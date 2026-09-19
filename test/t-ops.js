import { suite, test, ok, eq, deepEq, note } from './harness.js';
import { CellSet } from '../engine/cells.js';
import { PRESETS } from '../engine/presets.js';
import { apply } from '../engine/state.js';
import { defaultOp, sanitizeOp, runOp, evaluate, predictNext, opLabel,
         DEFAULT_CAP, MAX_ITERS } from '../engine/ops.js';
import { groupMatrices, groupOrder, symmetryImage,
         SYMMETRY_GROUPS } from '../engine/lattice.js';

const rep = o => Object.assign(defaultOp('replicate'), { count: 1, ty: 0 }, o);
const sub = o => Object.assign(defaultOp('substitute'), o);

function cube(n, mat = 0) { return CellSet.box(0, 0, 0, n - 1, n - 1, n - 1, mat); }

function menger() {
  const s = new CellSet();
  for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) for (let z = 0; z < 3; z++) {
    const mid = (x === 1 ? 1 : 0) + (y === 1 ? 1 : 0) + (z === 1 ? 1 : 0);
    if (mid <= 1) s.set(x, y, z, 2);
  }
  return s;
}

function vicsek() {
  const s = new CellSet();
  for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) for (let z = 0; z < 3; z++) {
    const mid = (x === 1 ? 1 : 0) + (y === 1 ? 1 : 0) + (z === 1 ? 1 : 0);
    if (mid >= 2) s.set(x, y, z, 8);
  }
  return s;
}

