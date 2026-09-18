// IFScraft — state, panels, input, render loop.
//
// CONSTRAINTS HONOURED HERE, so later work stays cheap:
//  1. The document is one JSON-serialisable object: numbers, plus the seed and the op stack.
//  2. The result is derived and never stored. Every change re-runs the stack from the seed.
//  3. renderFrame() is the single draw entry point — every export path calls it.
//  4. BUILD is logged at init, so "am I looking at the new code?" is one glance at the console.

import { CellSet } from './engine/cells.js';
import { evaluate, defaultOp, DEFAULT_CAP, MAX_CAP, MAX_ITERS } from './engine/ops.js';
import { buildMesh } from './engine/mesh.js';
import { createRenderer, BACKGROUNDS } from './engine/renderer.js';
import { pick } from './engine/raycast.js';
import { newState, capture, apply, encode, decode, History } from './engine/state.js';
import { viewProj, cameraEye, cameraForward, screenRay, toFly, toOrbit, frameBounds,
         flyForward, PITCH_LIMIT } from './engine/camera.js';
import { MATERIALS, PALETTE_SIZE } from './engine/palette.js';
import { PRESETS, STARTERS } from './engine/presets.js';
import { toOBJ, toCSV, download, downloadBytes, downloadCanvas } from './engine/exporters.js';
import { toSchem, toStructures, structureReadme, DATA_VERSIONS,
         STRUCTURE_MAX } from './engine/minecraft.js';
import { gzip } from './engine/nbt.js';
import { el, buildSwatches, buildStack, HELP_HTML } from './engine/ui.js';

export const BUILD = '0.3.1';
console.log('%c[ifscraft] build ' + BUILD, 'color:#8ab8ff');

const $ = id => document.getElementById(id);
const canvas = $('c');

let state = newState();
const history = new History(80);
let renderer;

let result = new CellSet();
let steps = [];
let capHit = false;
let gens = [0];
let settled = 0;
let ranIters = 1;
let mesh = { chunks: [], faces: 0 };
let bounds = null;
let docName = '';
let dirty = true;

/* ── derive ───────────────────────────────────────────────────────────────────────────── */

function shownCells() { return state.view ? result : state.seed; }

function rebuild() {
  const ev = evaluate(state.seed, state.ops, state.cap, state.iters);
  result = ev.cells; steps = ev.steps; capHit = ev.capHit;
  gens = ev.gens; settled = ev.settled; ranIters = ev.ran;
  remesh();
  refreshPanels();
}

function remesh() {
  const cells = shownCells();
  mesh = buildMesh(cells);
  renderer.setMesh(mesh);
  bounds = cells.bounds();
  refreshStats();
  dirty = true;
}

/* ── status line ──────────────────────────────────────────────────────────────────────── */

let statusTimer = 0;
function status(msg, ms = 2600) {
  const n = $('status');
  n.textContent = msg;
  n.classList.add('show');
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => n.classList.remove('show'), ms);
}

/* ── editing ──────────────────────────────────────────────────────────────────────────── */

function editable() {
  if (!state.view) return true;
  status('Editing happens in the seed — switch the view, or bake the result into it.');
  return false;
}

function placeAt(cell) {
  if (!editable()) return;
  if (state.seed.get(cell[0], cell[1], cell[2]) === state.material) return;
  history.push(state);
  if (!state.seed.set(cell[0], cell[1], cell[2], state.material)) {
    status('That is off the edge of the lattice.');
    return;
  }
  rebuild();
}

function removeAt(cell) {
  if (!cell || !editable()) return;
  if (!state.seed.has(cell[0], cell[1], cell[2])) return;
  history.push(state);
  state.seed.delete(cell[0], cell[1], cell[2]);
  rebuild();
}

/* ── document ─────────────────────────────────────────────────────────────────────────── */

function adoptState(next, name) {
  state = next;
  docName = name || '';
  $('nameInput').value = docName;
  applyTheme();
  rebuild();
  refreshAll();
}

