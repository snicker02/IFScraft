// Camera and the small matrix library it needs. Pure maths, no GL calls, so the handover between
// the two camera modes is provable rather than eyeballed.
//
// Two modes, and switching between them does not move the picture — carried over from Catoptron
// 3D, where it earned its place. Orbit swings around a target that is not necessarily the origin,
// because a substituted shape grows away from its seed and is rarely centred anywhere convenient.
// Flight goes where orbit cannot: inside a sponge, which is the whole reason to build one.
//
// The handover is exact both ways and the tests assert it. The point of having both modes is to
// compose in one and move in the other, and a jump on the switch would make that useless.

export const PITCH_LIMIT = Math.PI / 2 - 1e-3;

/* ── mat4, column-major, the order WebGL wants ─────────────────────────────────────────── */

export function mat4Identity() {
  return new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

export function mat4Mul(a, b) {
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] +
                   a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
}

export function mat4Perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  const o = new Float64Array(16);
  o[0] = f / aspect; o[5] = f;
  o[10] = (far + near) / (near - far); o[11] = -1;
  o[14] = (2 * far * near) / (near - far);
  return o;
}

export function mat4LookAt(eye, target, up) {
  let zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
  let l = Math.hypot(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l;
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
  l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  return new Float64Array([
    xx, yx, zx, 0,
    xy, yy, zy, 0,
    xz, yz, zz, 0,
    -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
    -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
    -(zx * eye[0] + zy * eye[1] + zz * eye[2]),
    1
  ]);
}

/* ── directions ───────────────────────────────────────────────────────────────────────── */

/** The outward direction from the orbit target to the camera. */
export function orbitDir(azim, elev) {
  const ce = Math.cos(elev);
  return [ce * Math.sin(azim), Math.sin(elev), ce * Math.cos(azim)];
}

/** The direction the flight camera is looking. */
export function flyForward(yaw, pitch) {
  const cp = Math.cos(pitch);
  return [cp * Math.sin(yaw), Math.sin(pitch), cp * Math.cos(yaw)];
}

export function cameraEye(s) {
  if (s.camMode) return [s.flyX, s.flyY, s.flyZ];
  const d = orbitDir(s.camAzim, s.camElev);
  return [s.tgtX + d[0] * s.camDist, s.tgtY + d[1] * s.camDist, s.tgtZ + d[2] * s.camDist];
}

export function cameraForward(s) {
  if (s.camMode) return flyForward(s.flyYaw, s.flyPitch);
  const d = orbitDir(s.camAzim, s.camElev);
  return [-d[0], -d[1], -d[2]];
}

export function viewMatrix(s) {
  const eye = cameraEye(s);
  const f = cameraForward(s);
  return mat4LookAt(eye, [eye[0] + f[0], eye[1] + f[1], eye[2] + f[2]], [0, 1, 0]);
}

export function viewProj(s, aspect, near = 0.05, far = 6000) {
  return mat4Mul(mat4Perspective(s.fov, aspect, near, far), viewMatrix(s));
}

/* ── mode handover ────────────────────────────────────────────────────────────────────── */

/** Orbit -> flight: take the orbit camera's position and heading verbatim. */
export function toFly(s) {
  const eye = cameraEye(s), f = cameraForward(s);
  s.flyX = eye[0]; s.flyY = eye[1]; s.flyZ = eye[2];
  s.flyYaw = Math.atan2(f[0], f[2]);
  s.flyPitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, Math.asin(Math.max(-1, Math.min(1, f[1])))));
  s.camMode = 1;
  return s;
}

/** Flight -> orbit: put the target ahead along the current heading, at the orbit distance, so
    nothing on screen moves. */
export function toOrbit(s) {
  const f = flyForward(s.flyYaw, s.flyPitch);
  const d = Math.max(0.2, s.camDist);
  s.tgtX = s.flyX + f[0] * d; s.tgtY = s.flyY + f[1] * d; s.tgtZ = s.flyZ + f[2] * d;
  s.camAzim = Math.atan2(-f[0], -f[2]);
  s.camElev = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, Math.asin(Math.max(-1, Math.min(1, -f[1])))));
  s.camDist = d;
  s.camMode = 0;
  return s;
}

/* ── picking ray ──────────────────────────────────────────────────────────────────────── */

/** Ray through a point in normalised device coordinates, x and y in [-1, 1], y up. */
export function screenRay(s, ndcX, ndcY, aspect) {
  const eye = cameraEye(s);
  const f = cameraForward(s);
  // Right and up of the view frame, rebuilt the same way mat4LookAt does it.
  const upW = [0, 1, 0];
  let rx = f[1] * upW[2] - f[2] * upW[1];
  let ry = f[2] * upW[0] - f[0] * upW[2];
  let rz = f[0] * upW[1] - f[1] * upW[0];
  let l = Math.hypot(rx, ry, rz) || 1; rx /= l; ry /= l; rz /= l;
  const ux = ry * f[2] - rz * f[1], uy = rz * f[0] - rx * f[2], uz = rx * f[1] - ry * f[0];

  const th = Math.tan(s.fov / 2);
  const dx = f[0] + rx * ndcX * th * aspect + ux * ndcY * th;
  const dy = f[1] + ry * ndcX * th * aspect + uy * ndcY * th;
  const dz = f[2] + rz * ndcX * th * aspect + uz * ndcY * th;
  return { origin: eye, dir: [dx, dy, dz] };
}

/** Frame a bounding box: point the orbit camera at its centre from far enough away to hold it. */
export function frameBounds(s, b, fill = 1.35) {
  if (!b) { s.tgtX = 0; s.tgtY = 0; s.tgtZ = 0; s.camDist = 16; s.camMode = 0; return s; }
  const cx = b.min[0] + b.size[0] / 2, cy = b.min[1] + b.size[1] / 2, cz = b.min[2] + b.size[2] / 2;
  const radius = 0.5 * Math.hypot(b.size[0], b.size[1], b.size[2]);
  s.tgtX = cx; s.tgtY = cy; s.tgtZ = cz;
  s.camDist = Math.max(3, (radius * fill) / Math.tan(s.fov / 2));
  s.camMode = 0;
  return s;
}
