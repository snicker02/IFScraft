// Merged mesh generation. Pure — it hands back plain typed arrays and never touches GL, so the
// face counts are testable headlessly, which is where almost every meshing bug actually lives.
//
// A face is emitted only where a solid cell touches an empty one. Interior faces are invisible
// and they are the overwhelming majority: a solid N-cube has 6N^2 exposed faces against 3N^2(N-1)
// interior ones, so culling alone is worth roughly N/2. Greedy merging of coplanar runs would be
// worth more again, and is deliberately not here yet — it complicates per-vertex ambient occlusion
// and the win is smaller than the first one.
//
// CHUNKING. WebGL1 has 16-bit indices unless OES_element_index_uint is present. Rather than make
// the renderer depend on an extension, the mesh comes out in chunks of at most 16384 faces
// (65536 vertices), which is always addressable. Fifty draw calls for a half-million-cell build
// costs nothing measurable and works everywhere.
//
// VERTEX LAYOUT, 20 bytes interleaved:
//   0  aPos    3 x float32
//   12 aNorm   3 x int8   (normalised)  + 1 pad
//   16 aCol    4 x uint8  (normalised)  rgb + ambient occlusion in alpha

import { pack, unpackX, unpackY, unpackZ } from './cells.js';
import { matColor } from './palette.js';

export const MAX_FACES_PER_CHUNK = 16384;
export const VERTEX_BYTES = 20;

/* Six faces. `u` cross `v` equals the normal, so corners taken in the order
   base, base+u, base+u+v, base+v are counter-clockwise seen from outside. That is derived rather
   than guessed, which is why there is no flipped-winding case to chase later. */