function loadPreset(p) {
  history.push(state);
  const r = apply(p);
  const keep = { theme: state.theme, bg: state.bg, showGrid: state.showGrid,
                 showAxes: state.showAxes, showBounds: state.showBounds, ao: state.ao };
  Object.assign(r.state, keep);
  adoptState(r.state, p.name || '');
  frameShape();
  if (r.warnings.length) status(r.warnings[0], 5000);
}

function frameShape() {
  const b = shownCells().bounds();
  frameBounds(state, b);
  $('camBtn').textContent = 'Orbit';
  dirty = true;
}

/* ── panels ───────────────────────────────────────────────────────────────────────────── */

function refreshAll() {
  buildSwatches($('swatches'), state.material, m => { state.material = m; refreshAll(); });
  $('matName').textContent = 'material ' + (state.material + 1) + ' — ' + MATERIALS[state.material].name;
  for (const b of $('viewSeg').children) b.classList.toggle('on', (+b.dataset.view) === state.view);
  $('viewNote').textContent = state.view
    ? 'Showing the result of the stack. Blocks here are copies; the seed is what you edit.'
    : 'Showing the seed. Click to place, shift-click to remove.';
  $('capInput').value = state.cap;
  $('itersInput').value = state.iters;
  $('gridChk').checked = !!state.showGrid;
  $('axesChk').checked = !!state.showAxes;
  $('boundsChk').checked = !!state.showBounds;
  $('aoChk').checked = !!state.ao;
  $('bgSel').value = String(state.bg);
  $('fovRange').value = state.fov;
  $('fovVal').textContent = Math.round(state.fov * 57.3) + '\u00b0';
  $('themeSel').value = String(state.theme);
  $('mcVerSel').value = String(state.mcVer);
  $('undoBtn').disabled = !history.canUndo;
  $('redoBtn').disabled = !history.canRedo;
  refreshPanels();
}

function refreshPanels() {
  buildStack($('stack'), state.ops, steps.map(s => s.incoming), state.cap, stackCallbacks);
  $('itersInfo').innerHTML = itersReadout();
  $('seedInfo').textContent = state.seed.size
    ? state.seed.size.toLocaleString() + ' cells in the seed, ' +
      (state.seed.bounds().size.join(' \u00d7 '))
    : 'The seed is empty. Click the ground to start, or set a starter shape below.';

  const pct = Math.min(1, result.size / state.cap);
  const bar = $('budgetBar');
  bar.classList.toggle('hot', pct > 0.85 || capHit);
  bar.firstElementChild.style.width = (pct * 100).toFixed(1) + '%';
  const stopped = steps.filter(s => s.stopped);
  $('budgetInfo').innerHTML = result.size.toLocaleString() + ' of ' + state.cap.toLocaleString() +
    ' cells' + (stopped.length ? '<br>stopped: ' + stopped[0].stopped : '');
  $('undoBtn').disabled = !history.canUndo;
  $('redoBtn').disabled = !history.canRedo;
  refreshStats();
}

/** What the iteration count actually did. Worth spelling out, because "8 runs" and "8 runs, of
    which 3 changed anything" are different facts and only one of them is on the input. */
function itersReadout() {
  if (!state.ops.length) return 'Nothing in the stack yet.';
  if (state.iters === 1 && !settled) {
    return 'The stack runs once. Raise this and each run starts from the last run\u2019s result.';
  }
  const shown = gens.length > 6 ? gens.slice(0, 3).concat(['\u2026'], gens.slice(-2)) : gens;
  const chain = shown.map(v => typeof v === 'number' ? v.toLocaleString() : v).join(' \u2192 ');
  let tail = '';
  if (settled) tail = '<br>settled after ' + settled + (settled === 1 ? ' run' : ' runs') +
                      ' \u2014 the stack maps this shape to itself';
  else if (capHit) tail = '<br>stopped during run ' + ranIters;
  return chain + tail;
}

