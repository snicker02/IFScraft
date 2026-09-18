// Minecraft export. Two formats, because they fail in opposite directions.
//
// .schem — Sponge Schematic version 2, the format WorldEdit, FAWE, Litematica and Amulet all
// read. One file, no size limit worth worrying about, paste with //schem load and //paste. It is
// DENSE: the block array has one entry per cell of the bounding box, air included, so a sparse
// build costs what a solid one of the same size costs. Version 2 rather than 3 on purpose —
// 3 is better specified and younger, and every tool in the wild reads 2.
//
// .nbt — the vanilla structure format, read by a structure block with no mods at all. It is
// SPARSE: only the blocks that exist are listed, which suits a Cantor dust exactly. The cost is
// the structure block's 48-cube limit, so anything bigger comes out as a grid of tiles that get
// placed one at a time.
//
// COORDINATES. Minecraft is Y-up and so is this, so the mapping is the identity apart from the
// shift that puts the build's minimum corner at the origin. Nothing is mirrored; a shape exported
// and pasted has the handedness it had on screen.

import { unpackX, unpackY, unpackZ } from './cells.js';
import { MATERIALS, PALETTE_SIZE, clampMat } from './palette.js';
import { Byte, Int, Short, Str, Compound, List, ByteArray, IntArray,
         TAG, writeNBT, varint } from './nbt.js';

/** One block per material slot. Concrete for the saturated end because it is flat, matt and
    reads at distance; terracotta and sandstone for the muted end, where concrete's cleanness
    fights the material name. Every id here has existed since 1.13. */
export const BLOCKS = [
  'minecraft:white_concrete',       // chalk
  'minecraft:smooth_sandstone',     // bone
  'minecraft:light_gray_concrete',  // ash
  'minecraft:gray_concrete',        // slate
  'minecraft:black_concrete',       // ink
  'minecraft:terracotta',           // clay
  'minecraft:brown_concrete',       // rust
  'minecraft:green_concrete',       // moss
  'minecraft:cyan_terracotta',      // verdigris
  'minecraft:cyan_concrete',        // teal
  'minecraft:light_blue_concrete',  // ice
  'minecraft:blue_concrete',        // cobalt
  'minecraft:purple_concrete',      // violet
  'minecraft:magenta_concrete',     // magenta
  'minecraft:orange_concrete',      // ember
  'minecraft:yellow_concrete'       // sulphur
];

export const AIR = 'minecraft:air';

/** Data versions are an ever-increasing integer, one per Minecraft build. A file whose version is
    NEWER than the server refuses to load; an older one is upgraded on paste. So the safe default
    is an old one, and the list is here rather than hard-coded because only the person with the
    server knows what it runs. */
export const DATA_VERSIONS = [
  { name: '1.16.5', v: 2586 },
  { name: '1.18.2', v: 2975 },
  { name: '1.20.1', v: 3465 },
  { name: '1.21',   v: 3953 },
  { name: '1.21.8', v: 4440 }
];
export const DEFAULT_DATA_VERSION = 3465;

/** The structure block places at most 48 cells on a side. Not a choice of ours. */
export const STRUCTURE_MAX = 48;

/** A dense block array has one entry per cell of the bounding box. Past this many the file is
    more of a problem than a deliverable, and the structure export — which is sparse — is the
    right tool instead. */
export const MAX_SCHEM_VOLUME = 16000000;

export function blockFor(mat) { return BLOCKS[clampMat(mat)]; }

/** Which materials are actually used, so the palette holds what the build contains and no more. */
function usedMaterials(cells) {
  const seen = new Set();
  for (const v of cells.m.values()) {
    seen.add(clampMat(v));
    if (seen.size === PALETTE_SIZE) break;
  }
  return [...seen].sort((a, b) => a - b);
}

/* ── .schem (Sponge version 2) ─────────────────────────────────────────────────────────── */

/** Returns { nbt, width, height, length, palette, volume } — `nbt` is uncompressed; the caller
    gzips it, because compression is async where the platform does it properly. */
