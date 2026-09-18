// The sparse cell set. Pure — no DOM, no GL — so the whole data model is testable headlessly.
//
// ONE CORRECTION TO THE BRIEF, MADE DELIBERATELY. The brief specifies 21 bits per axis packed
// into a 53-bit safe integer. Three 21-bit fields need 63 bits; Number.MAX_SAFE_INTEGER gives
// 53. Past 2^53 the packing stops being injective and two different cells silently collide —
// exactly the class of bug this project's integer-everything design exists to avoid.
//
// 17 bits per axis is the largest that fits: 3 x 17 = 51 bits, top key 2^51 - 1, every pack
// exact. Coordinates run [-65536, 65535], which is 131072 cells across a side — four orders of
// magnitude past the cell budget, so nothing real is lost.
//
// The key is built with multiplication, not shifts: JS bitwise operators truncate to 32 bits and
// would silently discard the high field.

export const BITS = 17;
export const OFF = 1 << (BITS - 1);          // 65536 — coordinate bias
export const SPAN = 1 << BITS;               // 131072 — field stride
export const SPAN2 = SPAN * SPAN;            // 2^34
export const MIN_COORD = -OFF;
export const MAX_COORD = OFF - 1;
export const MAX_KEY = SPAN2 * SPAN - 1;     // 2^51 - 1

export function inRange(x, y, z) {
  return x >= MIN_COORD && x <= MAX_COORD &&
         y >= MIN_COORD && y <= MAX_COORD &&
         z >= MIN_COORD && z <= MAX_COORD;
}

export function pack(x, y, z) {
  return ((x + OFF) * SPAN + (y + OFF)) * SPAN + (z + OFF);
}

export function unpackX(k) { return Math.floor(k / SPAN2) - OFF; }
export function unpackY(k) { return Math.floor(k / SPAN) % SPAN - OFF; }
export function unpackZ(k) { return k % SPAN - OFF; }

export function unpack(k, out) {
  const o = out || [0, 0, 0];
  o[0] = unpackX(k); o[1] = unpackY(k); o[2] = unpackZ(k);
  return o;
}

/* ── the set ──────────────────────────────────────────────────────────────────────────────
   A Map from packed key to material index. Membership is occupancy; there is no "empty"
   material, so material 0 is a real material and deleting is the only way to clear a cell. */

export class CellSet {
  constructor(map) { this.m = map instanceof Map ? map : new Map(); }

  get size() { return this.m.size; }

  has(x, y, z) { return this.m.has(pack(x, y, z)); }
  hasKey(k) { return this.m.has(k); }
  get(x, y, z) { return this.m.get(pack(x, y, z)); }
  getKey(k) { return this.m.get(k); }

  set(x, y, z, mat) {
    if (!inRange(x, y, z)) return false;
    this.m.set(pack(x, y, z), mat | 0);
    return true;
  }
  setKey(k, mat) { this.m.set(k, mat | 0); }

  delete(x, y, z) { return this.m.delete(pack(x, y, z)); }
  deleteKey(k) { return this.m.delete(k); }

  clear() { this.m.clear(); }
  clone() { return new CellSet(new Map(this.m)); }
  keys() { return this.m.keys(); }
  entries() { return this.m.entries(); }

  /** Union in place. Later wins on collision. */
  union(other) {
    for (const [k, v] of other.m) this.m.set(k, v);
    return this;
  }

  /** Axis-aligned bounds, or null when empty. `size` is a cell count per axis, so a single
      cell has size [1,1,1] — not [0,0,0]. */
  bounds() {
    if (this.m.size === 0) return null;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity;
    let x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (const k of this.m.keys()) {
      const x = unpackX(k), y = unpackY(k), z = unpackZ(k);
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    return {
      min: [x0, y0, z0],
      max: [x1, y1, z1],
      size: [x1 - x0 + 1, y1 - y0 + 1, z1 - z0 + 1]
    };
  }

  /** Translated so the bounding-box minimum sits at the origin. Returns { set, min }. */
  normalized() {
    const b = this.bounds();
    if (!b) return { set: new CellSet(), min: [0, 0, 0] };
    const out = new CellSet();
    for (const [k, v] of this.m) {
      out.m.set(pack(unpackX(k) - b.min[0], unpackY(k) - b.min[1], unpackZ(k) - b.min[2]), v);
    }
    return { set: out, min: b.min.slice() };
  }

  /** Flat [x,y,z,mat, ...], key-sorted so serialisation is deterministic and two equal shapes
      always produce byte-identical files. */
  toArray() {
    const ks = Array.from(this.m.keys()).sort((a, b) => a - b);
    const out = new Array(ks.length * 4);
    for (let i = 0; i < ks.length; i++) {
      const k = ks[i], o = i * 4;
      out[o] = unpackX(k); out[o + 1] = unpackY(k);
      out[o + 2] = unpackZ(k); out[o + 3] = this.m.get(k);
    }
    return out;
  }

  static fromArray(a) {
    const s = new CellSet();
    if (!a) return s;
    for (let i = 0; i + 3 < a.length; i += 4) {
      s.set(a[i] | 0, a[i + 1] | 0, a[i + 2] | 0, a[i + 3] | 0);
    }
    return s;
  }

  /** Solid axis-aligned box, inclusive of both corners. */
  static box(x0, y0, z0, x1, y1, z1, mat = 0) {
    const s = new CellSet();
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++)
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
        for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) s.set(x, y, z, mat);
    return s;
  }

  equals(other) {
    if (this.m.size !== other.m.size) return false;
    for (const [k, v] of this.m) if (other.m.get(k) !== v) return false;
    return true;
  }
}
