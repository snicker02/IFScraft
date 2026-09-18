// Headless validation. Run with `node test/run.js` before anything ships.
//
// Almost all of this project is integer arithmetic on a Map, so almost all of it is testable
// without a GPU — far more so than a raymarcher was. The only things not covered here are the GL
// calls themselves; the DOM wiring is covered against a stub, and everything that decides what
// shape comes out is covered for real.

import { suite, test, ok, eq, report, note } from './harness.js';
import cells from './t-cells.js';
import lattice from './t-lattice.js';
import ops from './t-ops.js';
import render from './t-render.js';
import ui from './t-ui.js';
import minecraft from './t-minecraft.js';
import blocks from './t-blocks.js';

import { PRESETS } from '../engine/presets.js';
import { apply } from '../engine/state.js';
import { evaluate } from '../engine/ops.js';
import { buildMesh } from '../engine/mesh.js';

const t0 = Date.now();

cells();
lattice();
ops();
render();
ui();
blocks();
await minecraft();

suite('presets', () => {
  const rows = [];
  for (const p of PRESETS) {
    test(`"${p.name}" loads, evaluates and meshes`, () => {
      const r = apply(p);
      eq(r.warnings.length, 0, 'warnings: ' + r.warnings.join('; '));
      const ev = evaluate(r.state.seed, r.state.ops, r.state.cap, r.state.iters);
      ok(ev.cells.size > 0, 'produced no cells');
      ok(!ev.capHit, 'a shipped preset must fit inside the default budget');
      const m = buildMesh(ev.cells);
      ok(m.faces > 0);
      const b = ev.cells.bounds();
      rows.push([p.name, ev.cells.size, m.faces, b.size.join('x'), m.chunks.length,
                 r.state.iters]);
    });
  }
  test('the preset list is reported', () => {
    const w = Math.max(...rows.map(r => r[0].length));
    for (const r of rows) {
      note(r[0].padEnd(w) + '  ' + String(r[1]).padStart(8) + ' cells  ' +
           String(r[2]).padStart(8) + ' faces  ' + r[3].padStart(12) + '  ' +
           String(r[4]).padStart(3) + ' chunks  ' +
           (r[5] > 1 ? r[5] + ' runs' : ''));
    }
    ok(rows.length === PRESETS.length);
  });
});

const bad = report();
console.log(`(${Date.now() - t0} ms)`);
process.exit(bad ? 1 : 0);
