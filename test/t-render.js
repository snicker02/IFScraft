import { suite, test, ok, eq, deepEq, near, note } from './harness.js';
import { CellSet } from '../engine/cells.js';
import { buildMesh, countFaces, buildIndexedQuads, MAX_FACES_PER_CHUNK, VERTEX_BYTES } from '../engine/mesh.js';
import { raycastCells, raycastGround, pick } from '../engine/raycast.js';
import { toFly, toOrbit, cameraEye, cameraForward, screenRay, viewProj,
         mat4Perspective, mat4LookAt, mat4Mul, frameBounds, PITCH_LIMIT } from '../engine/camera.js';
import { newState, capture, apply, encode, decode, History, DEFAULTS, PRESET_VERSION } from '../engine/state.js';
import { toOBJ, toCSV } from '../engine/exporters.js';
import { defaultOp } from '../engine/ops.js';

export default function () {
  suite('mesh', () => {

    test('a lone cell shows all six faces', () => {
      const s = new CellSet(); s.set(0, 0, 0, 0);
      eq(countFaces(s), 6);
      const m = buildMesh(s);
      eq(m.faces, 6);
      eq(m.chunks.length, 1);
      eq(m.chunks[0].vertices, 24);
      eq(m.chunks[0].indices.length, 36);
    });

    test('interior faces are culled — a solid N-cube shows 6N^2', () => {
      for (const n of [1, 2, 3, 5, 8]) {
        eq(countFaces(CellSet.box(0, 0, 0, n - 1, n - 1, n - 1)), 6 * n * n, `N=${n}`);
      }
    });

    test('two touching cells hide the faces between them', () => {
      const s = new CellSet(); s.set(0, 0, 0, 0); s.set(1, 0, 0, 0);
      eq(countFaces(s), 10);
    });

    test('buffers are sized exactly and indices stay inside the chunk', () => {
      const s = CellSet.box(0, 0, 0, 19, 19, 19);       // 2400 exposed faces
      const m = buildMesh(s);
      eq(m.faces, 6 * 400);
      let verts = 0, faces = 0;
      for (const c of m.chunks) {
        eq(c.data.byteLength, c.vertices * VERTEX_BYTES);
        eq(c.indices.length, c.faces * 6);
        eq(c.vertices, c.faces * 4);
        for (let i = 0; i < c.indices.length; i++) ok(c.indices[i] < c.vertices, 'index in range');
        verts += c.vertices; faces += c.faces;
      }
      eq(faces, m.faces);
      eq(verts, m.faces * 4);
    });

    test('a mesh past 16384 faces splits into addressable chunks', () => {
      const s = CellSet.box(0, 0, 0, 59, 59, 59);       // 21600 faces
      const m = buildMesh(s);
      eq(m.faces, 21600);
      ok(m.chunks.length >= 2, 'expected more than one chunk');
      for (const c of m.chunks) {
        ok(c.faces <= MAX_FACES_PER_CHUNK);
        ok(c.vertices <= 65536, 'vertices must be addressable by a 16-bit index');
      }
      eq(m.chunks.reduce((a, c) => a + c.faces, 0), m.faces);
    });

    test('face positions are the integer corners of the cell', () => {
      const s = new CellSet(); s.set(2, 3, 4, 0);
      const m = buildMesh(s);
      const f = new Float32Array(m.chunks[0].data);
      for (let v = 0; v < 24; v++) {
        const o = v * 5;                                 // 20 bytes / 4
        for (let a = 0; a < 3; a++) ok(Number.isInteger(f[o + a]), 'corner must be integral');
      }
    });

    test('all six normals appear, once each, four vertices apiece', () => {
      const s = new CellSet(); s.set(0, 0, 0, 0);
      const m = buildMesh(s);
      const i8 = new Int8Array(m.chunks[0].data);
      const seen = new Map();
      for (let v = 0; v < 24; v++) {
        const o = v * VERTEX_BYTES;
        const key = [i8[o + 12], i8[o + 13], i8[o + 14]].join(',');
        seen.set(key, (seen.get(key) || 0) + 1);
      }
      eq(seen.size, 6);
      for (const [, n] of seen) eq(n, 4);
    });

    test('an unoccluded cell gets full ambient light everywhere', () => {
      const s = new CellSet(); s.set(0, 0, 0, 0);
      const u8 = new Uint8Array(buildMesh(s).chunks[0].data);
      for (let v = 0; v < 24; v++) eq(u8[v * VERTEX_BYTES + 19], 255, 'AO should be clear');
    });

    test('a cell tucked into a corner gets darkened', () => {
      const s = CellSet.box(0, 0, 0, 2, 2, 2);
      s.delete(1, 1, 2);                                 // a pocket with occluded corners
      const m = buildMesh(s);
      let dark = 0;
      for (const c of m.chunks) {
        const u8 = new Uint8Array(c.data);
        for (let v = 0; v < c.vertices; v++) if (u8[v * VERTEX_BYTES + 19] < 255) dark++;
      }
      ok(dark > 0, 'expected some occluded vertices');
    });

    test('an empty set meshes to nothing rather than throwing', () => {
      const m = buildMesh(new CellSet());
      eq(m.faces, 0); eq(m.chunks.length, 0);
    });

    test('the OBJ geometry deduplicates corners exactly', () => {
      const s = new CellSet(); s.set(0, 0, 0, 0);
      const q = buildIndexedQuads(s);
      eq(q.verts.length / 3, 8, 'a cube has eight corners, not twenty-four');
      let faces = 0;
      for (const [, list] of q.groups) faces += list.length;
      eq(faces, 6);
    });
  });

  suite('raycast', () => {

    test('a ray down the axis hits the first cell and names the face', () => {
      const s = new CellSet(); s.set(5, 0, 0, 0); s.set(9, 0, 0, 0);
      const h = raycastCells(s, [0.5, 0.5, 0.5], [1, 0, 0]);
      deepEq(h.cell, [5, 0, 0]);
      deepEq(h.normal, [-1, 0, 0]);
      near(h.t, 4.5, 1e-9);
    });

    test('a miss is a miss', () => {
      const s = new CellSet(); s.set(5, 0, 0, 0);
      eq(raycastCells(s, [0.5, 0.5, 0.5], [0, 1, 0]), null);
      eq(raycastCells(new CellSet(), [0, 0, 0], [1, 1, 1]), null);
    });

    test('faces are found from every direction', () => {
      const s = new CellSet(); s.set(0, 0, 0, 0);
      const cases = [
        [[-6, 0.5, 0.5], [1, 0, 0], [-1, 0, 0]],
        [[6, 0.5, 0.5], [-1, 0, 0], [1, 0, 0]],
        [[0.5, -6, 0.5], [0, 1, 0], [0, -1, 0]],
        [[0.5, 6, 0.5], [0, -1, 0], [0, 1, 0]],
        [[0.5, 0.5, -6], [0, 0, 1], [0, 0, -1]],
        [[0.5, 0.5, 6], [0, 0, -1], [0, 0, 1]]
      ];
      for (const [o, d, n] of cases) {
        const h = raycastCells(s, o, d);
        ok(h, 'expected a hit from ' + o);
        deepEq(h.normal, n);
      }
    });

    test('the ground plane catches what the cells do not', () => {
      const g = raycastGround([0, 10, 0], [0, -1, 0]);
      deepEq(g.cell, [0, 0, 0]);
      eq(raycastGround([0, 10, 0], [0, 1, 0]), null, 'up never meets the ground');
      const g2 = raycastGround([3.7, 4, -2.2], [0, -1, 0]);
      deepEq(g2.cell, [3, 0, -3], 'floor, not truncate');
    });

    test('pick reports the cell to remove and the cell to fill', () => {
      const s = new CellSet(); s.set(0, 0, 0, 0);
      const p = pick(s, [-6, 0.5, 0.5], [1, 0, 0]);
      deepEq(p.target, [0, 0, 0]);
      deepEq(p.place, [-1, 0, 0]);
      const g = pick(new CellSet(), [2.5, 8, 3.5], [0, -1, 0]);
      eq(g.target, null);
      deepEq(g.place, [2, 0, 3]);
      ok(g.ground);
    });

    test('a ray starting inside a cell still resolves', () => {
      const s = new CellSet(); s.set(0, 0, 0, 0);
      const h = raycastCells(s, [0.5, 0.5, 0.5], [0, 0, 1]);
      deepEq(h.cell, [0, 0, 0]);
      eq(h.t, 0);
    });
  });

  suite('camera', () => {

    test('orbit to flight and back is exact', () => {
      const s = newState({ camAzim: 0.9, camElev: 0.35, camDist: 12, tgtX: 3, tgtY: -2, tgtZ: 7 });
      const before = { eye: cameraEye(s), fwd: cameraForward(s) };
      toFly(s); toOrbit(s);
      const after = { eye: cameraEye(s), fwd: cameraForward(s) };
      for (let i = 0; i < 3; i++) {
        near(after.eye[i], before.eye[i], 1e-12, 'eye');
        near(after.fwd[i], before.fwd[i], 1e-12, 'forward');
      }
      near(s.camDist, 12, 1e-12);
    });

    test('flight to orbit and back is exact', () => {
      const s = newState({ camMode: 1, flyX: -4, flyY: 9, flyZ: 2, flyYaw: 2.1, flyPitch: -0.6 });
      const before = { eye: cameraEye(s), fwd: cameraForward(s) };
      toOrbit(s); toFly(s);
      const after = { eye: cameraEye(s), fwd: cameraForward(s) };
      for (let i = 0; i < 3; i++) {
        near(after.eye[i], before.eye[i], 1e-12, 'eye');
        near(after.fwd[i], before.fwd[i], 1e-12, 'forward');
      }
    });

    test('the handover survives a hundred round trips without drifting', () => {
      const s = newState({ camAzim: -2.2, camElev: 0.8, camDist: 30, tgtY: 5 });
      const e0 = cameraEye(s);
      for (let i = 0; i < 100; i++) { toFly(s); toOrbit(s); }
      const e1 = cameraEye(s);
      for (let i = 0; i < 3; i++) near(e1[i], e0[i], 1e-9, 'eye after 100 round trips');
    });

    test('pitch stops short of vertical, where the frame would spin on itself', () => {
      const s = newState({ camMode: 1, flyPitch: 10 });
      toOrbit(s); toFly(s);
      ok(Math.abs(s.flyPitch) <= PITCH_LIMIT + 1e-12);
    });

    test('the ray through screen centre is the view direction', () => {
      const s = newState({ camAzim: 1.1, camElev: 0.3, camDist: 8 });
      const r = screenRay(s, 0, 0, 1.7);
      const f = cameraForward(s);
      const l = Math.hypot(r.dir[0], r.dir[1], r.dir[2]);
      for (let i = 0; i < 3; i++) near(r.dir[i] / l, f[i], 1e-12);
      deepEq(r.origin, cameraEye(s));
    });

    test('rays spread the way the field of view says they do', () => {
      const s = newState({ camAzim: 0, camElev: 0, camDist: 5, fov: 1.0 });
      const f = cameraForward(s);
      const r = screenRay(s, 1, 0, 1);
      const l = Math.hypot(r.dir[0], r.dir[1], r.dir[2]);
      const cos = (r.dir[0] * f[0] + r.dir[1] * f[1] + r.dir[2] * f[2]) / l;
      near(Math.acos(cos), Math.atan(Math.tan(0.5)), 1e-12, 'half the fov at the right edge');
    });

    test('a point in front of the camera lands inside the clip volume', () => {
      const s = newState({ camMode: 1, flyX: 0, flyY: 0, flyZ: 10, flyYaw: Math.PI, flyPitch: 0 });
      const vp = viewProj(s, 1.5);
      const p = [0, 0, 0, 1];
      const c = [0, 1, 2, 3].map(r => vp[r] * p[0] + vp[4 + r] * p[1] + vp[8 + r] * p[2] + vp[12 + r]);
      ok(c[3] > 0, 'w must be positive in front of the camera');
      near(c[0] / c[3], 0, 1e-9); near(c[1] / c[3], 0, 1e-9);
      ok(c[2] / c[3] > -1 && c[2] / c[3] < 1, 'inside the depth range');
    });

    test('framing a box puts it in front of the camera at a sane distance', () => {
      const s = newState();
      const b = { min: [0, 0, 0], max: [26, 26, 26], size: [27, 27, 27] };
      frameBounds(s, b);
      near(s.tgtX, 13.5, 1e-12);
      ok(s.camDist > 20 && s.camDist < 120, 'distance ' + s.camDist);
      eq(s.camMode, 0);
    });
  });

  suite('state', () => {

    test('a capture round trips through JSON with the seed and stack intact', () => {
      const s = newState({ camDist: 44, material: 7, cap: 250000 });
      s.seed.set(1, 2, 3, 9); s.seed.set(-4, 0, 0, 2);
      s.ops.push(defaultOp('substitute'), Object.assign(defaultOp('replicate'), { count: 6, tx: 5 }));
      const back = decode(encode(s, 'round trip'));
      eq(back.warnings.length, 0);
      eq(back.name, 'round trip');
      eq(back.state.camDist, 44);
      eq(back.state.material, 7);
      ok(back.state.seed.equals(s.seed));
      eq(back.state.ops.length, 2);
      eq(back.state.ops[1].count, 6);
      eq(back.state.ops[1].tx, 5);
    });

    test('the run count and the translate unit survive a round trip', () => {
      const s = newState({ iters: 6 });
      s.seed.set(0, 0, 0, 1);
      s.ops.push(Object.assign(defaultOp('replicate'), { tUnit: 'span', tx: 2 }));
      const back = decode(encode(s, ''));
      eq(back.warnings.length, 0);
      eq(back.state.iters, 6);
      eq(back.state.ops[0].tUnit, 'span');
      eq(back.state.ops[0].tx, 2);
    });

    test('a nonsense run count or translate unit is clamped on load, not trusted', () => {
      const a = apply({ v: 1, s: { iters: 999 }, seed: [], ops: [] });
      eq(a.state.iters, 16);
      const b = apply({ v: 1, s: { iters: 0 }, seed: [], ops: [] });
      eq(b.state.iters, 1);
      const c = apply({ v: 1, seed: [], ops: [{ type: 'replicate', tUnit: 'furlongs' }] });
      eq(c.state.ops[0].tUnit, 'cell');
    });

    test('defaults are omitted, so a preset stays small and reproducible', () => {
      const s = newState();
      const c = capture(s, 'empty');
      deepEq(c.s, {});
      eq(c.v, PRESET_VERSION);
      const moved = newState({ camDist: DEFAULTS.camDist + 1 });
      deepEq(Object.keys(capture(moved).s), ['camDist']);
    });

    test('an unknown op is skipped with a warning, not silently dropped', () => {
      const r = apply({ v: 1, s: {}, seed: [], ops: [{ type: 'teleport' }, { type: 'substitute', count: 2 }] });
      eq(r.state.ops.length, 1);
      eq(r.state.ops[0].count, 2);
      eq(r.warnings.length, 1);
    });

    test('a file from a newer build loads and says so', () => {
      const r = apply({ v: PRESET_VERSION + 5, s: { camDist: 9 }, seed: [], ops: [] });
      eq(r.state.camDist, 9);
      ok(/newer/.test(r.warnings[0]), r.warnings[0]);
    });

    test('rubbish in does not throw', () => {
      ok(decode('{not json').warnings.length > 0);
      ok(apply(null).warnings.length > 0);
      eq(apply({}).state.seed.size, 0);
    });

    test('undo and redo walk the seed and the stack together', () => {
      const h = new History();
      let s = newState();
      s.seed.set(0, 0, 0, 1);
      h.push(s);
      s.seed.set(1, 0, 0, 1);
      s.ops.push(defaultOp('substitute'));
      eq(s.seed.size, 2);

      const undone = h.undo(s);
      eq(undone.seed.size, 1);
      eq(undone.ops.length, 0);
      ok(h.canRedo);

      const redone = h.redo(undone);
      eq(redone.seed.size, 2);
      eq(redone.ops.length, 1);
      ok(!h.canRedo);
    });

    test('history is bounded', () => {
      const h = new History(5);
      const s = newState();
      for (let i = 0; i < 20; i++) h.push(s);
      eq(h.past.length, 5);
    });
  });

  suite('export', () => {

    test('an OBJ of one cell is eight vertices and six quads', () => {
      const s = new CellSet(); s.set(0, 0, 0, 5);
      const { obj, mtl, vertices } = toOBJ(s, { name: 'unit' });
      eq(vertices, 8);
      const lines = obj.split('\n');
      eq(lines.filter(l => l.startsWith('v ')).length, 8);
      eq(lines.filter(l => l.startsWith('vn ')).length, 6);
      eq(lines.filter(l => l.startsWith('f ')).length, 6);
      ok(/newmtl clay/.test(mtl), 'the material library names the material used');
      ok(/mtllib unit\.mtl/.test(obj));
    });

    test('every OBJ face index is one-based and inside the vertex list', () => {
      const s = CellSet.box(0, 0, 0, 3, 3, 3);
      s.delete(1, 1, 1);
      const { obj, vertices } = toOBJ(s);
      for (const l of obj.split('\n')) {
        if (!l.startsWith('f ')) continue;
        for (const tok of l.slice(2).trim().split(/\s+/)) {
          const vi = parseInt(tok.split('//')[0], 10);
          const ni = parseInt(tok.split('//')[1], 10);
          ok(vi >= 1 && vi <= vertices, 'vertex index ' + vi + ' of ' + vertices);
          ok(ni >= 1 && ni <= 6, 'normal index ' + ni);
        }
      }
    });

    test('each material becomes its own group', () => {
      const s = new CellSet();
      s.set(0, 0, 0, 1); s.set(4, 0, 0, 9);
      const { obj } = toOBJ(s);
      const used = obj.split('\n').filter(l => l.startsWith('usemtl '));
      eq(used.length, 2);
    });

    test('CSV names materials rather than numbering them', () => {
      const s = new CellSet(); s.set(1, 2, 3, 0);
      eq(toCSV(s).trim().split('\n')[1], '1,2,3,chalk');
    });
  });

  note('mesh vertex is ' + VERTEX_BYTES + ' bytes; a 400k-cell build at 2 faces per cell is ' +
       Math.round(400000 * 2 * 4 * VERTEX_BYTES / 1048576) + ' MB of buffer');
}
