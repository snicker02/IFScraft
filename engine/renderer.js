// WebGL1 renderer. Two programs and nothing else: one for the merged mesh, one for every line
// the tool draws (grid, bounds, cursor, axes).
//
// The mesh arrives already chunked at 65536 vertices, so indices are 16-bit and no extension is
// required. Buffers are rebuilt only when the cell set changes, never per frame — a sponge at
// depth 3 is a static mesh and re-uploading it sixty times a second would be the single most
// expensive thing in the program.

const SOLID_VS = `
attribute vec3 aPos;
attribute vec3 aNorm;
attribute vec4 aCol;
uniform mat4 uVP;
varying vec3 vN; varying vec3 vC; varying float vAO; varying vec3 vW;
void main(){
  vN = aNorm; vC = aCol.rgb; vAO = aCol.a; vW = aPos;
  gl_Position = uVP * vec4(aPos, 1.0);
}`;

const SOLID_FS = `
precision mediump float;
varying vec3 vN; varying vec3 vC; varying float vAO; varying vec3 vW;
uniform vec3 uLight, uSky, uGround, uFog, uEye;
uniform float uFogD, uAOMix;
void main(){
  vec3 n = normalize(vN);
  float key = max(dot(n, normalize(uLight)), 0.0);
  vec3 amb = mix(uGround, uSky, 0.5 + 0.5 * n.y);
  float ao = mix(1.0, vAO, uAOMix);
  vec3 c = vC * (amb * 0.60 + key * 0.80) * (0.22 + 0.78 * ao);
  vec3 v = normalize(uEye - vW);
  c += uSky * 0.14 * pow(1.0 - max(dot(n, v), 0.0), 3.0);
  float d = length(uEye - vW);
  c = mix(c, uFog, clamp(d / uFogD, 0.0, 1.0) * 0.6);
  gl_FragColor = vec4(c, 1.0);
}`;

const LINE_VS = `
attribute vec3 aPos;
uniform mat4 uVP;
void main(){ gl_Position = uVP * vec4(aPos, 1.0); }`;

const LINE_FS = `
precision mediump float;
uniform vec4 uColor;
void main(){ gl_FragColor = uColor; }`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error('shader: ' + gl.getShaderInfoLog(sh) + '\n' + src);
  }
  return sh;
}

function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error('link: ' + gl.getProgramInfoLog(p));
  }
  return p;
}

export const BACKGROUNDS = [
  { name: 'Slate',    bg: [0.055, 0.067, 0.086], sky: [0.42, 0.50, 0.62], ground: [0.10, 0.10, 0.12], fog: [0.055, 0.067, 0.086] },
  { name: 'Overcast', bg: [0.78, 0.80, 0.83],    sky: [0.85, 0.88, 0.94], ground: [0.42, 0.42, 0.44], fog: [0.78, 0.80, 0.83] },
  { name: 'Ink',      bg: [0.02, 0.02, 0.03],    sky: [0.28, 0.32, 0.42], ground: [0.04, 0.04, 0.06], fog: [0.02, 0.02, 0.03] },
  { name: 'Studio',   bg: [0.14, 0.14, 0.15],    sky: [0.72, 0.74, 0.78], ground: [0.22, 0.21, 0.20], fog: [0.14, 0.14, 0.15] },
  { name: 'Sand',     bg: [0.90, 0.87, 0.80],    sky: [0.95, 0.93, 0.88], ground: [0.55, 0.50, 0.42], fog: [0.90, 0.87, 0.80] }
];

