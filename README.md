# IFScraft

A block editor where placement is recursive. Place a cell or a small cluster, then define
transforms and an iteration count, and the shape builds itself out of copies of itself.

Build `0.2.0`. WebGL1, ES modules, no dependencies of any kind.

```
python3 -m http.server 8000     # or any static server; ES modules need http, not file://
open http://localhost:8000
npm test                        # 143 headless tests, ~2 s, no GPU
```

---

## The constraint that makes it work

Transforms are restricted to the lattice: integer translations, 90° rotations, axis mirrors,
integer scale. A general affine IFS lands cells at fractional positions and the result stops being
blocks — it becomes a point cloud that needs resampling, and every artifact of that resampling
ends up in the picture. The crystallographic subset maps cells to cells exactly. Integer
arithmetic throughout, no rounding, no gaps, no "which cell did this land in".

The cost is real and worth stating plainly: **there is no smooth helix.** 90° is the finest turn
available. The "Square helix" preset is the honest shape of the constraint, not a workaround for
it.

## The two operations

**Replicate** — copy the current shape N times under one transform. The array modifier:
colonnades, staircases, towers, pinwheels. Not fractal, but it is what makes the tool usable for
building.

**Substitute** — replace every cell with a scaled copy of the whole shape. Menger sponge, Vicsek
cross, Cantor dust, Jerusalem cube, and everything between.

Both stack, in order, as an editable list. The stack re-runs from the seed on every change, so
nothing in it is destructive.

## Stack runs

**Stack runs** (`[` / `]`, or the field above the stack) send the whole stack round again with its
own output as the input. Different knob from an op's own count: a count repeats a transform inside
one pass against the shape as it entered, runs repeat the whole stack. A substitute therefore
re-derives its rule from a shape it has already grown — depth 1 run twice reaches what depth 3
would, by a route where every intermediate is a shape you can look at.

**Replicate needs shape-width translation to compound, and the two features are really one.** A
translation in cells is absolute: run the same replicate on a shape that has doubled and the copy
lands back inside it, so runs give an arithmetic progression and not a fractal — iterating a
`+4` translate goes 1, 2, 3, 4, 5 cells and stops being interesting immediately. Switch the card
to *move by shape widths* and the offset is measured in bounding boxes of the shape entering the
op, so it grows with the shape. One cell, one copy, two shape widths along x, six runs, and the
result is the Cantor set exactly: 2^k cells across 3^k, tested to k = 6. The span is an integer
cell count and the multiplier is an integer, so nothing leaves the lattice.

Two consequences worth knowing:

- **A mirror on the same offset closes the gaps rather than leaving them** — the reflected copy
  attaches from its far end, so two shape widths mirrored is a solid run of 2^k across 2^(k+1)−1
  where the unmirrored version is Cantor.
- **A stack whose transforms form a closed group reaches a fixed point.** When a run changes
  nothing the remaining runs are skipped, and the panel says how many actually ran rather than
  pretending it did sixteen.

Two behaviours worth knowing before they surprise you:

- Substitute captures its rule **once**, at the top of the op, so `depth` means depth literally.
  Stacking two depth-1 substitutes is *not* the same as one depth-2 — the second re-derives its
  rule from the shape the first produced. Both are useful; they are different operations.
- "Keep the original" is a **no-op when the rule occupies its own bounding-box corner**, which the
  Menger rule does. On a rule that misses that corner — the 3D plus, Vicsek — it adds every cell
  back: 49 → 56.
- Replicate with a quarter turn and no translation **closes after four copies**. Asking for 40 is
  harmless and gives the same 13 cells.

## Data model

A sparse `Map` from a packed integer key to a material index. Occupied cells only — substitution
at depth 3 on a 3×3×3 rule reaches 160,000 cells inside an 81³ box, which is 9% dense, and it gets
sparser from there.

**The brief specified 21 bits per axis. That is wrong and this build does not do it.** 21 × 3 = 63
bits, well past the 53-bit safe integer, so keys would silently alias and cells would overwrite
each other with no error anywhere. IFScraft uses **17 bits per axis**: 51 bits, `MAX_KEY =
2,251,799,813,685,247`, coordinates `[-65536, 65535]`. Packing uses multiplication rather than
shifts, because JS bitwise operators truncate to 32 bits. A 131,072-cell span on each axis is
larger than any budget will ever fill.

Mirroring maps `p → -p`, treating cells as points rather than solids (not `-p-1`). That choice is
what makes the transform algebra compose exactly: `T(p) = s·M·(p − pivot) + pivot + t` is closed
under composition, and translation puts the mirror plane wherever you actually want it.

Scale `s > 1` grows a block of `s³` cells. On any axis whose matrix is flipped the block grows the
other way, so scaled mirrors stay put on symmetric builds instead of drifting by `s−1`.

## Budget

A hard cell cap, default 400,000, maximum 4,000,000. Every op card prices its own next step before
you press anything.

