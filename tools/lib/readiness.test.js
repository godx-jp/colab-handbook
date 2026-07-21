'use strict';
/**
 * Tests for the three-value readiness rule (tools/lib/readiness.js).
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * Two kinds of case, deliberately:
 *   - PURE cases pin the mapping (blocker state → verdict), including every direction the rule must
 *     refuse to be optimistic in. Those are the ones that would silently invert under a refactor.
 *   - GIT-BACKED cases build throwaway repositories with real git, so "its code is written but
 *     unmerged" is measured against what git actually reports rather than against hand-written
 *     signals that agree with whatever we believed. A squash fixture that quietly became a
 *     fast-forward would prove nothing, so those cases assert the raw signals too.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const {
  classify, classifyBlocker, isStartable,
  READY, SOFT, BLOCKED, UNCHECKED, CLEAR, SOFT_BLOCK, HARD_BLOCK,
} = require('./readiness.js');
const { landedState } = require('./landed.js');

// --- fixture builder (same shape as landed.test.js, same reasons) ------------

const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'readiness-test-'));
  TMP.push(dir);
  const g = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q', '-b', 'dev', '.');
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'readiness test');
  g('config', 'core.hooksPath', path.join(dir, '.nohooks'));
  g('config', 'commit.gpgsign', 'false');
  const write = (f, s) => { fs.writeFileSync(path.join(dir, f), s); };
  const commit = (msg) => { g('add', '-A'); g('commit', '-q', '-m', msg); };
  write('README', 'base\n');
  commit('chore: base');
  return { dir, g, write, commit };
}

/** What a caller does: gather the branch facts with landed's git half, hand them to readiness. */
function branchFacts(r, base, branch, pushed = true) {
  const v = landedState(r.dir, base, branch);
  return { pushed, commitsAhead: v.commitsAhead, diffEmpty: v.diffEmpty, containment: v.containment, _v: v };
}

// --- the case this rule exists for ------------------------------------------

test('GIT: blocker whose code is written and pushed but unmerged is soft, not blocked', () => {
  const r = repo();
  r.g('checkout', '-q', '-b', 'feat/dependency-7');
  r.write('dep.txt', 'the thing that is depended on\n'); r.commit('feat: the dependency');
  r.g('checkout', '-q', 'dev');

  const facts = branchFacts(r, 'dev', 'feat/dependency-7');
  assert.strictEqual(facts._v.state, 'cargo', 'fixture invalid: the blocker branch is not unmerged');

  const b = classifyBlocker({ number: 7, open: true, branch: facts });
  assert.strictEqual(b.state, SOFT_BLOCK);

  const v = classify({ blockers: [{ number: 7, open: true, branch: facts }] });
  assert.strictEqual(v.state, SOFT);
  assert.strictEqual(v.notes.length, 1);
  assert.strictEqual(v.notes[0].number, 7, 'the note must name what it is waiting on');
  assert.match(v.why, /merge gate/, 'the note must say the code already exists');
  assert.strictEqual(isStartable(v), true, 'soft-ready work may begin — that is the whole point');
});

test('GIT: blocker already squash-merged is fully clear, though its issue is still open', () => {
  const r = repo();
  r.g('checkout', '-q', '-b', 'feat/dependency-7');
  r.write('dep.txt', 'one\n'); r.commit('feat: the dependency');
  r.write('dep.txt', 'one\ntwo\n'); r.commit('fix: more');
  r.g('checkout', '-q', 'dev');
  r.g('merge', '--squash', 'feat/dependency-7');
  r.commit('feat: the dependency (#7)');

  const facts = branchFacts(r, 'dev', 'feat/dependency-7');
  assert.ok(facts.commitsAhead > 0, 'fixture invalid: squash left no commits ahead');

  const v = classify({ blockers: [{ number: 7, open: true, branch: facts }] });
  assert.strictEqual(v.state, READY, 'the dependency is on the base; only the tracker lags');
  assert.strictEqual(v.notes.length, 0);
});

