// The block catalogue: what each of the sixteen materials becomes in Minecraft.
//
// One table for both editions, because the alternative is two tables that drift. Each entry
// carries the Java id, the Bedrock id where it differs, and the pre-flattening Bedrock form with
// its states where that is different again — which is most of the coloured families, since
// Bedrock is still partway through splitting `concrete` into sixteen ids and keeps the old form
// as an alias.
//
// Three names worth knowing before they bite:
//   · Bedrock calls light grey SILVER in a colour state. Always has.
//   · Java `bricks` is Bedrock `brick_block`; Java `nether_bricks` is Bedrock `nether_brick`.
//   · Java `snow_block` is Bedrock `snow` — and Bedrock's `snow_layer` is the thin one.
//
// The colours are eyeballed from the block textures, not sampled, and they exist for one job:
// the match-by-colour button, which assigns each material the nearest block. Close enough for
// that and not claimed to be more.

export const COLORS = [
  ['white',      [0.93, 0.94, 0.94]],
  ['orange',     [0.89, 0.46, 0.08]],
  ['magenta',    [0.74, 0.27, 0.72]],
  ['light_blue', [0.22, 0.55, 0.79]],
  ['yellow',     [0.95, 0.77, 0.13]],
  ['lime',       [0.47, 0.75, 0.09]],
  ['pink',       [0.93, 0.53, 0.63]],
  ['gray',       [0.25, 0.27, 0.29]],
  ['light_gray', [0.60, 0.60, 0.56]],
  ['cyan',       [0.09, 0.51, 0.57]],
  ['purple',     [0.48, 0.19, 0.70]],
  ['blue',       [0.17, 0.20, 0.62]],
  ['brown',      [0.45, 0.28, 0.15]],
  ['green',      [0.34, 0.42, 0.09]],
  ['red',        [0.61, 0.16, 0.14]],
  ['black',      [0.07, 0.07, 0.09]]
];

const TITLE = {
  white: 'White', orange: 'Orange', magenta: 'Magenta', light_blue: 'Light blue', yellow: 'Yellow',
  lime: 'Lime', pink: 'Pink', gray: 'Grey', light_gray: 'Light grey', cyan: 'Cyan',
  purple: 'Purple', blue: 'Blue', brown: 'Brown', green: 'Green', red: 'Red', black: 'Black'
};

/** Bedrock's colour state never got the light_gray rename. */
const beColor = c => (c === 'light_gray' ? 'silver' : c);

const mix = (rgb, to, t) => rgb.map((v, i) => v * (1 - t) + to[i] * t);

/** Build one of the sixteen-colour families. `legacy` is the pre-flattening Bedrock id, which
    takes the colour as a state rather than as part of the name. */
function family(group, suffix, legacy, tint) {
  return COLORS.map(([c, rgb]) => ({
    key: c + '_' + suffix,
    label: TITLE[c] + ' ' + group.toLowerCase(),
    group,
    java: c + '_' + suffix,
    legacy: { name: legacy, states: { color: beColor(c) } },
    rgb: tint ? tint(rgb) : rgb
  }));
}

/** A single block. `be` overrides the id on Bedrock; `legacy` overrides it again pre-flattening. */
const one = (key, label, group, rgb, extra) =>
  Object.assign({ key, label, group, java: key, rgb }, extra || {});

