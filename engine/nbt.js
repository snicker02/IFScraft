// Named Binary Tag, written by hand, plus the gzip wrapper Minecraft expects around it.
//
// NBT is a small format: a tag id, a name, and a payload, all big-endian, and that is the whole
// specification. Writing it is fifty lines. Pulling in a library to do it would have been the
// only dependency in the project, to save fifty lines, in exchange for never being able to check
// what actually went into the file.
//
// GZIP IS THE PART WORTH EXPLAINING. Minecraft will not read an uncompressed schematic, and there
// is no dependency-free deflate here — so this writes gzip with STORED blocks: the deflate format
// allows a block to say "the next N bytes are literal", and every reader in existence handles it
// because it is the format's own escape hatch for incompressible data. The file is larger than a
// real compressor would make it and identical in content.
//
// Where the browser has CompressionStream (all current ones do), that is used instead and the
// file comes out properly compressed. The stored path is the fallback and the tested one, since
// it is the half that could be wrong.

export const TAG = {
  END: 0, BYTE: 1, SHORT: 2, INT: 3, LONG: 4, FLOAT: 5, DOUBLE: 6,
  BYTE_ARRAY: 7, STRING: 8, LIST: 9, COMPOUND: 10, INT_ARRAY: 11, LONG_ARRAY: 12
};

/* ── tag constructors ─────────────────────────────────────────────────────────────────────
   A tag is { t, v }. Compounds hold a plain object of name → tag, which keeps the call site
   readable: the schematic below looks like the specification rather than like a byte stream. */

export const Byte = v => ({ t: TAG.BYTE, v: v | 0 });
export const Short = v => ({ t: TAG.SHORT, v: v | 0 });
export const Int = v => ({ t: TAG.INT, v: v | 0 });
export const Float = v => ({ t: TAG.FLOAT, v: +v });
export const Double = v => ({ t: TAG.DOUBLE, v: +v });
export const Str = v => ({ t: TAG.STRING, v: String(v) });
export const ByteArray = v => ({ t: TAG.BYTE_ARRAY, v });
export const IntArray = v => ({ t: TAG.INT_ARRAY, v });
export const Compound = v => ({ t: TAG.COMPOUND, v: v || {} });
/** An empty list still needs an element type; Minecraft's readers check it. */
export const List = (t, items) => ({ t: TAG.LIST, et: t, v: items || [] });

/* ── the writer ───────────────────────────────────────────────────────────────────────── */

class Writer {
  /** Java's NBT is big-endian; Bedrock's is little-endian and otherwise identical. One flag
      rather than two writers, because the second writer would drift from the first. */
  constructor(little = false) { this.buf = new Uint8Array(1024); this.n = 0; this.le = little; }

  need(k) {
    if (this.n + k <= this.buf.length) return;
    let cap = this.buf.length;
    while (cap < this.n + k) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.n));
    this.buf = next;
  }
  u8(v) { this.need(1); this.buf[this.n++] = v & 0xff; }
  u16(v) {
    this.need(2);
    if (this.le) { this.buf[this.n++] = v & 0xff; this.buf[this.n++] = (v >>> 8) & 0xff; }
    else { this.buf[this.n++] = (v >>> 8) & 0xff; this.buf[this.n++] = v & 0xff; }
  }
  i32(v) {
    this.need(4);
    if (this.le) {
      this.buf[this.n++] = v & 0xff;          this.buf[this.n++] = (v >>> 8) & 0xff;
      this.buf[this.n++] = (v >>> 16) & 0xff; this.buf[this.n++] = (v >>> 24) & 0xff;
    } else {
      this.buf[this.n++] = (v >>> 24) & 0xff; this.buf[this.n++] = (v >>> 16) & 0xff;
      this.buf[this.n++] = (v >>> 8) & 0xff;  this.buf[this.n++] = v & 0xff;
    }
  }
  f32(v) { this.need(4); new DataView(this.buf.buffer).setFloat32(this.n, v, this.le); this.n += 4; }
  f64(v) { this.need(8); new DataView(this.buf.buffer).setFloat64(this.n, v, this.le); this.n += 8; }
  bytes(a) { this.need(a.length); this.buf.set(a, this.n); this.n += a.length; }

  /** NBT strings are a uint16 length then UTF-8. Everything written here is ASCII — block ids
      and field names both — so TextEncoder's plain UTF-8 and NBT's modified UTF-8 agree. */
  str(s) {
    const b = new TextEncoder().encode(s);
    this.u16(b.length);
    this.bytes(b);
  }

  payload(tag) {
    switch (tag.t) {
      case TAG.BYTE: this.u8(tag.v); break;
      case TAG.SHORT: this.u16(tag.v); break;
      case TAG.INT: this.i32(tag.v); break;
      case TAG.FLOAT: this.f32(tag.v); break;
      case TAG.DOUBLE: this.f64(tag.v); break;
      case TAG.STRING: this.str(tag.v); break;
      case TAG.BYTE_ARRAY:
        this.i32(tag.v.length);
        this.bytes(tag.v instanceof Uint8Array ? tag.v : Uint8Array.from(tag.v));
        break;
      case TAG.INT_ARRAY:
        this.i32(tag.v.length);
        for (const x of tag.v) this.i32(x);
        break;
      case TAG.LIST:
        this.u8(tag.et);
        this.i32(tag.v.length);
        for (const item of tag.v) this.payload(item);
        break;
      case TAG.COMPOUND:
        for (const k of Object.keys(tag.v)) {
          const child = tag.v[k];
          this.u8(child.t);
          this.str(k);
          this.payload(child);
        }
        this.u8(TAG.END);
        break;
      default: throw new Error('cannot write tag type ' + tag.t);
    }
  }

  done() { return this.buf.slice(0, this.n); }
}

