// A small fixed palette, per the brief. Fixed because substitution maps a material index to
// another index, and index arithmetic only means anything against a stable list.
//
// Sixteen slots: the first eight are a neutral mineral run that reads as structure at any depth,
// the last eight are saturated and meant to be used sparingly — at substitution depth 3 a bright
// material covers a quarter of the visible surface whether you meant it to or not.

export const PALETTE_SIZE = 16;

export const MATERIALS = [
  { name: 'chalk',     rgb: [0.88, 0.87, 0.83] },
  { name: 'bone',      rgb: [0.76, 0.73, 0.66] },
  { name: 'ash',       rgb: [0.56, 0.57, 0.58] },
  { name: 'slate',     rgb: [0.35, 0.38, 0.43] },
  { name: 'ink',       rgb: [0.15, 0.17, 0.22] },
  { name: 'clay',      rgb: [0.62, 0.42, 0.31] },
  { name: 'rust',      rgb: [0.46, 0.25, 0.17] },
  { name: 'moss',      rgb: [0.34, 0.42, 0.28] },
  { name: 'verdigris', rgb: [0.31, 0.58, 0.52] },
  { name: 'teal',      rgb: [0.16, 0.44, 0.50] },
  { name: 'ice',       rgb: [0.54, 0.72, 0.90] },
  { name: 'cobalt',    rgb: [0.20, 0.31, 0.68] },
  { name: 'violet',    rgb: [0.44, 0.31, 0.62] },
  { name: 'magenta',   rgb: [0.72, 0.24, 0.48] },
  { name: 'ember',     rgb: [0.86, 0.38, 0.18] },
  { name: 'sulphur',   rgb: [0.90, 0.76, 0.24] }
];

export function clampMat(m) {
  const v = (m | 0) % PALETTE_SIZE;
  return v < 0 ? v + PALETTE_SIZE : v;
}

export function matColor(m) { return MATERIALS[clampMat(m)].rgb; }

export function matHex(m) {
  const c = matColor(m);
  const h = v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
  return '#' + h(c[0]) + h(c[1]) + h(c[2]);
}

/** Flat Float32Array of the whole palette, for the renderer. */
export function paletteArray() {
  const a = new Float32Array(PALETTE_SIZE * 3);
  for (let i = 0; i < PALETTE_SIZE; i++) {
    const c = MATERIALS[i].rgb;
    a[i * 3] = c[0]; a[i * 3 + 1] = c[1]; a[i * 3 + 2] = c[2];
  }
  return a;
}
