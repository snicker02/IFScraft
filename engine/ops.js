// The two operations and the stack that re-runs them from the seed. Pure — no DOM, no GL.
//
// REPLICATE copies the current shape N times under one transform, each copy taken from the
// previous one, so copy i is T^i applied to the seed. That is the array modifier: colonnades,
// staircases, spirals, towers. Not fractal, and it is what makes the tool usable for building.
//
// SUBSTITUTE replaces every cell with a scaled copy of the whole shape. This is the fractal one.
//
// THE RULE IS CAPTURED ONCE, AT THE TOP OF THE OP. A substitute with count 3 uses the shape as it
// entered the op as its rule for all three passes, so count is depth: count 2 on the 20-cell
// Menger rule gives 8000 cells, not 160000. Re-deriving the rule from the growing shape each pass
// would square the depth every step, which is both surprising and useless — the interesting
// depths would be 1, 2, 4, 8 and nothing between.
//
// SYMMETRISE is the third operation and the odd one out: it neither arrays nor recurses, it just
// unions the shape with its own images under a group. Idempotent by nature — the second
// application has nothing left to add.
//
// SCOPE AND MODE apply to all three. Scope picks what the operation READS — the whole shape, one
// material, or a box, optionally inverted — and everything outside the scope is left alone.
// Mode says how what the operation MAKES is combined with what was already there:
//
//     add        the shape plus the product            (copy, mirror, grow)
//     replace    the product, minus what it acted on   (move, substitute, re-cut)
//     remove     the shape minus the product           (carve)
//     intersect  only what the product and the shape agree on
//
// THE PRODUCT IS WHAT THE OP MAKES, NOT COUNTING WHAT IT WAS MADE FROM. Replicate's product is
// its copies without the source; symmetrise's is its images without the identity. That is what
// makes `replace` mean "move" on a replicate and "the reflection alone" on a symmetrise, and it
// is why `remove` carves with the copies rather than deleting the original outright.
//
// Under `intersect` the product's own images are intersected with each other rather than unioned,
// so a symmetrise keeps exactly the part of the shape that already had every partner — the
// symmetric core — and a replicate keeps the overlap of the whole array.
//
// THE BUDGET IS CHECKED BEFORE THE PASS THAT WOULD BLOW IT, and that pass is abandoned whole. A
// half-applied substitution is not a shape anyone asked for, so the result is always the last
// complete step.
//
// ITERATIONS run the whole stack again with its own output as the new input. That is a different
// thing from an op's own count, and deliberately so: a substitute re-derives its rule from the
// shape it is given, so on the second iteration it is substituting a rule that the first
// iteration built. Growth is per-iteration compounding rather than per-pass, which is the one
// behaviour a single stack pass cannot produce.
//
// An iteration that changes nothing ends the run: a stack whose transforms form a closed group
// reaches its fixed point and stays there, and grinding out twelve more copies of the same set is
// work nobody asked for. The count of iterations actually run is reported, not silently swallowed.

import { CellSet, pack, unpackX, unpackY, unpackZ, MAX_COORD, MIN_COORD } from './cells.js';
import { makeTransform, groupMatrices, groupOrder, symmetryImage,
         SYMMETRY_GROUPS } from './lattice.js';
import { PALETTE_SIZE, clampMat } from './palette.js';

export const DEFAULT_CAP = 400000;
export const MAX_CAP = 4000000;
export const MAX_ITERS = 16;

export const SCOPES = [
  { name: 'all',      label: 'the whole shape' },
  { name: 'material', label: 'one material' },
  { name: 'box',      label: 'a box region' }
];

export const MODES = [
  { name: 'add',       label: 'add to the shape' },
  { name: 'replace',   label: 'replace what it acted on' },
  { name: 'remove',    label: 'cut out of the shape' },
  { name: 'intersect', label: 'keep only the overlap' }
];

/** The fields every op carries, whatever it does. */
const COMMON = {
  scope: 'all', scopeMat: 0, scopeInv: 0,
  bx0: 0, by0: 0, bz0: 0, bx1: 8, by1: 8, bz1: 8
};

