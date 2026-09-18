// Minecraft export, checked against something that is not our own code.
//
// The gzip container is verified with node's zlib, which is an independent implementation of the
// same specification: if our hand-rolled stored-deflate stream were malformed, gunzip would say
// so rather than politely accepting it. The NBT inside is then read back with a small reader
// written for this file alone — deliberately not sharing code with the writer, since a shared
// bug would cancel out and the test would pass on a file Minecraft cannot open.

import { suite, suiteAsync, test, testAsync, ok, eq, deepEq, note } from './harness.js';
import zlib from 'node:zlib';
import { CellSet } from '../engine/cells.js';
import { writeNBT, gzipStored, gzip, crc32, varint, TAG,
         Compound, Int, Str, List, ByteArray, IntArray, Byte, Short } from '../engine/nbt.js';
import { toSchem, toStructures, structureReadme, BLOCKS, AIR,
         DATA_VERSIONS, DEFAULT_DATA_VERSION, STRUCTURE_MAX, MAX_SCHEM_VOLUME }
  from '../engine/minecraft.js';
import { PALETTE_SIZE } from '../engine/palette.js';
import { toMCStructures, toMCPack, packManifest, mcpackReadme, looseFileReadme,
         loadCommand, blockVersion,
         BEDROCK_BLOCKS, BEDROCK_LEGACY_BLOCKS, BEDROCK_TILE, BEDROCK_VERSIONS }
  from '../engine/bedrock.js';
import { zip, uuid4 } from '../engine/zip.js';
import { DEFAULT_MAP } from '../engine/blocks.js';
import { PRESETS } from '../engine/presets.js';
import { apply, DEFAULTS } from '../engine/state.js';
import { evaluate } from '../engine/ops.js';

/* ── an independent NBT reader ────────────────────────────────────────────────────────── */

function readNBT(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 0;
  const u8 = () => bytes[p++];
  const i16 = () => { const v = dv.getInt16(p, false); p += 2; return v; };
  const u16 = () => { const v = dv.getUint16(p, false); p += 2; return v; };
  const i32 = () => { const v = dv.getInt32(p, false); p += 4; return v; };
  const str = () => { const n = u16(); const s = new TextDecoder().decode(bytes.subarray(p, p + n)); p += n; return s; };

  function payload(t) {
    switch (t) {
      case TAG.BYTE: { const v = dv.getInt8(p); p += 1; return v; }
      case TAG.SHORT: return i16();
      case TAG.INT: return i32();
      case TAG.FLOAT: { const v = dv.getFloat32(p, false); p += 4; return v; }
      case TAG.DOUBLE: { const v = dv.getFloat64(p, false); p += 8; return v; }
      case TAG.STRING: return str();
      case TAG.BYTE_ARRAY: { const n = i32(); const a = bytes.subarray(p, p + n); p += n; return a; }
      case TAG.INT_ARRAY: { const n = i32(); const a = []; for (let i = 0; i < n; i++) a.push(i32()); return a; }
      case TAG.LIST: {
        const et = u8(); const n = i32(); const a = [];
        for (let i = 0; i < n; i++) a.push(payload(et));
        a.elementType = et;
        return a;
      }
      case TAG.COMPOUND: {
        const o = {};
        for (;;) {
          const ct = u8();
          if (ct === TAG.END) break;
          const name = str();
          o[name] = payload(ct);
        }
        return o;
      }
      default: throw new Error('unknown tag ' + t + ' at ' + p);
    }
  }

  const t = u8();
  const name = str();
  const value = payload(t);
  return { name, type: t, value, consumed: p, length: bytes.length };
}

/** The same reader with the bytes the other way round. Bedrock's NBT is little-endian and
    otherwise identical, so this is the writer's claim tested rather than restated. */
function readNBTLE(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 0;
  const u8 = () => bytes[p++];
  const u16 = () => { const v = dv.getUint16(p, true); p += 2; return v; };
  const i32 = () => { const v = dv.getInt32(p, true); p += 4; return v; };
  const str = () => { const n = u16(); const s = new TextDecoder().decode(bytes.subarray(p, p + n)); p += n; return s; };

  function payload(t) {
    switch (t) {
      case TAG.BYTE: { const v = dv.getInt8(p); p += 1; return v; }
      case TAG.SHORT: { const v = dv.getInt16(p, true); p += 2; return v; }
      case TAG.INT: return i32();
      case TAG.FLOAT: { const v = dv.getFloat32(p, true); p += 4; return v; }
      case TAG.DOUBLE: { const v = dv.getFloat64(p, true); p += 8; return v; }
      case TAG.STRING: return str();
      case TAG.LIST: {
        const et = u8(); const n = i32(); const a = [];
        for (let i = 0; i < n; i++) a.push(payload(et));
        a.elementType = et;
        return a;
      }
      case TAG.COMPOUND: {
        const o = {};
        for (;;) {
          const ct = u8();
          if (ct === TAG.END) break;
          o[str()] = payload(ct);
        }
        return o;
      }
      default: throw new Error('unknown tag ' + t + ' at ' + p);
    }
  }
  const t = u8();
  const name = str();
  return { name, type: t, value: payload(t), consumed: p, length: bytes.length };
}