/** A whole file: the root tag, its name, and its payload. Pass little = true for Bedrock. */
export function writeNBT(rootName, tag, little = false) {
  const w = new Writer(little);
  w.u8(tag.t);
  w.str(rootName);
  w.payload(tag);
  return w.done();
}

/* ── gzip ─────────────────────────────────────────────────────────────────────────────── */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** gzip with stored deflate blocks. Valid, universally readable, and larger than it needs to be:
    a stored block carries at most 65535 bytes, so the overhead is five bytes per 64 KB. */
export function gzipStored(data) {
  const MAX = 65535;
  const blocks = Math.max(1, Math.ceil(data.length / MAX));
  const out = new Uint8Array(10 + data.length + blocks * 5 + 8);
  let p = 0;
  // header: magic, deflate, no flags, no mtime, no extra flags, unknown OS
  out.set([0x1f, 0x8b, 0x08, 0x00, 0, 0, 0, 0, 0x00, 0xff], p); p += 10;

  for (let i = 0; i < blocks; i++) {
    const start = i * MAX;
    const len = Math.min(MAX, data.length - start);
    const last = i === blocks - 1 ? 1 : 0;
    out[p++] = last;                          // BFINAL, BTYPE 00 (stored)
    out[p++] = len & 0xff; out[p++] = (len >>> 8) & 0xff;
    out[p++] = ~len & 0xff; out[p++] = (~len >>> 8) & 0xff;
    out.set(data.subarray(start, start + len), p); p += len;
  }

  const crc = crc32(data);
  out[p++] = crc & 0xff; out[p++] = (crc >>> 8) & 0xff;
  out[p++] = (crc >>> 16) & 0xff; out[p++] = (crc >>> 24) & 0xff;
  const n = data.length >>> 0;
  out[p++] = n & 0xff; out[p++] = (n >>> 8) & 0xff;
  out[p++] = (n >>> 16) & 0xff; out[p++] = (n >>> 24) & 0xff;
  return out.slice(0, p);
}

/** Real compression where the platform has it, stored otherwise. Both produce a valid gzip
    stream; only the size differs, by a lot on a sparse schematic. */
export async function gzip(data) {
  if (typeof CompressionStream === 'undefined') return gzipStored(data);
  try {
    const cs = new CompressionStream('gzip');
    const w = cs.writable.getWriter();
    w.write(data); w.close();
    const parts = [];
    const r = cs.readable.getReader();
    for (;;) {
      const { done, value } = await r.read();
      if (done) break;
      parts.push(value);
    }
    let total = 0;
    for (const p of parts) total += p.length;
    const out = new Uint8Array(total);
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
  } catch (e) {
    return gzipStored(data);
  }
}

/** Unsigned LEB128, which is what the Sponge schematic calls a varint. */
export function varint(v, out) {
  let x = v >>> 0;
  for (;;) {
    if (x < 0x80) { out.push(x); return out; }
    out.push((x & 0x7f) | 0x80);
    x >>>= 7;
  }
}