export const OP_DEFS = {
  replicate: {
    name: 'Replicate',
    blurb: 'Copy the shape N times under one transform. Each copy is taken from the last.',
    defaults: Object.assign({
      type: 'replicate', on: true, count: 4, mode: 'add',
      rx: 0, ry: 0, rz: 0, mx: 0, my: 0, mz: 0,
      s: 1, tx: 0, ty: 3, tz: 0, px: 0, py: 0, pz: 0,
      tUnit: 'cell', matShift: 0
    }, COMMON)
  },
  symmetrise: {
    name: 'Symmetrise',
    blurb: 'Union the shape with all its images under a symmetry group.',
    defaults: Object.assign({
      type: 'symmetrise', on: true, count: 0, mode: 'add',
      group: 'mirror', axis: 1, px: 0, py: 0, pz: 0, half: 0, matShift: 0
    }, COMMON)
  },
  substitute: {
    name: 'Substitute',
    blurb: 'Replace every cell with a scaled copy of the whole shape. Count is depth.',
    defaults: Object.assign({
      type: 'substitute', on: true, count: 1, mode: 'replace',
      nMode: 'auto', n: 3, matMode: 'outer', matShift: 0
    }, COMMON)
  }
};

export function defaultOp(type) {
  const d = OP_DEFS[type];
  if (!d) return null;
  return Object.assign({}, d.defaults);
}

/** Normalise an op read from a file: unknown keys dropped, missing keys defaulted, numbers
    coerced. Tolerant by design — a preset written by an older build still loads. */
export function sanitizeOp(raw) {
  if (!raw || !OP_DEFS[raw.type]) return null;
  const out = defaultOp(raw.type);
  for (const k of Object.keys(out)) {
    if (k === 'type' || !(k in raw)) continue;
    const dv = out[k];
    if (typeof dv === 'boolean') out[k] = !!raw[k];
    else if (typeof dv === 'number') out[k] = Number.isFinite(+raw[k]) ? Math.round(+raw[k]) : dv;
    else out[k] = String(raw[k]);
  }
  out.count = Math.max(0, Math.min(256, out.count | 0));

  if (!SCOPES.some(x => x.name === out.scope)) out.scope = 'all';
  if (!MODES.some(x => x.name === out.mode)) out.mode = OP_DEFS[out.type].defaults.mode;
  out.scopeMat = ((out.scopeMat | 0) % PALETTE_SIZE + PALETTE_SIZE) % PALETTE_SIZE;
  out.scopeInv = out.scopeInv ? 1 : 0;
  for (const k of ['bx0', 'by0', 'bz0', 'bx1', 'by1', 'bz1']) {
    out[k] = Math.max(MIN_COORD, Math.min(MAX_COORD, out[k] | 0));
  }
  for (const [lo, hi] of [['bx0', 'bx1'], ['by0', 'by1'], ['bz0', 'bz1']]) {
    if (out[lo] > out[hi]) { const t = out[lo]; out[lo] = out[hi]; out[hi] = t; }
  }
  // `keep` was the old name for "substitute, but union with the original", which is exactly what
  // mode `add` does. Files written before modes existed still load, and still mean it.
  if (out.type === 'substitute' && raw.keep && !('mode' in raw)) out.mode = 'add';

  if (out.type === 'symmetrise') {
    if (!SYMMETRY_GROUPS.some(g => g.name === out.group)) out.group = 'mirror';
    out.axis = ((out.axis | 0) % 3 + 3) % 3;
    out.half = out.half ? 1 : 0;
  } else if (out.type === 'replicate') {
    out.s = Math.max(1, Math.min(16, out.s | 0));
    out.rx &= 3; out.ry &= 3; out.rz &= 3;
    out.mx = out.mx ? 1 : 0; out.my = out.my ? 1 : 0; out.mz = out.mz ? 1 : 0;
    if (out.tUnit !== 'span') out.tUnit = 'cell';
  } else {
    out.n = Math.max(1, Math.min(64, out.n | 0));
    if (out.nMode !== 'fixed') out.nMode = 'auto';
    if (['inner', 'outer', 'mix'].indexOf(out.matMode) < 0) out.matMode = 'outer';
    out.count = Math.max(0, Math.min(12, out.count | 0));
  }
  out.matShift = ((out.matShift | 0) % PALETTE_SIZE + PALETTE_SIZE) % PALETTE_SIZE;
  return out;
}

/* ── scope ─────────────────────────────────────────────────────────────────────────────── */