/** Enough of a zip reader to prove the central directory agrees with the local headers. */
function readZip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= 0 && dv.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw new Error('no end-of-directory record');
  const count = dv.getUint16(end + 10, true);
  let p = dv.getUint32(end + 16, true);
  const files = [];
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('bad directory entry ' + i);
    const method = dv.getUint16(p + 10, true);
    const crc = dv.getUint32(p + 16, true);
    const comp = dv.getUint32(p + 20, true);
    const raw = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const offset = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    if (dv.getUint32(offset, true) !== 0x04034b50) throw new Error('bad local header for ' + name);
    const lNameLen = dv.getUint16(offset + 26, true);
    const lExtra = dv.getUint16(offset + 28, true);
    const start = offset + 30 + lNameLen + lExtra;
    files.push({ name, method, crc, comp, raw, body: bytes.subarray(start, start + comp) });
    p += 46 + nameLen + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
  }
  return files;
}

function readVarints(bytes, count) {
  const out = [];
  let p = 0;
  while (out.length < count) {
    let v = 0, shift = 0;
    for (;;) {
      const b = bytes[p++];
      v |= (b & 0x7f) << shift;
      if (!(b & 0x80)) break;
      shift += 7;
      if (shift > 35) throw new Error('varint too long');
    }
    out.push(v >>> 0);
  }
  return { values: out, consumed: p };
}

/* ── fixtures ─────────────────────────────────────────────────────────────────────────── */

function lShape() {
  const c = new CellSet();
  c.set(0, 0, 0, 0);
  c.set(1, 0, 0, 4);
  c.set(0, 1, 0, 4);
  c.set(0, 0, 2, 15);
  return c;
}