function refreshStats() {
  const cells = shownCells();
  const b = cells.bounds();
  const dense = b ? (cells.size / (b.size[0] * b.size[1] * b.size[2]) * 100).toFixed(1) : '0';
  $('statsInfo').innerHTML =
    cells.size.toLocaleString() + ' cells<br>' +
    mesh.faces.toLocaleString() + ' faces, ' + mesh.chunks.length + ' draw calls<br>' +
    (b ? b.size.join(' \u00d7 ') + ' box, ' + dense + '% dense' : 'nothing to show');
  $('hud').innerHTML =
    '<b>' + cells.size.toLocaleString() + '</b> cells &middot; <b>' +
    mesh.faces.toLocaleString() + '</b> faces &middot; ' + (state.view ? 'result' : 'seed') +
    (state.camMode ? ' &middot; flight' : '');
}

const stackCallbacks = {
  change(i, k, v) { history.push(state); state.ops[i][k] = v; rebuild(); },
  toggle(i) { history.push(state); state.ops[i].on = state.ops[i].on === false; rebuild(); },
  move(i, d) {
    const j = i + d;
    if (j < 0 || j >= state.ops.length) return;
    history.push(state);
    const a = state.ops;
    const tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    rebuild();
  },
  duplicate(i) {
    history.push(state);
    state.ops.splice(i + 1, 0, Object.assign({}, state.ops[i]));
    rebuild();
  },
  remove(i) { history.push(state); state.ops.splice(i, 1); rebuild(); },
  centrePivot(i) {
    const inc = steps[i] && steps[i].incoming;
    const b = inc && inc.bounds();
    if (!b) { status('Nothing reaches that operation yet.'); return; }
    history.push(state);
    state.ops[i].px = b.min[0] + ((b.size[0] - 1) >> 1);
    state.ops[i].py = b.min[1] + ((b.size[1] - 1) >> 1);
    state.ops[i].pz = b.min[2] + ((b.size[2] - 1) >> 1);
    rebuild();
  }
};

/* ── theme ────────────────────────────────────────────────────────────────────────────── */

function applyTheme() {
  document.body.className = ['', 'theme-grey', 'theme-light'][state.theme | 0] || '';
}

/* ── wiring ───────────────────────────────────────────────────────────────────────────── */