/** Split the shape into what this op acts on and what it leaves alone.

    `rest` matters only for `replace`, which drops the selection and puts the product in its
    place; the other modes measure against the whole shape. A scope that selects nothing is not
    an error — it is an op that has nothing to do this run, which happens constantly while a
    stack is being built. */
export function selectScope(cells, op) {
  if (!op.scope || op.scope === 'all') return { sel: cells, rest: new CellSet(), whole: true };

  const sel = new CellSet(), rest = new CellSet();
  const inv = op.scopeInv ? 1 : 0;

  if (op.scope === 'material') {
    const want = clampMat(op.scopeMat | 0);
    for (const [k, v] of cells.m) {
      ((clampMat(v) === want) !== !!inv ? sel : rest).m.set(k, v);
    }
  } else {
    const x0 = op.bx0 | 0, y0 = op.by0 | 0, z0 = op.bz0 | 0;
    const x1 = op.bx1 | 0, y1 = op.by1 | 0, z1 = op.bz1 | 0;
    for (const [k, v] of cells.m) {
      const x = unpackX(k), y = unpackY(k), z = unpackZ(k);
      const inside = x >= x0 && x <= x1 && y >= y0 && y <= y1 && z >= z0 && z <= z1;
      ((inside !== !!inv) ? sel : rest).m.set(k, v);
    }
  }
  return { sel, rest, whole: false };
}

/* ── combining ─────────────────────────────────────────────────────────────────────────── */

/** Merge `src` into `out`, recording enough to undo it exactly if the budget is passed partway.
    `overwrite` is the difference between replicate, where a later copy repaints what it lands on,
    and symmetrise, where the shape you drew survives its own reflection. */
function mergeInto(out, src, overwrite, cap) {
  const added = [], changed = [];
  for (const [k, v] of src.m) {
    if (out.m.has(k)) {
      if (!overwrite) continue;
      const old = out.m.get(k);
      if (old !== v) { changed.push(k, old); out.m.set(k, v); }
    } else {
      if (out.m.size >= cap) {
        for (const a of added) out.m.delete(a);
        for (let j = 0; j < changed.length; j += 2) out.m.set(changed[j], changed[j + 1]);
        return false;
      }
      added.push(k);
      out.m.set(k, v);
    }
  }
  return true;
}

/** Keep only the keys `src` also has. Materials stay as they are in `out`. */
function intersectInto(out, src) {
  for (const k of [...out.m.keys()]) if (!src.m.has(k)) out.m.delete(k);
  return out;
}

/** Fold the op's product into the shape it entered with. */
function combine(cells, rest, product, mode) {
  if (mode === 'remove') {
    const out = cells.clone();
    for (const k of product.m.keys()) out.m.delete(k);
    return out;
  }
  if (mode === 'intersect') {
    const out = cells.clone();
    return intersectInto(out, product);
  }
  const out = (mode === 'replace' ? rest : cells).clone();
  for (const [k, v] of product.m) out.m.set(k, v);
  return out;
}

/* ── replicate ─────────────────────────────────────────────────────────────────────────── */

/** One application of T to a whole set. Returns { set, err } — `err` is 'cap' when the copy alone
    passes the budget and 'range' when it runs off the lattice, which are different failures and
    deserve different words in the status line. The union check happens outside. */
function applyTransform(src, T, matShift, cap) {
  const out = new CellSet();
  const s = T.s, M = T.M, pv = T.pivot, t = T.t, bo = T.blockOff;
  for (const [k, mat] of src.m) {
    const a = unpackX(k) - pv[0], b = unpackY(k) - pv[1], c = unpackZ(k) - pv[2];
    const ax = s * (M[0] * a + M[1] * b + M[2] * c) + pv[0] + t[0] + bo[0];
    const ay = s * (M[3] * a + M[4] * b + M[5] * c) + pv[1] + t[1] + bo[1];
    const az = s * (M[6] * a + M[7] * b + M[8] * c) + pv[2] + t[2] + bo[2];
    const nm = clampMat(mat + matShift);
    if (s === 1) {
      if (ax < MIN_COORD || ax > MAX_COORD || ay < MIN_COORD || ay > MAX_COORD ||
          az < MIN_COORD || az > MAX_COORD) return { set: null, err: 'range' };
      out.m.set(pack(ax, ay, az), nm);
    } else {
      if (ax < MIN_COORD || ax + s - 1 > MAX_COORD || ay < MIN_COORD || ay + s - 1 > MAX_COORD ||
          az < MIN_COORD || az + s - 1 > MAX_COORD) return { set: null, err: 'range' };
      for (let dx = 0; dx < s; dx++)
        for (let dy = 0; dy < s; dy++)
          for (let dz = 0; dz < s; dz++) out.m.set(pack(ax + dx, ay + dy, az + dz), nm);
    }
    if (out.m.size > cap) return { set: null, err: 'cap' };
  }
  return { set: out, err: null };
}

