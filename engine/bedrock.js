// Bedrock Edition export. A different game, and the Java exports do not work there at all:
// Bedrock keeps structures inside the world or inside an add-on, never as a loose .nbt, and its
// NBT is little-endian and uncompressed.
//
// The unit here is `.mcstructure`, and the delivery is a `.mcpack` — a zip that Bedrock imports
// on a double-click. The alternative is telling someone to go find com.mojang, which on a phone
// or a console is a worse instruction than any file format problem.
//
// FOUR THINGS ABOUT THE FORMAT THAT ARE NOT GUESSABLE:
//
// 1. Blocks are indexed ZYX, not XYZ: index = SZ*SY*x + SZ*y + z. Java's schematic is the other
//    way round. Getting this wrong produces a shape that is recognisably yours and wrong.
// 2. `block_indices` must hold exactly two lists of exactly width*height*depth entries — a second
//    layer, used in vanilla for the water in a waterlogged block. Ours is all -1. Wrong count in
//    either list and the game refuses the whole structure.
// 3. -1 means "leave whatever is already there", which is how a structure void is stored. Using
//    it for empty cells makes the export sparse in effect: the fractal's gaps do not carry air
//    that would clear the terrain around them. The trade is that you cannot carve with it.
// 4. Each palette entry carries a `version` int whose four bytes are the game version that wrote
//    it — 0x01 10 D2 03 is 1.16.210.3. It drives the game's own upgrade path for old block data.
//
// BLOCK IDS ARE THE ONE THING HERE I COULD NOT VERIFY IN GAME. Bedrock has been splitting
// compound blocks into separate ids since 1.16.100 (`concrete` with a colour state became
// `white_concrete` and the rest), a process the wiki still lists as unfinished, with the old ids
// kept as aliases. So both tables are here and the export offers both: aliases are documented to
// still work, which makes the legacy table the safer default, and the flattened one is a single
// switch away if a version ever drops them.

import { unpackX, unpackY, unpackZ } from './cells.js';
import { PALETTE_SIZE, clampMat } from './palette.js';
import { Byte, Int, Str, Compound, List, TAG, writeNBT } from './nbt.js';
import { resolve, sanitizeMap, DEFAULT_MAP } from './blocks.js';
import { zip, uuid4 } from './zip.js';

/** The default mapping, resolved both ways. Named exports because they are what the app opens
    with; the live mapping comes from the document — see engine/blocks.js. */
export const BEDROCK_BLOCKS = DEFAULT_MAP.map(k => resolve(k, 'bedrock'));
export const BEDROCK_LEGACY_BLOCKS = DEFAULT_MAP.map(k => resolve(k, 'bedrock-legacy'));

/** The vanilla save limit is 64 x 256 x 64. Bigger files do load from a pack, by report, but a
    limit nobody has to trust is worth more than a few fewer files. */
export const BEDROCK_TILE = 64;

/** Four bytes: major, minor, patch, revision. */
export function blockVersion(major, minor, patch, rev = 0) {
  return ((major & 0xff) * 0x1000000) + ((minor & 0xff) << 16) + ((patch & 0xff) << 8) + (rev & 0xff);
}

export const BEDROCK_VERSIONS = [
  { name: '1.20',  v: [1, 20, 0], block: blockVersion(1, 20, 0) },
  { name: '1.21',  v: [1, 21, 0], block: blockVersion(1, 21, 0) },
  { name: '26.x',  v: [1, 26, 0], block: blockVersion(1, 26, 0) }
];
export const DEFAULT_BEDROCK_VERSION = '26.x';

function paletteEntry(def, version) {
  const states = {};
  for (const k of Object.keys(def.states || {})) {
    const v = def.states[k];
    states[k] = typeof v === 'string' ? Str(v) : typeof v === 'boolean' ? Byte(v ? 1 : 0) : Int(v);
  }
  return Compound({ name: Str(def.name), states: Compound(states), version: Int(version) });
}

