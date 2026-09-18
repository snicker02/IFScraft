import { suite, test, ok, eq, deepEq, note } from './harness.js';
import { CellSet } from '../engine/cells.js';
import { defaultOp, sanitizeOp, runOp, evaluate, predictNext,
         DEFAULT_CAP, MAX_ITERS } from '../engine/ops.js';

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