/** Resolve a replicate spec against the shape it is about to copy.

    WITH `tUnit: 'span'` THE TRANSLATION IS MEASURED IN BOUNDING BOXES OF THE CURRENT SHAPE, not
    in cells, and that is what makes stack iterations compound. A translation fixed in cells is
    absolute: run the same replicate again on a shape that has grown and the copy lands back
    inside it, so iterating gives an arithmetic progression (1, 2, 3, 4 cells) rather than
    structure. Measured in spans, the offset grows with the shape, so each iteration is a scaled
    copy of the last and the result is a genuine IFS attractor — one cell, translate 2 spans,
    six iterations is the Cantor set, exactly.

    The span is an integer cell count and the multiplier is an integer, so nothing here leaves the
    lattice. */
function resolveSpec(cells, op) {
  if (op.tUnit !== 'span') return op;
  const b = cells.bounds();
  if (!b) return op;
  return Object.assign({}, op, {
    tx: (op.tx | 0) * b.size[0],
    ty: (op.ty | 0) * b.size[1],
    tz: (op.tz | 0) * b.size[2]
  });
}

/** The copies, accumulated. For the union modes they go straight into `base` — a clone of the
    shape (or of what is outside the scope) — so the budget is measured against the real total and
    a copy that does not fit rolls back exactly. For intersect they are folded together instead,
    and a product that shrinks with every image can never pass the cap. */
function productReplicate(sel, op, cap, mode, base) {
  const T = makeTransform(resolveSpec(sel, op));
  const n = Math.max(0, op.count | 0);
  const intersecting = mode === 'intersect';
  const acc = intersecting ? null : base;
  let inter = null;
  let cur = sel;
  let ran = 0, stopped = null;

  if (T.isIdentity && !op.matShift) {
    return { out: intersecting ? sel.clone() : acc, ran: 0, stopped: null,
             note: 'transform is the identity — every copy lands on the original' };
  }

  for (let i = 0; i < n; i++) {
    const r = applyTransform(cur, T, op.matShift | 0, cap);
    if (!r.set) {
      stopped = r.err === 'range'
        ? `copy ${i + 1} runs off the lattice`
        : `copy ${i + 1} passes the ${cap.toLocaleString()} cell budget`;
      break;
    }
    const next = r.set;
    if (intersecting) {
      inter = inter === null ? next.clone() : intersectInto(inter, next);
    } else if (!mergeInto(acc, next, true, cap)) {
      // Copies overlap often — a half turn about a shape's own centre lands back on itself — so
      // refusing on the upper bound would refuse builds that actually fit. Union for real and
      // undo exactly the last one if the total goes over.
      stopped = `copy ${i + 1} passes the ${cap.toLocaleString()} cell budget`;
      break;
    }
    cur = next;
    ran++;
  }
  return { out: intersecting ? (inter || new CellSet()) : acc, ran, stopped, note: null };
}

/* ── substitute ────────────────────────────────────────────────────────────────────────── */

function combineMat(mode, outerMat, innerMat, shift) {
  let m;
  if (mode === 'inner') m = innerMat;
  else if (mode === 'mix') m = outerMat + innerMat;
  else m = outerMat;
  return clampMat(m + shift);
}

/** The images of the shape under a symmetry group.

    FIRST WINS on an overlap in the union modes, unlike replicate. The original shape is the thing
    you drew; its reflection landing on top of it should not repaint it, and with a material shift
    per image the difference is visible rather than theoretical.

    Under intersect the images are folded together instead of unioned, which leaves the cells that
    have a partner in every image — the symmetric core of what you drew.

    The whole op is refused if it would pass the budget, never half-applied: a half-symmetrised
    shape is asymmetric, which is the one thing this op exists to prevent. */
