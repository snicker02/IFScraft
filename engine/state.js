// The document. Pure — no DOM, no localStorage — so the whole file format is testable headlessly.
//
// Everything except `seed` and `ops` is a number, and those two convert to plain arrays on
// capture. `seed` is a CellSet in memory because every edit and every op runs against it, and a
// flat array on disk because that is what survives a round trip.
//
// UNDO IS CHEAP HERE, and that is a consequence of the design rather than an optimisation: the
// document is the seed plus the op list, and the seed is hand-placed so it stays small. The
// half-million cells live in the derived result, which is never snapshotted because it can always
// be rebuilt by re-running the stack.
//
// TOLERANT LOADER. Applying a preset resets to defaults first, so an omitted key is deterministic
// rather than whatever happened to be there. Ops carry their type as a string, so inserting an op
// type in a future build cannot silently turn an old file into a different shape.

import { CellSet } from './cells.js';
import { sanitizeOp, DEFAULT_CAP, MAX_CAP } from './ops.js';
import { PALETTE_SIZE } from './palette.js';

export const PRESET_VERSION = 1;

export const DEFAULTS = {
  // camera
  camMode: 0,
  tgtX: 0, tgtY: 2, tgtZ: 0,
  camDist: 26, camAzim: 0.85, camElev: 0.52, fov: 0.95,
  flyX: 0, flyY: 6, flyZ: 20, flyYaw: Math.PI, flyPitch: -0.2, flySpeed: 8,
  // build
  cap: DEFAULT_CAP,
  material: 3,
  // view
  view: 1,            // 0 = seed, 1 = result
  showGrid: 1, showBounds: 0, ao: 1, showAxes: 1,
  bg: 0,              // background index
  theme: 0            // 0 dark, 1 grey, 2 light
};

export function newState(overrides) {
  const s = Object.assign({}, DEFAULTS, overrides || {});
  s.seed = new CellSet();
  s.ops = [];
  return s;
}

const round = (v, dp = 6) => {
  if (typeof v !== 'number' || !isFinite(v)) return 0;
  const k = Math.pow(10, dp);
  return Math.round(v * k) / k;
};

/** Snapshot. Only non-default numbers are stored, which keeps a preset small enough to read. */
export function capture(state, name = '') {
  const s = {};
  for (const k of Object.keys(DEFAULTS)) {
    if (round(state[k]) !== round(DEFAULTS[k])) s[k] = round(state[k]);
  }
  return {
    v: PRESET_VERSION,
    name: String(name || ''),
    s,
    seed: state.seed ? state.seed.toArray() : [],
    ops: (state.ops || []).map(o => Object.assign({}, o))
  };
}

/** Load into a fresh state. Unknown keys are dropped, missing keys take the default, and an op
    whose type this build does not know is skipped rather than throwing. */
export function apply(data) {
  const st = newState();
  if (!data || typeof data !== 'object') return { state: st, warnings: ['not a Lattice file'] };
  const warn = [];
  if (data.v !== undefined && data.v > PRESET_VERSION) {
    warn.push(`file version ${data.v} is newer than this build (${PRESET_VERSION})`);
  }
  const src = data.s || {};
  for (const k of Object.keys(DEFAULTS)) {
    if (k in src && Number.isFinite(+src[k])) st[k] = +src[k];
  }
  st.cap = Math.max(1000, Math.min(MAX_CAP, st.cap | 0));
  st.material = ((st.material | 0) % PALETTE_SIZE + PALETTE_SIZE) % PALETTE_SIZE;
  st.view = st.view ? 1 : 0;
  st.seed = CellSet.fromArray(data.seed || []);
  st.ops = [];
  for (const raw of (data.ops || [])) {
    const op = sanitizeOp(raw);
    if (op) st.ops.push(op); else warn.push(`skipped an unrecognised op: ${raw && raw.type}`);
  }
  return { state: st, name: data.name || '', warnings: warn };
}

export function encode(state, name) { return JSON.stringify(capture(state, name)); }

export function decode(text) {
  let data;
  try { data = JSON.parse(text); }
  catch (e) { return { state: newState(), warnings: ['could not parse the file: ' + e.message] }; }
  return apply(data);
}

/* ── undo ─────────────────────────────────────────────────────────────────────────────── */

export class History {
  constructor(limit = 80) { this.limit = limit; this.past = []; this.future = []; }

  /** Call before a change, with the state as it is now. */
  push(state) {
    this.past.push(capture(state));
    if (this.past.length > this.limit) this.past.shift();
    this.future.length = 0;
  }
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }

  undo(current) {
    if (!this.past.length) return null;
    this.future.push(capture(current));
    return apply(this.past.pop()).state;
  }
  redo(current) {
    if (!this.future.length) return null;
    this.past.push(capture(current));
    return apply(this.future.pop()).state;
  }
  clear() { this.past.length = 0; this.future.length = 0; }
}