export function toSchem(cells, opts = {}) {
  const b = cells.bounds();
  if (!b) throw new Error('nothing to export');
  const [W, H, L] = b.size;
  const volume = W * H * L;
  if (volume > MAX_SCHEM_VOLUME) {
    throw new Error(`${W}x${H}x${L} is ${volume.toLocaleString()} block slots — past what a ` +
                    'schematic should carry. Export structure tiles instead; they are sparse.');
  }

  // Palette: air first so an untouched slot is index 0, then one entry per material in use.
  const mats = usedMaterials(cells);
  const palette = { [AIR]: Int(0) };
  const indexOf = new Map();
  let next = 1;
  for (const m of mats) {
    const id = blockFor(m);
    if (!(id in palette)) { palette[id] = Int(next); indexOf.set(m, next); next++; }
    else indexOf.set(m, palette[id].v);   // two materials can share a block; the palette must not
  }

  // x + z * W + y * W * L, per the specification.
  const grid = new Uint8Array(volume);
  for (const [k, mat] of cells.m) {
    const x = unpackX(k) - b.min[0], y = unpackY(k) - b.min[1], z = unpackZ(k) - b.min[2];
    grid[x + z * W + y * W * L] = indexOf.get(clampMat(mat));
  }

  const data = [];
  for (let i = 0; i < volume; i++) varint(grid[i], data);

  const dv = opts.dataVersion || DEFAULT_DATA_VERSION;
  const root = Compound({
    Version: Int(2),
    DataVersion: Int(dv),
    Metadata: Compound({
      Name: Str(opts.name || 'ifscraft'),
      Author: Str('IFScraft')
    }),
    Width: Short(W), Height: Short(H), Length: Short(L),
    Offset: IntArray([0, 0, 0]),
    PaletteMax: Int(next),
    Palette: Compound(palette),
    BlockData: ByteArray(Uint8Array.from(data)),
    BlockEntities: List(TAG.COMPOUND, [])
  });

  return {
    nbt: writeNBT('Schematic', root),
    width: W, height: H, length: L, volume,
    palette: Object.keys(palette)
  };
}

/* ── .nbt (vanilla structure block) ────────────────────────────────────────────────────── */

/** Split into structure-block-sized tiles. Returns a list of { name, nbt, origin, size, count },
    one per tile that has anything in it — an empty tile is not written, so a sparse build costs
    only the tiles it occupies. */
export function toStructures(cells, opts = {}) {
  const b = cells.bounds();
  if (!b) throw new Error('nothing to export');
  const max = Math.max(1, Math.min(STRUCTURE_MAX, opts.tile || STRUCTURE_MAX));
  const base = opts.name || 'ifscraft';
  const dv = opts.dataVersion || DEFAULT_DATA_VERSION;

  const tiles = new Map();
  for (const [k, mat] of cells.m) {
    const x = unpackX(k) - b.min[0], y = unpackY(k) - b.min[1], z = unpackZ(k) - b.min[2];
    const tx = Math.floor(x / max), ty = Math.floor(y / max), tz = Math.floor(z / max);
    const id = tx + ',' + ty + ',' + tz;
    let t = tiles.get(id);
    if (!t) { t = { tx, ty, tz, cells: [] }; tiles.set(id, t); }
    t.cells.push([x - tx * max, y - ty * max, z - tz * max, clampMat(mat)]);
  }

  const out = [];
  const keys = [...tiles.keys()].sort();
  for (const key of keys) {
    const t = tiles.get(key);
    let sx = 0, sy = 0, sz = 0;
    for (const c of t.cells) {
      if (c[0] + 1 > sx) sx = c[0] + 1;
      if (c[1] + 1 > sy) sy = c[1] + 1;
      if (c[2] + 1 > sz) sz = c[2] + 1;
    }

    // One palette entry per material present in THIS tile: structure palettes are per file.
    const mats = [...new Set(t.cells.map(c => c[3]))].sort((a, b2) => a - b2);
    const slot = new Map();
    const paletteList = [];
    for (const m of mats) {
      slot.set(m, paletteList.length);
      paletteList.push(Compound({ Name: Str(blockFor(m)) }));
    }

    const blocks = t.cells.map(c => Compound({
      state: Int(slot.get(c[3])),
      pos: List(TAG.INT, [Int(c[0]), Int(c[1]), Int(c[2])])
    }));

    const root = Compound({
      DataVersion: Int(dv),
      size: List(TAG.INT, [Int(sx), Int(sy), Int(sz)]),
      palette: List(TAG.COMPOUND, paletteList),
      blocks: List(TAG.COMPOUND, blocks),
      entities: List(TAG.COMPOUND, [])
    });

    out.push({
      name: `${base}_${t.tx}_${t.ty}_${t.tz}`,
      nbt: writeNBT('', root),
      origin: [t.tx * max, t.ty * max, t.tz * max],
      size: [sx, sy, sz],
      count: t.cells.length
    });
  }
  return out;
}

/** The note that goes with a tiled export, because eight .nbt files with no instructions are
    eight files nobody can place. */
export function structureReadme(tiles, base, max = STRUCTURE_MAX) {
  const L = [];
  L.push(`${base} — ${tiles.length} structure file${tiles.length === 1 ? '' : 's'}`, '');
  L.push('Put every .nbt file in:');
  L.push('  <world save>/generated/minecraft/structures/', '');
  L.push('Then, in game, /give yourself a structure block, set it to Load, and type the file');
  L.push('name without the extension. Place each one at the offset below, measured from the');
  L.push(`corner you want the build to start at (tiles are ${max} blocks on a side).`, '');
  for (const t of tiles) {
    L.push(`  ${t.name}   offset ${t.origin.join(' ')}   ${t.size.join('x')}   ` +
           `${t.count.toLocaleString()} blocks`);
  }
  L.push('');
  L.push('The structure block places from its own position, so a tile at offset 48 0 0 goes 48');
  L.push('blocks east of where the first one went. Air is not stored: these files add blocks and');
  L.push('never clear any, so place them in open space.');
  return L.join('\n');
}
