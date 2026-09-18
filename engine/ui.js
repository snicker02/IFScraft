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
import { groups, blockByKey } from './blocks.js';

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

/** Sixteen rows: the material's own colour, its name, and the block it becomes. Only the
    materials actually used in the build are marked, because a mapping panel that looks equally
    important in all sixteen rows tells you nothing about which four matter today. */
export function buildBlockMap(host, mapping, used, onPick) {
  host.innerHTML = '';
  const cat = groups();
  for (let i = 0; i < PALETTE_SIZE; i++) {
    const inUse = used && used.has(i);
    const row = el('div', { class: 'brow' + (inUse ? ' used' : '') });
    row.appendChild(el('span', { class: 'chip', style: 'background:' + matHex(i) }));
    row.appendChild(el('span', { class: 'bname', text: MATERIALS[i].name }));

    const sel = el('select', { onchange: e => onPick(i, e.target.value) });
    for (const g of cat) {
      const og = el('optgroup', { label: g.name });
      for (const b of g.blocks) og.appendChild(el('option', { value: b.key, text: b.label }));
      sel.appendChild(og);
    }
    sel.value = mapping[i];
    if (sel.value !== mapping[i]) {          // a key the catalogue no longer has
      sel.appendChild(el('option', { value: mapping[i], text: mapping[i] }));
      sel.value = mapping[i];
    }
    row.appendChild(sel);
    host.appendChild(row);
  }
}