function productSymmetrise(sel, op, cap, mode, base) {
  const mats = groupMatrices(op.group, op.axis);
  const h = op.half ? 1 : 0;
  const pivot2 = [2 * (op.px | 0) + h, 2 * (op.py | 0) + h, 2 * (op.pz | 0) + h];
  const shift = op.matShift | 0;
  const intersecting = mode === 'intersect';
  const src = [...sel.m.entries()];
  const p = [0, 0, 0], q = [0, 0, 0];
  let inter = null;
  let ran = 0;

  for (let i = 1; i < mats.length; i++) {          // index 0 is the identity: not part of the product
    const M = mats[i];
    const image = new CellSet();
    for (const [k, mat] of src) {
      p[0] = unpackX(k); p[1] = unpackY(k); p[2] = unpackZ(k);
      symmetryImage(M, p, pivot2, q);
      if (q[0] < MIN_COORD || q[0] > MAX_COORD || q[1] < MIN_COORD || q[1] > MAX_COORD ||
          q[2] < MIN_COORD || q[2] > MAX_COORD) {
        return { out: null, ran, stopped: `image ${i + 1} runs off the lattice`, note: null };
      }
      image.m.set(pack(q[0], q[1], q[2]), clampMat(mat + shift * i));
    }
    if (intersecting) {
      inter = inter === null ? image : intersectInto(inter, image);
    } else if (!mergeInto(base, image, mode !== 'add', cap)) {
      return { out: null, ran,
               stopped: `image ${i + 1} passes the ${cap.toLocaleString()} cell budget`,
               note: null };
    }
    ran++;
  }

  return { out: intersecting ? (inter || new CellSet()) : base, ran, stopped: null,
           note: ran === 0 ? 'the group is just the identity' : null };
}

/** The substituted shape. One product, however many passes made it. */
function productSubstitute(sel, op, cap) {
  const bnd = sel.bounds();
  const norm = sel.normalized();
  const R = norm.set;
  const n = op.nMode === 'fixed'
    ? [Math.max(1, op.n | 0), Math.max(1, op.n | 0), Math.max(1, op.n | 0)]
    : bnd.size.slice();

  if (n[0] * n[1] * n[2] === 1) {
    return { out: sel.clone(), ran: 0, stopped: null,
             note: 'the rule is one cell wide — substitution is the identity' };
  }

  let cur = R;
  let ran = 0, stopped = null;
  const passes = Math.max(0, op.count | 0);
  const mode = op.matMode, shift = op.matShift | 0;

  for (let i = 0; i < passes; i++) {
    const cost = cur.size * R.size;
    if (cost > cap) { stopped = `depth ${i + 1} needs ${cost} cells`; break; }
    // The shape grows by a factor of n on each axis. Stop before the lattice does.
    const ext = [0, 1, 2].map(ax => (curExtent(cur, ax)) * n[ax]);
    if (ext.some(e => e > MAX_COORD)) { stopped = `depth ${i + 1} runs off the lattice`; break; }

    const next = new CellSet();
    for (const [pk, pm] of cur.m) {
      const px = unpackX(pk) * n[0], py = unpackY(pk) * n[1], pz = unpackZ(pk) * n[2];
      for (const [qk, qm] of R.m) {
        next.m.set(pack(px + unpackX(qk), py + unpackY(qk), pz + unpackZ(qk)),
                   combineMat(mode, pm, qm, shift));
      }
    }
    cur = next;
    ran++;
  }

  // Back to where the shape was.
  const out = new CellSet();
  const [mx, my, mz] = norm.min;
  for (const [k, v] of cur.m) {
    out.m.set(pack(unpackX(k) + mx, unpackY(k) + my, unpackZ(k) + mz), v);
  }
  return { out, ran, stopped, note: null };
}

function curExtent(set, axis) {
  let hi = 0;
  const f = axis === 0 ? unpackX : axis === 1 ? unpackY : unpackZ;
  for (const k of set.m.keys()) { const v = f(k); if (v > hi) hi = v; }
  return hi + 1;
}

/* ── the stack ─────────────────────────────────────────────────────────────────────────── */

