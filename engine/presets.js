// Built-in presets, written in the same format the save button produces — so they exercise the
// loader on every use, and a preset that stops loading is caught the first time anyone opens one.
//
// They are grouped by which of the two operations does the work, because that is the distinction
// a new user has to learn and no amount of explaining beats seeing both lists.

import { PRESET_VERSION } from './state.js';

/* seed builders — plain arrays of x,y,z,material */

function fromPredicate(nx, ny, nz, fn, mat = 3) {
  const a = [];
  for (let x = 0; x < nx; x++) for (let y = 0; y < ny; y++) for (let z = 0; z < nz; z++) {
    const m = fn(x, y, z);
    if (m === false || m === null || m === undefined) continue;
    a.push(x, y, z, m === true ? mat : m);
  }
  return a;
}

function box(x0, y0, z0, x1, y1, z1, mat = 3) {
  const a = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
    a.push(x, y, z, mat);
  }
  return a;
}

const ones = (x, y, z) => (x === 1 ? 1 : 0) + (y === 1 ? 1 : 0) + (z === 1 ? 1 : 0);

/* the rules */

// The Menger rule is exactly the edge frame of a 3-cube: keep a cell unless two or more of its
// coordinates are the middle one.
const MENGER = fromPredicate(3, 3, 3, (x, y, z) => ones(x, y, z) <= 1 ? 2 : false);

// The same frame with its eight corners one material and its twelve edge middles another. A
// uniform rule cannot produce a multi-coloured sponge however the materials are combined — mixing
// one colour with itself gives one colour — so the variety has to start in the rule. With `mix`,
// a cell's material ends up as the sum along its address: which sub-cell it sat in at every
// level. That is a real property of the structure rather than a stripe painted on it.
const MENGER_TONED = fromPredicate(3, 3, 3,
  (x, y, z) => ones(x, y, z) <= 1 ? (ones(x, y, z) === 0 ? 2 : 6) : false);

// Something deliberately lopsided. A symmetry operation applied to a symmetric shape does
// nothing, so the seeds in the symmetry group have to be scrap — the whole point is watching the
// group do the work.
// The Sierpinski carpet rule, extruded the full depth of its own box. Substituting keeps it an
// extrusion; intersecting it with its two rotations is the classical construction of the Menger
// sponge, and it needs intersect mode to say so.
const CARPET_BAR = fromPredicate(3, 3, 3, (x, y, z) => (x === 1 && y === 1) ? false : 9);

// Corners one colour, edge middles another. Under a rule per material the two grow into
// different shapes: the corners into dust, the edges into a frame, sharing one box.
const TWO_RULE = fromPredicate(3, 3, 3,
  (x, y, z) => ones(x, y, z) === 0 ? 2 : ones(x, y, z) === 1 ? 10 : false);

// The same two rules on colours that walk somewhere else under "colour from both": 5 plus 5 is
// 10, which has a rule; 10 plus 10 wraps to 4, which has none.
const MIX_RULE = fromPredicate(3, 3, 3,
  (x, y, z) => ones(x, y, z) === 0 ? 5 : ones(x, y, z) === 1 ? 10 : false);

const CHIP = [
  0, 0, 0, 3,  1, 0, 0, 3,  2, 0, 0, 3,
  0, 1, 0, 7,  0, 2, 0, 7,
  1, 1, 1, 11, 2, 0, 1, 11
];

// The 3D plus: centre plus its six face neighbours.
const VICSEK = fromPredicate(3, 3, 3, (x, y, z) => ones(x, y, z) >= 2 ? 8 : false);

// Eight corners, nothing else.
const DUST = fromPredicate(3, 3, 3, (x, y, z) => (x !== 1 && y !== 1 && z !== 1) ? 10 : false);

// Four cells of a 2-cube, alternating — the lattice's tetrahedron.
const TETRA = [0, 0, 0, 14, 1, 1, 0, 14, 1, 0, 1, 14, 0, 1, 1, 14];

const CHECKER = fromPredicate(3, 3, 3, (x, y, z) => ((x + y + z) % 2 === 0) ? 9 : false);

// A 5-cube with a cross bored through each axis: the Jerusalem family, lattice-legal at n = 5.
const JERUSALEM = fromPredicate(5, 5, 5, (x, y, z) => {
  const mid = v => v === 2;
  const near = v => v >= 1 && v <= 3;
  const bored = (mid(x) && near(y) && near(z)) || (mid(y) && near(x) && near(z)) ||
                (mid(z) && near(x) && near(y));
  return bored ? false : 5;
});

