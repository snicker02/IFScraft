import { suite, test, ok, eq, deepEq, note } from './harness.js';
import { rotMatrix, matMul, matPow, matDet, matApply, matEquals, isSignedPermutation,
         allSymmetries, makeTransform, applyPoint, composeTransforms,
         IDENTITY_M, SYMMETRY_GROUPS, closeGroup, groupMatrices, groupOrder,
         symmetryImage } from '../engine/lattice.js';

export default function () {
  suite('lattice', () => {

    test('every (rotation, mirror) combination is a signed permutation', () => {
      for (let rx = 0; rx < 4; rx++) for (let ry = 0; ry < 4; ry++) for (let rz = 0; rz < 4; rz++)
        for (let m = 0; m < 8; m++) {
          const M = rotMatrix(rx, ry, rz, m & 1, (m >> 1) & 1, (m >> 2) & 1);
          ok(isSignedPermutation(M), `not a signed permutation at ${rx}${ry}${rz}/${m}`);
          ok(Math.abs(matDet(M)) === 1, 'determinant must be +/-1');
        }
    });

    test('the parameterisation reaches all 48 cube symmetries and no more', () => {
      const all = allSymmetries();
      eq(all.length, 48);
      eq(all.filter(M => matDet(M) === 1).length, 24, 'proper rotations');
      eq(all.filter(M => matDet(M) === -1).length, 24, 'improper');
    });

    test('a quarter turn has order four', () => {
      for (const ax of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
        const M = rotMatrix(ax[0], ax[1], ax[2]);
        ok(matEquals(matMul(matMul(M, M), matMul(M, M)), IDENTITY_M));
        ok(!matEquals(matMul(M, M), IDENTITY_M));
      }
    });

    test('rotations preserve squared length exactly', () => {
      const p = [3, -7, 11];
      const n2 = 9 + 49 + 121;
      for (const M of allSymmetries()) {
        const q = matApply(M, p);
        eq(q[0] * q[0] + q[1] * q[1] + q[2] * q[2], n2);
        ok(q.every(Number.isInteger), 'integers in, integers out');
      }
    });

    test('the named quarter turns go the way the labels say', () => {
      // Right-handed: a +90 about Y sends +X to -Z.
      deepEq(matApply(rotMatrix(0, 1, 0), [1, 0, 0]), [0, 0, -1]);
      // +90 about Z sends +X to +Y.
      deepEq(matApply(rotMatrix(0, 0, 1), [1, 0, 0]), [0, 1, 0]);
      // +90 about X sends +Y to +Z.
      deepEq(matApply(rotMatrix(1, 0, 0), [0, 1, 0]), [0, 0, 1]);
    });

    test('a mirror is an involution about the cell, not the face', () => {
      const M = rotMatrix(0, 0, 0, 1, 0, 0);
      deepEq(matApply(M, [5, 1, 2]), [-5, 1, 2]);
      ok(matEquals(matMul(M, M), IDENTITY_M));
    });

    test('composition is exact', () => {
      let seed = 987;
      const rnd = n => Math.floor((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff * n);
      for (let i = 0; i < 400; i++) {
        const spec = () => ({
          rx: rnd(4), ry: rnd(4), rz: rnd(4),
          mx: rnd(2), my: rnd(2), mz: rnd(2),
          s: 1, tx: rnd(21) - 10, ty: rnd(21) - 10, tz: rnd(21) - 10,
          px: rnd(9) - 4, py: rnd(9) - 4, pz: rnd(9) - 4
        });
        const T1 = makeTransform(spec()), T2 = makeTransform(spec());
        const C = composeTransforms(T1, T2);
        const p = [rnd(41) - 20, rnd(41) - 20, rnd(41) - 20];
        deepEq(applyPoint(C, p), applyPoint(T2, applyPoint(T1, p)),
               'compose must equal apply-then-apply');
      }
    });

    test('scale composes multiplicatively', () => {
      const T1 = makeTransform({ s: 2 }), T2 = makeTransform({ s: 3 });
      eq(composeTransforms(T1, T2).s, 6);
      deepEq(applyPoint(makeTransform({ s: 3, tx: 1 }), [2, 0, 0]), [7, 0, 0]);
    });

    test('the pivot is a fixed point', () => {
      const T = makeTransform({ ry: 1, px: 4, py: 0, pz: 9 });
      deepEq(applyPoint(T, [4, 0, 9]), [4, 0, 9]);
    });

    test('a flipped axis grows its scaled block the other way', () => {
      const T = makeTransform({ mx: 1, s: 3 });
      deepEq(T.blockOff, [-2, 0, 0]);
      const U = makeTransform({ s: 3 });
      deepEq(U.blockOff, [0, 0, 0]);
    });

    test('identity is recognised', () => {
      ok(makeTransform({}).isIdentity);
      ok(!makeTransform({ tx: 1 }).isIdentity);
      ok(!makeTransform({ ry: 2 }).isIdentity);
      ok(makeTransform({ ry: 4 }).isIdentity, 'four quarter turns is no turn');
    });

    note(`48 symmetries, matPow wraps at ${matEquals(matPow(rotMatrix(1, 0, 0), 4), IDENTITY_M) ? 4 : '?'}`);
  });

  suite('lattice / symmetry groups', () => {

    const all = () => {
      const out = [];
      for (const g of SYMMETRY_GROUPS) {
        for (const axis of (g.axial ? [0, 1, 2] : [1])) out.push([g, axis, groupMatrices(g.name, axis)]);
      }
      return out;
    };

    test('every group is closed under multiplication — the property that makes it a group', () => {
      for (const [g, axis, M] of all()) {
        for (const A of M) for (const B of M) {
          const P = matMul(A, B);
          ok(M.some(X => matEquals(X, P)), g.name + '/' + axis + ' is not closed');
        }
      }
    });

    test('and contains the identity and an inverse for every element', () => {
      for (const [g, axis, M] of all()) {
        ok(matEquals(M[0], IDENTITY_M), g.name + ' should list the identity first');
        for (const A of M) {
          ok(M.some(B => matEquals(matMul(A, B), IDENTITY_M)), g.name + ' is missing an inverse');
        }
      }
    });

    test('every element is one of the 48, so the lattice is preserved', () => {
      const cube = allSymmetries();
      for (const [g, axis, M] of all()) {
        for (const A of M) {
          ok(isSignedPermutation(A), g.name);
          ok(cube.some(X => matEquals(X, A)), g.name + ' has an element outside the cube group');
        }
      }
    });

    test('the orders are the ones the labels claim', () => {
      const want = { mirror: 2, mirror2: 4, mirror3: 8, half: 2, quarter: 4, quarterMir: 8,
                     dihedral: 8, inversion: 2, triad: 3, tetra: 12, rotations: 24, full: 48 };
      for (const g of SYMMETRY_GROUPS) {
        for (const axis of (g.axial ? [0, 1, 2] : [1])) {
          eq(groupOrder(g.name, axis), want[g.name], g.name + ' about axis ' + axis);
        }
      }
      note('group orders: ' + SYMMETRY_GROUPS.map(g => g.name + ' ' + groupOrder(g.name)).join(', '));
    });

    test('the rotation groups are rotations only; the rest are half and half', () => {
      for (const name of ['half', 'quarter', 'dihedral', 'triad', 'tetra', 'rotations']) {
        for (const A of groupMatrices(name)) eq(matDet(A), 1, name + ' should be proper rotations');
      }
      for (const name of ['mirror', 'mirror2', 'mirror3', 'quarterMir', 'full']) {
        const M = groupMatrices(name);
        eq(M.filter(A => matDet(A) === 1).length, M.length / 2, name + ' should be half proper');
      }
    });

    test('a group is the same object every time, which is why it can be cached', () => {
      ok(groupMatrices('full') === groupMatrices('full'));
      ok(groupMatrices('mirror', 0) !== groupMatrices('mirror', 1), 'the axis must key the cache');
    });

    test('closeGroup on one generator gives the cyclic group it generates', () => {
      eq(closeGroup([rotMatrix(0, 1, 0)]).length, 4);
      eq(closeGroup([matPow(rotMatrix(0, 1, 0), 2)]).length, 2);
      eq(closeGroup([]).length, 1, 'no generators is the trivial group, not an empty set');
    });

    test('symmetryImage stays on the lattice for every element and both pivot parities', () => {
      const pts = [[0, 0, 0], [3, 1, 4], [-5, 7, -2], [100, -100, 13]];
      for (const A of allSymmetries()) {
        for (const h of [0, 1]) {
          const pivot2 = [2 * 3 + h, 2 * -1 + h, 2 * 5 + h];
          for (const p of pts) {
            const q = symmetryImage(A, p, pivot2);
            for (const v of q) eq(v, Math.round(v), 'left the lattice: ' + q.join(','));
          }
        }
      }
    });

    test('an element applied twice about the same centre returns the point', () => {
      for (const name of ['mirror', 'half', 'inversion']) {
        for (const h of [0, 1]) {
          const pivot2 = [2 * 2 + h, 2 * 2 + h, 2 * 2 + h];
          for (const A of groupMatrices(name, 1)) {
            const p = [7, -3, 4];
            deepEq(symmetryImage(A, symmetryImage(A, p, pivot2), pivot2), p, name);
          }
        }
      }
    });

    test('the centre is fixed when the pivot is a cell, and split when it is a boundary', () => {
      const M = groupMatrices('mirror', 0)[1];
      deepEq(symmetryImage(M, [2, 5, 5], [4, 10, 10]), [2, 5, 5], 'the pivot cell maps to itself');
      deepEq(symmetryImage(M, [2, 5, 5], [5, 11, 11]), [3, 5, 5],
             'half a cell over, the pivot column is doubled instead');
    });
  });
}
