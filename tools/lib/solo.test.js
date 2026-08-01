'use strict';
/**
 * Tests for solo flow's entry/exit gate (tools/lib/solo.js).
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * Same discipline as landed.test.js: every case builds a throwaway repo (with a real bare
 * "origin") in a temp dir, because the whole point of this gate is "never an honor system" — it
 * has to be measured against what git actually reports, not a mock tuned to agree with us.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { unpushedBranches, fullyDirty, entryProblems, exitProblems } = require('./solo.js');

// --- fixture builder --------------------------------------------------------

const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

/** A repo with a pushed `main` and a bare "origin" — the shape solo flow assumes. */
function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solo-test-'));
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'solo-test-origin-'));
  TMP.push(dir, bare);
  const g = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  execFileSync('git', ['init', '-q', '--bare', bare]);
  g('init', '-q', '-b', 'main', '.');
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'solo test');
  g('config', 'core.hooksPath', path.join(dir, '.nohooks'));
  g('config', 'commit.gpgsign', 'false');
  g('remote', 'add', 'origin', bare);
  const write = (f, s) => { fs.writeFileSync(path.join(dir, f), s); };
  const commit = (msg) => { g('add', '-A'); g('commit', '-q', '-m', msg); };
  write('README', 'base\n');
  commit('chore: base');
  g('push', '-q', '-u', 'origin', 'main');
  return { dir, g, write, commit };
}

const emptyState = () => ({ worktrees: {}, claims: {} });

// --- entryProblems -----------------------------------------------------------

test('entryProblems: clean, pushed, on trunk, no other branch → clear', () => {
  const r = repo();
  assert.deepStrictEqual(entryProblems(emptyState(), r.dir, 'main'), []);
});

test('entryProblems: a tracked, uncommitted change refuses', () => {
  const r = repo();
  r.write('README', 'base\nedited\n');
  const problems = entryProblems(emptyState(), r.dir, 'main');
  assert.strictEqual(problems.length, 1);
  assert.match(problems[0], /tree not clean/);
});

test('entryProblems: an UNTRACKED file also refuses — stricter than a ship precondition', () => {
  const r = repo();
  r.write('scratch.txt', 'not yet added\n');
  const problems = entryProblems(emptyState(), r.dir, 'main');
  assert.strictEqual(problems.length, 1);
  assert.match(problems[0], /tree not clean/);
});

test('entryProblems: checked out on a feature branch (not trunk) refuses', () => {
  const r = repo();
  r.g('checkout', '-q', '-b', 'feat/thing-1');
  const problems = entryProblems(emptyState(), r.dir, 'main');
  assert.strictEqual(problems.length, 1);
  assert.match(problems[0], /checked out on "feat\/thing-1"/);
});

test('entryProblems: an unpushed OTHER branch refuses, even with trunk itself clean', () => {
  const r = repo();
  r.g('checkout', '-q', '-b', 'feat/leftover-1');
  r.write('thing.txt', 'one\n'); r.commit('feat: thing');
  r.g('checkout', '-q', 'main'); // back on trunk, which is itself clean and pushed
  const problems = entryProblems(emptyState(), r.dir, 'main');
  assert.strictEqual(problems.length, 1);
  assert.match(problems[0], /unpushed branch "feat\/leftover-1"/);
  assert.match(problems[0], /1 commit\(s\) ahead of origin\/main/);
});

test('entryProblems: trunk itself ahead of origin (a previous solo session left unpushed work) refuses', () => {
  const r = repo();
  r.write('thing.txt', 'one\n'); r.commit('feat: thing (not pushed)');
  const problems = entryProblems(emptyState(), r.dir, 'main');
  assert.strictEqual(problems.length, 1);
  assert.match(problems[0], /unpushed branch "main"/);
});

test('entryProblems: a worktree recorded against this repo refuses, by name', () => {
  const r = repo();
  const st = { worktrees: { 'some-feature-9': { name: 'some-feature-9', repo: r.dir } }, claims: {} };
  const problems = entryProblems(st, r.dir, 'main');
  assert.strictEqual(problems.length, 1);
  assert.match(problems[0], /worktree\(s\) held: some-feature-9/);
});

test('entryProblems: a claim recorded against this repo refuses, by issue', () => {
  const r = repo();
  const st = { worktrees: {}, claims: { [`${r.dir}#9`]: { issue: '#9', repo: r.dir, worktree: null } } };
  const problems = entryProblems(st, r.dir, 'main');
  assert.strictEqual(problems.length, 1);
  assert.match(problems[0], /claim\(s\) held: #9/);
});

test('entryProblems: a worktree/claim recorded against a DIFFERENT repo does not refuse', () => {
  const r = repo();
  const other = repo();
  const st = {
    worktrees: { 'unrelated-1': { name: 'unrelated-1', repo: other.dir } },
    claims: { [`${other.dir}#3`]: { issue: '#3', repo: other.dir, worktree: null } },
  };
  assert.deepStrictEqual(entryProblems(st, r.dir, 'main'), []);
});

test('entryProblems: every condition failing at once is reported together, not just the first', () => {
  const r = repo();
  r.g('checkout', '-q', '-b', 'feat/thing-1');
  r.write('scratch.txt', 'dirty\n');
  const st = { worktrees: { w: { name: 'w', repo: r.dir } }, claims: { [`${r.dir}#1`]: { issue: '#1', repo: r.dir } } };
  const problems = entryProblems(st, r.dir, 'main');
  // worktree held + claim held + wrong branch + dirty tree — four independent problems, all
  // surfaced at once rather than stopping at the first (§ the whole point of a mechanical gate).
  assert.strictEqual(problems.length, 4, problems.join('\n'));
});

// --- exitProblems -------------------------------------------------------------

test('exitProblems: clean and pushed → clear', () => {
  const r = repo();
  assert.deepStrictEqual(exitProblems(r.dir, 'main'), []);
});

test('exitProblems: uncommitted change refuses', () => {
  const r = repo();
  r.write('README', 'base\nedited\n');
  const problems = exitProblems(r.dir, 'main');
  assert.strictEqual(problems.length, 1);
  assert.match(problems[0], /tree not clean/);
});

test('exitProblems: a local commit not yet pushed refuses', () => {
  const r = repo();
  r.write('thing.txt', 'one\n'); r.commit('feat: thing');
  const problems = exitProblems(r.dir, 'main');
  assert.strictEqual(problems.length, 1);
  assert.match(problems[0], /not pushed to origin\/main/);
});

test('exitProblems: does NOT look at other branches — narrower than the entry gate on purpose', () => {
  const r = repo();
  r.g('checkout', '-q', '-b', 'feat/leftover-1');
  r.write('thing.txt', 'one\n'); r.commit('feat: thing');
  r.g('checkout', '-q', 'main'); // current checkout is clean + pushed
  assert.deepStrictEqual(exitProblems(r.dir, 'main'), []);
});

// --- helpers directly ---------------------------------------------------------

test('unpushedBranches: empty on a freshly pushed repo', () => {
  const r = repo();
  assert.deepStrictEqual(unpushedBranches(r.dir, 'main'), []);
});

test('fullyDirty: counts untracked AND tracked changes, unlike git.js dirtyTracked', () => {
  const r = repo();
  r.write('untracked.txt', 'x\n');
  r.write('README', 'base\nedited\n');
  assert.strictEqual(fullyDirty(r.dir).length, 2);
});
