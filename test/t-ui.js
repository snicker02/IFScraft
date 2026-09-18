// The panel builder, exercised against a forty-line DOM stub.
//
// engine/ui.js holds no state — it builds nodes and calls back — so a stub that records
// appendChild and fires listeners is enough to prove the cards are wired to the right op index
// and the right field name. That is the part that actually breaks: a card that reads op 2 and
// writes op 1 looks perfectly fine on screen until you touch it.
//
// This does not prove anything about layout or CSS. Nothing headless can.

import { suite, test, ok, eq, note } from './harness.js';
import { el, buildSwatches, buildStack, buildBlockMap, blockMapSummary,
         HELP_HTML } from '../engine/ui.js';
import { DEFAULT_MAP, blockByKey, CATALOGUE } from '../engine/blocks.js';
import { defaultOp, DEFAULT_CAP } from '../engine/ops.js';
import { PALETTE_SIZE } from '../engine/palette.js';
import { CellSet } from '../engine/cells.js';

/* ── the stub ─────────────────────────────────────────────────────────────────────────── */

class Node {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.attrs = {};
    this.listeners = {};
    this.className = '';
    this.textContent = '';
    this._innerHTML = '';
    this.value = '';
    this.checked = false;
  }
  set innerHTML(v) { this._innerHTML = v; if (v === '') this.children = []; }
  get innerHTML() { return this._innerHTML; }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'value') this.value = String(v); }
  getAttribute(k) { return this.attrs[k]; }
  addEventListener(k, fn) { (this.listeners[k] = this.listeners[k] || []).push(fn); }
  appendChild(n) { this.children.push(n); n.parent = this; return n; }
  fire(kind, ev) { for (const fn of (this.listeners[kind] || [])) fn(ev || { target: this }); }
  // depth-first walk, this node included
  *all() { yield this; for (const c of this.children) yield* c.all(); }
  find(pred) { for (const n of this.all()) if (pred(n)) return n; return null; }
  findAll(pred) { return [...this.all()].filter(pred); }
  text() { return [...this.all()].map(n => n.textContent).join(' '); }
}

function stubDOM() {
  globalThis.document = {
    createElement: tag => new Node(tag),
    createTextNode: t => { const n = new Node('#text'); n.textContent = t; return n; }
  };
}

const byText = t => n => n.textContent === t;
const buttons = root => root.findAll(n => n.tagName === 'BUTTON');

/* ── the recorder ─────────────────────────────────────────────────────────────────────── */

function recorder() {
  const log = [];
  const cb = {};
  for (const k of ['toggle', 'move', 'duplicate', 'remove', 'change', 'centrePivot']) {
    cb[k] = (...args) => log.push([k, ...args]);
  }
  cb.log = log;
  return cb;
}