export function createRenderer(canvas) {
  const gl = canvas.getContext('webgl', {
    antialias: true, preserveDrawingBuffer: true, alpha: false, depth: true
  }) || canvas.getContext('experimental-webgl');
  if (!gl) throw new Error('WebGL 1 is not available in this browser.');

  const solid = program(gl, SOLID_VS, SOLID_FS);
  const line = program(gl, LINE_VS, LINE_FS);

  const S = {
    aPos: gl.getAttribLocation(solid, 'aPos'),
    aNorm: gl.getAttribLocation(solid, 'aNorm'),
    aCol: gl.getAttribLocation(solid, 'aCol'),
    uVP: gl.getUniformLocation(solid, 'uVP'),
    uLight: gl.getUniformLocation(solid, 'uLight'),
    uSky: gl.getUniformLocation(solid, 'uSky'),
    uGround: gl.getUniformLocation(solid, 'uGround'),
    uFog: gl.getUniformLocation(solid, 'uFog'),
    uEye: gl.getUniformLocation(solid, 'uEye'),
    uFogD: gl.getUniformLocation(solid, 'uFogD'),
    uAOMix: gl.getUniformLocation(solid, 'uAOMix')
  };
  const L = {
    aPos: gl.getAttribLocation(line, 'aPos'),
    uVP: gl.getUniformLocation(line, 'uVP'),
    uColor: gl.getUniformLocation(line, 'uColor')
  };

  let chunks = [];            // { vbo, ibo, count }
  const dyn = gl.createBuffer();
  let gridMinor = null, gridMajor = null, axes = null;

  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);
  gl.frontFace(gl.CCW);

  function lineBuffer(arr) {
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.STATIC_DRAW);
    return { buf: b, count: arr.length / 3 };
  }

  function buildGrid(extent, majorEvery) {
    const minor = [], major = [];
    for (let i = -extent; i <= extent; i++) {
      const t = (i % majorEvery === 0) ? major : minor;
      t.push(-extent, 0, i, extent, 0, i);
      t.push(i, 0, -extent, i, 0, extent);
    }
    if (gridMinor) { gl.deleteBuffer(gridMinor.buf); gl.deleteBuffer(gridMajor.buf); }
    gridMinor = lineBuffer(minor);
    gridMajor = lineBuffer(major);
  }
  buildGrid(48, 8);

  axes = lineBuffer([0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 6]);

  function setMesh(mesh) {
    for (const c of chunks) { gl.deleteBuffer(c.vbo); gl.deleteBuffer(c.ibo); }
    chunks = [];
    if (!mesh) return;
    for (const ch of mesh.chunks) {
      const vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, ch.data, gl.STATIC_DRAW);
      const ibo = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, ch.indices, gl.STATIC_DRAW);
      chunks.push({ vbo, ibo, count: ch.indices.length });
    }
  }

  function resize(w, h, dpr) {
    const W = Math.max(1, Math.round(w * dpr)), H = Math.max(1, Math.round(h * dpr));
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    return W / H;
  }

  function drawLines(bufObj, vp, color, mode) {
    gl.bindBuffer(gl.ARRAY_BUFFER, bufObj.buf);
    gl.enableVertexAttribArray(L.aPos);
    gl.vertexAttribPointer(L.aPos, 3, gl.FLOAT, false, 0, 0);
    gl.uniform4fv(L.uColor, color);
    gl.drawArrays(mode || gl.LINES, 0, bufObj.count);
  }

  function boxEdges(min, size, out) {
    const [x0, y0, z0] = min;
    const x1 = x0 + size[0], y1 = y0 + size[1], z1 = z0 + size[2];
    const c = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1],
               [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
    const E = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4],
               [0, 4], [1, 5], [2, 6], [3, 7]];
    for (const [a, b] of E) out.push(...c[a], ...c[b]);
    return out;
  }

  function render(vp, eye, opts) {
    const o = opts || {};
    const bgi = BACKGROUNDS[(o.bg | 0) % BACKGROUNDS.length];
    const vpf = new Float32Array(vp);

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(bgi.bg[0], bgi.bg[1], bgi.bg[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // grid first, under everything
    if (o.showGrid) {
      gl.useProgram(line);
      gl.uniformMatrix4fv(L.uVP, false, vpf);
      const dark = bgi.bg[0] + bgi.bg[1] + bgi.bg[2] < 1.2;
      const a = dark ? [0.45, 0.52, 0.65, 0.16] : [0.20, 0.24, 0.32, 0.22];
      const b = dark ? [0.55, 0.66, 0.85, 0.34] : [0.16, 0.20, 0.28, 0.40];
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      drawLines(gridMinor, vp, a);
      drawLines(gridMajor, vp, b);
      if (o.showAxes) drawLines(axes, vp, dark ? [0.60, 0.74, 1.0, 0.55] : [0.15, 0.30, 0.55, 0.6]);
      gl.disable(gl.BLEND);
    }

    // mesh
    gl.useProgram(solid);
    gl.uniformMatrix4fv(S.uVP, false, vpf);
    gl.uniform3fv(S.uLight, new Float32Array(o.light || [0.55, 0.78, 0.32]));
    gl.uniform3fv(S.uSky, new Float32Array(bgi.sky));
    gl.uniform3fv(S.uGround, new Float32Array(bgi.ground));
    gl.uniform3fv(S.uFog, new Float32Array(bgi.fog));
    gl.uniform3fv(S.uEye, new Float32Array(eye));
    gl.uniform1f(S.uFogD, o.fogDistance || 400);
    gl.uniform1f(S.uAOMix, o.ao === false ? 0 : 1);

    gl.enableVertexAttribArray(S.aPos);
    gl.enableVertexAttribArray(S.aNorm);
    gl.enableVertexAttribArray(S.aCol);
    for (const c of chunks) {
      gl.bindBuffer(gl.ARRAY_BUFFER, c.vbo);
      gl.vertexAttribPointer(S.aPos, 3, gl.FLOAT, false, 20, 0);
      gl.vertexAttribPointer(S.aNorm, 3, gl.BYTE, true, 20, 12);
      gl.vertexAttribPointer(S.aCol, 4, gl.UNSIGNED_BYTE, true, 20, 16);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, c.ibo);
      gl.drawElements(gl.TRIANGLES, c.count, gl.UNSIGNED_SHORT, 0);
    }
    gl.disableVertexAttribArray(S.aNorm);
    gl.disableVertexAttribArray(S.aCol);

    // overlays
    const wires = [];
    if (o.bounds) boxEdges(o.bounds.min, o.bounds.size, wires);
    if (wires.length) {
      gl.useProgram(line);
      gl.uniformMatrix4fv(L.uVP, false, vpf);
      gl.bindBuffer(gl.ARRAY_BUFFER, dyn);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(wires), gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(L.aPos);
      gl.vertexAttribPointer(L.aPos, 3, gl.FLOAT, false, 0, 0);
      gl.uniform4fv(L.uColor, [0.55, 0.70, 0.95, 0.5]);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.LINES, 0, wires.length / 3);
      gl.disable(gl.BLEND);
    }

    if (o.cursor) {
      const cur = [];
      boxEdges(o.cursor, [1, 1, 1], cur);
      gl.useProgram(line);
      gl.uniformMatrix4fv(L.uVP, false, vpf);
      gl.bindBuffer(gl.ARRAY_BUFFER, dyn);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(cur), gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(L.aPos);
      gl.vertexAttribPointer(L.aPos, 3, gl.FLOAT, false, 0, 0);
      gl.uniform4fv(L.uColor, o.cursorRemove ? [1.0, 0.42, 0.36, 0.95] : [0.62, 0.95, 0.72, 0.95]);
      gl.disable(gl.DEPTH_TEST);
      gl.drawArrays(gl.LINES, 0, cur.length / 3);
      gl.enable(gl.DEPTH_TEST);
    }
  }

  return {
    gl, canvas, setMesh, resize, render, buildGrid,
    get drawCalls() { return chunks.length; }
  };
}
