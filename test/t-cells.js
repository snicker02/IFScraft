import { suite, test, ok, eq, deepEq, note } from './harness.js';
import { CellSet, pack, unpackX, unpackY, unpackZ, unpack,
         MIN_COORD, MAX_COORD, MAX_KEY, inRange } from '../engine/cells.js';

export default function () {
  suite('cells', () => {

    test('the whole key space stays inside the safe integer range', () => {
      ok(MAX_KEY < Number.MAX_SAFE_INTEGER, `MAX_KEY ${MAX_KEY} must be below 2^53-1`);
      eq(pack(MAX_COORD, MAX_COORD, MAX_COORD), MAX_KEY);
      eq(pack(MIN_COORD, MIN_COORD, MIN_COORD), 0);
      ok(Number.isSafeInteger(pack(MAX_COORD, MAX_COORD, MAX_COORD)));
    });

    test('pack and unpack round trip on the corners', () => {
      const vals = [MIN_COORD, MIN_COORD + 1, -1, 0, 1, MAX_COORD - 1, MAX_COORD];
      for (const x of vals) for (const y of vals) for (const z of vals) {
        const k = pack(x, y, z);
        eq(unpackX(k), x, 'x'); eq(unpackY(k), y, 'y'); eq(unpackZ(k), z, 'z');
      }
    });

    test('pack and unpack round trip on random coordinates', () => {
      let seed = 12345;
      const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
      for (let i = 0; i < 20000; i++) {
        const x = Math.floor(rnd() * 131072) - 65536;
        const y = Math.floor(rnd() * 131072) - 65536;
        const z = Math.floor(rnd() * 131072) - 65536;
        deepEq(unpack(pack(x, y, z)), [x, y, z]);
      }
    });

    test('distinct cells never share a key', () => {
      const seen = new Set();
      for (let x = -3; x <= 3; x++) for (let y = -3; y <= 3; y++) for (let z = -3; z <= 3; z++) {
        const k = pack(x, y, z);
        ok(!seen.has(k), `collision at ${x},${y},${z}`);
        seen.add(k);
      }
      eq(seen.size, 343);
    });

    test('inRange rejects what would alias', () => {
      ok(inRange(MAX_COORD, 0, 0));
      ok(!inRange(MAX_COORD + 1, 0, 0));
      ok(!inRange(0, MIN_COORD - 1, 0));
    });

    test('a single cell has size one on every axis', () => {
      const s = new CellSet();
      s.set(4, -2, 9, 1);
      const b = s.bounds();
      deepEq(b.min, [4, -2, 9]);
      deepEq(b.size, [1, 1, 1]);
    });

    test('a solid box has the cell count its bounds imply', () => {
      const s = CellSet.box(-1, 0, 2, 1, 2, 4);
      eq(s.size, 27);
      deepEq(s.bounds().size, [3, 3, 3]);
    });

    test('normalised puts the bounds minimum at the origin', () => {
      const s = CellSet.box(10, -4, 7, 12, -2, 9);
      const n = s.normalized();
      deepEq(n.min, [10, -4, 7]);
      deepEq(n.set.bounds().min, [0, 0, 0]);
      eq(n.set.size, s.size);
    });

    test('serialisation round trips and is deterministic', () => {
      const a = new CellSet();
      a.set(3, 1, 4, 5); a.set(-1, -1, -1, 0); a.set(0, 0, 0, 15);
      const arr = a.toArray();
      eq(arr.length, 12);
      const b = CellSet.fromArray(arr);
      ok(a.equals(b));
      deepEq(b.toArray(), arr);
      // Insertion order must not leak into the file.
      const c = new CellSet();
      c.set(0, 0, 0, 15); c.set(3, 1, 4, 5); c.set(-1, -1, -1, 0);
      deepEq(c.toArray(), arr);
    });

    test('out of range writes are refused rather than aliased', () => {
      const s = new CellSet();
      eq(s.set(MAX_COORD + 1, 0, 0, 1), false);
      eq(s.size, 0);
    });

    note(`key space ${MAX_KEY.toLocaleString()} of ${Number.MAX_SAFE_INTEGER.toLocaleString()}`);
  });
}
