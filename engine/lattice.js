// Lattice transforms. Every map here sends cells to cells exactly — integers in, integers out,
// no rounding anywhere. Pure, so the whole algebra is testable headlessly.
//
// THE FORM. A transform is
//
//     T(p) = s * M * (p - pivot) + pivot + t
//
// where M is a signed permutation matrix (one non-zero per row and column, each +/-1), s a
// positive integer scale, and pivot / t integer vectors. The 48 signed permutation matrices are
// exactly the symmetry group of the cube, so M is guaranteed to map the lattice onto itself.
//
// Rather than exposing an index into those 48, the UI gives quarter-turns about each axis and
// three mirror flags, which is what a person actually reaches for. Every combination lands on one
// of the 48 and every one of the 48 is reachable.
//
// CELLS AS POINTS. A mirror maps p to -p, not to -p-1. Reflection is therefore about the centre
// of cell 0, not about the face plane at 0 — the centre column is shared rather than doubled.
// Both conventions are defensible; the point convention is the one that composes exactly
// (T2(T1(p)) is again of the form above), and translation is available to place the mirror plane
// wherever you want it.
//
// SCALE. s > 1 enlarges the solid, so one cell becomes an s x s x s block. The block grows away
// from the anchor, and on an axis the matrix flipped, it grows the other way — otherwise a scaled
// mirror would sit s-1 cells off from an unscaled one and symmetric builds would drift apart.

export const ROT_LABELS = ['0', '90', '180', '270'];

export const IDENTITY_M = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/* Right-handed quarter turns, row-major. */
const RX = [1, 0, 0, 0, 0, -1, 0, 1, 0];   // (x,y,z) -> (x,-z,y)
const RY = [0, 0, 1, 0, 1, 0, -1, 0, 0];   // (x,y,z) -> (z,y,-x)
const RZ = [0, -1, 0, 1, 0, 0, 0, 0, 1];   // (x,y,z) -> (-y,x,z)

export function matMul(A, B) {
  const C = new Array(9);
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) {
      C[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c];
    }
  return C;
}

export function matPow(M, n) {
  let out = IDENTITY_M.slice();
  for (let i = 0; i < (n & 3); i++) out = matMul(M, out);
  return out;
}

export function matDet(M) {
  return M[0] * (M[4] * M[8] - M[5] * M[7])
       - M[1] * (M[3] * M[8] - M[5] * M[6])
       + M[2] * (M[3] * M[7] - M[4] * M[6]);
}

export function matApply(M, p, out) {
  const o = out || [0, 0, 0];
  const x = p[0], y = p[1], z = p[2];
  o[0] = M[0] * x + M[1] * y + M[2] * z;
  o[1] = M[3] * x + M[4] * y + M[5] * z;
  o[2] = M[6] * x + M[7] * y + M[8] * z;
  return o;
}

export function matEquals(A, B) {
  for (let i = 0; i < 9; i++) if (A[i] !== B[i]) return false;
  return true;
}

/** True when M has exactly one +/-1 per row and per column and nothing else. */
export function isSignedPermutation(M) {
  if (!M || M.length !== 9) return false;
  const rows = [0, 0, 0], cols = [0, 0, 0];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    const v = M[r * 3 + c];
    if (!Number.isInteger(v)) return false;
    if (v === 0) continue;
    if (v !== 1 && v !== -1) return false;
    rows[r]++; cols[c]++;
  }
  return rows.every(n => n === 1) && cols.every(n => n === 1);
}

/** Mirror * Rz^rz * Ry^ry * Rx^rx — rotate about X, then Y, then Z, then flip axes. */
export function rotMatrix(rx = 0, ry = 0, rz = 0, mx = 0, my = 0, mz = 0) {
  let M = matMul(matPow(RY, ry), matPow(RX, rx));
  M = matMul(matPow(RZ, rz), M);
  if (mx || my || mz) {
    M = matMul([mx ? -1 : 1, 0, 0, 0, my ? -1 : 1, 0, 0, 0, mz ? -1 : 1], M);
  }
  return M;
}