export const CATALOGUE = [
  ...family('Concrete', 'concrete', 'concrete'),
  ...family('Wool', 'wool', 'wool', rgb => mix(rgb, [1, 1, 1], 0.18)),
  ...family('Terracotta', 'terracotta', 'stained_hardened_clay',
            rgb => mix(rgb, [0.63, 0.42, 0.32], 0.42)),
  ...family('Stained glass', 'stained_glass', 'stained_glass',
            rgb => mix(rgb, [1, 1, 1], 0.35)),

  one('terracotta', 'Terracotta (plain)', 'Terracotta', [0.59, 0.37, 0.27],
      { legacy: { name: 'hardened_clay' } }),
  one('glass', 'Glass', 'Stained glass', [0.85, 0.92, 0.94]),

  one('stone', 'Stone', 'Stone', [0.49, 0.49, 0.49]),
  one('cobblestone', 'Cobblestone', 'Stone', [0.49, 0.49, 0.49]),
  one('mossy_cobblestone', 'Mossy cobblestone', 'Stone', [0.41, 0.46, 0.35]),
  one('granite', 'Granite', 'Stone', [0.60, 0.42, 0.35],
      { legacy: { name: 'stone', states: { stone_type: 'granite' } } }),
  one('diorite', 'Diorite', 'Stone', [0.78, 0.78, 0.79],
      { legacy: { name: 'stone', states: { stone_type: 'diorite' } } }),
  one('andesite', 'Andesite', 'Stone', [0.53, 0.54, 0.53],
      { legacy: { name: 'stone', states: { stone_type: 'andesite' } } }),
  one('stone_bricks', 'Stone bricks', 'Stone', [0.48, 0.48, 0.48],
      { legacy: { name: 'stonebrick', states: { stone_brick_type: 'default' } } }),
  one('mossy_stone_bricks', 'Mossy stone bricks', 'Stone', [0.44, 0.48, 0.41],
      { legacy: { name: 'stonebrick', states: { stone_brick_type: 'mossy' } } }),
  one('bricks', 'Bricks', 'Stone', [0.59, 0.33, 0.27], { be: 'brick_block' }),
  one('deepslate', 'Deepslate', 'Stone', [0.31, 0.31, 0.33]),
  one('polished_deepslate', 'Polished deepslate', 'Stone', [0.28, 0.28, 0.30]),
  one('deepslate_bricks', 'Deepslate bricks', 'Stone', [0.27, 0.27, 0.29]),
  one('deepslate_tiles', 'Deepslate tiles', 'Stone', [0.21, 0.21, 0.23]),
  one('blackstone', 'Blackstone', 'Stone', [0.17, 0.15, 0.18]),
  one('polished_blackstone', 'Polished blackstone', 'Stone', [0.21, 0.20, 0.24]),
  one('basalt', 'Basalt', 'Stone', [0.29, 0.29, 0.31]),
  one('smooth_basalt', 'Smooth basalt', 'Stone', [0.25, 0.25, 0.28]),
  one('tuff', 'Tuff', 'Stone', [0.42, 0.43, 0.39]),
  one('calcite', 'Calcite', 'Stone', [0.87, 0.87, 0.85]),
  one('obsidian', 'Obsidian', 'Stone', [0.08, 0.06, 0.13]),
  one('crying_obsidian', 'Crying obsidian', 'Stone', [0.13, 0.05, 0.25]),
  one('end_stone', 'End stone', 'Stone', [0.87, 0.87, 0.64]),
  one('end_stone_bricks', 'End stone bricks', 'Stone', [0.86, 0.88, 0.66],
      { be: 'end_bricks' }),
  one('purpur_block', 'Purpur', 'Stone', [0.66, 0.47, 0.66],
      { legacy: { name: 'purpur_block', states: { chisel_type: 'default' } } }),
  one('nether_bricks', 'Nether bricks', 'Stone', [0.18, 0.09, 0.11],
      { be: 'nether_brick' }),
  one('quartz_block', 'Quartz', 'Stone', [0.93, 0.91, 0.86],
      { legacy: { name: 'quartz_block', states: { chisel_type: 'default' } } }),
  one('prismarine', 'Prismarine', 'Stone', [0.38, 0.60, 0.56],
      { legacy: { name: 'prismarine', states: { prismarine_block_type: 'default' } } }),
  one('dark_prismarine', 'Dark prismarine', 'Stone', [0.20, 0.34, 0.28],
      { legacy: { name: 'prismarine', states: { prismarine_block_type: 'dark' } } }),
  one('prismarine_bricks', 'Prismarine bricks', 'Stone', [0.39, 0.64, 0.59],
      { legacy: { name: 'prismarine', states: { prismarine_block_type: 'bricks' } } }),

  one('sandstone', 'Sandstone', 'Sand', [0.85, 0.81, 0.62],
      { legacy: { name: 'sandstone', states: { sand_stone_type: 'default' } } }),
  one('smooth_sandstone', 'Smooth sandstone', 'Sand', [0.87, 0.83, 0.64],
      { legacy: { name: 'sandstone', states: { sand_stone_type: 'smooth' } } }),
  one('red_sandstone', 'Red sandstone', 'Sand', [0.75, 0.42, 0.14],
      { legacy: { name: 'red_sandstone', states: { sand_stone_type: 'default' } } }),
  one('smooth_red_sandstone', 'Smooth red sandstone', 'Sand', [0.76, 0.44, 0.16],
      { legacy: { name: 'red_sandstone', states: { sand_stone_type: 'smooth' } } }),
  one('sand', 'Sand', 'Sand', [0.87, 0.84, 0.66],
      { legacy: { name: 'sand', states: { sand_type: 'normal' } } }),
  one('red_sand', 'Red sand', 'Sand', [0.75, 0.42, 0.16],
      { legacy: { name: 'sand', states: { sand_type: 'red' } } }),
  one('gravel', 'Gravel', 'Sand', [0.52, 0.50, 0.49]),
  one('dirt', 'Dirt', 'Sand', [0.53, 0.37, 0.25]),
  one('coarse_dirt', 'Coarse dirt', 'Sand', [0.47, 0.33, 0.22],
      { legacy: { name: 'dirt', states: { dirt_type: 'coarse' } } }),
  one('grass_block', 'Grass block', 'Sand', [0.44, 0.60, 0.29],
      { legacy: { name: 'grass' } }),
  one('moss_block', 'Moss', 'Sand', [0.34, 0.47, 0.19]),
  one('bone_block', 'Bone block', 'Sand', [0.89, 0.88, 0.81]),

  one('oak_planks', 'Oak planks', 'Wood', [0.66, 0.54, 0.34],
      { legacy: { name: 'planks', states: { wood_type: 'oak' } } }),
  one('spruce_planks', 'Spruce planks', 'Wood', [0.45, 0.33, 0.19],
      { legacy: { name: 'planks', states: { wood_type: 'spruce' } } }),
  one('birch_planks', 'Birch planks', 'Wood', [0.79, 0.72, 0.51],
      { legacy: { name: 'planks', states: { wood_type: 'birch' } } }),
  one('jungle_planks', 'Jungle planks', 'Wood', [0.71, 0.51, 0.36],
      { legacy: { name: 'planks', states: { wood_type: 'jungle' } } }),
  one('acacia_planks', 'Acacia planks', 'Wood', [0.69, 0.40, 0.22],
      { legacy: { name: 'planks', states: { wood_type: 'acacia' } } }),
  one('dark_oak_planks', 'Dark oak planks', 'Wood', [0.26, 0.17, 0.09],
      { legacy: { name: 'planks', states: { wood_type: 'dark_oak' } } }),
  one('crimson_planks', 'Crimson planks', 'Wood', [0.40, 0.21, 0.30]),
  one('warped_planks', 'Warped planks', 'Wood', [0.17, 0.42, 0.40]),

  one('iron_block', 'Iron', 'Metal', [0.86, 0.86, 0.86]),
  one('gold_block', 'Gold', 'Metal', [0.97, 0.85, 0.35]),
  one('diamond_block', 'Diamond', 'Metal', [0.43, 0.88, 0.85]),
  one('emerald_block', 'Emerald', 'Metal', [0.31, 0.84, 0.44]),
  one('lapis_block', 'Lapis', 'Metal', [0.13, 0.31, 0.62]),
  one('redstone_block', 'Redstone', 'Metal', [0.68, 0.11, 0.06]),
  one('coal_block', 'Coal', 'Metal', [0.06, 0.06, 0.06]),
  one('netherite_block', 'Netherite', 'Metal', [0.26, 0.23, 0.24]),
  one('copper_block', 'Copper', 'Metal', [0.76, 0.45, 0.32]),
  one('oxidized_copper', 'Oxidised copper', 'Metal', [0.32, 0.65, 0.53]),
  one('amethyst_block', 'Amethyst', 'Metal', [0.60, 0.44, 0.80]),

  one('glowstone', 'Glowstone', 'Light', [0.78, 0.63, 0.38]),
  one('sea_lantern', 'Sea lantern', 'Light', [0.68, 0.76, 0.72]),
  one('shroomlight', 'Shroomlight', 'Light', [0.91, 0.55, 0.26]),
  one('redstone_lamp', 'Redstone lamp', 'Light', [0.48, 0.30, 0.17]),
  one('magma_block', 'Magma', 'Light', [0.55, 0.26, 0.13], { be: 'magma' }),
  one('ochre_froglight', 'Ochre froglight', 'Light', [0.90, 0.85, 0.60]),
  one('verdant_froglight', 'Verdant froglight', 'Light', [0.79, 0.88, 0.76]),
  one('pearlescent_froglight', 'Pearlescent froglight', 'Light', [0.91, 0.82, 0.88]),

  one('snow_block', 'Snow', 'Ice', [0.96, 0.98, 0.99], { be: 'snow' }),
  one('ice', 'Ice', 'Ice', [0.57, 0.73, 0.95]),
  one('packed_ice', 'Packed ice', 'Ice', [0.53, 0.70, 0.94]),
  one('blue_ice', 'Blue ice', 'Ice', [0.45, 0.67, 0.96])
];