function wire() {
  $('helpDoc').innerHTML = HELP_HTML;

  BACKGROUNDS.forEach((b, i) => $('bgSel').appendChild(el('option', { value: i, text: b.name })));

  const groups = {};
  for (const p of PRESETS) (groups[p.group] = groups[p.group] || []).push(p);
  for (const g of Object.keys(groups)) {
    const og = el('optgroup', { label: g });
    for (const p of groups[g]) og.appendChild(el('option', { value: p.name, text: p.name }));
    $('presetSel').appendChild(og);
  }

  $('presetBtn').onclick = () => {
    const p = PRESETS.find(x => x.name === $('presetSel').value);
    if (p) loadPreset(p);
  };

  for (const b of $('viewSeg').children) {
    b.onclick = () => { state.view = +b.dataset.view; remesh(); refreshAll(); };
  }

  $('starterBtn').onclick = () => {
    history.push(state);
    state.seed = CellSet.fromArray(STARTERS[$('starterSel').value] || []);
    rebuild();
  };
  $('clearSeedBtn').onclick = () => { history.push(state); state.seed = new CellSet(); rebuild(); };
  $('seedFromResultBtn').onclick = () => {
    if (!result.size) return;
    history.push(state);
    state.seed = result.clone();
    state.ops = [];
    state.view = 0;
    rebuild(); refreshAll();
    status('Baked ' + state.seed.size.toLocaleString() + ' cells into the seed.');
  };

  $('itersInput').onchange = e => {
    history.push(state);
    state.iters = Math.max(1, Math.min(MAX_ITERS, Math.round(+e.target.value) || 1));
    e.target.value = state.iters;
    rebuild();
  };

  $('capInput').onchange = e => {
    state.cap = Math.max(1000, Math.min(MAX_CAP, Math.round(+e.target.value) || DEFAULT_CAP));
    e.target.value = state.cap;
    rebuild();
  };

  $('addRepBtn').onclick = () => { history.push(state); state.ops.push(defaultOp('replicate')); rebuild(); };
  $('addSubBtn').onclick = () => { history.push(state); state.ops.push(defaultOp('substitute')); rebuild(); };

  $('gridChk').onchange = e => { state.showGrid = e.target.checked ? 1 : 0; dirty = true; };
  $('axesChk').onchange = e => { state.showAxes = e.target.checked ? 1 : 0; dirty = true; };
  $('boundsChk').onchange = e => { state.showBounds = e.target.checked ? 1 : 0; dirty = true; };
  $('aoChk').onchange = e => { state.ao = e.target.checked ? 1 : 0; dirty = true; };
  $('bgSel').onchange = e => { state.bg = +e.target.value; dirty = true; };
  $('fovRange').oninput = e => {
    state.fov = +e.target.value;
    $('fovVal').textContent = Math.round(state.fov * 57.3) + '\u00b0';
    dirty = true;
  };
  $('themeSel').onchange = e => { state.theme = +e.target.value; applyTheme(); };

  $('newBtn').onclick = () => {
    history.push(state);
    const next = newState({ theme: state.theme, bg: state.bg, showGrid: state.showGrid,
                            showAxes: state.showAxes, ao: state.ao, material: state.material });
    next.seed.set(0, 0, 0, state.material);
    next.view = 0;
    adoptState(next, '');
    frameShape();
  };
  $('frameBtn').onclick = frameShape;
  $('camBtn').onclick = toggleCamera;
  $('undoBtn').onclick = () => doUndo();
  $('redoBtn').onclick = () => doRedo();

  $('panelsBtn').onclick = togglePanels;
  $('toggle').onclick = () => setPanel('panel', $('panel').classList.contains('hidden'));
  $('toggleR').onclick = () => setPanel('panelR', $('panelR').classList.contains('hidden'));

  $('helpBtn').onclick = () => setHelp(!$('help').classList.contains('show'));
  $('helpClose').onclick = () => setHelp(false);

  $('saveBtn').onclick = () => {
    const name = $('nameInput').value.trim() || 'ifscraft';
    download(slug(name) + '.json', encode(state, name), 'application/json');
    $('exportNote').textContent = 'Saved the document — seed, stack, camera.';
  };
  $('loadBtn').onclick = () => $('fileInput').click();
  $('fileInput').onchange = e => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      const res = decode(String(r.result));
      history.push(state);
      adoptState(res.state, res.name || f.name.replace(/\.json$/i, ''));
      frameShape();
      status(res.warnings.length ? res.warnings.join(' · ') : 'Opened ' + f.name, 5000);
    };
    r.readAsText(f);
    e.target.value = '';
  };

  $('objBtn').onclick = () => {
    const cells = shownCells();
    if (!cells.size) { status('Nothing to export.'); return; }
    const name = slug($('nameInput').value.trim() || 'ifscraft');
    const { obj, mtl, vertices } = toOBJ(cells, { name });
    download(name + '.obj', obj, 'model/obj');
    download(name + '.mtl', mtl, 'text/plain');
    $('exportNote').textContent = vertices.toLocaleString() + ' vertices, ' +
      mesh.faces.toLocaleString() + ' quads, plus the material library.';
  };
  $('csvBtn').onclick = () => {
    const cells = shownCells();
    if (!cells.size) { status('Nothing to export.'); return; }
    download(slug($('nameInput').value.trim() || 'ifscraft') + '.csv', toCSV(cells), 'text/csv');
    $('exportNote').textContent = cells.size.toLocaleString() + ' cells, one per line.';
  };
  $('pngBtn').onclick = () => {
    renderFrame();
    downloadCanvas(canvas, slug($('nameInput').value.trim() || 'ifscraft') + '.png');
  };
  for (const d of DATA_VERSIONS) {
    $('mcVerSel').appendChild(el('option', { value: d.v, text: 'Minecraft ' + d.name }));
  }
  $('mcVerSel').onchange = e => { state.mcVer = +e.target.value; };

  $('schemBtn').onclick = async () => {
    const cells = shownCells();
    if (!cells.size) { status('Nothing to export.'); return; }
    const name = slug($('nameInput').value.trim() || 'ifscraft');
    let r;
    try { r = toSchem(cells, { name, dataVersion: state.mcVer }); }
    catch (err) { $('mcNote').textContent = err.message; status(err.message, 6000); return; }
    $('mcNote').textContent = 'compressing\u2026';
    const bytes = await gzip(r.nbt);
    downloadBytes(name + '.schem', bytes);
    $('mcNote').innerHTML =
      r.width + ' \u00d7 ' + r.height + ' \u00d7 ' + r.length + ', ' +
      (r.palette.length - 1) + ' block types, ' + fileSize(bytes.length) +
      '<br>//schem load ' + name + ' then //paste';
  };

  $('nbtBtn').onclick = async () => {
    const cells = shownCells();
    if (!cells.size) { status('Nothing to export.'); return; }
    const name = slug($('nameInput').value.trim() || 'ifscraft');
    let tiles;
    try { tiles = toStructures(cells, { name, dataVersion: state.mcVer }); }
    catch (err) { $('mcNote').textContent = err.message; return; }

    $('mcNote').textContent = 'writing ' + tiles.length + ' file' +
                              (tiles.length === 1 ? '' : 's') + '\u2026';
    // Staggered: a browser that sees a dozen downloads fired in one tick blocks most of them.
    let total = 0;
    for (let i = 0; i < tiles.length; i++) {
      const bytes = await gzip(tiles[i].nbt);
      total += bytes.length;
      downloadBytes(tiles[i].name + '.nbt', bytes);
      await new Promise(r => setTimeout(r, 180));
    }
    download(name + '-placement.txt', structureReadme(tiles, name, STRUCTURE_MAX), 'text/plain');
    $('mcNote').innerHTML = tiles.length + ' structure file' + (tiles.length === 1 ? '' : 's') +
      ', ' + fileSize(total) + ', plus a placement note' +
      (tiles.length > 1 ? '<br>tiles are ' + STRUCTURE_MAX + ' blocks on a side' : '');
  };

  $('nameInput').onchange = e => { docName = e.target.value; };
}