export default function () {
  stubDOM();

  suite('ui / el', () => {

    test('class, text and attributes land in the right places', () => {
      const n = el('div', { class: 'card', text: 'hello', title: 'tip', 'data-i': 3 });
      eq(n.tagName, 'DIV');
      eq(n.className, 'card');
      eq(n.textContent, 'hello');
      eq(n.getAttribute('title'), 'tip');
      eq(n.getAttribute('data-i'), '3');
    });

    test('null and undefined attributes are dropped, not stringified', () => {
      const n = el('button', { disabled: null, title: undefined, value: 0 });
      ok(!('disabled' in n.attrs), 'null wrote an attribute');
      ok(!('title' in n.attrs), 'undefined wrote an attribute');
      eq(n.getAttribute('value'), '0', 'zero must survive — it is not nullish');
    });

    test('on* keys become listeners, not attributes', () => {
      let hits = 0;
      const n = el('button', { onclick: () => hits++ });
      ok(!('onclick' in n.attrs));
      n.fire('click');
      eq(hits, 1);
    });

    test('falsy children are skipped so conditionals inline safely', () => {
      const n = el('div', {}, [el('span'), null, undefined, false, el('b')]);
      eq(n.children.length, 2);
    });
  });

  suite('ui / swatches', () => {

    test('one button per material, the current one marked', () => {
      const host = new Node('div');
      buildSwatches(host, 5, () => {});
      eq(host.children.length, PALETTE_SIZE);
      const on = host.children.filter(n => n.className.includes('on'));
      eq(on.length, 1, 'exactly one swatch is current');
      eq(host.children.indexOf(on[0]), 5);
    });

    test('a click reports the index it was drawn with', () => {
      const host = new Node('div');
      const picked = [];
      buildSwatches(host, 0, i => picked.push(i));
      host.children[11].fire('click');
      host.children[3].fire('click');
      eq(picked.join(','), '11,3');
    });

    test('rebuilding clears the host instead of stacking a second row', () => {
      const host = new Node('div');
      buildSwatches(host, 0, () => {});
      buildSwatches(host, 1, () => {});
      eq(host.children.length, PALETTE_SIZE);
    });
  });

  suite('ui / stack', () => {

    test('an empty stack explains itself rather than showing nothing', () => {
      const host = new Node('div');
      buildStack(host, [], [], DEFAULT_CAP, recorder());
      eq(host.children.length, 1);
      ok(host.children[0].textContent.length > 40, 'the empty state should say something useful');
    });

    test('one card per op, in stack order', () => {
      const host = new Node('div');
      const ops = [defaultOp('replicate'), defaultOp('substitute'), defaultOp('replicate')];
      buildStack(host, ops, [null, null, null], DEFAULT_CAP, recorder());
      eq(host.children.length, 3);
      ok(host.children[0].text().includes('Replicate'));
      ok(host.children[1].text().includes('Substitute'));
    });

    test('card buttons report the index of their own card', () => {
      const host = new Node('div');
      const ops = [defaultOp('replicate'), defaultOp('replicate'), defaultOp('replicate')];
      const cb = recorder();
      buildStack(host, ops, [null, null, null], DEFAULT_CAP, cb);
      const head = host.children[2].children[0];      // second card's head row
      const btns = buttons(head);
      eq(btns.length, 5, 'toggle, up, down, duplicate, remove');
      btns[0].fire('click');
      btns[1].fire('click');
      btns[2].fire('click');
      btns[3].fire('click');
      btns[4].fire('click');
      eq(JSON.stringify(cb.log), JSON.stringify([
        ['toggle', 2], ['move', 2, -1], ['move', 2, 1], ['duplicate', 2], ['remove', 2]
      ]));
    });

    test('the ends of the stack cannot be moved off it', () => {
      const host = new Node('div');
      const ops = [defaultOp('replicate'), defaultOp('replicate')];
      buildStack(host, ops, [null, null], DEFAULT_CAP, recorder());
      const first = buttons(host.children[0].children[0]);
      const last = buttons(host.children[1].children[0]);
      ok('disabled' in first[1].attrs, 'the first card must not move up');
      ok(!('disabled' in first[2].attrs));
      ok('disabled' in last[2].attrs, 'the last card must not move down');
      ok(!('disabled' in last[1].attrs));
    });

    test('a disabled op is drawn as disabled', () => {
      const host = new Node('div');
      const op = defaultOp('replicate'); op.on = false;
      buildStack(host, [op], [null], DEFAULT_CAP, recorder());
      ok(host.children[0].className.includes('off'));
    });

    test('number fields round, clamp and report their own field name', () => {
      const host = new Node('div');
      const op = defaultOp('replicate');
      const cb = recorder();
      buildStack(host, [op], [null], DEFAULT_CAP, cb);
      const copies = host.children[0].find(n => n.tagName === 'INPUT' && n.attrs.max === '256');
      ok(copies, 'the copies field should be there');
      copies.value = '7.6';  copies.fire('change');
      copies.value = '-4';   copies.fire('change');
      copies.value = '9999'; copies.fire('change');
      copies.value = 'pear'; copies.fire('change');
      eq(JSON.stringify(cb.log), JSON.stringify([
        ['change', 0, 'count', 8],
        ['change', 0, 'count', 0],
        ['change', 0, 'count', 256],
        ['change', 0, 'count', 0]
      ]));
    });

    test('quarter turns offer exactly four options and write the selection back', () => {
      const host = new Node('div');
      const op = defaultOp('replicate');
      const cb = recorder();
      buildStack(host, [op], [null], DEFAULT_CAP, cb);
      const sels = host.children[0].findAll(n => n.tagName === 'SELECT' && n.children.length === 4);
      eq(sels.length, 3, 'one per axis');
      sels[1].value = '3';
      sels[1].fire('change', { target: sels[1] });
      eq(JSON.stringify(cb.log), JSON.stringify([['change', 0, 'ry', 3]]));
    });

    test('the translate unit is offered and reported', () => {
      const host = new Node('div');
      const cb = recorder();
      buildStack(host, [defaultOp('replicate')], [null], DEFAULT_CAP, cb);
      const unit = host.children[0].find(n => n.tagName === 'SELECT' && n.children.length === 2);
      ok(unit, 'the cell/span select should be there');
      eq(unit.value, 'cell');
      unit.value = 'span';
      unit.fire('change', { target: unit });
      eq(JSON.stringify(cb.log), JSON.stringify([['change', 0, 'tUnit', 'span']]));
    });

    test('shape-width translation explains itself on the card', () => {
      const host = new Node('div');
      const op = defaultOp('replicate'); op.tUnit = 'span';
      buildStack(host, [op], [null], DEFAULT_CAP, recorder());
      ok(host.children[0].text().toLowerCase().includes('bounding box'));
    });

    test('flip buttons toggle rather than set', () => {
      const host = new Node('div');
      const op = defaultOp('replicate'); op.my = 1;
      const cb = recorder();
      buildStack(host, [op], [null], DEFAULT_CAP, cb);
      const flips = host.children[0].find(n => n.className === 'flips');
      flips.children[0].fire('click');   // mx is 0 -> 1
      flips.children[1].fire('click');   // my is 1 -> 0
      eq(JSON.stringify(cb.log), JSON.stringify([
        ['change', 0, 'mx', 1], ['change', 0, 'my', 0]
      ]));
    });

    test('the pivot shortcut asks the app, which is the only thing that knows the shape', () => {
      const host = new Node('div');
      const cb = recorder();
      buildStack(host, [defaultOp('replicate')], [null], DEFAULT_CAP, cb);
      host.children[0].find(n => n.textContent === 'pivot = shape centre').fire('click');
      eq(JSON.stringify(cb.log), JSON.stringify([['centrePivot', 0]]));
    });

    test('substitute shows the fixed-grid field only when fixed is chosen', () => {
      const auto = new Node('div');
      buildStack(auto, [defaultOp('substitute')], [null], DEFAULT_CAP, recorder());
      ok(!auto.find(n => n.tagName === 'INPUT' && n.attrs.max === '64'), 'auto should hide it');

      const fixed = new Node('div');
      const op = defaultOp('substitute'); op.nMode = 'fixed';
      buildStack(fixed, [op], [null], DEFAULT_CAP, recorder());
      ok(fixed.find(n => n.tagName === 'INPUT' && n.attrs.max === '64'), 'fixed should show it');
    });

    test('the keep-original checkbox reflects and reports state', () => {
      const host = new Node('div');
      const op = defaultOp('substitute'); op.keep = 1;
      const cb = recorder();
      buildStack(host, [op], [null], DEFAULT_CAP, cb);
      const box = host.children[0].find(n => n.attrs.type === 'checkbox');
      eq(box.checked, true);
      box.checked = false;
      box.fire('change', { target: box });
      eq(JSON.stringify(cb.log), JSON.stringify([['change', 0, 'keep', 0]]));
    });

    test('the cost line appears when a cell count is known and warns when it is over', () => {
      const cells = new CellSet();
      for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) cells.set(x, y, 0, 1);

      const under = new Node('div');
      const cheap = defaultOp('substitute'); cheap.count = 1;
      buildStack(under, [cheap], [cells], DEFAULT_CAP, recorder());
      const lineA = under.find(n => n.className && n.className.startsWith('cost'));
      ok(lineA, 'a card with cells coming in should price the step');
      ok(!lineA.className.includes('over'));

      const over = new Node('div');
      const dear = defaultOp('substitute'); dear.count = 8;
      buildStack(over, [dear], [cells], DEFAULT_CAP, recorder());
      const lineB = over.find(n => n.className && n.className.startsWith('cost'));
      ok(lineB.className.includes('over'), 'depth 8 on nine cells is far past any budget');
      note('cost line at depth 8 reads: ' + lineB.textContent);
    });

    test('a disabled op is not priced — it is not going to run', () => {
      const cells = new CellSet();
      cells.set(0, 0, 0, 1);
      const host = new Node('div');
      const op = defaultOp('substitute'); op.on = false;
      buildStack(host, [op], [cells], DEFAULT_CAP, recorder());
      ok(!host.find(n => n.className && n.className.startsWith('cost')));
    });
  });

  suite('ui / block map', () => {

    test('sixteen rows, each showing the whole catalogue', () => {
      const host = new Node('div');
      buildBlockMap(host, DEFAULT_MAP, new Set(), () => {});
      eq(host.children.length, PALETTE_SIZE);
      const sel = host.children[0].find(n => n.tagName === 'SELECT');
      const opts = sel.findAll(n => n.tagName === 'OPTION');
      eq(opts.length, CATALOGUE.length);
      ok(sel.findAll(n => n.tagName === 'OPTGROUP').length >= 6, 'grouped, or it is unusable');
    });

    test('each row opens on the block that material is actually mapped to', () => {
      const map = DEFAULT_MAP.slice();
      map[2] = 'obsidian';
      const host = new Node('div');
      buildBlockMap(host, map, new Set(), () => {});
      eq(host.children[0].find(n => n.tagName === 'SELECT').value, DEFAULT_MAP[0]);
      eq(host.children[2].find(n => n.tagName === 'SELECT').value, 'obsidian');
    });

    test('a pick reports its own row index and the chosen key', () => {
      const host = new Node('div');
      const picks = [];
      buildBlockMap(host, DEFAULT_MAP, new Set(), (i, k) => picks.push([i, k]));
      const sel = host.children[7].find(n => n.tagName === 'SELECT');
      sel.value = 'glowstone';
      sel.fire('change', { target: sel });
      eq(JSON.stringify(picks), JSON.stringify([[7, 'glowstone']]));
    });

    test('materials in the build are marked, the rest are not', () => {
      const host = new Node('div');
      buildBlockMap(host, DEFAULT_MAP, new Set([1, 4]), () => {});
      eq(host.children.filter(n => n.className.includes('used')).length, 2);
      ok(host.children[1].className.includes('used'));
      ok(!host.children[0].className.includes('used'));
    });

    test('the summary names the blocks in use and nothing else', () => {
      const map = DEFAULT_MAP.slice();
      map[0] = 'glowstone';
      const txt = blockMapSummary(map, new Set([0, 3]));
      ok(txt.includes('glowstone'), txt);
      ok(txt.includes(blockByKey(map[3]).label.toLowerCase()), txt);
      ok(!txt.includes(blockByKey(map[9]).label.toLowerCase()), 'unused blocks stay out: ' + txt);
      eq(blockMapSummary(map, new Set()), 'Nothing placed yet.');
    });
  });

  suite('ui / guide', () => {

    test('the guide is present and its tags balance', () => {
      ok(HELP_HTML.length > 2000, 'a guide that short is not a guide');
      const opens = (HELP_HTML.match(/<(?!\/)([a-z0-9]+)[^>]*>/g) || [])
        .filter(t => !/\/>$/.test(t) && !/^<(br|hr|img|input)\b/.test(t));
      const closes = HELP_HTML.match(/<\/[a-z0-9]+>/g) || [];
      eq(opens.length, closes.length, 'unbalanced tags in HELP_HTML');
    });

    test('the guide covers both operations and the budget', () => {
      const h = HELP_HTML.toLowerCase();
      for (const word of ['replicate', 'substitute', 'budget', 'seed']) {
        ok(h.includes(word), 'the guide never mentions "' + word + '"');
      }
    });
  });
}