A pass that would exceed the cap is **refused whole and rolled back exactly** — never half-run.
Replicate unions for real and records what it added and overwrote, because an upper-bound refusal
would wrongly reject overlapping builds that actually fit. The result on screen is always the last
complete step.

## Rendering

Merged, face-culled mesh: a face is emitted only where a solid cell touches an empty one. Interior
faces are the overwhelming majority and none of them are drawn. The mesh rebuilds when the cell
set changes, never per frame.

Chunked at 16,384 faces / 65,536 vertices so indices stay 16-bit and no
`OES_element_index_uint` extension is needed. Interleaved 20-byte vertex: position `float32×3`,
normal `int8×3` normalized, colour + AO `uint8×4`. Face tangents are derived as `u × v = normal`,
so winding is correct by construction rather than by a table someone has to keep right.

Minecraft-style vertex ambient occlusion with the diagonal flip, baked into the vertex alpha and
mixed by a shader uniform — toggling AO costs a uniform, not a remesh.

## Interaction

Click places, shift-click removes. Picking is a DDA walk of the cell set, not a mesh test.

Editing happens in **Seed** view. Result view refuses edits and says so; a "bake result" button
collapses the result into the seed and empties the stack when you want to carry on by hand.

| key | |
|---|---|
| `Tab` | seed ↔ result |
| `1`–`8`, `Shift`+`1`–`8` | material |
| `[` `]` | fewer / more stack runs |
| `F` | frame shape |
| `G` | grid |
| `C` | orbit ↔ fly |
| `WASD` `QE` | fly (wheel sets speed) |
| `H` | hide panels |
| `?` | guide |
| `Ctrl`/`Cmd`+`Z`, `+Shift` | undo, redo |

## Files

```
index.html        markup + CSS (Catoptron token set, three themes)
main.js           state, panels, input, render loop
engine/
  cells.js        packed keys, CellSet
  lattice.js      integer transform algebra — the 48 cube symmetries
  ops.js          replicate, substitute, stack evaluation, budget
  mesh.js         face-culled merged mesh, vertex AO, OBJ quads
  raycast.js      DDA pick, ground plane
  camera.js       mat4, orbit/fly with exact handover, screen ray
  state.js        DEFAULTS, capture/apply/encode/decode, History
  palette.js      16 fixed materials
  presets.js      12 presets, 8 starter seeds
  renderer.js     WebGL1: solid + line programs, five backgrounds
  exporters.js    OBJ/MTL, CSV, project JSON, PNG
  ui.js           DOM helpers, op cards, in-app guide
test/             143 tests: cells, lattice, ops, mesh/raycast/camera/state, ui
```

The document is the seed plus the op stack and the run count. The result is derived and never stored — which is why
undo snapshots are cheap, since seeds are hand-placed and small.

## Validation

`npm test` — 143 tests, no GPU, ~2 s. Exact cell counts (Menger 20 → 400 → 8,000 → 160,000 with
exact bounding boxes), all 48 symmetries and 400 random composition pairs, budget refusal leaving
no material trace, face-culling identities, chunk splitting, DDA picks from all six directions,
orbit↔fly handover to 1e-12, state round-trip and tolerant loading, n runs of a stack proved equal
to one run of that stack written out n times, the Cantor identity at every depth to k = 6, fixed
point detection, and every preset loading, evaluating and meshing with zero warnings.

The four WebGL1 shaders are extracted from `engine/renderer.js` and checked with
`glslangValidator` — all four clean. What remains uncovered is the GL calls themselves and the
canvas/pointer wiring in `main.js`; the panel builders in `engine/ui.js` are tested against a DOM
stub.

## Presets

| | cells | faces | box |
|---|---|---|---|
| Menger sponge | 8,000 | 18,048 | 27³ |
| Menger, coloured by depth | 160,000 | 336,384 | 81³ |
| Vicsek cross | 343 | 1,374 | 27³ |
| Cantor dust | 4,096 | 24,576 | 81³ |
| Sierpinski tetrahedron | 4,096 | 24,576 | 64³ |
| Checkerboard sponge | 2,744 | 16,464 | 27³ |
| Jerusalem cube | 11,236 | 10,824 | 25³ |
| Square helix | 287 | 1,150 | 5×41×5 |
| Twisting tower | 784 | 1,600 | 5×49×5 |
| Colonnade | 756 | 2,632 | 27×11×18 |
| Branch lattice | 343 | 1,374 | 27³ |
| Mirrored sponge tower | 3,200 | 7,936 | 39×18×9 |
| Branching growth *(5 runs)* | 7,078 | 16,062 | 50×61×50 |
| Doubling twist *(5 runs)* | 256 | 616 | 3×64×3 |
| Sponge by runs *(2 runs)* | 160,000 | 336,384 | 81³ |

Opens on the Menger sponge. "New" gives you one cell.

## Export

`.obj` + `.mtl` with per-material groups and deduplicated corners, `.csv` of cell coordinates and
materials, `.json` project (seed + stack, versioned, tolerant loader), and PNG of the canvas.