const fileSize = n => n < 1024 ? n + ' B'
  : n < 1048576 ? (n / 1024).toFixed(1) + ' KB'
  : (n / 1048576).toFixed(1) + ' MB';

const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'ifscraft';

function setHelp(on) {
  $('help').classList.toggle('show', on);
  $('helpClose').style.display = on ? '' : 'none';
  $('helpBtn').classList.toggle('on', on);
}

function setPanel(id, show) {
  $(id).classList.toggle('hidden', !show);
  $(id === 'panel' ? 'toggle' : 'toggleR').classList.toggle('tucked', !show);
  $(id === 'panel' ? 'toggle' : 'toggleR').innerHTML =
    (id === 'panel') === show ? '&#9664;' : '&#9654;';
  if (id === 'panel') $('hud').classList.toggle('tucked', !show);
  resize();
}

function togglePanels() {
  const hidden = $('panel').classList.contains('hidden');
  setPanel('panel', hidden); setPanel('panelR', hidden);
}

function doUndo() {
  const s = history.undo(state);
  if (!s) return;
  const view = state.view;
  adoptState(s, docName);
  state.view = view;
  refreshAll(); remesh();
}
function doRedo() {
  const s = history.redo(state);
  if (!s) return;
  const view = state.view;
  adoptState(s, docName);
  state.view = view;
  refreshAll(); remesh();
}

function toggleCamera() {
  if (state.camMode) toOrbit(state); else toFly(state);
  $('camBtn').textContent = state.camMode ? 'Flight' : 'Orbit';
  refreshStats();
  dirty = true;
}

/* ── input ────────────────────────────────────────────────────────────────────────────── */

let cursor = null, cursorRemove = false;
const keys = new Set();
let drag = null;

