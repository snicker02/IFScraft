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
// THE BUDGET IS CHECKED BEFORE THE PASS THAT WOULD BLOW IT, and that pass is abandoned whole. A
// half-applied substitution is not a shape anyone asked for, so the result is always the last
// complete step.

import { CellSet, pack, unpackX, unpackY, unpackZ, MAX_COORD, MIN_COORD } from './cells.js';
import { makeTransform } from './lattice.js';
import { PALETTE_SIZE, clampMat } from './palette.js';

export const DEFAULT_CAP = 400000;
export const MAX_CAP = 4000000;

export const OP_DEFS = {
  replicate: {
    name: 'Replicate',
    blurb: 'Copy the shape N times under one transform. Each copy is taken from the last.',
    defaults: {
      type: 'replicate', on: true, count: 4,
      rx: 0, ry: 0, rz: 0, mx: 0, my: 0, mz: 0,
      s: 1, tx: 0, ty: 3, tz: 0, px: 0, py: 0, pz: 0,
      matShift: 0
    }
  },
  substitute: {
    name: 'Substitute',
    blurb: 'Replace every cell with a scaled copy of the whole shape. Count is depth.',
    defaults: {
      type: 'substitute', on: true, count: 1,
      nMode: 'auto', n: 3, keep: 0, matMode: 'outer', matShift: 0
    }
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
  if (out.type === 'replicate') {
    out.s = Math.max(1, Math.min(16, out.s | 0));
    out.rx &= 3; out.ry &= 3; out.rz &= 3;
    out.mx = out.mx ? 1 : 0; out.my = out.my ? 1 : 0; out.mz = out.mz ? 1 : 0;
  } else {
    out.n = Math.max(1, Math.min(64, out.n | 0));
    if (out.nMode !== 'fixed') out.nMode = 'auto';
    if (['inner', 'outer', 'mix'].indexOf(out.matMode) < 0) out.matMode = 'outer';
    out.count = Math.max(0, Math.min(12, out.count | 0));
  }
  out.matShift = ((out.matShift | 0) % PALETTE_SIZE + PALETTE_SIZE) % PALETTE_SIZE;
  return out;
}

/* ── replicate ─────────────────────────────────────────────────────────────────────────── */

/** One application of T to a whole set. Returns null if the copy alone would exceed `cap`,
    which is the only place a single copy can be refused — the union check happens outside. */
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
          az < MIN_COORD || az > MAX_COORD) return null;
      out.m.set(pack(ax, ay, az), nm);
    } else {
      if (ax < MIN_COORD || ax + s - 1 > MAX_COORD || ay < MIN_COORD || ay + s - 1 > MAX_COORD ||
          az < MIN_COORD || az + s - 1 > MAX_COORD) return null;
      for (let dx = 0; dx < s; dx++)
        for (let dy = 0; dy < s; dy++)
          for (let dz = 0; dz < s; dz++) out.m.set(pack(ax + dx, ay + dy, az + dz), nm);
    }
    if (out.m.size > cap) return null;
  }
  return out;
}

function runReplicate(cells, op, cap) {
  const before = cells.size;
  const T = makeTransform(op);
  const out = cells.clone();
  let cur = cells;
  let ran = 0, stopped = null;
  const n = Math.max(0, op.count | 0);

  if (before === 0) return { cells: out, before, ran: 0, stopped: null, note: 'nothing to copy' };
  if (T.isIdentity && !op.matShift) {
    return { cells: out, before, ran: 0, stopped: null,
             note: 'transform is the identity — every copy lands on the original' };
  }

  for (let i = 0; i < n; i++) {
    const next = applyTransform(cur, T, op.matShift | 0, cap);
    if (!next) { stopped = `copy ${i + 1} exceeds the budget`; break; }
    // Copies overlap often — a half turn about a shape's own centre lands back on itself — so
    // refusing on the upper bound would refuse builds that actually fit. Union for real, record
    // what was newly added, and undo exactly that if the total goes over.
    const added = [], changed = [];
    let over = false;
    for (const [k, v] of next.m) {
      if (out.m.has(k)) {
        const old = out.m.get(k);
        if (old !== v) changed.push(k, old);
      } else {
        if (out.m.size >= cap) { over = true; break; }
        added.push(k);
      }
      out.m.set(k, v);
    }
    if (over) {
      for (const k of added) out.m.delete(k);
      for (let j = 0; j < changed.length; j += 2) out.m.set(changed[j], changed[j + 1]);
      stopped = `copy ${i + 1} passes the ${cap.toLocaleString()} cell budget`;
      break;
    }
    cur = next;
    ran++;
  }
  return { cells: out, before, ran, stopped, note: null };
}

/* ── substitute ────────────────────────────────────────────────────────────────────────── */

function combineMat(mode, outerMat, innerMat, shift) {
  let m;
  if (mode === 'inner') m = innerMat;
  else if (mode === 'mix') m = outerMat + innerMat;
  else m = outerMat;
  return clampMat(m + shift);
}

function runSubstitute(cells, op, cap) {
  const before = cells.size;
  if (before === 0) {
    return { cells: cells.clone(), before, ran: 0, stopped: null, note: 'nothing to substitute' };
  }
  const b = cells.bounds();
  const norm = cells.normalized();
  const R = norm.set;
  const n = op.nMode === 'fixed'
    ? [Math.max(1, op.n | 0), Math.max(1, op.n | 0), Math.max(1, op.n | 0)]
    : b.size.slice();

  if (n[0] * n[1] * n[2] === 1) {
    return { cells: cells.clone(), before, ran: 0, stopped: null,
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
  if (op.keep) for (const [k, v] of cells.m) out.m.set(k, v);

  return { cells: out, before, ran, stopped, note: null };
}

function curExtent(set, axis) {
  let hi = 0;
  const f = axis === 0 ? unpackX : axis === 1 ? unpackY : unpackZ;
  for (const k of set.m.keys()) { const v = f(k); if (v > hi) hi = v; }
  return hi + 1;
}

/* ── the stack ─────────────────────────────────────────────────────────────────────────── */

export function runOp(cells, op, cap) {
  if (op.type === 'replicate') return runReplicate(cells, op, cap);
  if (op.type === 'substitute') return runSubstitute(cells, op, cap);
  return { cells: cells.clone(), before: cells.size, ran: 0, stopped: null, note: 'unknown op' };
}

/** Re-run the whole stack from the seed. Nothing is destructive: the seed and the op list are
    the document, this is the derived value. */
export function evaluate(seed, ops, cap = DEFAULT_CAP) {
  let cells = seed.clone();
  const steps = [];
  let capHit = false;
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
    if (r.stopped) capHit = true;
  }
  return { cells, steps, capHit };
}

/** What the next step of this op would cost, given the shape as it enters the op. Substitution
    multiplies, so this is the number the UI needs to show before the button is pressed. */
export function predictNext(cells, op) {
  const size = cells.size;
  if (size === 0) return { cost: 0, exact: true, text: 'nothing to grow' };
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
  if (op.type === 'replicate') {
    const bits = [`x${op.count}`];
    const t = [op.tx, op.ty, op.tz];
    if (t.some(v => v)) bits.push(`move ${t.join(',')}`);
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
  if (op.keep) bits.push('keep original');
  return bits.join(' · ');
}
