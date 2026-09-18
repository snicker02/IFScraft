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
      const p = PRESETS.find(x => x.name === 'Menger, coloured by depth');
      const st = apply(p).state;
      const cells = evaluate(st.seed, st.ops, st.cap, st.iters).cells;
      const t = toStructures(cells, { name: 'sponge' });
      eq(t.map(x => x.count).reduce((a, b) => a + b, 0), cells.size);
      const bytes = t.map(x => x.nbt.length).reduce((a, b) => a + b, 0);
      note('Menger depth 3 as structures: ' + t.length + ' files, ' +
           bytes.toLocaleString() + ' bytes before gzip');
      ok(t.length === 8, '81 across is 2 tiles per axis');
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
}