/** Scope, product, combine — in that order, for every operation.

    A refusal returns the shape exactly as it entered, EXCEPT for replicate, which keeps the
    copies it finished: an array missing its last copy is still an array, where a substitution
    missing its last pass is a different shape and a symmetry missing an image is not symmetric. */
export function runOp(cells, op, cap) {
  const before = cells.size;
  if (!OP_DEFS[op.type]) {
    return { cells: cells.clone(), before, ran: 0, stopped: null, note: 'unknown op' };
  }
  if (before === 0) {
    return { cells: cells.clone(), before, ran: 0, stopped: null, note: 'nothing to work on' };
  }

  const { sel, rest } = selectScope(cells, op);
  if (sel.size === 0) {
    return { cells: cells.clone(), before, ran: 0, stopped: null,
             note: 'the scope selects nothing in this shape' };
  }

  const mode = op.mode || OP_DEFS[op.type].defaults.mode;
  const union = mode === 'add' || mode === 'replace';
  // For the union modes the product is accumulated straight into its destination, so the budget
  // is measured against the real total rather than against the product alone. `remove` builds the
  // product on its own — it can only ever shrink the result — and `intersect` folds its images
  // together instead of accumulating at all.
  const base = mode === 'intersect' ? null
             : mode === 'replace' ? rest.clone()
             : mode === 'add' ? cells.clone()
             : new CellSet();

  let r;
  if (op.type === 'replicate') r = productReplicate(sel, op, cap, mode, base);
  else if (op.type === 'symmetrise') r = productSymmetrise(sel, op, cap, mode, base);
  else r = productSubstitute(sel, op, cap);

  if (r.out === null) {                     // refused outright
    return { cells: cells.clone(), before, ran: r.ran, stopped: r.stopped, note: r.note };
  }

  if (op.type === 'substitute') {
    if (r.stopped && r.ran === 0) {
      return { cells: cells.clone(), before, ran: 0, stopped: r.stopped, note: r.note };
    }
    const out = union ? (mode === 'replace' ? rest.clone() : cells.clone()) : null;
    if (union) {
      if (!mergeInto(out, r.out, mode !== 'add', cap)) {
        return { cells: cells.clone(), before, ran: r.ran,
                 stopped: `the result passes the ${cap.toLocaleString()} cell budget`,
                 note: r.note };
      }
      return { cells: out, before, ran: r.ran, stopped: r.stopped, note: r.note };
    }
    return { cells: combine(cells, rest, r.out, mode), before, ran: r.ran,
             stopped: r.stopped, note: r.note };
  }

  const out = union ? r.out : combine(cells, rest, r.out, mode);
  return { cells: out, before, ran: r.ran, stopped: r.stopped, note: r.note };
}

/** Re-run the whole stack from the seed, `iters` times, feeding each run's output back in.
    Nothing is destructive: the seed and the op list are the document, this is the derived value.

    Returns `steps` for the LAST run — that is the one the op cards price against, because it is
    the one whose numbers are about to get large. `gens` is the cell count after each run, `ran`
    is how many runs actually happened, and `settled` is the run at which the shape stopped
    changing (0 if it never did). */
export function evaluate(seed, ops, cap = DEFAULT_CAP, iters = 1) {
  const want = Math.max(1, Math.min(MAX_ITERS, (iters | 0) || 1));
  let cells = seed.clone();
  let steps = [];
  let capHit = false;
  let stoppedAt = null;
  let settled = 0;
  let ran = 0;
  const gens = [cells.size];

  for (let g = 0; g < want; g++) {
    // Kept by reference, not cloned: every op that does anything returns a new set, so `entering`
    // still points at the shape this run started with.
    const entering = cells;
    steps = [];
    let halted = false;

    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      if (op.on === false) {
        steps.push({ i, type: op.type, skipped: true, incoming: cells,
                     before: cells.size, size: cells.size, ran: 0 });
        continue;
      }
      const incoming = cells;
      const r = runOp(cells, op, cap);
      cells = r.cells;
      // The incoming set is kept by reference, not copied: the panel needs it to say what the next
      // step of that op would cost, and every earlier stage is small next to the last one.
      steps.push({ i, type: op.type, skipped: false, incoming, before: r.before, size: cells.size,
                   ran: r.ran, stopped: r.stopped, note: r.note });
      if (r.stopped) {
        capHit = true;
        stoppedAt = { iter: g + 1, op: i, why: r.stopped };
        halted = true;
        break;
      }
    }

    ran = g + 1;
    gens.push(cells.size);
    if (halted) break;
    if (cells.equals(entering)) { settled = g + 1; break; }
    if (cells.size === 0) break;
  }

  return { cells, steps, capHit, gens, stoppedAt, settled, ran, iters: want };
}