/** One line under the panel, naming what the build will actually be made of. */
export function blockMapSummary(mapping, used) {
  if (!used || !used.size) return 'Nothing placed yet.';
  const names = [...used].sort((a, b) => a - b)
    .map(i => (blockByKey(mapping[i]) || { label: mapping[i] }).label.toLowerCase());
  const head = names.slice(0, 4).join(', ');
  return names.length + (names.length === 1 ? ' block in use: ' : ' blocks in use: ') +
         head + (names.length > 4 ? ', \u2026' : '');
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

    const unitSel = el('select', { onchange: e => set('tUnit', e.target.value) }, [
      el('option', { value: 'cell', text: 'move by cells' }),
      el('option', { value: 'span', text: 'move by shape widths' })
    ]);
    unitSel.value = op.tUnit === 'span' ? 'span' : 'cell';
    card.appendChild(unitSel);
    card.appendChild(el('div', { style: 'height:6px' }));
    card.appendChild(triple(['x', 'y', 'z'], [op.tx, op.ty, op.tz],
      (a, v) => set(['tx', 'ty', 'tz'][a], v), { min: -256, max: 256 }));
    if (op.tUnit === 'span') {
      card.appendChild(el('p', { class: 'note', text:
        'Each step is one bounding box of the shape as it enters this op, so the offset grows ' +
        'with the shape. This is what makes stack runs compound instead of just adding on.' }));
    }

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

<h2>Stack runs</h2>
<p><strong>Stack runs</strong> sends the whole stack round again with its own output as the new
input. One run is the ordinary thing; raise it and run three starts from what run two produced.
<code>[</code> and <code>]</code> step it without reaching for the field.</p>
<p>That is a different knob from an operation's own count, and the difference is the point. A
count repeats a transform <em>inside</em> one pass, against the shape as it entered. Runs repeat
the whole stack, so a substitute re-derives its rule from a shape it has already grown — depth 1
run twice reaches what depth 3 would, and it does so from a rule you can see at every stage.</p>
<p><strong>Replicate needs one more thing to compound, and it is on the card.</strong> A
translation in cells is absolute: run the same replicate on a shape that has doubled and the copy
lands back inside it, so runs give you an arithmetic progression and not a fractal. Switch the
card to <em>move by shape widths</em> and the offset is measured in bounding boxes of the shape as
it enters the operation, so it grows with the shape. One cell, one copy, two shape widths along x,
six runs, and the result is the Cantor set exactly: 64 cells across 729.</p>
<p>Two more things fall out of it. A mirror on the same offset closes the gaps instead of leaving
them, because the reflected copy attaches from its far end — two shape widths mirrored is solid.
And a stack whose transforms form a closed group reaches a fixed point; when a run changes
nothing, the rest are skipped and the panel says how many actually ran.</p>

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
<p>Substitution multiplies, and stack runs multiply what substitution did. A twenty-cell rule goes
20 → 400 → 8,000 → 160,000 → 3,200,000, so the
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
<tr><th>[ and ]</th><td>fewer or more stack runs</td></tr>
<tr><th>F</th><td>frame the shape</td></tr>
<tr><th>G</th><td>ground grid</td></tr>
<tr><th>H</th><td>hide the panels</td></tr>
<tr><th>Ctrl+Z, Ctrl+Shift+Z</th><td>undo, redo</td></tr>
</table>

<h2>Choosing the blocks</h2>
<p>The <em>Blocks</em> section maps each of the sixteen materials to a Minecraft block. Press
<em>edit</em> for the sixteen rows; the materials your build actually contains are shown at full
strength and the rest are dimmed, since a panel that weights all sixteen equally tells you nothing
about which four are on screen.</p>
<p>The catalogue is one table for both editions — concrete, wool, terracotta and stained glass in
all sixteen colours, then stone, sand, wood, metal, light and ice. Each entry knows its Java id,
its Bedrock id where those differ (<code>bricks</code> is <code>brick_block</code>,
<code>snow_block</code> is <code>snow</code>) and its pre-flattening Bedrock form with states,
so the same choice exports correctly wherever you send it.</p>
<p>The dropdown above the rows holds whole palettes — all concrete, all wool, stone greys, nether,
treasure, ice, glow — and <em>match</em> assigns each material the nearest block by colour. Both
write a normal mapping you can then edit, rather than a mode you are stuck in.</p>
<p>Two things worth knowing. Concrete is the default because it is flat and matt and holds its
colour at distance, where wool goes to mush and terracotta turns to mud once substitution has
made it small. And a glass or ice mapping is the one case where the exported shape looks
genuinely different from the preview: this renders solid cubes, and the game will not.</p>

<h2>Into Minecraft</h2>
<p>Two routes out, and they fail in opposite directions.</p>
<p><strong>.schem</strong> is the Sponge schematic WorldEdit, FAWE, Litematica and Amulet all
read. One file; <code>//schem load &lt;name&gt;</code> then <code>//paste</code>. It is dense — the
block array carries one entry per cell of the bounding box, air included — so a Cantor dust costs
what a solid block of the same size costs. Fine up to a few million slots, useless past that.</p>
<p><strong>.nbt</strong> is the vanilla structure format, placed by a structure block with no mods
at all. It is sparse, so only the blocks that exist are stored, which is the right shape for
anything lacy. The catch is the structure block's own 48-cube limit: bigger builds come out as a
grid of tiles, one file each, with a placement note listing the offsets.</p>
<p><strong>Finding the folder is the part everyone gets stuck on.</strong> It does not exist in a
fresh world, and whether it is called <code>structures</code> or <code>structure</code> changed
with the 1.21 data-pack renames — so do not go hunting for it. Get a structure block
(<code>/give @s minecraft:structure_block</code>), leave it on Save, type any name, and press the
button; that creates the folder. Then <em>Singleplayer &rarr; the world &rarr; Edit &rarr; Open
World Folder</em>, look under <code>generated</code> for the file you just made, and put these
beside it. Load mode, the file name without the extension, Load, Place. The exported placement
note says all of this again, with the per-platform paths.</p>
<h2>Bedrock Edition</h2>
<p>None of the above works on Bedrock — phone, console, Windows edition. Different game, different
files: its NBT is little-endian and uncompressed, and structures live inside an add-on rather than
as loose files. Switch <em>edition</em> to Bedrock and the export becomes a single
<strong>.mcpack</strong>: double-click it, Minecraft imports it, activate it in the world's
behaviour packs, then <code>/structure load &lt;name&gt;:&lt;name&gt;_0_0_0 ~ ~ ~</code>.</p>
<p>A <strong>&lt;name&gt;-commands.txt</strong> comes down beside the pack, carrying the exact
command for every tile with its offset worked out, the import steps, and which block each material
became. The pack holds the same text, but a file inside an imported pack is buried in com.mojang,
which is the problem this export exists to avoid — so it arrives as a plain download too. Tiles
are 64 blocks here rather than 48; Bedrock allows the bigger box.</p>
<p><strong>Empty space</strong> is written as "leave what is there" by default, which is how a
structure void is stored: the gaps will not clear the terrain around them, and equally will not
carve. Tick <em>empty space places air</em> and the holes become real air blocks, so the shape
cuts itself out of whatever it lands in — what you want in a hillside, and not what you want over
your base. The toggle covers the vanilla Java structure files as well; a Java one pays for it in
size, since that format has no "everything else" and every hole is written out as its own block.</p>
<p>The second button writes the <strong>.mcstructure</strong> files loose, without the pack around
them. Bedrock has no folder of its own for these — a structure block reads them only from a
behaviour pack that is <em>active</em> in the world — so they go in
<code>&lt;world&gt;/behavior_packs/&lt;pack&gt;/structures/&lt;name&gt;/</code>, and the
accompanying .txt spells that out. Worth it when you already have a pack to drop them into; the
.mcpack is the same structures with a pack built around them and no folder hunt.</p>
<p><strong>The one thing not verified in game is the block ids.</strong> Bedrock has been splitting
compound blocks into separate ids since 1.16.100 — <code>concrete</code> with a colour state
becoming <code>white_concrete</code> and the rest — a process the wiki still lists as unfinished,
with the old ids kept as working aliases. So the export offers both tables and defaults to the
legacy one, since an alias is documented to still work. If a build comes in as stone or as
nothing, flip <em>block ids</em> to flattened and export again.</p>
<p>Set <em>game version</em> to the oldest thing you intend to paste into. A file whose data
version is newer than the server is refused outright; an older one is upgraded on paste, which is
the failure worth having. The sixteen materials map to concrete, terracotta and smooth sandstone —
blocks that are matt, flat and read at distance, which is what a fractal made of blocks needs.</p>

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
<li>Stack runs were added after the first build, because the stack alone could not express growth
that compounds. They only pay off once translation can be measured in shape widths; with the
offset fixed in cells, iterating a replicate adds one copy a run and nothing more. The two
features are really one feature.</li>
</ul>`;
