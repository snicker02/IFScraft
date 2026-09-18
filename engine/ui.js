// Panel construction. Everything here builds DOM and calls back; it holds no state of its own,
// so the op cards can be thrown away and rebuilt whenever the stack changes without anything
// getting out of step.
//
// Integers get number fields, not sliders. The whole premise is that transforms are restricted to
// the lattice, and a slider that reports "2.9999" for the translation you meant to be 3 argues
// against the premise every time you touch it.

import { OP_DEFS, opLabel, predictNext } from './ops.js';
import { MATERIALS, matHex, PALETTE_SIZE } from './palette.js';
import { ROT_LABELS } from './lattice.js';

export function el(tag, attrs, kids) {
  const n = document.createElement(tag);
  if (attrs) for (const k of Object.keys(attrs)) {
    if (k === 'class') n.className = attrs[k];
    else if (k === 'text') n.textContent = attrs[k];
    else if (k === 'html') n.innerHTML = attrs[k];
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), attrs[k]);
    else if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
  }
  for (const c of (kids || [])) if (c) n.appendChild(c);
  return n;
}

function num(value, onChange, opts = {}) {
  const i = el('input', {
    type: 'number', value,
    min: opts.min !== undefined ? opts.min : -999,
    max: opts.max !== undefined ? opts.max : 999,
    step: 1
  });
  i.addEventListener('change', () => {
    let v = Math.round(+i.value);
    if (!Number.isFinite(v)) v = 0;
    if (opts.min !== undefined) v = Math.max(opts.min, v);
    if (opts.max !== undefined) v = Math.min(opts.max, v);
    i.value = v;
    onChange(v);
  });
  return i;
}

function triple(labels, values, onChange, opts) {
  return el('div', { class: 'grid3' }, labels.map((L, i) =>
    el('div', { class: 'f' }, [
      el('span', { text: L }),
      num(values[i], v => onChange(i, v), opts)
    ])
  ));
}

function labelled(text, node, extra) {
  const lab = el('label', { text });
  if (extra) lab.appendChild(el('span', { text: extra }));
  return el('div', {}, [lab, node]);
}

/* ── material swatches ────────────────────────────────────────────────────────────────── */

export function buildSwatches(host, current, onPick) {
  host.innerHTML = '';
  for (let i = 0; i < PALETTE_SIZE; i++) {
    const b = el('button', {
      class: 'sw' + (i === current ? ' on' : ''),
      title: MATERIALS[i].name + '  (' + (i < 8 ? i + 1 : 'shift ' + (i - 7)) + ')',
      style: 'background:' + matHex(i),
      onclick: () => onPick(i)
    });
    host.appendChild(b);
  }
}

/* ── op cards ─────────────────────────────────────────────────────────────────────────── */

export function buildStack(host, ops, cellsAtStep, cap, cb) {
  host.innerHTML = '';
  if (!ops.length) {
    host.appendChild(el('p', { class: 'empty', text:
      'No operations yet. Build something small, then add a replicate to array it or a ' +
      'substitute to make it fractal. The stack re-runs from the seed, so nothing here is ' +
      'destructive.' }));
    return;
  }
  ops.forEach((op, i) => host.appendChild(opCard(op, i, ops.length, cellsAtStep[i], cap, cb)));
}