test('GIT: an empty pushed branch clears nothing — it is not code', () => {
  const r = repo();
  r.g('branch', 'feat/dependency-7'); // pushed, and never committed to

  const facts = branchFacts(r, 'dev', 'feat/dependency-7');
  // The trap this guards: no commits ahead and no diff is exactly what a squash-merge leaves, so
  // landed's rule calls this branch `landed` and it is telling the truth about content.
  assert.strictEqual(facts._v.state, 'landed', 'fixture invalid: the empty branch is not reading as landed');
  assert.strictEqual(facts.commitsAhead, 0);

  const b = classifyBlocker({ number: 7, open: true, branch: facts });
  assert.strictEqual(b.state, HARD_BLOCK, 'an empty branch must never clear a blocker');
  assert.strictEqual(classify({ blockers: [{ number: 7, open: true, branch: facts }] }).state, BLOCKED);
});

// --- the three values, pinned ------------------------------------------------

test('a closed blocker is clear', () => {
  assert.strictEqual(classifyBlocker({ number: 7, open: false }).state, CLEAR);
  assert.strictEqual(classify({ blockers: [{ number: 7, open: false }] }).state, READY);
});

test('an open blocker nobody has started is blocked, unchanged', () => {
  const v = classify({ blockers: [{ number: 7, open: true }] });
  assert.strictEqual(v.state, BLOCKED);
  assert.match(v.why, /no code exists/);
  assert.strictEqual(isStartable(v), false);
});

test('a hard blocker outranks a soft one — the worst blocker decides', () => {
  const v = classify({
    blockers: [
      { number: 7, open: true, branch: { pushed: true, commitsAhead: 2, diffEmpty: false, containment: 'diverged' } },
      { number: 8, open: true },
    ],
  });
  assert.strictEqual(v.state, BLOCKED);
  assert.strictEqual(v.hard.length, 1);
  assert.strictEqual(v.hard[0].number, 8);
});

// --- an active session is intent, not evidence -------------------------------

test('an active session on the blocker moves nothing', () => {
  const withSession = classifyBlocker({ number: 7, open: true, session: true });
  const without = classifyBlocker({ number: 7, open: true });
  assert.strictEqual(withSession.state, HARD_BLOCK);
  assert.deepStrictEqual(withSession, without, 'session must not change the verdict at all');
});

test('an unpushed branch is not evidence either', () => {
  const b = classifyBlocker({
    number: 7, open: true, session: true,
    branch: { pushed: false, commitsAhead: 3, diffEmpty: false, containment: 'diverged' },
  });
  assert.strictEqual(b.state, HARD_BLOCK);
  assert.match(b.why, /not pushed/);
});

// --- it must fail toward blocked, never toward ready -------------------------

test('unmeasurable branch facts read as blocked, not ready', () => {
  for (const branch of [
    { pushed: true, commitsAhead: undefined, diffEmpty: undefined, containment: 'unknown' },
    { pushed: true, commitsAhead: null, diffEmpty: null, containment: 'unknown' },
    { pushed: true, commitsAhead: 2, diffEmpty: 'no', containment: 'unknown' },
  ]) {
    const b = classifyBlocker({ number: 7, open: true, branch });
    assert.strictEqual(b.state, HARD_BLOCK, `optimistic on ${JSON.stringify(branch)}`);
  }
});

test('malformed blocker facts read as blocked', () => {
  for (const bad of [null, undefined, 'open', 42]) {
    assert.strictEqual(classifyBlocker(bad).state, HARD_BLOCK, `optimistic on ${JSON.stringify(bad)}`);
  }
});

// --- unchecked survives: "none" and "nobody looked" stay apart ---------------

test('absent dependency data is unchecked, and unchecked is not startable', () => {
  for (const input of [undefined, {}, { blockers: null }, { blockers: 'none' }]) {
    const v = classify(input);
    assert.strictEqual(v.state, UNCHECKED, `read ${JSON.stringify(input)} as something other than unchecked`);
    assert.strictEqual(isStartable(v), false);
  }
});

test('an empty blocker list is unchecked without the marker, ready with it', () => {
  assert.strictEqual(classify({ blockers: [] }).state, UNCHECKED);
  assert.strictEqual(classify({ blockers: [], depsChecked: true }).state, READY);
});

test('isStartable fails closed on anything it does not recognise', () => {
  for (const v of [null, undefined, {}, { state: UNCHECKED }, { state: BLOCKED }, { state: 'wat' }]) {
    assert.strictEqual(isStartable(v), false, `startable on ${JSON.stringify(v)}`);
  }
  assert.strictEqual(isStartable({ state: READY }), true);
  assert.strictEqual(isStartable({ state: SOFT }), true);
});