/** One .mcstructure per occupied tile. Returns [{ name, nbt, origin, size, count }]. */
export function toMCStructures(cells, opts = {}) {
  const b = cells.bounds();
  if (!b) throw new Error('nothing to export');
  const max = Math.max(1, Math.min(BEDROCK_TILE, opts.tile || BEDROCK_TILE));
  const base = opts.name || 'ifscraft';
  const style = opts.idStyle === 'flat' ? 'bedrock' : 'bedrock-legacy';
  const map = sanitizeMap(opts.blocks);
  const ver = (BEDROCK_VERSIONS.find(v => v.name === opts.version) ||
               BEDROCK_VERSIONS[BEDROCK_VERSIONS.length - 1]);

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
  for (const key of [...tiles.keys()].sort()) {
    const t = tiles.get(key);
    let SX = 0, SY = 0, SZ = 0;
    for (const c of t.cells) {
      if (c[0] + 1 > SX) SX = c[0] + 1;
      if (c[1] + 1 > SY) SY = c[1] + 1;
      if (c[2] + 1 > SZ) SZ = c[2] + 1;
    }

    const mats = [...new Set(t.cells.map(c => c[3]))].sort((a, c) => a - c);
    const slot = new Map();
    const blockPalette = [];
    for (const m of mats) {
      slot.set(m, blockPalette.length);
      blockPalette.push(paletteEntry(resolve(map[m], style), ver.block));
    }

    const volume = SX * SY * SZ;
    const primary = new Array(volume).fill(-1);
    for (const c of t.cells) primary[SZ * SY * c[0] + SZ * c[1] + c[2]] = slot.get(c[3]);
    const secondary = new Array(volume).fill(-1);

    const root = Compound({
      format_version: Int(1),
      size: List(TAG.INT, [Int(SX), Int(SY), Int(SZ)]),
      structure: Compound({
        block_indices: List(TAG.LIST, [
          List(TAG.INT, primary.map(Int)),
          List(TAG.INT, secondary.map(Int))
        ]),
        entities: List(TAG.COMPOUND, []),
        palette: Compound({
          default: Compound({
            block_palette: List(TAG.COMPOUND, blockPalette),
            block_position_data: Compound({})
          })
        })
      }),
      structure_world_origin: List(TAG.INT, [Int(0), Int(0), Int(0)])
    });

    out.push({
      name: `${base}_${t.tx}_${t.ty}_${t.tz}`,
      nbt: writeNBT('', root, true),          // little-endian: this is the Bedrock half
      origin: [t.tx * max, t.ty * max, t.tz * max],
      size: [SX, SY, SZ],
      count: t.cells.length
    });
  }
  return out;
}

/** The add-on wrapper. `ifscraft` becomes the namespace, so a tile is loaded as
    `ifscraft:ifscraft_0_0_0`. Two fresh uuids per export, because Bedrock refuses a pack whose
    id matches one already installed. */
export function packManifest(base, version) {
  const ver = BEDROCK_VERSIONS.find(v => v.name === version) ||
              BEDROCK_VERSIONS[BEDROCK_VERSIONS.length - 1];
  return JSON.stringify({
    format_version: 2,
    header: {
      name: base + ' (IFScraft)',
      description: 'Structures exported from IFScraft',
      uuid: uuid4(),
      version: [1, 0, 0],
      min_engine_version: ver.v
    },
    modules: [{
      type: 'data',
      description: 'Structure files',
      uuid: uuid4(),
      version: [1, 0, 0]
    }]
  }, null, 2);
}

/** The whole add-on as one file. */
export async function toMCPack(cells, opts = {}) {
  const base = opts.name || 'ifscraft';
  const tiles = toMCStructures(cells, opts);
  const entries = [{ name: 'manifest.json', data: packManifest(base, opts.version) }];
  for (const t of tiles) {
    entries.push({ name: `structures/${base}/${t.name}.mcstructure`, data: t.nbt });
  }
  entries.push({ name: 'README.txt', data: mcpackReadme(tiles, base) });
  return { bytes: await zip(entries), tiles };
}

export function mcpackReadme(tiles, base, max = BEDROCK_TILE) {
  const L = [];
  L.push(`${base} — ${tiles.length} structure${tiles.length === 1 ? '' : 's'}, Bedrock Edition`);
  L.push('');
  L.push('1. Double-click the .mcpack. Minecraft imports it as a behaviour pack.');
  L.push('2. In the world settings, under Behaviour Packs, activate it. Activating a behaviour');
  L.push('   pack turns on cheats for that world, which you need anyway for step 3.');
  L.push('3. In game:');
  L.push('');
  for (const t of tiles) {
    L.push(`     /structure load ${base}:${t.name} ~${t.origin[0] ? '' + t.origin[0] : ''} ` +
           `~${t.origin[1] ? '' + t.origin[1] : ''} ~${t.origin[2] ? '' + t.origin[2] : ''}`);
  }
  L.push('');
  L.push('   Run them from one spot, standing where the build should start. The offsets in the');
  L.push(`   commands are already worked out; tiles are ${max} blocks on a side.`);
  L.push('');
  L.push('   A structure block set to Load and given the same name works too.');
  L.push('');
  L.push('Empty cells are stored as "leave what is there", not as air, so the gaps in a fractal');
  L.push('will not clear terrain. Place it in open sky if you want to see it whole.');
  return L.join('\n');
}