function canvasRay(ev) {
  const r = canvas.getBoundingClientRect();
  const nx = ((ev.clientX - r.left) / r.width) * 2 - 1;
  const ny = 1 - ((ev.clientY - r.top) / r.height) * 2;
  return screenRay(state, nx, ny, r.width / r.height);
}

function updateCursor(ev) {
  const { origin, dir } = canvasRay(ev);
  const p = pick(shownCells(), origin, dir);
  const removing = ev.shiftKey;
  const next = p ? (removing ? p.target : p.place) : null;
  const changed = (!!next !== !!cursor) ||
    (next && cursor && (next[0] !== cursor[0] || next[1] !== cursor[1] || next[2] !== cursor[2])) ||
    removing !== cursorRemove;
  cursor = next; cursorRemove = removing;
  if (changed) dirty = true;
  return p;
}

function bindInput() {
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  canvas.addEventListener('pointerdown', ev => {
    canvas.setPointerCapture(ev.pointerId);
    drag = { x: ev.clientX, y: ev.clientY, x0: ev.clientX, y0: ev.clientY,
             t: performance.now(), button: ev.button, moved: 0 };
    if (ev.button !== 2) document.body.classList.add('orbiting');
  });

  canvas.addEventListener('pointermove', ev => {
    if (!drag) { updateCursor(ev); return; }
    const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
    drag.x = ev.clientX; drag.y = ev.clientY;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    if (drag.moved < 3) return;

    if (drag.button === 2 && !state.camMode) {
      // Pan the orbit target across the view plane.
      const f = cameraForward(state);
      // right = forward x worldUp, which for up = (0,1,0) is (-fz, 0, fx).
      let rx = -f[2], ry = 0, rz = f[0];
      const l = Math.hypot(rx, rz) || 1; rx /= l; rz /= l;
      const ux = ry * f[2] - rz * f[1], uy = rz * f[0] - rx * f[2], uz = rx * f[1] - ry * f[0];
      const k = state.camDist * 0.0018;
      state.tgtX += (-rx * dx + ux * dy) * k;
      state.tgtY += (-ry * dx + uy * dy) * k;
      state.tgtZ += (-rz * dx + uz * dy) * k;
    } else if (state.camMode) {
      state.flyYaw -= dx * 0.0035;
      state.flyPitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, state.flyPitch - dy * 0.0035));
    } else {
      state.camAzim -= dx * 0.006;
      state.camElev = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, state.camElev + dy * 0.006));
    }
    dirty = true;
  });

  canvas.addEventListener('pointerup', ev => {
    document.body.classList.remove('orbiting');
    const d = drag; drag = null;
    if (!d || d.button === 2) return;
    const moved = Math.abs(ev.clientX - d.x0) + Math.abs(ev.clientY - d.y0);
    if (moved > 4 || performance.now() - d.t > 600) return;

    const p = updateCursor(ev);
    if (!p) return;
    if (ev.shiftKey) removeAt(p.target); else placeAt(p.place);
  });

  canvas.addEventListener('wheel', ev => {
    ev.preventDefault();
    if (state.camMode) {
      state.flySpeed = Math.max(0.3, Math.min(400, state.flySpeed * Math.exp(-ev.deltaY * 0.0012)));
      status('flight speed ' + state.flySpeed.toFixed(1), 900);
    } else {
      state.camDist = Math.max(1.2, Math.min(6000, state.camDist * Math.exp(ev.deltaY * 0.0012)));
    }
    dirty = true;
  }, { passive: false });

  window.addEventListener('keydown', ev => {
    const tag = (ev.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;

    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') {
      ev.preventDefault();
      if (ev.shiftKey) doRedo(); else doUndo();
      return;
    }
    const k = ev.key.toLowerCase();
    if (k >= '1' && k <= '8') {
      state.material = (+k - 1) + (ev.shiftKey ? 8 : 0);
      refreshAll();
      return;
    }
    switch (k) {
      case 'tab':
        ev.preventDefault();
        state.view = state.view ? 0 : 1; remesh(); refreshAll(); break;
      case '[': bumpIters(-1); break;
      case ']': bumpIters(1); break;
      case 'f': frameShape(); break;
      case 'g': state.showGrid = state.showGrid ? 0 : 1; refreshAll(); dirty = true; break;
      case 'c': toggleCamera(); break;
      case 'h': togglePanels(); break;
      case '?': setHelp(!$('help').classList.contains('show')); break;
      case 'escape': setHelp(false); break;
      default: break;
    }
    if ('wasdqe'.includes(k)) keys.add(k);
  });

  window.addEventListener('keyup', ev => keys.delete(ev.key.toLowerCase()));
  window.addEventListener('blur', () => keys.clear());
  window.addEventListener('resize', resize);
}