const FACES = [
  { n: [ 1, 0, 0], base: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
  { n: [-1, 0, 0], base: [0, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [0,  1, 0], base: [0, 1, 0], u: [0, 0, 1], v: [1, 0, 0] },
  { n: [0, -1, 0], base: [0, 0, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0,  1], base: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { n: [0, 0, -1], base: [0, 0, 0], u: [0, 1, 0], v: [1, 0, 0] }
];

/* Four ambient-occlusion steps. The darkest is not black: a fully tucked corner in a Menger
   sponge is a large fraction of the visible surface at depth 3, and crushing it loses the
   structure the whole tool exists to show. */
const AO_LEVELS = [0.46, 0.64, 0.82, 1.0];

/** Count exposed faces without building anything. Cheap enough to run on every rebuild, and it
    is what the buffer sizes are allocated from. */
export function countFaces(cells) {
  let n = 0;
  for (const k of cells.m.keys()) {
    const x = unpackX(k), y = unpackY(k), z = unpackZ(k);
    for (let f = 0; f < 6; f++) {
      const d = FACES[f].n;
      if (!cells.m.has(pack(x + d[0], y + d[1], z + d[2]))) n++;
    }
  }
  return n;
}

function aoLevel(cells, nx, ny, nz, du, dv) {
  const s1 = cells.m.has(pack(nx + du[0], ny + du[1], nz + du[2])) ? 1 : 0;
  const s2 = cells.m.has(pack(nx + dv[0], ny + dv[1], nz + dv[2])) ? 1 : 0;
  if (s1 && s2) return 0;
  const c = cells.m.has(pack(nx + du[0] + dv[0], ny + du[1] + dv[1], nz + du[2] + dv[2])) ? 1 : 0;
  return 3 - (s1 + s2 + c);
}

/**
 * Build the merged mesh.
 * @returns {{chunks: Array, faces: number, cells: number}} each chunk is
 *          { data: ArrayBuffer, vertices, indices: Uint16Array, faces }
 */
export function buildMesh(cells, opts = {}) {
  const ao = opts.ao !== false;
  const faces = countFaces(cells);
  const chunks = [];
  if (faces === 0) return { chunks, faces: 0, cells: cells.size };

  let cap = 0, view = null, f32 = null, u8 = null, i8 = null, idx = null, fcount = 0;

  const openChunk = (want) => {
    cap = Math.min(MAX_FACES_PER_CHUNK, want);
    const buf = new ArrayBuffer(cap * 4 * VERTEX_BYTES);
    view = buf; f32 = new Float32Array(buf); u8 = new Uint8Array(buf); i8 = new Int8Array(buf);
    idx = new Uint16Array(cap * 6);
    fcount = 0;
  };
  const closeChunk = () => {
    if (!view || fcount === 0) return;
    chunks.push({
      data: view.slice(0, fcount * 4 * VERTEX_BYTES),
      vertices: fcount * 4,
      indices: idx.slice(0, fcount * 6),
      faces: fcount
    });
    view = null;
  };

  let remaining = faces;
  openChunk(remaining);

  const p = [0, 0, 0];
  for (const [k, mat] of cells.m) {
    const cx = unpackX(k), cy = unpackY(k), cz = unpackZ(k);
    const col = matColor(mat);
    const r = Math.round(col[0] * 255), g = Math.round(col[1] * 255), b = Math.round(col[2] * 255);

    for (let fi = 0; fi < 6; fi++) {
      const F = FACES[fi];
      const nx = cx + F.n[0], ny = cy + F.n[1], nz = cz + F.n[2];
      if (cells.m.has(pack(nx, ny, nz))) continue;

      if (fcount === cap) { closeChunk(); remaining = faces - chunks.reduce((a, c) => a + c.faces, 0); openChunk(remaining); }

      const base = fcount * 4;
      const a = new Array(4);
      // corner order (0,0) (1,0) (1,1) (0,1) in u,v
      const UV = [[0, 0], [1, 0], [1, 1], [0, 1]];
      for (let ci = 0; ci < 4; ci++) {
        const iu = UV[ci][0], iv = UV[ci][1];
        p[0] = cx + F.base[0] + F.u[0] * iu + F.v[0] * iv;
        p[1] = cy + F.base[1] + F.u[1] * iu + F.v[1] * iv;
        p[2] = cz + F.base[2] + F.u[2] * iu + F.v[2] * iv;

        let level = 3;
        if (ao) {
          const du = [F.u[0] * (2 * iu - 1), F.u[1] * (2 * iu - 1), F.u[2] * (2 * iu - 1)];
          const dv = [F.v[0] * (2 * iv - 1), F.v[1] * (2 * iv - 1), F.v[2] * (2 * iv - 1)];
          level = aoLevel(cells, nx, ny, nz, du, dv);
        }
        a[ci] = level;

        const o = (base + ci) * VERTEX_BYTES;
        f32[o / 4] = p[0]; f32[o / 4 + 1] = p[1]; f32[o / 4 + 2] = p[2];
        i8[o + 12] = F.n[0] * 127; i8[o + 13] = F.n[1] * 127; i8[o + 14] = F.n[2] * 127;
        i8[o + 15] = 0;
        u8[o + 16] = r; u8[o + 17] = g; u8[o + 18] = b;
        u8[o + 19] = Math.round(AO_LEVELS[level] * 255);
      }

      // Flip the split when the occlusion across one diagonal is lopsided, or the interpolation
      // shows the triangle seam as a visible crease across every tucked corner.
      const io = fcount * 6;
      if (a[0] + a[2] > a[1] + a[3]) {
        idx[io] = base; idx[io + 1] = base + 1; idx[io + 2] = base + 2;
        idx[io + 3] = base; idx[io + 4] = base + 2; idx[io + 5] = base + 3;
      } else {
        idx[io] = base + 1; idx[io + 1] = base + 2; idx[io + 2] = base + 3;
        idx[io + 3] = base + 1; idx[io + 4] = base + 3; idx[io + 5] = base;
      }
      fcount++;
    }
  }
  closeChunk();
  return { chunks, faces, cells: cells.size };
}

/** Deduplicated indexed geometry for OBJ export. Positions are integers, so the dedupe is exact
    rather than tolerance-based. */
export function buildIndexedQuads(cells) {
  const verts = [];             // flat x,y,z
  const lookup = new Map();
  const groups = new Map();     // material -> array of [i0,i1,i2,i3]

  const vid = (x, y, z) => {
    const key = pack(x, y, z);
    let i = lookup.get(key);
    if (i === undefined) { i = verts.length / 3; lookup.set(key, i); verts.push(x, y, z); }
    return i;
  };

  for (const [k, mat] of cells.m) {
    const cx = unpackX(k), cy = unpackY(k), cz = unpackZ(k);
    for (let fi = 0; fi < 6; fi++) {
      const F = FACES[fi];
      if (cells.m.has(pack(cx + F.n[0], cy + F.n[1], cz + F.n[2]))) continue;
      const q = [];
      const UV = [[0, 0], [1, 0], [1, 1], [0, 1]];
      for (let ci = 0; ci < 4; ci++) {
        const iu = UV[ci][0], iv = UV[ci][1];
        q.push(vid(cx + F.base[0] + F.u[0] * iu + F.v[0] * iv,
                   cy + F.base[1] + F.u[1] * iu + F.v[1] * iv,
                   cz + F.base[2] + F.u[2] * iu + F.v[2] * iv));
      }
      if (!groups.has(mat)) groups.set(mat, []);
      groups.get(mat).push({ q, n: fi });
    }
  }
  return { verts, groups, normals: FACES.map(f => f.n) };
}