export default function () {
  suite('ops / substitute', () => {

    test('the Menger rule is the edge frame of the 3-cube', () => {
      eq(menger().size, 20);
      deepEq(menger().bounds().size, [3, 3, 3]);
    });

    test('Menger depth counts are exact', () => {
      const r1 = runOp(menger(), sub({ count: 1 }), DEFAULT_CAP);
      eq(r1.cells.size, 400);
      deepEq(r1.cells.bounds().size, [9, 9, 9]);
      const r2 = runOp(menger(), sub({ count: 2 }), DEFAULT_CAP);
      eq(r2.cells.size, 8000);
      deepEq(r2.cells.bounds().size, [27, 27, 27]);
      const r3 = runOp(menger(), sub({ count: 3 }), DEFAULT_CAP);
      eq(r3.cells.size, 160000);
      deepEq(r3.cells.bounds().size, [81, 81, 81]);
    });

    test('the rule is captured once, so count is depth rather than a doubling', () => {
      // Two separate depth-1 ops must equal one depth-2 op. If the second op re-derived its rule
      // from the 400-cell shape it would produce 160000 instead.
      const once = runOp(menger(), sub({ count: 2 }), DEFAULT_CAP).cells;
      const twice = evaluate(menger(), [sub({ count: 1 }), sub({ count: 1 })], 1e9).cells;
      eq(once.size, 8000);
      eq(twice.size, 160000, 'stacking two ops re-derives the rule — that is the documented path');
      ok(!once.equals(twice));
    });

    test('Vicsek and Cantor dust match their closed forms', () => {
      eq(runOp(vicsek(), sub({ count: 1 }), DEFAULT_CAP).cells.size, 49);
      eq(runOp(vicsek(), sub({ count: 2 }), DEFAULT_CAP).cells.size, 343);
      const dust = new CellSet();
      for (const x of [0, 2]) for (const y of [0, 2]) for (const z of [0, 2]) dust.set(x, y, z, 1);
      eq(dust.size, 8);
      eq(runOp(dust, sub({ count: 3 }), DEFAULT_CAP).cells.size, 4096);
    });

    test('a solid cube substitutes into a bigger solid cube', () => {
      const r = runOp(cube(2), sub({ count: 1 }), DEFAULT_CAP);
      eq(r.cells.size, 64);
      deepEq(r.cells.bounds().size, [4, 4, 4]);
      ok(r.cells.equals(CellSet.box(0, 0, 0, 3, 3, 3)));
    });

    test('a non-cubic rule keeps its aspect on every axis', () => {
      const bar = CellSet.box(0, 0, 0, 3, 0, 0);        // 4 x 1 x 1
      const r = runOp(bar, sub({ count: 1 }), DEFAULT_CAP);
      eq(r.cells.size, 16);
      deepEq(r.cells.bounds().size, [16, 1, 1]);
    });

    test('a one-cell rule is refused rather than silently doing nothing', () => {
      const one = new CellSet(); one.set(0, 0, 0, 0);
      const r = runOp(one, sub({ count: 3 }), DEFAULT_CAP);
      eq(r.cells.size, 1);
      ok(/identity/.test(r.note), 'expected a note explaining why nothing happened');
    });

    test('the shape stays where it was put', () => {
      const moved = new CellSet();
      const arr = menger().toArray();
      for (let i = 0; i < arr.length; i += 4) moved.set(arr[i] - 7, arr[i + 1] + 20, arr[i + 2], arr[i + 3]);
      const r = runOp(moved, sub({ count: 1 }), DEFAULT_CAP);
      deepEq(r.cells.bounds().min, [-7, 20, 0], 'substitution is anchored at the bounds minimum');
    });

    test('keep original only adds cells when the rule misses its own corner', () => {
      // A rule that occupies its bounds-minimum corner reproduces the original inside its first
      // block, so "keep" is a no-op. Menger does; Vicsek does not. Worth knowing before reaching
      // for the toggle and concluding it is broken.
      eq(runOp(menger(), sub({ count: 1, keep: 1 }), DEFAULT_CAP).cells.size, 400);
      eq(runOp(vicsek(), sub({ count: 1, keep: 0 }), DEFAULT_CAP).cells.size, 49);
      eq(runOp(vicsek(), sub({ count: 1, keep: 1 }), DEFAULT_CAP).cells.size, 56);
    });

    test('fixed grid overlaps instead of tiling, and stays exact', () => {
      const r = runOp(cube(3), sub({ count: 1, nMode: 'fixed', n: 2 }), DEFAULT_CAP);
      // 27 cells each stamped with a 3-cube at 2x spacing: union covers [0,8)^3 minus nothing.
      deepEq(r.cells.bounds().size, [7, 7, 7]);
      eq(r.cells.size, 343);
    });

    test('material modes do what they say', () => {
      const a = new CellSet();
      a.set(0, 0, 0, 1); a.set(1, 0, 0, 4);
      const inner = runOp(a, sub({ count: 1, matMode: 'inner' }), DEFAULT_CAP).cells;
      const outer = runOp(a, sub({ count: 1, matMode: 'outer' }), DEFAULT_CAP).cells;
      const mix = runOp(a, sub({ count: 1, matMode: 'mix' }), DEFAULT_CAP).cells;
      eq(inner.get(0, 0, 0), 1); eq(inner.get(1, 0, 0), 4);
      eq(outer.get(0, 0, 0), 1); eq(outer.get(1, 0, 0), 1);
      eq(mix.get(1, 0, 0), 5);
      const shift = runOp(a, sub({ count: 1, matMode: 'outer', matShift: 3 })).cells;
      eq(shift.get(0, 0, 0), 4);
    });

    test('the budget refuses a pass rather than half-running it', () => {
      const r = runOp(menger(), sub({ count: 3 }), 10000);
      eq(r.cells.size, 8000, 'result is the last complete depth');
      eq(r.ran, 2);
      ok(/depth 3/.test(r.stopped), r.stopped);
    });

    test('the prediction matches what actually happens', () => {
      const p = predictNext(menger(), sub({ count: 2 }));
      eq(p.cost, 8000);
      eq(runOp(menger(), sub({ count: 2 }), DEFAULT_CAP).cells.size, p.cost);
    });
  });

  suite('ops / replicate', () => {

    test('a column is the seed plus one cell per copy', () => {
      const one = new CellSet(); one.set(0, 0, 0, 3);
      const r = runOp(one, rep({ count: 4, ty: 1 }), DEFAULT_CAP);
      eq(r.cells.size, 5);
      deepEq(r.cells.bounds().size, [1, 5, 1]);
    });

    test('copies are taken from the previous copy, so the transform compounds', () => {
      const one = new CellSet(); one.set(0, 0, 0, 0);
      const r = runOp(one, rep({ count: 3, tx: 2, ty: 1 }), DEFAULT_CAP);
      eq(r.cells.size, 4);
      ok(r.cells.has(6, 3, 0), 'the fourth cell is at 3 x (2,1,0)');
    });

    test('a quarter turn about the shape makes a pinwheel that closes', () => {
      const arm = CellSet.box(0, 0, 0, 3, 0, 0, 1);
      const r = runOp(arm, rep({ count: 3, ry: 1, px: 0, pz: 0 }), DEFAULT_CAP);
      // Four arms sharing the pivot cell: 4 x 4 - 3 duplicates at the centre.
      eq(r.cells.size, 13);
      const r2 = runOp(arm, rep({ count: 7, ry: 1 }), DEFAULT_CAP);
      eq(r2.cells.size, 13, 'a fifth quarter turn lands back on the first arm');
    });

    test('scale turns one cell into a block, growing away from the anchor', () => {
      const one = new CellSet(); one.set(0, 0, 0, 0);
      const r = runOp(one, rep({ count: 1, s: 2, tx: 4 }), DEFAULT_CAP);
      eq(r.cells.size, 9);
      ok(r.cells.has(4, 0, 0) && r.cells.has(5, 1, 1));
      const m = runOp(one, rep({ count: 1, s: 2, mx: 1, tx: -4 }), DEFAULT_CAP);
      ok(m.cells.has(-4, 0, 0) && m.cells.has(-5, 1, 1), 'a flipped axis grows the other way');
    });

    test('a mirror with a pivot reflects about that column', () => {
      const a = new CellSet(); a.set(0, 0, 0, 0); a.set(1, 0, 0, 0);
      const r = runOp(a, rep({ count: 1, mx: 1, px: 3 }), DEFAULT_CAP);
      ok(r.cells.has(6, 0, 0) && r.cells.has(5, 0, 0));
      eq(r.cells.size, 4);
    });

    test('the identity transform is called out instead of doing nothing quietly', () => {
      const a = cube(2);
      const r = runOp(a, rep({ count: 5 }), DEFAULT_CAP);
      eq(r.cells.size, 8);
      ok(/identity/.test(r.note), r.note);
    });

    test('the budget stops between copies and keeps the whole ones', () => {
      const blob = cube(10);                      // 1000 cells
      const r = runOp(blob, rep({ count: 9, tx: 12 }), 3500);
      eq(r.cells.size, 3000);
      eq(r.ran, 2);
      ok(/budget/.test(r.stopped), r.stopped);
    });

    test('a refused copy leaves no trace of itself behind', () => {
      const blob = cube(10);
      const r = runOp(blob, rep({ count: 9, tx: 12, matShift: 1 }), 3500);
      for (const [, v] of r.cells.m) ok(v <= 2, 'no cell carries a material from the refused copy');
    });

    test('material shift accumulates one step per copy', () => {
      const one = new CellSet(); one.set(0, 0, 0, 0);
      const r = runOp(one, rep({ count: 3, ty: 1, matShift: 2 }), DEFAULT_CAP);
      eq(r.cells.get(0, 0, 0), 0);
      eq(r.cells.get(0, 1, 0), 2);
      eq(r.cells.get(0, 2, 0), 4);
      eq(r.cells.get(0, 3, 0), 6);
    });

    test('an empty seed is not an error', () => {
      const r = runOp(new CellSet(), rep({ count: 4, ty: 1 }), DEFAULT_CAP);
      eq(r.cells.size, 0);
      ok(r.note);
    });
  });

  suite('ops / stack', () => {

    test('the stack re-runs from the seed and nothing is destructive', () => {
      const seed = menger();
      const ops = [sub({ count: 1 }), rep({ count: 1, tx: 12 })];
      const a = evaluate(seed, ops, DEFAULT_CAP);
      const b = evaluate(seed, ops, DEFAULT_CAP);
      eq(seed.size, 20, 'the seed is untouched');
      eq(a.cells.size, 800);
      ok(a.cells.equals(b.cells), 'evaluation is deterministic');
    });

    test('a disabled op is skipped without changing anything downstream', () => {
      const seed = cube(2);
      const on = evaluate(seed, [sub({ count: 1 }), rep({ count: 1, tx: 8 })], DEFAULT_CAP);
      const off = evaluate(seed, [sub({ count: 1, on: false }), rep({ count: 1, tx: 8 })], DEFAULT_CAP);
      eq(on.cells.size, 128);
      eq(off.cells.size, 16);
      eq(off.steps[0].skipped, true);
    });

    test('order matters, and the stack proves it', () => {
      const seed = CellSet.box(0, 0, 0, 1, 0, 0);
      const a = evaluate(seed, [rep({ count: 1, tx: 4 }), sub({ count: 1 })], 1e7).cells;
      const b = evaluate(seed, [sub({ count: 1 }), rep({ count: 1, tx: 4 })], 1e7).cells;
      ok(!a.equals(b));
    });

    test('a cap hit is reported up through evaluate', () => {
      const r = evaluate(menger(), [sub({ count: 4 })], 10000);
      ok(r.capHit);
      eq(r.cells.size, 8000);
    });
  });

  suite('ops / file format', () => {

    test('sanitize fills in what is missing and drops what is not ours', () => {
      const o = sanitizeOp({ type: 'replicate', count: 3, nonsense: 9, ry: 7 });
      eq(o.count, 3);
      eq(o.ry, 3, 'quarter turns wrap into 0..3');
      ok(!('nonsense' in o));
      eq(sanitizeOp({ type: 'nope' }), null);
    });

    test('out of range values are clamped, not trusted', () => {
      const o = sanitizeOp({ type: 'replicate', count: 1e6, s: -4, matShift: -1 });
      eq(o.count, 256);
      eq(o.s, 1);
      eq(o.matShift, 15);
    });
  });

  suite('ops / materials', () => {

    test('a uniform rule cannot produce a multi-coloured substitution, whatever the mode', () => {
      // Worth pinning: mixing one colour with itself is one colour, so "colour by recursion"
      // starts in the rule or it does not happen.
      const rule = new CellSet();
      for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) rule.set(x, y, 0, 4);
      for (const mode of ['inner', 'outer', 'mix']) {
        const r = evaluate(rule, [sub({ count: 2, matMode: mode, matShift: 3 })], DEFAULT_CAP);
        eq(new Set([...r.cells.m.values()]).size, 1, mode + ' should stay one colour');
      }
    });

    test('a two-material rule under mix spreads across the structure', () => {
      const rule = new CellSet();
      for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) rule.set(x, y, 0, x === 1 ? 6 : 2);
      const r = evaluate(rule, [sub({ count: 2, matMode: 'mix', matShift: 5 })], DEFAULT_CAP);
      ok(new Set([...r.cells.m.values()]).size >= 3,
         'got ' + new Set([...r.cells.m.values()]).size + ' materials');
    });

    test('the coloured sponge preset actually comes out coloured', () => {
      const p = PRESETS.find(x => x.name === 'Menger, coloured by address');
      ok(p, 'the preset should exist under that name');
      const st = apply(p).state;
      const cells = evaluate(st.seed, st.ops, st.cap, st.iters).cells;
      const seen = new Set([...cells.m.values()]);
      ok(seen.size >= 4, 'a preset that promises colour must deliver it: ' + seen.size);
      note('coloured sponge uses ' + seen.size + ' materials across ' +
           cells.size.toLocaleString() + ' cells');
    });
  });

  suite('ops / symmetrise', () => {

    const sym = o => Object.assign(defaultOp('symmetrise'), o);

    /** A lopsided scrap — symmetrising something already symmetric proves nothing. */
    const chip = () => {
      const c = new CellSet();
      [[0, 0, 0, 3], [1, 0, 0, 3], [2, 0, 0, 3],
       [0, 1, 0, 7], [0, 2, 0, 7], [1, 1, 1, 11]].forEach(([x, y, z, m]) => c.set(x, y, z, m));
      return c;
    };

    /** The real test of a symmetry operation: the result maps onto itself under every element. */
    function invariant(cells, op) {
      const mats = groupMatrices(op.group, op.axis);
      const h = op.half ? 1 : 0;
      const pivot2 = [2 * (op.px | 0) + h, 2 * (op.py | 0) + h, 2 * (op.pz | 0) + h];
      const keys = cells.toArray();
      for (const M of mats) {
        for (let i = 0; i < keys.length; i += 4) {
          const q = symmetryImage(M, [keys[i], keys[i + 1], keys[i + 2]], pivot2);
          if (cells.get(q[0], q[1], q[2]) === null) return false;
        }
      }
      return true;
    }

    test('the result is invariant under its own group — every group, every axis', () => {
      for (const g of SYMMETRY_GROUPS) {
        for (const axis of (g.axial ? [0, 1, 2] : [1])) {
          for (const half of [0, 1]) {
            const op = sym({ group: g.name, axis, half, px: 1, py: 0, pz: 1 });
            const r = evaluate(chip(), [op], DEFAULT_CAP);
            ok(!r.capHit, g.name);
            ok(invariant(r.cells, op), g.name + ' about ' + axis + ' half=' + half);
          }
        }
      }
    });

    test('doing it twice changes nothing — a symmetric shape is already at the fixed point', () => {
      for (const name of ['mirror3', 'quarterMir', 'tetra', 'full']) {
        const op = sym({ group: name });
        const once = evaluate(chip(), [op], DEFAULT_CAP);
        const twice = evaluate(chip(), [op, op], DEFAULT_CAP);
        deepEq(twice.cells.toArray(), once.cells.toArray(), name);
        eq(evaluate(chip(), [op], DEFAULT_CAP, 4).settled, 2, name + ' should settle at run 2');
      }
    });

    test('a mirror doubles a shape that does not straddle the plane', () => {
      const c = new CellSet();
      c.set(2, 0, 0, 1); c.set(3, 0, 0, 1);
      const off = evaluate(c, [sym({ group: 'mirror', axis: 0, px: 0 })], DEFAULT_CAP);
      eq(off.cells.size, 4);
      deepEq(off.cells.bounds().min, [-3, 0, 0]);
      eq(off.cells.bounds().size[0], 7, 'plane through the middle of cell 0: an odd width');
    });

    test('the half-cell flag puts the plane between cells, giving an even width', () => {
      const c = new CellSet();
      c.set(0, 0, 0, 1); c.set(1, 0, 0, 1); c.set(2, 0, 0, 1);
      const odd = evaluate(c, [sym({ group: 'mirror', axis: 0, px: 0, half: 0 })], DEFAULT_CAP);
      const even = evaluate(c, [sym({ group: 'mirror', axis: 0, px: 0, half: 1 })], DEFAULT_CAP);
      eq(odd.cells.size, 5, 'reflected about the centre of cell 0: -2..2');
      eq(odd.cells.bounds().size[0], 5);
      eq(odd.cells.bounds().size[0] % 2, 1, 'a plane through cell centres gives an odd width');
      // The plane now sits between cells 0 and 1, so those two already mirror each other.
      eq(even.cells.size, 4);
      deepEq(even.cells.bounds().min, [-1, 0, 0]);
      eq(even.cells.bounds().size[0] % 2, 0, 'a plane on the boundary gives an even width');
    });

    test('a shape already symmetric about the plane is left exactly alone', () => {
      const c = new CellSet();
      c.set(-1, 0, 0, 2); c.set(0, 0, 0, 2); c.set(1, 0, 0, 2);
      const r = evaluate(c, [sym({ group: 'mirror', axis: 0 })], DEFAULT_CAP);
      deepEq(r.cells.toArray(), c.toArray());
    });

    test('the original keeps its materials; images take the shift', () => {
      const c = new CellSet();
      c.set(1, 0, 0, 4);
      const r = evaluate(c, [sym({ group: 'mirror', axis: 0, matShift: 3 })], DEFAULT_CAP);
      eq(r.cells.get(1, 0, 0), 4, 'first wins — the shape you drew is not repainted');
      eq(r.cells.get(-1, 0, 0), 7, 'the image is shifted by one step');
    });

    test('an overlap does not double-shift, because first still wins', () => {
      const c = new CellSet();
      c.set(0, 0, 0, 4);                      // sits on the mirror plane
      const r = evaluate(c, [sym({ group: 'mirror', axis: 0, matShift: 3 })], DEFAULT_CAP);
      eq(r.cells.size, 1);
      eq(r.cells.get(0, 0, 0), 4);
    });

    test('the budget refuses the whole op and leaves the shape untouched', () => {
      const c = new CellSet();
      for (let x = 0; x < 20; x++) c.set(x + 5, 0, 0, 1);
      const r = evaluate(c, [sym({ group: 'full' })], 100);
      ok(r.capHit);
      eq(r.cells.size, 20, 'a half-symmetrised shape is asymmetric — the point of refusing');
      deepEq(r.cells.toArray(), c.toArray());
      ok(/budget/.test(r.stoppedAt.why), r.stoppedAt.why);
    });

    test('an image off the end of the lattice is reported as that', () => {
      const c = new CellSet();
      c.set(60000, 0, 0, 1);
      const r = evaluate(c, [sym({ group: 'mirror', axis: 0, px: -60000 })], DEFAULT_CAP);
      ok(r.capHit);
      ok(/lattice/.test(r.stoppedAt.why), r.stoppedAt.why);
      eq(r.cells.size, 1);
    });

    test('an empty shape is a no-op with a reason, not an error', () => {
      const r = runOp(new CellSet(), sym({ group: 'full' }), DEFAULT_CAP);
      eq(r.cells.size, 0);
      eq(r.ran, 0);
      ok(/nothing/.test(r.note));
    });

    test('the cost line names the number of images', () => {
      const p = predictNext(chip(), sym({ group: 'tetra' }));
      eq(p.cost, 6 * 12);
      ok(/12 images/.test(p.text), p.text);
    });

    test('a nonsense group or axis is clamped on load', () => {
      const a = sanitizeOp({ type: 'symmetrise', group: 'icosahedral', axis: 9, half: true });
      eq(a.group, 'mirror');
      eq(a.axis, 0);
      eq(a.half, 1);
      eq(sanitizeOp({ type: 'symmetrise', half: 'yes' }).half, 0,
         'a value that is not a number at all keeps the default');
      const b = sanitizeOp({ type: 'symmetrise', group: 'tetra', axis: -1 });
      eq(b.group, 'tetra');
      eq(b.axis, 2, 'a negative axis wraps rather than throwing');
    });

    test('the label says which group, how many images, and where', () => {
      const t = opLabel(sym({ group: 'quarterMir', axis: 2, px: 3, half: 1 }));
      ok(t.includes('quarter turns + mirrors'), t);
      ok(t.includes('about Z'), t);
      ok(t.includes('x8'), t);
      ok(t.includes('half-cell'), t);
      ok(t.includes('3,0,0'), t);
    });

    test('order in the stack matters, as it does everywhere else here', () => {
      const first = evaluate(chip(), [sym({ group: 'mirror3' }), sub({ count: 1 })], DEFAULT_CAP);
      const last = evaluate(chip(), [sub({ count: 1 }), sym({ group: 'mirror3' })], DEFAULT_CAP);
      ok(first.cells.size !== last.cells.size,
         'symmetrise then substitute is not substitute then symmetrise');
      ok(invariant(last.cells, sym({ group: 'mirror3' })), 'the last word still holds');
    });
  });

  suite('ops / stack runs', () => {

    const one = () => { const c = new CellSet(); c.set(0, 0, 0, 1); return c; };

    test('one run is exactly what a single pass always did', () => {
      const ops = [rep({ count: 3, tx: 2 })];
      const a = evaluate(cube(2), ops, DEFAULT_CAP);
      const b = evaluate(cube(2), ops, DEFAULT_CAP, 1);
      deepEq(a.cells.toArray(), b.cells.toArray());
      eq(b.ran, 1);
      eq(b.iters, 1);
    });

    test('n runs of a stack equal one run of that stack written out n times', () => {
      const op = rep({ count: 2, tx: 1, tUnit: 'span' });
      const looped = evaluate(one(), [op], DEFAULT_CAP, 4);
      const spelt = evaluate(one(), [op, op, op, op], DEFAULT_CAP, 1);
      deepEq(looped.cells.toArray(), spelt.cells.toArray());
    });

    test('a translation fixed in cells does NOT compound — this is why spans exist', () => {
      // The offset stays put while the shape grows, so each run just extends the line by one.
      const r = evaluate(one(), [rep({ count: 1, tx: 4 })], DEFAULT_CAP, 5);
      eq(r.cells.size, 6, 'arithmetic, not geometric');
      eq(r.gens.join(','), '1,2,3,4,5,6');
    });

    test('a translation in spans builds the Cantor set exactly', () => {
      // One cell, copy two shape-widths along x, and the attractor is the middle-thirds set:
      // 2^k cells inside 3^k.
      for (let k = 1; k <= 6; k++) {
        const r = evaluate(one(), [rep({ count: 1, tx: 2, tUnit: 'span' })], DEFAULT_CAP, k);
        eq(r.cells.size, Math.pow(2, k), `run ${k} cell count`);
        eq(r.cells.bounds().size[0], Math.pow(3, k), `run ${k} extent`);
      }
    });

    test('spans on three axes give the same dust the substitute route gives', () => {
      const ax = a => rep({ count: 1, tx: 0, ty: 0, tz: 0, tUnit: 'span', [a]: 2 });
      const r = evaluate(one(), [ax('tx'), ax('ty'), ax('tz')], DEFAULT_CAP, 4);
      eq(r.cells.size, Math.pow(8, 4));
      deepEq(r.cells.bounds().size, [81, 81, 81]);
    });

    test('the substitute route re-derives its rule, so runs are not the same as depth', () => {
      const seed = cube(2);                                  // 8 cells, 2x2x2
      const depth2 = evaluate(seed, [sub({ count: 2 })], DEFAULT_CAP, 1);
      const twice = evaluate(seed, [sub({ count: 1 })], DEFAULT_CAP, 2);
      eq(depth2.cells.size, 8 * 8 * 8, 'depth 2 is rule^3');
      eq(twice.cells.size, 64 * 64, 'run 2 substitutes the 64-cell shape into itself');
      ok(depth2.cells.size !== twice.cells.size);
    });

    test('gens records the count after every run', () => {
      const r = evaluate(one(), [rep({ count: 1, tx: 2, tUnit: 'span' })], DEFAULT_CAP, 3);
      eq(r.gens.join(','), '1,2,4,8');
      eq(r.ran, 3);
    });

    test('a stack that maps the shape to itself settles and stops early', () => {
      // A quarter turn about the origin closes after four copies; running it again adds nothing.
      const r = evaluate(one(), [rep({ count: 1, tx: 3, rz: 1 })], DEFAULT_CAP, 12);
      eq(r.settled, 4);
      eq(r.ran, 4, 'eight further runs would have been wasted work');
      eq(r.cells.size, 4);
    });

    test('an empty stack settles immediately rather than looping sixteen times', () => {
      const r = evaluate(cube(2), [], DEFAULT_CAP, 16);
      eq(r.settled, 1);
      eq(r.ran, 1);
      eq(r.cells.size, 8);
    });

    test('a disabled op is skipped on every run, not just the first', () => {
      const off = rep({ count: 1, tx: 2, tUnit: 'span' }); off.on = false;
      const r = evaluate(one(), [off], DEFAULT_CAP, 5);
      eq(r.cells.size, 1);
      eq(r.settled, 1);
    });

    test('the budget stops the run it cannot afford and says which one', () => {
      const r = evaluate(one(), [rep({ count: 1, tx: 2, tUnit: 'span' })], 20, 16);
      ok(r.capHit);
      ok(r.stoppedAt, 'the stop should be located');
      eq(r.stoppedAt.iter, 5, '16 cells fit in 20, 32 do not');
      eq(r.cells.size, 16, 'the result is the last complete step');
      ok(/budget/.test(r.stoppedAt.why));
    });

    test('running off the lattice is reported as that, not as a budget failure', () => {
      const r = evaluate(one(), [rep({ count: 1, tx: 2, tUnit: 'span' })], DEFAULT_CAP, MAX_ITERS);
      ok(r.capHit, 'span 2 doubles the extent every run; the lattice ends before 16 runs do');
      ok(/lattice/.test(r.stoppedAt.why), 'got: ' + r.stoppedAt.why);
    });

    test('the run count is clamped rather than trusted', () => {
      eq(evaluate(one(), [], DEFAULT_CAP, 0).iters, 1);
      eq(evaluate(one(), [], DEFAULT_CAP, -3).iters, 1);
      eq(evaluate(one(), [], DEFAULT_CAP, 9e9).iters, MAX_ITERS);
      eq(evaluate(one(), [], DEFAULT_CAP, NaN).iters, 1);
    });

    test('steps come from the last run, so the cards price the big numbers', () => {
      const r = evaluate(one(), [rep({ count: 1, tx: 2, tUnit: 'span' })], DEFAULT_CAP, 4);
      eq(r.steps.length, 1);
      eq(r.steps[0].incoming.size, 8, 'the fourth run started from eight cells');
      eq(r.steps[0].size, 16);
    });

    test('a mirror fills the gap the same offset leaves open without one', () => {
      // Worth knowing before it surprises you: the reflected copy attaches from its far end, so
      // two shape-widths mirrored closes up into a solid run (2^k cells across 2^(k+1)-1) where
      // the unmirrored version leaves Cantor gaps (2^k cells across 3^k).
      for (let k = 1; k <= 3; k++) {
        const r = evaluate(one(), [rep({ count: 1, tx: 2, tUnit: 'span', mx: 1 })], DEFAULT_CAP, k);
        eq(r.cells.size, Math.pow(2, k), `run ${k} cells`);
        eq(r.cells.bounds().size[0], Math.pow(2, k + 1) - 1, `run ${k} extent`);
      }
    });
  });

  note('Menger depth 3 = 160,000 cells in a 81^3 box — 9.0% dense');
}