function opCard(op, i, total, incoming, cap, cb) {
  const def = OP_DEFS[op.type];
  const card = el('div', { class: 'card' + (op.on === false ? ' off' : '') });

  const head = el('div', { class: 'cardhead' }, [
    el('div', { class: 'cname', text: def.name }),
    el('div', { class: 'cbtns' }, [
      el('button', { class: 'mini', title: op.on === false ? 'enable' : 'disable',
                     html: op.on === false ? '&#9675;' : '&#9679;',
                     onclick: () => cb.toggle(i) }),
      el('button', { class: 'mini', title: 'move up', html: '&#8593;',
                     disabled: i === 0 ? '' : null, onclick: () => cb.move(i, -1) }),
      el('button', { class: 'mini', title: 'move down', html: '&#8595;',
                     disabled: i === total - 1 ? '' : null, onclick: () => cb.move(i, 1) }),
      el('button', { class: 'mini', title: 'duplicate', html: '&#10697;',
                     onclick: () => cb.duplicate(i) }),
      el('button', { class: 'mini', title: 'remove', html: '&#10005;',
                     onclick: () => cb.remove(i) })
    ])
  ]);
  card.appendChild(head);
  card.appendChild(el('div', { class: 'clabel', text: opLabel(op) }));

  const set = (k, v) => cb.change(i, k, v);

  if (op.type === 'replicate') {
    card.appendChild(labelled('copies', num(op.count, v => set('count', v), { min: 0, max: 256 })));
    card.appendChild(el('div', { style: 'height:7px' }));

    card.appendChild(el('label', { text: 'move by' }));
    card.appendChild(triple(['x', 'y', 'z'], [op.tx, op.ty, op.tz],
      (a, v) => set(['tx', 'ty', 'tz'][a], v), { min: -256, max: 256 }));

    card.appendChild(el('label', { text: 'quarter turns' }));
    card.appendChild(el('div', { class: 'grid3' }, ['rx', 'ry', 'rz'].map((k, a) => {
      const s = el('select', { onchange: e => set(k, +e.target.value) });
      ROT_LABELS.forEach((L, q) => s.appendChild(el('option', { value: q, text: L + '\u00b0' })));
      s.value = String(op[k]);
      return el('div', { class: 'f' }, [el('span', { text: 'XYZ'[a] }), s]);
    })));

    card.appendChild(el('label', { text: 'flip axis' }));
    card.appendChild(el('div', { class: 'flips' }, ['mx', 'my', 'mz'].map((k, a) =>
      el('button', { class: op[k] ? 'on' : '', text: 'XYZ'[a],
                     onclick: () => set(k, op[k] ? 0 : 1) })
    )));

    card.appendChild(el('label', { text: 'pivot' }));
    card.appendChild(triple(['x', 'y', 'z'], [op.px, op.py, op.pz],
      (a, v) => set(['px', 'py', 'pz'][a], v), { min: -4096, max: 4096 }));
    card.appendChild(el('div', { class: 'row' }, [
      el('button', { class: 'mini', text: 'pivot = shape centre',
                     onclick: () => cb.centrePivot(i) })
    ]));

    card.appendChild(el('div', { class: 'row' }, [
      el('div', {}, [el('label', { text: 'scale' }),
                     num(op.s, v => set('s', v), { min: 1, max: 16 })]),
      el('div', {}, [el('label', { text: 'material step' }),
                     num(op.matShift, v => set('matShift', v), { min: 0, max: 15 })])
    ]));
  } else {
    card.appendChild(labelled('depth', num(op.count, v => set('count', v), { min: 0, max: 12 })));
    card.appendChild(el('div', { style: 'height:7px' }));

    const gridSel = el('select', { onchange: e => set('nMode', e.target.value) }, [
      el('option', { value: 'auto', text: 'grid from the shape' }),
      el('option', { value: 'fixed', text: 'fixed grid' })
    ]);
    gridSel.value = op.nMode;
    card.appendChild(el('label', { text: 'sub-grid' }));
    card.appendChild(gridSel);
    if (op.nMode === 'fixed') {
      card.appendChild(el('div', { style: 'height:6px' }));
      card.appendChild(num(op.n, v => set('n', v), { min: 1, max: 64 }));
      card.appendChild(el('p', { class: 'note', text:
        'A grid smaller than the shape makes the copies overlap. Still exact — just denser.' }));
    }

    card.appendChild(el('div', { style: 'height:7px' }));
    const matSel = el('select', { onchange: e => set('matMode', e.target.value) }, [
      el('option', { value: 'outer', text: 'colour from the coarse cell' }),
      el('option', { value: 'inner', text: 'colour from the fine detail' }),
      el('option', { value: 'mix', text: 'colour from both' })
    ]);
    matSel.value = op.matMode;
    card.appendChild(el('label', { text: 'material' }));
    card.appendChild(matSel);

    card.appendChild(el('div', { style: 'height:7px' }));
    card.appendChild(el('div', { class: 'row' }, [
      el('div', {}, [el('label', { text: 'material step' }),
                     num(op.matShift, v => set('matShift', v), { min: 0, max: 15 })])
    ]));

    const keep = el('input', { type: 'checkbox', onchange: e => set('keep', e.target.checked ? 1 : 0) });
    keep.checked = !!op.keep;
    card.appendChild(el('label', { class: 'chk' }, [keep, document.createTextNode('keep the original')]));
  }

  if (incoming && op.on !== false) {
    const p = predictNext(incoming, op);
    const over = p.cost > cap;
    card.appendChild(el('p', {
      class: 'cost' + (over ? ' over' : ''),
      text: (over ? 'over budget — ' : '') +
            incoming.size.toLocaleString() + ' in \u2192 ' + p.text
    }));
  }
  return card;
}

/* ── the guide ────────────────────────────────────────────────────────────────────────── */

