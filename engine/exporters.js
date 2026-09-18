// Exporters. The OBJ writer is pure text generation with no DOM in it, so the output is
// checkable headlessly — which matters, because an off-by-one in OBJ's 1-based indexing produces
// a file that opens without complaint and renders as garbage.
//
// Vertices are deduplicated exactly rather than by tolerance. They are integers, so there is no
// tolerance to choose: two corners are the same corner or they are not.

import { buildIndexedQuads } from './mesh.js';
import { MATERIALS, clampMat } from './palette.js';
import { encode } from './state.js';

/** Wavefront OBJ plus its material library. Quads, not triangles — every tool that reads OBJ
    reads quads, and the file is a third smaller. */
export function toOBJ(cells, opts = {}) {
  const name = opts.name || 'ifscraft';
  const { verts, groups, normals } = buildIndexedQuads(cells);

  const L = [];
  L.push('# ' + name + ' — exported from IFScraft');
  L.push('# ' + cells.size + ' cells, ' + (verts.length / 3) + ' vertices');
  L.push('mtllib ' + name + '.mtl');
  L.push('o ' + name.replace(/\s+/g, '_'));

  for (let i = 0; i < verts.length; i += 3) {
    L.push('v ' + verts[i] + ' ' + verts[i + 1] + ' ' + verts[i + 2]);
  }
  for (const n of normals) L.push('vn ' + n[0] + ' ' + n[1] + ' ' + n[2]);

  const used = [];
  for (const [mat, quads] of groups) {
    const m = clampMat(mat);
    if (used.indexOf(m) < 0) used.push(m);
    L.push('usemtl ' + MATERIALS[m].name);
    for (const { q, n } of quads) {
      const nn = n + 1;
      L.push('f ' + (q[0] + 1) + '//' + nn + ' ' + (q[1] + 1) + '//' + nn + ' ' +
                    (q[2] + 1) + '//' + nn + ' ' + (q[3] + 1) + '//' + nn);
    }
  }

  const M = ['# IFScraft palette'];
  for (const m of used) {
    const c = MATERIALS[m].rgb;
    M.push('newmtl ' + MATERIALS[m].name);
    M.push('Kd ' + c.map(v => v.toFixed(4)).join(' '));
    M.push('Ka ' + c.map(v => (v * 0.2).toFixed(4)).join(' '));
    M.push('Ks 0.0 0.0 0.0');
    M.push('illum 1');
    M.push('');
  }

  return { obj: L.join('\n') + '\n', mtl: M.join('\n') + '\n', vertices: verts.length / 3 };
}

/** The project file: seed, op stack, camera, settings. Small, because the seed is small. */
export function toProject(state, name) { return encode(state, name); }

/** A flat cell list for anything that wants the voxels rather than a surface. One line per cell,
    so it diffs and greps. */
export function toCSV(cells) {
  const a = cells.toArray();
  const L = ['x,y,z,material'];
  for (let i = 0; i < a.length; i += 4) {
    L.push(a[i] + ',' + a[i + 1] + ',' + a[i + 2] + ',' + MATERIALS[clampMat(a[i + 3])].name);
  }
  return L.join('\n') + '\n';
}

/** Browser-side download. The only function in this file that touches the DOM. */
export function download(filename, text, mime = 'text/plain') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadCanvas(canvas, filename) {
  canvas.toBlob(blob => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }, 'image/png');
}
