import { suite, test, ok, eq, deepEq, note } from './harness.js';
import { rotMatrix, matMul, matPow, matDet, matApply, matEquals, isSignedPermutation,
         allSymmetries, makeTransform, applyPoint, composeTransforms,
         IDENTITY_M } from '../engine/lattice.js';

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
}