export const HELP_HTML = `
<h2>What this is</h2>
<p>A block editor where placement is recursive. Place a few blocks, then define a transform and an
iteration count, and the shape builds itself out of copies of itself. Minecraft construction with
an iterated function system underneath.</p>

<h2>The two operations</h2>
<p>They live in the same stack and do different jobs.</p>
<p><strong>Replicate</strong> copies the current shape N times under one transform, each copy taken
from the one before it. That is the array modifier: colonnades, staircases, spiral towers. It is
not fractal, and it is what makes the tool usable for building.</p>
<p><strong>Substitute</strong> replaces every cell with a scaled copy of the whole shape. This is
the fractal one. Build the twenty-cell frame of a 3-cube, substitute twice, and you have a Menger
sponge. Depth is exact, not approximate: the rule is captured once when the operation starts, so
depth 3 on a twenty-cell rule is 8,000 cells and never anything else.</p>

<h2>Why everything is an integer</h2>
<p>Transforms are restricted to the lattice: whole-cell translations, quarter turns, axis mirrors,
whole-number scale. Nothing else.</p>
<p>This is the design rather than a limitation. A general affine system lands blocks at fractional
positions, and the result stops being blocks — it becomes a point cloud that has to be resampled,
and every artefact of that resampling ends up in the picture. The crystallographic subset maps
cells to cells exactly. No rounding, no gaps, no question about which cell something landed in, and
a structure that exports exactly as it was built.</p>
<p>One consequence worth knowing early: there is no smooth helix. Ninety degrees is the finest turn
there is, so a spiral staircase is a square one. That is the honest shape of the constraint.</p>

<h2>Seed and result</h2>
<p>The document is the <strong>seed</strong> plus the <strong>stack</strong>. The result is derived
by re-running the stack from the seed every time either changes, so nothing you do is destructive —
turn an operation off, reorder it, change a number, and the shape rebuilds from scratch.</p>
<p>Editing happens in the seed. Switch the view to <strong>Seed</strong> to place and remove
blocks; in <strong>Result</strong> the blocks you can see are mostly copies, and there is no
meaningful cell for a click on one of them to edit. <em>Bake result</em> collapses the result into
the seed and empties the stack when you want to keep building on top of something.</p>

<h2>The budget</h2>
<p>Substitution multiplies. A twenty-cell rule goes 20 → 400 → 8,000 → 160,000 → 3,200,000, so the
step from depth 3 to depth 4 is the one that ends the session. Each card shows what its next step
would cost before you press anything, and the cap refuses a pass rather than half-running it: the
shape you get back is always the last complete step.</p>

<h2>Controls</h2>
<table>
<tr><th>Click</th><td>place a block against the face under the cursor</td></tr>
<tr><th>Shift-click</th><td>remove the block under the cursor</td></tr>
<tr><th>Drag</th><td>orbit, or look around in flight</td></tr>
<tr><th>Right-drag</th><td>pan the orbit target</td></tr>
<tr><th>Wheel</th><td>dolly in orbit, flight speed in flight</td></tr>
<tr><th>1 – 8, shift 1 – 8</th><td>pick a material</td></tr>
<tr><th>Tab</th><td>switch between seed and result</td></tr>
<tr><th>C</th><td>orbit or flight</td></tr>
<tr><th>W A S D, Q E</th><td>fly; Q and E go down and up along world up</td></tr>
<tr><th>F</th><td>frame the shape</td></tr>
<tr><th>G</th><td>ground grid</td></tr>
<tr><th>H</th><td>hide the panels</td></tr>
<tr><th>Ctrl+Z, Ctrl+Shift+Z</th><td>undo, redo</td></tr>
</table>

<h2>Exports</h2>
<p><strong>.json</strong> is the document — seed, stack, camera, settings. It is small, because the
seed is small; the half-million cells are derived and never stored.
<strong>.obj</strong> is the merged surface with a material library beside it, corners
deduplicated exactly rather than by tolerance, since integer corners have no tolerance to choose.
<strong>.csv</strong> is one line per cell for anything that wants voxels instead of a surface.</p>

<h2>A few things learned by building it</h2>
<ul>
<li><em>Keep the original</em> on a substitute often does nothing, and that is correct. If the rule
occupies its own bounding-box corner — the Menger frame does — the first sub-block reproduces the
original exactly, so there is nothing to add back. On a rule that misses that corner, such as the
3D plus, it adds every cell.</li>
<li>Two substitute operations stacked are not the same as one with twice the depth. The second
captures its rule from the already-substituted shape, so depths compose by multiplication:
1 then 1 gives what a single op at depth 3 would.</li>
<li>Replicate with a quarter turn and no translation closes after four copies. Asking for forty is
harmless and gives you the same thirteen cells.</li>
</ul>`;