function bumpIters(d) {
  const next = Math.max(1, Math.min(MAX_ITERS, state.iters + d));
  if (next === state.iters) return;
  history.push(state);
  state.iters = next;
  rebuild(); refreshAll();
  status('stack runs: ' + state.iters);
}

function flyStep(dt) {
  if (!state.camMode || keys.size === 0) return;
  const f = flyForward(state.flyYaw, state.flyPitch);
  let rx = -f[2], ry = 0, rz = f[0];
  const l = Math.hypot(rx, ry, rz) || 1; rx /= l; rz /= l;
  const v = state.flySpeed * dt;
  let mx = 0, my = 0, mz = 0;
  if (keys.has('w')) { mx += f[0]; my += f[1]; mz += f[2]; }
  if (keys.has('s')) { mx -= f[0]; my -= f[1]; mz -= f[2]; }
  if (keys.has('d')) { mx += rx; mz += rz; }
  if (keys.has('a')) { mx -= rx; mz -= rz; }
  if (keys.has('e')) my += 1;
  if (keys.has('q')) my -= 1;
  const m = Math.hypot(mx, my, mz);
  if (m < 1e-9) return;
  state.flyX += (mx / m) * v; state.flyY += (my / m) * v; state.flyZ += (mz / m) * v;
  dirty = true;
}

/* ── frame ────────────────────────────────────────────────────────────────────────────── */

function resize() {
  const leftHidden = $('panel').classList.contains('hidden');
  const rightHidden = $('panelR').classList.contains('hidden');
  const L = leftHidden ? 0 : $('panel').offsetWidth;
  const R = rightHidden ? 0 : $('panelR').offsetWidth;
  const w = Math.max(80, window.innerWidth - L - R);
  const h = Math.max(80, window.innerHeight - 44);
  canvas.style.left = L + 'px';
  renderer.resize(w, h, Math.min(window.devicePixelRatio || 1, 2));
  dirty = true;
}

/** The single draw entry point. */
function renderFrame() {
  const aspect = canvas.width / canvas.height;
  const vp = viewProj(state, aspect);
  const eye = cameraEye(state);
  const far = bounds ? Math.max(...bounds.size) * 3 + 80 : 200;
  renderer.render(vp, eye, {
    bg: state.bg,
    showGrid: state.showGrid,
    showAxes: state.showAxes,
    ao: !!state.ao,
    fogDistance: far,
    bounds: state.showBounds && bounds ? bounds : null,
    cursor: cursor,
    cursorRemove: cursorRemove
  });
}

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  flyStep(dt);
  if (dirty) { renderFrame(); dirty = false; }
  requestAnimationFrame(loop);
}

/* ── init ─────────────────────────────────────────────────────────────────────────────── */

function boot() {
  try {
    renderer = createRenderer(canvas);
  } catch (e) {
    $('boot').textContent = e.message;
    console.error(e);
    return;
  }
  wire();
  bindInput();
  applyTheme();
  resize();

  // Open on a sponge. It is the shape that explains what the tool is for, and an empty grid
  // explains nothing.
  const first = apply(PRESETS[0]);
  state = first.state;
  docName = PRESETS[0].name;
  $('nameInput').value = docName;
  rebuild();
  refreshAll();
  frameShape();

  $('boot').classList.add('done');
  requestAnimationFrame(loop);
}

boot();