const BY_KEY = new Map(CATALOGUE.map(b => [b.key, b]));

export function blockByKey(key) { return BY_KEY.get(key) || null; }

export function groups() {
  const out = [];
  for (const b of CATALOGUE) {
    let g = out.find(x => x.name === b.group);
    if (!g) { g = { name: b.group, blocks: [] }; out.push(g); }
    g.blocks.push(b);
  }
  return out;
}

/** The mapping the app starts with: the muted end in stone and terracotta, the saturated end in
    concrete, because concrete is flat and matt and reads at distance where wool goes to mush. */
export const DEFAULT_MAP = [
  'white_concrete', 'smooth_sandstone', 'light_gray_concrete', 'gray_concrete',
  'black_concrete', 'terracotta', 'brown_concrete', 'green_concrete',
  'cyan_terracotta', 'cyan_concrete', 'light_blue_concrete', 'blue_concrete',
  'purple_concrete', 'magenta_concrete', 'orange_concrete', 'yellow_concrete'
];

/** A named starting point is worth more than sixteen dropdowns when you just want a look. */
export const MAP_PRESETS = [
  { name: 'Default', keys: DEFAULT_MAP.slice() },
  { name: 'All concrete', keys: COLORS.map(([c]) => c + '_concrete') },
  { name: 'All wool', keys: COLORS.map(([c]) => c + '_wool') },
  { name: 'All terracotta', keys: COLORS.map(([c]) => c + '_terracotta') },
  { name: 'Stained glass', keys: COLORS.map(([c]) => c + '_stained_glass') },
  { name: 'Stone greys', keys: [
      'calcite', 'diorite', 'andesite', 'stone', 'cobblestone', 'stone_bricks', 'tuff', 'gravel',
      'deepslate', 'polished_deepslate', 'deepslate_bricks', 'deepslate_tiles',
      'smooth_basalt', 'blackstone', 'polished_blackstone', 'obsidian'] },
  { name: 'Nether', keys: [
      'quartz_block', 'smooth_sandstone', 'warped_planks', 'crimson_planks',
      'blackstone', 'polished_blackstone', 'nether_bricks', 'basalt',
      'smooth_basalt', 'obsidian', 'crying_obsidian', 'magma_block',
      'shroomlight', 'glowstone', 'netherite_block', 'gold_block'] },
  { name: 'Treasure', keys: [
      'quartz_block', 'bone_block', 'iron_block', 'netherite_block',
      'coal_block', 'copper_block', 'oxidized_copper', 'emerald_block',
      'diamond_block', 'prismarine', 'sea_lantern', 'lapis_block',
      'amethyst_block', 'purpur_block', 'redstone_block', 'gold_block'] },
  { name: 'Ice and snow', keys: [
      'snow_block', 'calcite', 'diorite', 'light_gray_concrete', 'blue_ice',
      'packed_ice', 'ice', 'glass', 'light_blue_stained_glass', 'cyan_concrete',
      'light_blue_concrete', 'blue_concrete', 'lapis_block', 'sea_lantern',
      'white_stained_glass', 'white_concrete'] },
  { name: 'Glow', keys: [
      'glowstone', 'ochre_froglight', 'pearlescent_froglight', 'verdant_froglight',
      'sea_lantern', 'shroomlight', 'magma_block', 'redstone_lamp',
      'blackstone', 'obsidian', 'crying_obsidian', 'deepslate_tiles',
      'amethyst_block', 'purple_stained_glass', 'orange_stained_glass', 'yellow_stained_glass'] }
];