function opSub(count, extra) {
  return Object.assign({ type: 'substitute', on: true, count, nMode: 'auto', n: 3,
                         matMode: 'outer', matShift: 0 }, extra || {});
}
function opRep(count, extra) {
  return Object.assign({ type: 'replicate', on: true, count,
                         rx: 0, ry: 0, rz: 0, mx: 0, my: 0, mz: 0, s: 1,
                         tx: 0, ty: 0, tz: 0, px: 0, py: 0, pz: 0,
                         tUnit: 'cell', matShift: 0 }, extra || {});
}

function opSym(group, extra) {
  return Object.assign({ type: 'symmetrise', on: true, count: 0, group, axis: 1,
                         px: 0, py: 0, pz: 0, half: 0, matShift: 0 }, extra || {});
}

function P(name, group, seed, ops, s) {
  return { v: PRESET_VERSION, name, group, s: s || {}, seed, ops };
}

/* ── the list ─────────────────────────────────────────────────────────────────────────── */

export const PRESETS = [
  P('Menger sponge', 'Substitute',
    MENGER, [opSub(2)]),

  P('Menger, coloured by address', 'Substitute',
    MENGER_TONED, [opSub(3, { matMode: 'mix', matShift: 5 })]),

  P('Vicsek cross', 'Substitute',
    VICSEK, [opSub(2)]),

  P('Cantor dust', 'Substitute',
    DUST, [opSub(3)]),

  P('Sierpinski tetrahedron', 'Substitute',
    TETRA, [opSub(5)]),

  P('Checkerboard sponge', 'Substitute',
    CHECKER, [opSub(2, { matMode: 'inner' })]),

  P('Jerusalem cube', 'Substitute',
    JERUSALEM, [opSub(1)]),

  // A 3x3 slab with a corner bitten out, turned a quarter and lifted, forty times over. The
  // lattice cannot make a smooth helix — 90 degrees is the finest turn there is — so this is the
  // square one, which is the honest shape of the constraint rather than a workaround for it.
  P('Square helix', 'Replicate',
    box(0, 0, 0, 3, 0, 0, 6).concat(box(3, 0, 1, 3, 0, 3, 6)),
    [opRep(40, { ry: 1, ty: 1, px: 2, pz: 2 })]),

  P('Twisting tower', 'Replicate',
    fromPredicate(5, 1, 5, (x, y, z) => (x === 0 || z === 0 || x === 4 || z === 4) ? 3 : false),
    [opRep(48, { ry: 1, ty: 1, px: 2, pz: 2, matShift: 1 })]),

  P('Colonnade', 'Replicate',
    box(0, 0, 0, 0, 8, 0, 1).concat(box(-1, 9, -1, 1, 9, 1, 0), box(-1, -1, -1, 1, -1, 1, 4)),
    [opRep(6, { tx: 4 }), opRep(3, { tz: 5 })]),

  // Replicate builds the arm, substitute turns the arm into a rule for itself. The second
  // replicate swings a copy into Z — without it the whole thing stays in one plane, which is a
  // handsome tile and not what a branch lattice is for.
  P('Branch lattice', 'Both',
    box(0, 0, 0, 0, 2, 0, 7),
    [opRep(1, { rz: 1, tx: 1, ty: 2 }), opRep(1, { ry: 1, px: 0, pz: 0 }),
     opSub(2, { matMode: 'mix', matShift: 3 })]),

  P('Mirrored sponge tower', 'Both',
    MENGER, [opSub(1), opRep(1, { my: 1, py: 8, ty: 1 }), opRep(3, { tx: 10 })]),

  /* ── the stack-run family ───────────────────────────────────────────────────────────────
     These three need `iters`, and none of them is reachable with a single pass of the stack.
     The first two move in shape widths, so the offset grows with the shape and every run is a
     scaled copy of the last; the third leans on the other half of it, that a substitute given a
     shape it has already grown re-derives its rule from that shape. */

  // A three-cell stem, copied twice a shape-width up and across with a quarter turn, then swung
  // into Z. Five runs of that is a recursive branch: 7,078 cells in a 50 x 61 x 50 box.
  P('Branching growth', 'Runs',
    box(0, 0, 0, 0, 2, 0, 7),
    [opRep(2, { tx: 1, ty: 1, tUnit: 'span', rz: 1, matShift: 2 }), opRep(1, { ry: 1 })],
    { iters: 5 }),

  // One post, doubled in height and given a quarter turn each run. Height is 2^runs, exactly.
  P('Doubling twist', 'Runs',
    box(0, 0, 0, 1, 1, 1, 6),
    [opRep(1, { ty: 1, tUnit: 'span', ry: 1, matShift: 1 })],
    { iters: 5 }),

  // Depth 1 twice is not depth 2: the second run substitutes the 400-cell shape into itself
  // rather than the 20-cell rule, so this is the sponge at the resolution depth 3 would give.
  P('Sponge by runs', 'Runs',
    MENGER, [opSub(1, { matMode: 'mix', matShift: 4 })], { iters: 2 }),

  /* ── symmetry ───────────────────────────────────────────────────────────────────────────
     Each of these starts from a lopsided scrap of cells, because a symmetry operation applied to
     an already-symmetric shape does nothing at all. The group is doing the work, and the seed is
     there to have something to work on. */

  P('Kaleidoscope tower', 'Symmetry',
    CHIP, [opSym('quarterMir', { axis: 1, matShift: 2 }),
           opRep(2, { ty: 1, tUnit: 'span', ry: 1 })]),

  P('Snowflake sponge', 'Symmetry',
    CHIP, [opSub(1), opSym('quarterMir', { axis: 1, matShift: 2 })]),

  P('Cube group, then fractal', 'Symmetry',
    CHIP, [opSym('full', { matShift: 1 }), opSub(1)]),

  P('Tetrahedral dust', 'Symmetry',
    CHIP, [opSym('tetra'), opSub(1, { matMode: 'mix', matShift: 3 })]),

  P('Mirrored on three axes', 'Symmetry',
    CHIP, [opRep(3, { ty: 3 }), opSym('mirror3')]),

  /* ── scope and mode ─────────────────────────────────────────────────────────────────────
     What the two new fields on every op are for. Each of these is unreachable without them. */

  // The sponge, then its own coarse cells used as a chisel: substitute again inside one colour
  // only, and cut rather than add.
  P('Carved sponge', 'Scope',
    MENGER_TONED, [opSub(1, { matMode: 'mix', matShift: 5 }),
                   opRep(1, { tx: 1, mode: 'remove', scope: 'material', scopeMat: 13 })]),

  // Replicate with one copy and replace is a move, so the whole stack walks the shape upward
  // while a symmetrise mirrors what is left behind.
  P('Walked and mirrored', 'Scope',
    CHIP, [opRep(1, { ty: 4, mode: 'replace' }), opSym('mirror', { axis: 1, half: 1 })],
    { iters: 4 }),

  // The Menger sponge the way it is actually defined: three orthogonal extrusions of the
  // Sierpinski carpet, intersected. The three-fold about the body diagonal supplies the other two
  // extrusions, and intersect mode does the rest. 8,000 cells, and not one of them placed.
  P('Menger by intersection', 'Scope',
    CARPET_BAR, [opSub(2), opSym('triad', { mode: 'intersect' })]),

  // Substitute only the cells in the lower half of the box, so the fractal grows out of a solid.
  P('Fractal on a plinth', 'Scope',
    box(0, 0, 0, 4, 4, 4, 2),
    [opSub(1, { nMode: 'fixed', n: 3, scope: 'box', bx1: 4, by1: 1, bz1: 4 })]),

  /* ── a rule per material ────────────────────────────────────────────────────────────────
     Two colours, two rules, one frame. The eight corners grow into corners; the twelve edge
     middles grow into edges. Same seed, same grid, two different fractals interleaved. */

  P('Dust and frame', 'Rules',
    TWO_RULE, [opSub(3, { ruleMode: 'material', matMode: 'inner' })]),

  // The same two rules, but each pass hands its cells to the other rule: a material step of 8
  // maps 3 to 11 and 11 back to 3, so corners grow into edges and edges into corners. A two-step
  // cycle, and a different shape from either rule on its own.
  P('Alternating rules', 'Rules',
    TWO_RULE, [opSub(3, { ruleMode: 'material', matMode: 'inner', matShift: 8 })]),

  // What a terminal looks like. Under "colour from both" a cell's next state is its own colour
  // plus the rule's, which here walks both states onto colours that have no rule of their own —
  // so the second pass is the last one that grows, and after it the shape only spreads.
  P('Grows, then sets', 'Rules',
    MIX_RULE, [opSub(2, { ruleMode: 'material', matMode: 'mix' })])
];

/* Starter seeds for the Seed panel — the shapes worth having one click away, because typing a
   3-cube frame in by hand is twenty clicks nobody should spend twice. */
export const STARTERS = {
  cell: [0, 0, 0, 3],
  cube2: box(0, 0, 0, 1, 1, 1, 3),
  cube3: box(0, 0, 0, 2, 2, 2, 3),
  menger: MENGER,
  vicsek: VICSEK,
  dust: DUST,
  tetra: TETRA,
  checker: CHECKER
};

export function presetByName(name) {
  return PRESETS.find(p => p.name === name) || null;
}
