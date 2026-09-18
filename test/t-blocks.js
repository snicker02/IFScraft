// The block catalogue, and the mapping from material to block.
//
// The catalogue is data, and the failure mode of data is a typo that nobody notices until the
// game silently places stone. Nothing here can check an id exists in Minecraft — that needs the
// game — so these check the things that are checkable: shape, uniqueness, that every id looks
// like an id, that both editions resolve every entry, and that the default mapping still
// produces byte-for-byte what it produced before the mapping existed.

import { suite, test, ok, eq, deepEq, note } from './harness.js';
import { CATALOGUE, COLORS, DEFAULT_MAP, MAP_PRESETS, blockByKey, groups,
         matchByColour, resolve, sanitizeMap, isDefaultMap } from '../engine/blocks.js';
import { MATERIALS, PALETTE_SIZE } from '../engine/palette.js';
import { blockFor, toSchem, toStructures, BLOCKS } from '../engine/minecraft.js';
import { toMCStructures, BEDROCK_BLOCKS, BEDROCK_LEGACY_BLOCKS } from '../engine/bedrock.js';
import { newState, encode, decode, apply, DEFAULTS } from '../engine/state.js';
import { CellSet } from '../engine/cells.js';

const ID = /^[a-z][a-z0-9_]*$/;

export default function () {

  suite('blocks / catalogue', () => {

    test('keys are unique — a duplicate would silently shadow a block', () => {
      const keys = CATALOGUE.map(b => b.key);
      eq(new Set(keys).size, keys.length,
         'duplicates: ' + keys.filter((k, i) => keys.indexOf(k) !== i).join(', '));
    });

    test('every entry has an id, a label, a group and a colour', () => {
      for (const b of CATALOGUE) {
        ok(ID.test(b.java), 'bad java id: ' + b.java);
        if (b.be) ok(ID.test(b.be), 'bad bedrock id: ' + b.be);
        if (b.legacy) ok(ID.test(b.legacy.name), 'bad legacy id: ' + b.legacy.name);
        ok(b.label && b.label.length > 1, 'no label: ' + b.key);
        ok(b.group && b.group.length > 1, 'no group: ' + b.key);
        eq(b.rgb.length, 3, b.key);
        for (const c of b.rgb) ok(c >= 0 && c <= 1, b.key + ' colour out of range');
      }
      note(CATALOGUE.length + ' blocks in ' + groups().length + ' groups');
    });

    test('the colour families are complete and carry their state', () => {
      eq(COLORS.length, 16);
      for (const fam of ['concrete', 'wool', 'terracotta', 'stained_glass']) {
        const got = COLORS.filter(([c]) => blockByKey(c + '_' + fam));
        eq(got.length, 16, fam + ' is missing colours');
      }
      eq(resolve('light_gray_wool', 'bedrock-legacy').states.color, 'silver',
         'Bedrock never renamed silver to light gray in a state');
      eq(resolve('light_gray_wool', 'java').name, 'minecraft:light_gray_wool');
    });

    test('the known Java/Bedrock name splits are all present', () => {
      const pairs = [
        ['bricks', 'minecraft:brick_block'],
        ['nether_bricks', 'minecraft:nether_brick'],
        ['snow_block', 'minecraft:snow'],
        ['magma_block', 'minecraft:magma'],
        ['end_stone_bricks', 'minecraft:end_bricks']
      ];
      for (const [key, be] of pairs) {
        eq(resolve(key, 'bedrock').name, be, key);
        eq(resolve(key, 'java').name, 'minecraft:' + key, key);
      }
    });

    test('every entry resolves for all three id styles', () => {
      for (const b of CATALOGUE) {
        for (const style of ['java', 'bedrock', 'bedrock-legacy']) {
          const r = resolve(b.key, style);
          ok(/^minecraft:[a-z0-9_]+$/.test(r.name), b.key + ' / ' + style + ': ' + r.name);
          ok(r.states && typeof r.states === 'object');
        }
      }
    });

    test('a legacy form either adds states or is the same block by another name', () => {
      for (const b of CATALOGUE) {
        if (!b.legacy) continue;
        const differs = b.legacy.name !== b.java || Object.keys(b.legacy.states || {}).length;
        ok(differs, b.key + ' carries a legacy entry that changes nothing');
      }
    });

    test('every mapping preset is sixteen known keys', () => {
      for (const p of MAP_PRESETS) {
        eq(p.keys.length, PALETTE_SIZE, p.name);
        for (const k of p.keys) ok(blockByKey(k), p.name + ' names an unknown block: ' + k);
      }
      eq(MAP_PRESETS[0].name, 'Default');
      deepEq(MAP_PRESETS[0].keys, DEFAULT_MAP);
    });

    test('an unknown key falls back to the default for that slot, not to a hole', () => {
      const m = sanitizeMap(['iron_block', 'not_a_block', 7, null]);
      eq(m.length, PALETTE_SIZE);
      eq(m[0], 'iron_block');
      eq(m[1], DEFAULT_MAP[1]);
      eq(m[15], DEFAULT_MAP[15]);
      deepEq(sanitizeMap(null), DEFAULT_MAP);
      deepEq(sanitizeMap('nonsense'), DEFAULT_MAP);
      ok(isDefaultMap(sanitizeMap(undefined)));
      ok(!isDefaultMap(m));
    });

    test('sanitize returns a copy, so nothing can edit the defaults through it', () => {
      const m = sanitizeMap(null);
      m[0] = 'obsidian';
      eq(DEFAULT_MAP[0], 'white_concrete');
    });
  });

  suite('blocks / colour matching', () => {

    test('each material gets the nearest block, and dark stays dark', () => {
      const m = matchByColour(MATERIALS);
      eq(m.length, PALETTE_SIZE);
      for (const k of m) ok(blockByKey(k), k);
      const ink = blockByKey(m[4]);           // 'ink' is the darkest material
      ok(ink.rgb[0] + ink.rgb[1] + ink.rgb[2] < 0.6, 'ink matched to ' + ink.label);
      const chalk = blockByKey(m[0]);
      ok(chalk.rgb[0] + chalk.rgb[1] + chalk.rgb[2] > 2.2, 'chalk matched to ' + chalk.label);
      note('match by colour: ' + m.map(k => blockByKey(k).label).join(', '));
    });

    test('restricted to one group it stays in that group', () => {
      const m = matchByColour(MATERIALS, 'Wool');
      for (const k of m) eq(blockByKey(k).group, 'Wool', k);
      eq(new Set(m).size > 8, true, 'sixteen materials should not collapse onto a few wools');
    });
  });

  suite('blocks / through the exporters', () => {

    const twoCells = () => {
      const c = new CellSet();
      c.set(0, 0, 0, 0);
      c.set(1, 0, 0, 5);
      return c;
    };

    test('the default mapping still produces exactly what it did before it was editable', () => {
      eq(BLOCKS[0], 'minecraft:white_concrete');
      eq(BLOCKS[1], 'minecraft:smooth_sandstone');
      eq(BLOCKS[5], 'minecraft:terracotta');
      eq(BLOCKS[8], 'minecraft:cyan_terracotta');
      eq(BLOCKS.length, PALETTE_SIZE);
      eq(BEDROCK_BLOCKS[0].name, 'minecraft:white_concrete');
      eq(BEDROCK_LEGACY_BLOCKS[0].name, 'minecraft:concrete');
      eq(BEDROCK_LEGACY_BLOCKS[0].states.color, 'white');
      eq(BEDROCK_LEGACY_BLOCKS[2].states.color, 'silver');
    });

    test('a chosen block reaches the Java schematic palette', () => {
      const map = DEFAULT_MAP.slice();
      map[0] = 'glowstone';
      map[5] = 'blue_ice';
      const r = toSchem(twoCells(), { blocks: map });
      ok(r.palette.includes('minecraft:glowstone'), r.palette.join(' '));
      ok(r.palette.includes('minecraft:blue_ice'), r.palette.join(' '));
      ok(!r.palette.includes('minecraft:white_concrete'), 'the old block should be gone');
      eq(blockFor(0, map), 'minecraft:glowstone');
    });

    test('and the structure files, which build their palette per tile', () => {
      const map = DEFAULT_MAP.slice();
      map[0] = 'sea_lantern';
      const t = toStructures(twoCells(), { blocks: map })[0];
      ok(new TextDecoder().decode(t.nbt).includes('sea_lantern'));
    });

    test('and both Bedrock id styles', () => {
      const map = DEFAULT_MAP.slice();
      map[0] = 'oak_planks';
      const legacy = new TextDecoder().decode(toMCStructures(twoCells(), { blocks: map })[0].nbt);
      ok(legacy.includes('minecraft:planks'), 'legacy should use planks + wood_type');
      ok(legacy.includes('wood_type'));
      const flat = new TextDecoder()
        .decode(toMCStructures(twoCells(), { blocks: map, idStyle: 'flat' })[0].nbt);
      ok(flat.includes('minecraft:oak_planks'));
      ok(!flat.includes('wood_type'), 'a flattened id carries no state');
    });

    test('an unknown key in a loaded document does not reach a file', () => {
      const r = toSchem(twoCells(), { blocks: ['no_such_block'] });
      for (const id of r.palette) ok(/^minecraft:[a-z0-9_]+$/.test(id), id);
      ok(r.palette.includes('minecraft:white_concrete'), 'it falls back to the default');
    });
  });

  suite('blocks / in the document', () => {

    test('the mapping round trips, and the defaults stay out of the file', () => {
      const s = newState();
      s.seed.set(0, 0, 0, 1);
      eq(JSON.parse(encode(s, '')).s.blocks, undefined, 'a default mapping is not worth writing');
      s.blocks = s.blocks.slice();
      s.blocks[3] = 'netherite_block';
      const json = JSON.parse(encode(s, ''));
      eq(json.s.blocks.length, PALETTE_SIZE);
      const back = decode(encode(s, ''));
      eq(back.warnings.length, 0);
      eq(back.state.blocks[3], 'netherite_block');
      eq(back.state.blocks[0], DEFAULT_MAP[0]);
    });

    test('two documents do not share one array', () => {
      const a = newState(), b = newState();
      a.blocks[0] = 'obsidian';
      eq(b.blocks[0], DEFAULT_MAP[0]);
      eq(DEFAULTS.blocks[0], DEFAULT_MAP[0]);
    });

    test('the edition and id-style settings survive a save, which they did not before', () => {
      const s = newState();
      s.mcEdition = 'bedrock';
      s.beIds = 'flat';
      s.beVer = '1.21';
      const back = decode(encode(s, '')).state;
      eq(back.mcEdition, 'bedrock');
      eq(back.beIds, 'flat');
      eq(back.beVer, '1.21');
    });

    test('rubbish in the settings is clamped, not trusted', () => {
      const a = apply({ v: 1, s: { blocks: 'not an array', mcEdition: 'atari', beIds: 7 },
                        seed: [], ops: [] }).state;
      deepEq(a.blocks, DEFAULT_MAP);
      eq(a.mcEdition, 'java');
      eq(a.beIds, 'legacy');
    });
  });
}
