// A ZIP writer, because a Bedrock add-on is a zip with a different extension.
//
// Bedrock imports a .mcpack by double-click; the alternative is telling someone to find their
// com.mojang folder, which on a phone or a console is a worse instruction than any file format
// problem. So the export has to be one file, and that means writing a zip.
//
// Two compression methods, same as the gzip in nbt.js: DEFLATE where the platform supplies it
// (CompressionStream('deflate-raw')), STORED otherwise. An .mcstructure is mostly repeated
// four-byte integers, so deflate takes a 4 MB file to a few tens of kilobytes and stored takes it
// to 4 MB. Both import.

import { crc32 } from './nbt.js';

const enc = new TextEncoder();

async function deflateRaw(data) {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const cs = new CompressionStream('deflate-raw');
    const w = cs.writable.getWriter();
    w.write(data); w.close();
    const parts = [];
    const r = cs.readable.getReader();
    for (;;) {
      const { done, value } = await r.read();
      if (done) break;
      parts.push(value);
    }
    let n = 0;
    for (const p of parts) n += p.length;
    const out = new Uint8Array(n);
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out.length < data.length ? out : null;   // never pay to make a file bigger
  } catch (e) {
    return null;
  }
}

class Out {
  constructor() { this.parts = []; this.n = 0; }
  push(a) { this.parts.push(a); this.n += a.length; }
  u16(v) { this.push(Uint8Array.from([v & 0xff, (v >>> 8) & 0xff])); }
  u32(v) {
    this.push(Uint8Array.from([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]));
  }
  done() {
    const out = new Uint8Array(this.n);
    let at = 0;
    for (const p of this.parts) { out.set(p, at); at += p.length; }
    return out;
  }
}

/** entries: [{ name, data }] where data is a Uint8Array or a string. Returns the zip bytes.
    No directory entries, no timestamps worth the name — a pack is read by path, and a fixed
    date keeps the output byte-identical between runs, which makes it testable. */
export async function zip(entries) {
  const files = [];
  for (const e of entries) {
    const data = typeof e.data === 'string' ? enc.encode(e.data) : e.data;
    const packed = await deflateRaw(data);
    files.push({
      name: enc.encode(e.name),
      data,
      body: packed || data,
      method: packed ? 8 : 0,
      crc: crc32(data)
    });
  }

  const out = new Out();
  const DOS_TIME = 0, DOS_DATE = 0x2100;      // 1 Jan 1980, the zero of the DOS epoch

  for (const f of files) {
    f.offset = out.n;
    out.u32(0x04034b50);
    out.u16(20); out.u16(0); out.u16(f.method);
    out.u16(DOS_TIME); out.u16(DOS_DATE);
    out.u32(f.crc); out.u32(f.body.length); out.u32(f.data.length);
    out.u16(f.name.length); out.u16(0);
    out.push(f.name);
    out.push(f.body);
  }

  const dirStart = out.n;
  for (const f of files) {
    out.u32(0x02014b50);
    out.u16(20); out.u16(20); out.u16(0); out.u16(f.method);
    out.u16(DOS_TIME); out.u16(DOS_DATE);
    out.u32(f.crc); out.u32(f.body.length); out.u32(f.data.length);
    out.u16(f.name.length); out.u16(0); out.u16(0);
    out.u16(0); out.u16(0); out.u32(0);
    out.u32(f.offset);
    out.push(f.name);
  }
  const dirSize = out.n - dirStart;

  out.u32(0x06054b50);
  out.u16(0); out.u16(0);
  out.u16(files.length); out.u16(files.length);
  out.u32(dirSize); out.u32(dirStart);
  out.u16(0);
  return out.done();
}

/** RFC 4122 version 4, from the platform where it has one. A manifest needs two distinct ids and
    Bedrock refuses a pack whose id collides with one already installed, so these must be fresh
    per export rather than baked into the source. */
export function uuid4() {
  const c = typeof crypto !== 'undefined' ? crypto : null;
  if (c && c.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  if (c && c.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = (Math.random() * 256) | 0;
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