/** Nearest catalogue block to each material colour, by plain RGB distance. Not a colour science
    claim — it is a starting point you then edit, which is why the result is a normal mapping and
    not a mode. `only` restricts the search to one group, so "nearest wool" is a thing you can
    ask for. */
export function matchByColour(materials, only) {
  const pool = only ? CATALOGUE.filter(b => b.group === only) : CATALOGUE;
  return materials.map(m => {
    let best = pool[0], bd = Infinity;
    for (const b of pool) {
      const d = (b.rgb[0] - m.rgb[0]) ** 2 + (b.rgb[1] - m.rgb[1]) ** 2 + (b.rgb[2] - m.rgb[2]) ** 2;
      if (d < bd) { bd = d; best = b; }
    }
    return best.key;
  });
}

/** Resolve one material to an id and states, for whichever edition is being written.
    style: 'java' | 'bedrock' | 'bedrock-legacy'. */
export function resolve(key, style) {
  const b = BY_KEY.get(key) || BY_KEY.get(DEFAULT_MAP[0]);
  if (style === 'java') return { name: 'minecraft:' + b.java, states: {} };
  if (style === 'bedrock-legacy' && b.legacy) {
    return { name: 'minecraft:' + b.legacy.name, states: b.legacy.states || {} };
  }
  return { name: 'minecraft:' + (b.be || b.java), states: {} };
}

/** Anything unrecognised falls back to the default for that slot rather than to a hole. */
export function sanitizeMap(map) {
  const out = DEFAULT_MAP.slice();
  if (!Array.isArray(map)) return out;
  for (let i = 0; i < out.length; i++) {
    if (typeof map[i] === 'string' && BY_KEY.has(map[i])) out[i] = map[i];
  }
  return out;
}

export function isDefaultMap(map) {
  return Array.isArray(map) && map.length === DEFAULT_MAP.length &&
         map.every((k, i) => k === DEFAULT_MAP[i]);
}
