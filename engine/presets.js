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
                         keep: 0, matMode: 'outer', matShift: 0 }, extra || {});
}
function opRep(count, extra) {
  return Object.assign({ type: 'replicate', on: true, count,
                         rx: 0, ry: 0, rz: 0, mx: 0, my: 0, mz: 0, s: 1,
                         tx: 0, ty: 0, tz: 0, px: 0, py: 0, pz: 0, matShift: 0 }, extra || {});
}

function P(name, group, seed, ops, s) {
  return { v: PRESET_VERSION, name, group, s: s || {}, seed, ops };
}

/* ── the list ─────────────────────────────────────────────────────────────────────────── */

export const PRESETS = [
  P('Menger sponge', 'Substitute',
    MENGER, [opSub(2)]),

  P('Menger, coloured by depth', 'Substitute',
    MENGER, [opSub(3, { matMode: 'mix', matShift: 5 })]),

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
    MENGER, [opSub(1), opRep(1, { my: 1, py: 8, ty: 1 }), opRep(3, { tx: 10 })])
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