export default async function () {

  suite('nbt / writer', () => {

    test('a scalar compound round trips through an independent reader', () => {
      const bytes = writeNBT('Root', Compound({
        n: Int(-7), s: Str('hello'), b: Byte(3), sh: Short(300)
      }));
      const r = readNBT(bytes);
      eq(r.name, 'Root');
      eq(r.type, TAG.COMPOUND);
      eq(r.value.n, -7);
      eq(r.value.s, 'hello');
      eq(r.value.b, 3);
      eq(r.value.sh, 300);
      eq(r.consumed, r.length, 'the reader must land exactly on the end of the file');
    });

    test('nesting, lists and arrays survive', () => {
      const bytes = writeNBT('', Compound({
        size: List(TAG.INT, [Int(1), Int(2), Int(3)]),
        palette: List(TAG.COMPOUND, [Compound({ Name: Str('a') }), Compound({ Name: Str('b') })]),
        raw: ByteArray(Uint8Array.from([0, 200, 255])),
        ia: IntArray([-1, 0, 99]),
        empty: List(TAG.COMPOUND, [])
      }));
      const v = readNBT(bytes).value;
      deepEq(v.size, [1, 2, 3]);
      eq(v.palette.length, 2);
      eq(v.palette[1].Name, 'b');
      eq(v.raw.length, 3);
      eq(v.raw[1], 200, 'a byte array is raw bytes, not sign-mangled');
      deepEq(v.ia, [-1, 0, 99]);
      eq(v.empty.length, 0);
      eq(v.empty.elementType, TAG.COMPOUND, 'an empty list still declares its element type');
    });

    test('big-endian, which is the half of NBT easiest to get backwards', () => {
      const bytes = writeNBT('', Compound({ n: Int(0x01020304) }));
      // 1 (type) + 2 (name length) + 0 (name) + 1 (field type) + 2 + 1 ("n") = 7 bytes in
      deepEq([...bytes.subarray(7, 11)], [1, 2, 3, 4]);
    });
  });

  suite('nbt / gzip', () => {

    const sample = (n) => {
      const a = new Uint8Array(n);
      for (let i = 0; i < n; i++) a[i] = (i * 37 + (i >> 5)) & 0xff;
      return a;
    };

    test('the stored stream is real gzip — node unpacks it byte for byte', () => {
      for (const n of [0, 1, 1000, 65535, 65536, 200000]) {
        const src = sample(n);
        const out = zlib.gunzipSync(Buffer.from(gzipStored(src)));
        eq(out.length, n, `length at n=${n}`);
        ok(Buffer.from(src).equals(out), `content at n=${n}`);
      }
    });

    test('blocks past 64 KB are split, and the last one is marked final', () => {
      const z = gzipStored(sample(70000));
      eq(z[0], 0x1f); eq(z[1], 0x8b); eq(z[2], 0x08);
      eq(z[10], 0, 'the first block is not final');
      // header + first block (5 + 65535) lands on the second block header
      eq(z[10 + 5 + 65535], 1, 'the second block is final');
    });

    test('the trailer carries the real crc and length', () => {
      const src = sample(5000);
      const z = gzipStored(src);
      const dv = new DataView(z.buffer, z.byteOffset, z.byteLength);
      eq(dv.getUint32(z.length - 8, true), crc32(src));
      eq(dv.getUint32(z.length - 4, true), 5000);
    });

    test('crc32 matches node on a known input', () => {
      eq(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
    });

    test('varints encode the way the schematic spec reads them', () => {
      deepEq(varint(0, []), [0]);
      deepEq(varint(1, []), [1]);
      deepEq(varint(127, []), [127]);
      deepEq(varint(128, []), [0x80, 0x01]);
      deepEq(varint(300, []), [0xac, 0x02]);
      const { values } = readVarints(Uint8Array.from(
        [].concat(varint(0, []), varint(300, []), varint(70000, []))), 3);
      deepEq(values, [0, 300, 70000]);
    });
  });

  await suiteAsync('nbt / gzip (platform)', async () => {
    await testAsync('the async path produces gzip node can read, and compresses when it can',
      async () => {
        const src = new Uint8Array(100000);     // all zeroes: highly compressible
        const z = await gzip(src);
        eq(zlib.gunzipSync(Buffer.from(z)).length, 100000);
        if (typeof CompressionStream !== 'undefined') {
          ok(z.length < gzipStored(src).length,
             'with a real compressor available the file should be much smaller');
          note('100 KB of zeroes: ' + gzipStored(src).length.toLocaleString() +
               ' bytes stored, ' + z.length.toLocaleString() + ' bytes compressed');
        }
      });
  });

  suite('minecraft / schem', () => {

    test('the block table covers the palette exactly, with real ids', () => {
      eq(BLOCKS.length, PALETTE_SIZE);
      for (const id of BLOCKS) ok(/^minecraft:[a-z_]+$/.test(id), 'bad id: ' + id);
      ok(!BLOCKS.includes(AIR), 'air must not be a material — it is the absence of one');
    });

    test('dimensions and palette describe the build', () => {
      const r = toSchem(lShape(), { name: 'test' });
      eq(r.width, 2); eq(r.height, 2); eq(r.length, 3);
      eq(r.volume, 12);
      eq(r.palette[0], AIR, 'air is index 0 so an untouched slot means empty');
      eq(r.palette.length, 4, 'air plus the three materials in use');
    });

    test('the file gzips, ungzips and reads back as a version 2 schematic', () => {
      const r = toSchem(lShape(), { name: 'test' });
      const back = zlib.gunzipSync(Buffer.from(gzipStored(r.nbt)));
      const nbt = readNBT(new Uint8Array(back));
      eq(nbt.name, 'Schematic', 'version 2 names its root compound');
      const s = nbt.value;
      eq(s.Version, 2);
      eq(s.DataVersion, DEFAULT_DATA_VERSION);
      eq(s.Width, 2); eq(s.Height, 2); eq(s.Length, 3);
      deepEq(s.Offset, [0, 0, 0]);
      eq(s.PaletteMax, 4);
      eq(Object.keys(s.Palette).length, 4);
      eq(s.Metadata.Name, 'test');
      eq(s.BlockEntities.length, 0);
      eq(nbt.consumed, nbt.length);
    });

    test('every cell lands at x + z*W + y*W*L, and everything else is air', () => {
      const r = toSchem(lShape());
      const s = readNBT(r.nbt).value;
      const { values, consumed } = readVarints(s.BlockData, r.volume);
      eq(consumed, s.BlockData.length, 'no bytes left over');
      eq(values.length, 12);

      const W = r.width, L = r.length;
      const at = (x, y, z) => values[x + z * W + y * W * L];
      const idOf = {};
      for (const k of Object.keys(s.Palette)) idOf[s.Palette[k]] = k;

      eq(idOf[at(0, 0, 0)], BLOCKS[0]);
      eq(idOf[at(1, 0, 0)], BLOCKS[4]);
      eq(idOf[at(0, 1, 0)], BLOCKS[4]);
      eq(idOf[at(0, 0, 2)], BLOCKS[15]);
      eq(idOf[at(1, 1, 2)], AIR);
      eq(values.filter(v => idOf[v] === AIR).length, 8, 'four cells of twelve are filled');
    });

    test('two materials sharing one block share one palette entry', () => {
      const c = new CellSet();
      c.set(0, 0, 0, 4);
      c.set(1, 0, 0, 4 + PALETTE_SIZE);        // same material after clamping
      const r = toSchem(c);
      eq(r.palette.length, 2, 'air and one block');
    });

    test('the build is shifted so its minimum corner sits at the origin', () => {
      const c = new CellSet();
      c.set(-30, 7, -4, 2);
      c.set(-29, 7, -4, 2);
      const r = toSchem(c);
      eq(r.width, 2); eq(r.height, 1); eq(r.length, 1);
      const s = readNBT(r.nbt).value;
      const { values } = readVarints(s.BlockData, r.volume);
      ok(values.every(v => v !== 0), 'both slots are filled, so nothing was shifted off');
    });

    test('the default in the document matches the default in the exporter', () => {
      eq(DEFAULTS.mcVer, DEFAULT_DATA_VERSION, 'two files must not drift apart on this');
      ok(DATA_VERSIONS.some(d => d.v === DEFAULT_DATA_VERSION), 'the default must be offerable');
    });

    test('a chosen data version is written through', () => {
      for (const d of DATA_VERSIONS) {
        const r = toSchem(lShape(), { dataVersion: d.v });
        eq(readNBT(r.nbt).value.DataVersion, d.v, d.name);
      }
    });

    test('an empty set and an oversized box are refused, with reasons', () => {
      let msg = '';
      try { toSchem(new CellSet()); } catch (e) { msg = e.message; }
      ok(/nothing/.test(msg), 'got: ' + msg);

      const wide = new CellSet();
      wide.set(0, 0, 0, 1);
      wide.set(3000, 3000, 3000, 1);           // 3001^3 slots
      msg = '';
      try { toSchem(wide); } catch (e) { msg = e.message; }
      ok(/structure/.test(msg), 'the refusal should point at the sparse format: ' + msg);
      ok(3001 * 3001 * 3001 > MAX_SCHEM_VOLUME);
    });

    test('a real preset exports at a sane size', () => {
      const p = PRESETS.find(x => x.name === 'Menger sponge');
      const st = apply(p).state;
      const cells = evaluate(st.seed, st.ops, st.cap, st.iters).cells;
      const r = toSchem(cells, { name: 'menger' });
      eq(r.volume, 27 * 27 * 27);
      const z = zlib.gzipSync(Buffer.from(r.nbt));
      note('Menger sponge .schem: ' + r.nbt.length.toLocaleString() + ' bytes of NBT, ' +
           z.length.toLocaleString() + ' compressed, ' +
           gzipStored(r.nbt).length.toLocaleString() + ' stored');
      ok(zlib.gunzipSync(z).length === r.nbt.length);
    });
  });

  suite('minecraft / structures', () => {

    test('a small build is one tile with one file', () => {
      const t = toStructures(lShape(), { name: 'small' });
      eq(t.length, 1);
      eq(t[0].name, 'small_0_0_0');
      deepEq(t[0].origin, [0, 0, 0]);
      deepEq(t[0].size, [2, 2, 3]);
      eq(t[0].count, 4);
    });

    test('the file reads back as a vanilla structure, sparse and unnamed at the root', () => {
      const t = toStructures(lShape(), { name: 'small' })[0];
      const r = readNBT(t.nbt);
      eq(r.name, '', 'a structure file has an anonymous root');
      const v = r.value;
      eq(v.DataVersion, DEFAULT_DATA_VERSION);
      deepEq(v.size, [2, 2, 3]);
      eq(v.blocks.length, 4, 'only the cells that exist are listed');
      eq(v.entities.length, 0);
      eq(v.palette.length, 3, 'three materials in this shape');
      const names = v.palette.map(x => x.Name);
      ok(names.includes(BLOCKS[0]) && names.includes(BLOCKS[4]) && names.includes(BLOCKS[15]));
      const first = v.blocks.find(b => b.pos[0] === 0 && b.pos[1] === 0 && b.pos[2] === 2);
      eq(names[first.state], BLOCKS[15]);
      eq(r.consumed, r.length);
    });

    test('anything past 48 is tiled, with positions local to each tile', () => {
      const c = new CellSet();
      for (let x = 0; x < 100; x++) c.set(x, 0, 0, 3);
      const t = toStructures(c, { name: 'line' });
      eq(t.length, 3, '100 cells across is three tiles of at most 48');
      deepEq(t.map(x => x.origin[0]), [0, 48, 96]);
      eq(t.map(x => x.count).reduce((a, b) => a + b, 0), 100, 'no cell lost, none duplicated');
      for (const tile of t) {
        const v = readNBT(tile.nbt).value;
        for (const blk of v.blocks) {
          ok(blk.pos[0] >= 0 && blk.pos[0] < STRUCTURE_MAX, 'position must be inside the tile');
        }
      }
    });

    test('empty tiles are never written — that is the point of the sparse format', () => {
      const c = new CellSet();
      c.set(0, 0, 0, 1);
      c.set(200, 0, 0, 1);                     // far apart, nothing between
      const t = toStructures(c);
      eq(t.length, 2, 'two occupied tiles, not five');
    });

    test('a 160,000 cell sponge tiles without losing a block', () => {
      const p = PRESETS.find(x => x.name === 'Menger, coloured by address');
      const st = apply(p).state;
      const cells = evaluate(st.seed, st.ops, st.cap, st.iters).cells;
      const t = toStructures(cells, { name: 'sponge' });
      eq(t.map(x => x.count).reduce((a, b) => a + b, 0), cells.size);
      const bytes = t.map(x => x.nbt.length).reduce((a, b) => a + b, 0);
      note('Menger depth 3 as structures: ' + t.length + ' files, ' +
           bytes.toLocaleString() + ' bytes before gzip');
      ok(t.length === 8, '81 across is 2 tiles per axis');
    });

    test('air fill writes an air block for every hole, which is the cost of clearing', () => {
      const plain = toStructures(lShape())[0];
      const airy = toStructures(lShape(), { air: true })[0];
      const a = readNBT(plain.nbt).value, b = readNBT(airy.nbt).value;
      deepEq(b.size, a.size);
      eq(a.blocks.length, 4, 'sparse: only the cells that exist');
      eq(b.blocks.length, 2 * 2 * 3, 'dense: every position in the box');
      eq(b.palette.length, a.palette.length + 1);
      eq(b.palette[b.palette.length - 1].Name, 'minecraft:air');
      const airSlot = b.palette.length - 1;
      eq(b.blocks.filter(x => x.state === airSlot).length, 12 - 4);
      // and the solid cells did not move
      for (const blk of a.blocks) {
        const same = b.blocks.find(x => x.pos.every((v, i) => v === blk.pos[i]));
        eq(a.palette[blk.state].Name, b.palette[same.state].Name, blk.pos.join(','));
      }
    });

    test('the placement note names every file it wrote', () => {
      const t = toStructures(lShape(), { name: 'small' });
      const txt = structureReadme(t, 'small');
      ok(txt.includes('small_0_0_0'));
      ok(txt.includes('48'), 'the tile size has to be in there to make the offsets mean anything');
    });

    test('the note tells you how to find the folder, both spellings and all three platforms', () => {
      const t = toStructures(lShape(), { name: 'small' });
      const txt = structureReadme(t, 'small');
      ok(/structure_block/.test(txt), 'it should say how to get a structure block');
      ok(/Open World Folder/.test(txt), 'the in-game route beats a file path');
      ok(txt.includes('generated/minecraft/structures') &&
         txt.includes('structure/'), 'both the 1.20 and 1.21 spellings');
      for (const os of ['.minecraft', 'Application Support', 'server']) ok(txt.includes(os), os);
      ok(/Bedrock/.test(txt), 'Bedrock does not work this way and the note must say so');
    });

    test('a tiled note lists every offset, one line each', () => {
      const c = new CellSet();
      for (let x = 0; x < 100; x++) c.set(x, 0, 0, 3);
      const tiles = toStructures(c, { name: 'line' });
      const txt = structureReadme(tiles, 'line');
      for (const t of tiles) ok(txt.includes(t.name + '   offset ' + t.origin.join(' ')), t.name);
    });
  });

  suite('bedrock / mcstructure', () => {

    test('both block tables cover the palette, and the legacy one carries its states', () => {
      eq(BEDROCK_BLOCKS.length, PALETTE_SIZE);
      eq(BEDROCK_LEGACY_BLOCKS.length, PALETTE_SIZE);
      for (const b of BEDROCK_BLOCKS) ok(/^minecraft:[a-z_]+$/.test(b.name), b.name);
      for (const b of BEDROCK_LEGACY_BLOCKS) ok(/^minecraft:[a-z_]+$/.test(b.name), b.name);
      eq(BEDROCK_LEGACY_BLOCKS[2].states.color, 'silver',
         'Bedrock calls light gray "silver" and always has');
    });

    test('the version int packs four bytes the way the game reads them', () => {
      eq(blockVersion(1, 16, 210, 3), 17879555, 'the documented example');
      eq(blockVersion(1, 21, 0, 0), (1 << 24) | (21 << 16));
    });

    test('the file is little-endian NBT with the shape the loader demands', () => {
      const t = toMCStructures(lShape(), { name: 'b' })[0];
      const r = readNBTLE(t.nbt);
      eq(r.name, '', 'anonymous root');
      eq(r.consumed, r.length, 'the reader lands exactly on the end');
      const v = r.value;
      eq(v.format_version, 1);
      deepEq(v.size, [2, 2, 3]);
      deepEq(v.structure_world_origin, [0, 0, 0]);
      eq(v.structure.block_indices.length, 2, 'exactly two layers or the game refuses it');
      const [first, second] = v.structure.block_indices;
      eq(first.length, 2 * 2 * 3, 'one entry per cell of the box');
      eq(second.length, first.length, 'the layers must match in length');
      ok(second.every(x => x === -1), 'the second layer is empty');
      ok(v.structure.palette.default, 'the palette must be called default');
      eq(v.structure.palette.default.block_palette.length, 3);
    });

    test('blocks are indexed ZYX — the opposite of the Java schematic', () => {
      const t = toMCStructures(lShape(), { name: 'b' })[0];
      const v = readNBTLE(t.nbt).value;
      const [SX, SY, SZ] = v.size;
      const idx = (x, y, z) => SZ * SY * x + SZ * y + z;
      const pal = v.structure.palette.default.block_palette;
      const layer = v.structure.block_indices[0];
      eq(pal[layer[idx(0, 0, 0)]].name, BEDROCK_LEGACY_BLOCKS[0].name);
      eq(pal[layer[idx(0, 0, 0)]].states.color, 'white');
      eq(pal[layer[idx(1, 0, 0)]].states.color, 'black');
      eq(pal[layer[idx(0, 1, 0)]].states.color, 'black');
      eq(pal[layer[idx(0, 0, 2)]].states.color, 'yellow');
      eq(layer[idx(1, 1, 2)], -1, 'an empty cell leaves whatever is already there');
      eq(layer.filter(x => x === -1).length, 12 - 4);
    });

    test('the flattened table is one switch away and writes bare ids', () => {
      const t = toMCStructures(lShape(), { name: 'b', idStyle: 'flat' })[0];
      const pal = readNBTLE(t.nbt).value.structure.palette.default.block_palette;
      const names = pal.map(p => p.name);
      ok(names.includes('minecraft:white_concrete'), names.join(' '));
      for (const p of pal) eq(Object.keys(p.states).length, 0, 'a flattened id needs no state');
    });

    test('the chosen version reaches every palette entry', () => {
      for (const v of BEDROCK_VERSIONS) {
        const t = toMCStructures(lShape(), { version: v.name })[0];
        const pal = readNBTLE(t.nbt).value.structure.palette.default.block_palette;
        for (const e of pal) eq(e.version, v.block, v.name);
      }
    });

    test('tiles at 64, not 48 — Bedrock allows the bigger box', () => {
      eq(BEDROCK_TILE, 64);
      const c = new CellSet();
      for (let x = 0; x < 100; x++) c.set(x, 0, 0, 3);
      const t = toMCStructures(c, { name: 'line' });
      eq(t.length, 2, '100 across is two tiles of 64, where Java needed three of 48');
      eq(t.map(x => x.count).reduce((a, b) => a + b, 0), 100);
      deepEq(t.map(x => x.origin[0]), [0, 64]);
    });

    test('air fill replaces the structure void with a real air block', () => {
      const plain = toMCStructures(lShape())[0];
      const airy = toMCStructures(lShape(), { air: true })[0];

      const a = readNBTLE(plain.nbt).value;
      const b = readNBTLE(airy.nbt).value;
      const palA = a.structure.palette.default.block_palette;
      const palB = b.structure.palette.default.block_palette;
      eq(palB.length, palA.length + 1, 'one more palette entry: air');
      eq(palB[palB.length - 1].name, 'minecraft:air');
      eq(palB[palB.length - 1].version, palA[0].version, 'air takes the same block version');

      const layer = b.structure.block_indices[0];
      eq(layer.filter(x => x === -1).length, 0, 'no voids left in the primary layer');
      eq(layer.filter(x => x === palB.length - 1).length, 12 - 4, 'the empty cells are air');
      eq(b.structure.block_indices[1].filter(x => x !== -1).length, 0,
         'the second layer stays void — air there would be water');
      deepEq(b.size, a.size, 'the box does not change');
    });

    test('the same cells come out in the same places either way', () => {
      const plain = readNBTLE(toMCStructures(lShape())[0].nbt).value;
      const airy = readNBTLE(toMCStructures(lShape(), { air: true })[0].nbt).value;
      const pal = airy.structure.palette.default.block_palette;
      const air = pal.length - 1;
      const A = plain.structure.block_indices[0], B = airy.structure.block_indices[0];
      for (let i = 0; i < A.length; i++) {
        if (A[i] === -1) eq(B[i], air, 'index ' + i);
        else eq(B[i], A[i], 'index ' + i);
      }
    });

    test('every tile of a real preset keeps its cells and its box', () => {
      const p = PRESETS.find(x => x.name === 'Vicsek cross');
      const st = apply(p).state;
      const cells = evaluate(st.seed, st.ops, st.cap, st.iters).cells;
      const tiles = toMCStructures(cells, { name: 'vicsek' });
      eq(tiles.map(t => t.count).reduce((a, b) => a + b, 0), cells.size);
      for (const t of tiles) {
        const v = readNBTLE(t.nbt).value;
        const vol = v.size[0] * v.size[1] * v.size[2];
        eq(v.structure.block_indices[0].length, vol, t.name);
        eq(v.structure.block_indices[0].filter(x => x >= 0).length, t.count, t.name);
      }
    });
  });

  await suiteAsync('bedrock / mcpack', async () => {

    await testAsync('the pack is a readable zip holding a manifest and every structure',
      async () => {
        const { bytes, tiles } = await toMCPack(lShape(), { name: 'demo' });
        const files = readZip(bytes);
        const names = files.map(f => f.name);
        deepEq(names, ['manifest.json', 'structures/demo/demo_0_0_0.mcstructure', 'README.txt']);
        eq(tiles.length, 1);
        // Every entry decompressed must match the crc and length the directory claims — the
        // check a real unzip does, run with node's inflate rather than our own code.
        for (const f of files) {
          const raw = f.method === 8 ? new Uint8Array(zlib.inflateRawSync(Buffer.from(f.body)))
                                     : f.body;
          eq(raw.length, f.raw, f.name + ' length');
          eq(crc32(raw), f.crc, f.name + ' crc');
        }
        const structure = files.find(f => f.name.endsWith('.mcstructure'));
        const raw = structure.method === 8
          ? new Uint8Array(zlib.inflateRawSync(Buffer.from(structure.body))) : structure.body;
        eq(readNBTLE(raw).value.format_version, 1, 'the packed bytes are still a structure');
      });

    await testAsync('the manifest is valid json with two distinct fresh uuids', async () => {
      const a = JSON.parse(packManifest('demo', '1.21'));
      const b = JSON.parse(packManifest('demo', '1.21'));
      eq(a.format_version, 2);
      eq(a.modules[0].type, 'data');
      deepEq(a.header.min_engine_version, [1, 21, 0]);
      ok(/^[0-9a-f-]{36}$/.test(a.header.uuid), a.header.uuid);
      ok(a.header.uuid !== a.modules[0].uuid, 'header and module need different ids');
      ok(a.header.uuid !== b.header.uuid, 'a second export must not collide with the first');
    });

    await testAsync('a stored entry round trips and a deflated one is smaller', async () => {
      const flat = new Uint8Array(50000);       // compresses to nothing
      const packed = await zip([{ name: 'a.bin', data: flat }, { name: 'b.txt', data: 'hello' }]);
      const files = readZip(packed);
      eq(files.length, 2);
      eq(files[1].method, 0, 'five bytes are not worth deflating');
      eq(new TextDecoder().decode(files[1].body), 'hello');
      eq(files[0].raw, 50000);
      if (typeof CompressionStream !== 'undefined') {
        eq(files[0].method, 8);
        ok(files[0].comp < 1000, 'deflated: ' + files[0].comp);
        note('50 KB of zeroes zips to ' + files[0].comp + ' bytes');
      }
    });

    await testAsync('a sponge packs to something sendable', async () => {
      const p = PRESETS.find(x => x.name === 'Menger sponge');
      const st = apply(p).state;
      const cells = evaluate(st.seed, st.ops, st.cap, st.iters).cells;
      const { bytes, tiles } = await toMCPack(cells, { name: 'menger' });
      const files = readZip(bytes);
      eq(files.length, tiles.length + 2);
      note('Menger sponge .mcpack: ' + tiles.length + ' structure, ' +
           bytes.length.toLocaleString() + ' bytes packed, ' +
           files.reduce((a, f) => a + f.raw, 0).toLocaleString() + ' raw');
    });

    await testAsync('the note comes back from the export, to be saved beside the pack', async () => {
      const { notes, tiles } = await toMCPack(lShape(), { name: 'demo' });
      ok(notes.includes('/structure load demo:demo_0_0_0 ~ ~ ~'), notes);
      eq(tiles.length, 1);
      ok(notes.indexOf('COMMANDS') < notes.indexOf('IMPORT'),
         'the commands come first — that is what the file is opened for');
    });

    await testAsync('the note lists the blocks each material became', async () => {
      const map = DEFAULT_MAP.slice();
      map[0] = 'glowstone';
      const tiles = toMCStructures(lShape(), { name: 'demo', blocks: map });
      const txt = mcpackReadme(tiles, 'demo', { blocks: map, materials: new Set([0, 4]) });
      ok(txt.includes('minecraft:glowstone'), txt);
      ok(txt.includes('material  1'), txt);
      ok(txt.includes('material  5'), txt);
      ok(!/material  3\b/.test(txt), 'materials not in the build stay out');
      const legacy = mcpackReadme(tiles, 'demo', { blocks: map, materials: new Set([4]) });
      ok(legacy.includes('["color"="black"]'), 'legacy ids need their state spelled out');
      const flat = mcpackReadme(tiles, 'demo',
        { blocks: map, materials: new Set([4]), idStyle: 'flat' });
      ok(flat.includes('minecraft:black_concrete') && !flat.includes('["color"'), flat);
    });

    await testAsync('the header counts what is actually in the build', async () => {
      const c = new CellSet();
      for (let x = 0; x < 100; x++) c.set(x, 0, 0, 3);
      const tiles = toMCStructures(c, { name: 'line' });
      const txt = mcpackReadme(tiles, 'line');
      ok(txt.includes('100 blocks'), txt.split('\n')[1]);
      ok(txt.includes('2 structures'), txt.split('\n')[1]);
    });

    await testAsync('the note says which way empty space was written', async () => {
      const tiles = toMCStructures(lShape(), { name: 'demo' });
      ok(/will not clear terrain/.test(mcpackReadme(tiles, 'demo')));
      ok(/CLEARS the space/.test(mcpackReadme(tiles, 'demo', { air: true })));
    });

    await testAsync('the loose-file note explains where Bedrock will actually look', async () => {
      const c = new CellSet();
      for (let x = 0; x < 100; x++) c.set(x, 0, 0, 3);
      const tiles = toMCStructures(c, { name: 'line' });
      const txt = looseFileReadme(tiles, 'line');
      ok(/behavior_packs/.test(txt), 'the path is the whole point of the file');
      ok(/ACTIVE/.test(txt), 'an inactive pack is the silent failure here');
      ok(txt.includes('mystructure'), 'a file loose in structures/ gets that namespace');
      ok(txt.includes('line:line_0_0_0') && txt.includes('line:line_1_0_0'));
      ok(txt.includes('offset 64 0 0'));
      ok(/\.mcpack/.test(txt), 'it should point at the easier route for anyone without a pack');
    });

    await testAsync('a load command reads ~ for zero and ~n otherwise', async () => {
      eq(loadCommand('b', { name: 'b_0_0_0', origin: [0, 0, 0] }),
         '/structure load b:b_0_0_0 ~ ~ ~');
      eq(loadCommand('b', { name: 'b_1_0_2', origin: [64, 0, 128] }),
         '/structure load b:b_1_0_2 ~64 ~ ~128');
    });

    await testAsync('the note gives a runnable command per tile', async () => {
      const c = new CellSet();
      for (let x = 0; x < 100; x++) c.set(x, 0, 0, 3);
      const tiles = toMCStructures(c, { name: 'line' });
      const txt = mcpackReadme(tiles, 'line');
      ok(txt.includes('/structure load line:line_0_0_0'));
      ok(txt.includes('/structure load line:line_1_0_0'));
      ok(/~64/.test(txt), 'the second tile needs its offset in the command');
      ok(/behaviou?r pack/i.test(txt), 'it has to say the pack must be activated');
    });
  });
}
