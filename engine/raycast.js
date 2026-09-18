// Picking. An Amanatides–Woo grid walk against the cell set, not a test against the mesh: the
// mesh is a merged buffer with no cell identity left in it, and rebuilding a spatial index of
// triangles to recover what the Map already knows would be absurd.
//
// Cell (x,y,z) occupies the unit box [x,x+1) x [y,y+1) x [z,z+1). The ground plane is y = 0, so
// the first buildable layer is y = 0.

import { pack } from './cells.js';

const EPS = 1e-9;

/**
 * @param cells CellSet
 * @param o     ray origin, world units
 * @param d     ray direction, need not be normalised
 * @param maxSteps how many cell boundaries to cross before giving up
 * @returns {{cell:[x,y,z], normal:[nx,ny,nz], t:number}|null}
 */
export function raycastCells(cells, o, d, maxSteps = 512) {
  const len = Math.hypot(d[0], d[1], d[2]);
  if (len < EPS) return null;
  const dir = [d[0] / len, d[1] / len, d[2] / len];

  let x = Math.floor(o[0]), y = Math.floor(o[1]), z = Math.floor(o[2]);

  if (cells.m.has(pack(x, y, z))) {
    // Starting inside a cell: report it with the face we are looking away from, so a click from
    // within a solid still removes something sensible.
    const ax = Math.abs(dir[0]), ay = Math.abs(dir[1]), az = Math.abs(dir[2]);
    const n = ax >= ay && ax >= az ? [-Math.sign(dir[0]), 0, 0]
            : ay >= az ? [0, -Math.sign(dir[1]), 0] : [0, 0, -Math.sign(dir[2])];
    return { cell: [x, y, z], normal: n, t: 0 };
  }

  const step = [dir[0] > 0 ? 1 : -1, dir[1] > 0 ? 1 : -1, dir[2] > 0 ? 1 : -1];
  const tDelta = [
    Math.abs(dir[0]) < EPS ? Infinity : 1 / Math.abs(dir[0]),
    Math.abs(dir[1]) < EPS ? Infinity : 1 / Math.abs(dir[1]),
    Math.abs(dir[2]) < EPS ? Infinity : 1 / Math.abs(dir[2])
  ];
  const nextBound = [
    step[0] > 0 ? x + 1 : x,
    step[1] > 0 ? y + 1 : y,
    step[2] > 0 ? z + 1 : z
  ];
  const tMax = [
    tDelta[0] === Infinity ? Infinity : (nextBound[0] - o[0]) / dir[0],
    tDelta[1] === Infinity ? Infinity : (nextBound[1] - o[1]) / dir[1],
    tDelta[2] === Infinity ? Infinity : (nextBound[2] - o[2]) / dir[2]
  ];

  for (let i = 0; i < maxSteps; i++) {
    let axis;
    if (tMax[0] <= tMax[1] && tMax[0] <= tMax[2]) axis = 0;
    else if (tMax[1] <= tMax[2]) axis = 1;
    else axis = 2;

    const t = tMax[axis];
    if (!isFinite(t)) return null;

    if (axis === 0) x += step[0]; else if (axis === 1) y += step[1]; else z += step[2];
    tMax[axis] += tDelta[axis];

    if (cells.m.has(pack(x, y, z))) {
      const n = [0, 0, 0];
      n[axis] = -step[axis];
      return { cell: [x, y, z], normal: n, t };
    }
  }
  return null;
}

/** Where the ray meets the ground plane, as the cell that would sit on it. Returns null when the
    ray goes up, or comes down too far away to be a useful place to put a block. */
export function raycastGround(o, d, limit = 4096) {
  if (Math.abs(d[1]) < EPS) return null;
  const t = -o[1] / d[1];
  if (t <= 0) return null;
  const x = o[0] + d[0] * t, z = o[2] + d[2] * t;
  if (Math.abs(x) > limit || Math.abs(z) > limit) return null;
  return { cell: [Math.floor(x), 0, Math.floor(z)], normal: [0, 1, 0], t, ground: true };
}

/** Everything a click needs: the cell under the cursor, and the empty cell in front of it.
    Falls through to the ground plane so an empty scene is still buildable. */
export function pick(cells, o, d) {
  const hit = raycastCells(cells, o, d);
  if (hit) {
    return {
      target: hit.cell,
      place: [hit.cell[0] + hit.normal[0], hit.cell[1] + hit.normal[1], hit.cell[2] + hit.normal[2]],
      normal: hit.normal,
      t: hit.t,
      ground: false
    };
  }
  const g = raycastGround(o, d);
  if (!g) return null;
  return { target: null, place: g.cell, normal: g.normal, t: g.t, ground: true };
}
