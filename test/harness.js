// A test harness in forty lines, because adding a dependency to run the tests would undo the
// point of not having any.

let current = '';
const results = [];

export function suite(name, fn) {
  current = name;
  fn();
  current = '';
}

export function test(name, fn) {
  const label = current ? current + ' / ' + name : name;
  try { fn(); results.push({ label, ok: true }); }
  catch (e) { results.push({ label, ok: false, err: e }); }
}

export function ok(cond, msg) {
  if (!cond) throw new Error(msg || 'expected true');
}

export function eq(a, b, msg) {
  if (a !== b) throw new Error((msg ? msg + ': ' : '') + `expected ${b}, got ${a}`);
}

export function near(a, b, tol = 1e-12, msg) {
  if (!(Math.abs(a - b) <= tol)) {
    throw new Error((msg ? msg + ': ' : '') + `expected ${b} +/- ${tol}, got ${a} (delta ${Math.abs(a - b)})`);
  }
}

export function deepEq(a, b, msg) {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa !== sb) throw new Error((msg ? msg + ': ' : '') + `\n  expected ${sb}\n  got      ${sa}`);
}

export function throws(fn, msg) {
  try { fn(); } catch (e) { return; }
  throw new Error(msg || 'expected a throw');
}

export function report() {
  const bad = results.filter(r => !r.ok);
  for (const r of results) {
    if (!r.ok) console.log('  FAIL  ' + r.label + '\n        ' + r.err.message.replace(/\n/g, '\n        '));
  }
  console.log(`\n${results.length - bad.length}/${results.length} passed`);
  return bad.length;
}

export function note(s) { console.log('  · ' + s); }