/** What the next step of this op would cost, given the shape as it enters the op. Substitution
    multiplies, so this is the number the UI needs to show before the button is pressed. */
export function predictNext(cells, op) {
  const size = cells.size;
  if (size === 0) return { cost: 0, exact: true, text: 'nothing to grow' };
  if (op.type === 'symmetrise') {
    const order = groupOrder(op.group, op.axis);
    const cost = size * order;
    return { cost, exact: false,
             text: 'at most ' + cost.toLocaleString() + ' cells (' + order + ' images)' };
  }
  if (op.type === 'substitute') {
    const b = cells.bounds();
    const n = op.nMode === 'fixed' ? [op.n, op.n, op.n] : b.size;
    if (n[0] * n[1] * n[2] === 1) return { cost: size, exact: true, text: 'identity' };
    const rule = size;
    let cost = rule;
    const per = [];
    for (let d = 1; d <= Math.max(1, op.count | 0); d++) { cost *= rule; per.push(cost); }
    return { cost, exact: op.nMode === 'auto', per,
             text: (op.nMode === 'auto' ? '' : 'at most ') + cost.toLocaleString() + ' cells' };
  }
  const per = Math.pow(op.s | 0 || 1, 3);
  const cost = size * (1 + (op.count | 0) * per);
  return { cost, exact: false, text: 'at most ' + Math.round(cost).toLocaleString() + ' cells' };
}

/** One-line description for an op card header. */
export function opLabel(op) {
  if (op.type === 'symmetrise') {
    const def = SYMMETRY_GROUPS.find(g => g.name === op.group) || SYMMETRY_GROUPS[0];
    const bits = [def.label.toLowerCase()];
    if (def.axial) bits.push('about ' + 'XYZ'[op.axis | 0]);
    bits.push('x' + groupOrder(op.group, op.axis));
    if (op.half) bits.push('half-cell');
    const pv = [op.px, op.py, op.pz];
    if (pv.some(v => v)) bits.push('at ' + pv.join(','));
    return bits.join(' · ');
  }
  if (op.type === 'replicate') {
    const bits = [`x${op.count}`];
    const t = [op.tx, op.ty, op.tz];
    if (t.some(v => v)) bits.push(`move ${t.join(',')}` + (op.tUnit === 'span' ? ' spans' : ''));
    const r = [];
    if (op.rx) r.push(`X${op.rx * 90}`);
    if (op.ry) r.push(`Y${op.ry * 90}`);
    if (op.rz) r.push(`Z${op.rz * 90}`);
    if (r.length) bits.push('turn ' + r.join('/'));
    const m = ['x', 'y', 'z'].filter((a, i) => [op.mx, op.my, op.mz][i]);
    if (m.length) bits.push('flip ' + m.join(''));
    if (op.s > 1) bits.push(`scale ${op.s}`);
    return bits.join(' · ');
  }
  const bits = [`depth ${op.count}`];
  bits.push(op.nMode === 'fixed' ? `grid ${op.n}` : 'grid from shape');
  return bits.join(' · ');
}

/** The scope and mode line, shown under the op's own label when either is not the default. */
export function scopeLabel(op) {
  const def = OP_DEFS[op.type].defaults;
  const bits = [];
  if (op.scope === 'material') {
    bits.push((op.scopeInv ? 'not material ' : 'material ') + ((op.scopeMat | 0) + 1));
  } else if (op.scope === 'box') {
    bits.push((op.scopeInv ? 'outside ' : 'inside ') +
              `${op.bx0},${op.by0},${op.bz0} \u2192 ${op.bx1},${op.by1},${op.bz1}`);
  }
  const mode = op.mode || def.mode;
  if (mode !== def.mode || bits.length) {
    const m = MODES.find(x => x.name === mode);
    bits.push(m ? m.label : mode);
  }
  return bits.join(' · ');
}