/** All 48 cube symmetries, generated from the (rx,ry,rz,mx,my,mz) parameterisation. Used by the
    tests to prove the parameterisation is onto, and by nothing else. */
export function allSymmetries() {
  const seen = [];
  for (let rx = 0; rx < 4; rx++) for (let ry = 0; ry < 4; ry++) for (let rz = 0; rz < 4; rz++)
    for (let m = 0; m < 8; m++) {
      const M = rotMatrix(rx, ry, rz, m & 1, (m >> 1) & 1, (m >> 2) & 1);
      if (!seen.some(S => matEquals(S, M))) seen.push(M);
    }
  return seen;
}

/* ── transforms ────────────────────────────────────────────────────────────────────────── */

export const TRANSFORM_DEFAULTS = {
  rx: 0, ry: 0, rz: 0, mx: 0, my: 0, mz: 0,
  s: 1, tx: 0, ty: 0, tz: 0, px: 0, py: 0, pz: 0
};

/** Resolve a UI-level spec into the concrete map, with the per-axis block growth direction
    worked out once. */
export function makeTransform(spec) {
  const q = Object.assign({}, TRANSFORM_DEFAULTS, spec || {});
  const s = Math.max(1, Math.round(q.s) || 1);
  const M = rotMatrix(q.rx | 0, q.ry | 0, q.rz | 0, q.mx ? 1 : 0, q.my ? 1 : 0, q.mz ? 1 : 0);
  // Row sums give the sign on each output axis, because each row holds exactly one +/-1.
  const sign = [
    M[0] + M[1] + M[2],
    M[3] + M[4] + M[5],
    M[6] + M[7] + M[8]
  ];
  return {
    M, s,
    t: [q.tx | 0, q.ty | 0, q.tz | 0],
    pivot: [q.px | 0, q.py | 0, q.pz | 0],
    sign,
    // Where the s x s x s block starts relative to the anchor, per axis.
    blockOff: [
      sign[0] < 0 ? -(s - 1) : 0,
      sign[1] < 0 ? -(s - 1) : 0,
      sign[2] < 0 ? -(s - 1) : 0
    ],
    isIdentity: s === 1 && matEquals(M, IDENTITY_M) &&
                q.tx === 0 && q.ty === 0 && q.tz === 0
  };
}

/** The anchor map. For s = 1 this is the whole story; for s > 1 it gives the block corner. */
export function applyPoint(T, p, out) {
  const o = out || [0, 0, 0];
  const a = p[0] - T.pivot[0], b = p[1] - T.pivot[1], c = p[2] - T.pivot[2];
  const M = T.M, s = T.s;
  o[0] = s * (M[0] * a + M[1] * b + M[2] * c) + T.pivot[0] + T.t[0];
  o[1] = s * (M[3] * a + M[4] * b + M[5] * c) + T.pivot[1] + T.t[1];
  o[2] = s * (M[6] * a + M[7] * b + M[8] * c) + T.pivot[2] + T.t[2];
  return o;
}

/** Compose: the transform that does T1 and then T2. Exact — the closure of the family under
    composition is the reason the lattice restriction buys anything. Only meaningful for the
    anchor map; block growth is applied at materialisation. */
export function composeTransforms(T1, T2) {
  const M = matMul(T2.M, T1.M);
  const s = T1.s * T2.s;
  // T2(T1(p)) with both pivots folded into a single translation about the origin.
  const a = applyPoint(T2, applyPoint(T1, [0, 0, 0]));
  const sign = [M[0] + M[1] + M[2], M[3] + M[4] + M[5], M[6] + M[7] + M[8]];
  return {
    M, s, t: a, pivot: [0, 0, 0], sign,
    blockOff: [
      sign[0] < 0 ? -(s - 1) : 0,
      sign[1] < 0 ? -(s - 1) : 0,
      sign[2] < 0 ? -(s - 1) : 0
    ],
    isIdentity: false
  };
}

/** How many cells one source cell becomes. */
export function blockVolume(T) { return T.s * T.s * T.s; }
