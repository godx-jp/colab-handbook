'use strict';
/**
 * Tests for tools/lib/git.js — `worktreeListDetailed` (#67), the dirty-tree readings (#86), and
 * `ghRunForSha` (#92).
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * `worktreeListDetailed` is the ground-truth read `colab worktrees` reconciles its own records
 * against (tools/colab: `unrecordedWorktrees`). Getting the porcelain parse wrong in either
 * direction is exactly the failure #67 is about — a real worktree the parse drops is invisible
 * again, just one function lower — so this is built against real git, like landed.test.js, rather
 * than against a hand-written porcelain fixture that could quietly stop matching git's actual
 * output.
 *
 * `ghRunForSha` is the CI verdict `colab ship`'s gate reads, judged by the branch's CURRENT remote
 * head sha rather than by "the newest run" (#92). `git ls-remote` runs for real against a bare `origin` on disk (no network). `gh run list` is
 * network-bound and cannot run for real in a test, so a fake `gh` is placed first on PATH,
 * printing canned JSON from a file the test writes before each call. The property under test is
 * "given these {headSha,status,conclusion} rows, does ghRunForSha read the right one" — not gh's
 * own behaviour, which is out of scope here.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const git = require('./git.js');
const { worktreeListDetailed, dirtyTracked, dirtyUntracked, dirtyAny } = git;

const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

// realpath, not just mkdtemp: on macOS `/tmp` is a symlink to `/private/tmp`, so git (which
// resolves paths for real) and a bare os.tmpdir() string disagree on what "the same path" is
// unless both sides are normalised the same way.
function tmp(prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  TMP.push(dir);
  return dir;
}

function repo() {
  const dir = tmp('git-test-');
  const g = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q', '-b', 'main', '.');
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'git test');
  g('config', 'core.hooksPath', path.join(dir, '.nohooks'));
  g('config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(dir, 'README'), 'base\n');
  g('add', '-A'); g('commit', '-q', '-m', 'chore: base');
  return { dir, g };
}

test('main checkout only: one entry, branch main, not detached', () => {
  const r = repo();
  const rows = worktreeListDetailed(r.dir);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(path.resolve(rows[0].path), path.resolve(r.dir));
  assert.strictEqual(rows[0].branch, 'main');
  assert.strictEqual(rows[0].detached, false);
  assert.strictEqual(rows[0].bare, false);
});

test('a linked worktree is a second entry with its OWN path and branch', () => {
  const r = repo();
  const wtDir = tmp('git-test-wt-');
  fs.rmdirSync(wtDir); // `git worktree add` refuses an existing empty dir on some git versions; start clean
  r.g('worktree', 'add', '-b', 'feat/thing', wtDir);

  const rows = worktreeListDetailed(r.dir);
  assert.strictEqual(rows.length, 2);
  const linked = rows.find((w) => path.resolve(w.path) !== path.resolve(r.dir));
  assert.ok(linked, 'linked worktree missing from the parse');
  assert.strictEqual(path.resolve(linked.path), path.resolve(wtDir));
  assert.strictEqual(linked.branch, 'feat/thing');
  assert.strictEqual(linked.detached, false);
});

test('a detached worktree reports branch: null, detached: true — never a guessed branch name', () => {
  const r = repo();
  const sha = r.g('rev-parse', 'HEAD').trim();
  const wtDir = tmp('git-test-wt-');
  fs.rmdirSync(wtDir);
  r.g('worktree', 'add', '--detach', wtDir, sha);

  const rows = worktreeListDetailed(r.dir);
  const linked = rows.find((w) => path.resolve(w.path) !== path.resolve(r.dir));
  assert.ok(linked);
  assert.strictEqual(linked.branch, null);
  assert.strictEqual(linked.detached, true);
});

test('a non-repo path returns [] rather than throwing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-test-notrepo-'));
  TMP.push(dir);
  assert.deepStrictEqual(worktreeListDetailed(dir), []);
});

// --- dirty readings (#86) -----------------------------------------------------
//
// The regression these pin is a DATA-LOSS one, so they are written against real git rather than a
// porcelain fixture: the bug was a disagreement about what `git status` actually emits, and a
// hand-written fixture would have agreed with the buggy reading.

test('#86 REGRESSION: a never-added file is invisible to dirtyTracked but caught by dirtyUntracked', () => {
  const r = repo();
  // The exact shape of a session's first hour: new module + new test, neither staged. There is no
  // copy in the index, in a commit, or on a remote — a teardown here destroys them outright.
  fs.writeFileSync(path.join(r.dir, 'checklist.js'), 'module.exports = {};\n');
  fs.writeFileSync(path.join(r.dir, 'checklist.test.js'), '// tests\n');

  assert.strictEqual(dirtyTracked(r.dir), '', 'tracked reading must stay clean — this is the blind spot');
  const untracked = dirtyUntracked(r.dir);
  assert.match(untracked, /checklist\.js/);
  assert.match(untracked, /checklist\.test\.js/);
  assert.strictEqual(untracked.split('\n').length, 2);
});

test('#86: dirtyAny is the union — tracked edits AND untracked files', () => {
  const r = repo();
  fs.writeFileSync(path.join(r.dir, 'README'), 'base\nedited\n');
  fs.writeFileSync(path.join(r.dir, 'brand-new.js'), 'x\n');

  assert.match(dirtyTracked(r.dir), /README/);
  assert.match(dirtyUntracked(r.dir), /brand-new\.js/);
  assert.strictEqual(dirtyAny(r.dir).split('\n').length, 2);
});

test('#86: IGNORED files stay excluded — build output must not block a teardown', () => {
  const r = repo();
  fs.writeFileSync(path.join(r.dir, '.gitignore'), 'node_modules/\n.env\ndist/\n');
  r.g('add', '-A'); r.g('commit', '-q', '-m', 'chore: ignore');
  fs.mkdirSync(path.join(r.dir, 'node_modules'));
  fs.writeFileSync(path.join(r.dir, 'node_modules', 'pkg.js'), 'x\n');
  fs.writeFileSync(path.join(r.dir, '.env'), 'SECRET=1\n');

  // A worktree post-create hook legitimately produces these. Counting them would make every
  // worktree permanently un-removable without --force, which is how a safety gate gets disabled.
  assert.strictEqual(dirtyUntracked(r.dir), '');
  assert.strictEqual(dirtyAny(r.dir), '');
});

test('#86: -uall names the FILES in a new directory, not the collapsed directory', () => {
  const r = repo();
  fs.mkdirSync(path.join(r.dir, 'newmod'));
  fs.writeFileSync(path.join(r.dir, 'newmod', 'a.js'), 'a\n');
  fs.writeFileSync(path.join(r.dir, 'newmod', 'b.js'), 'b\n');

  // Default porcelain would emit a single `?? newmod/`. The gate is about to delete these, and a
  // directory name does not tell a human which of their new sources is at stake.
  const untracked = dirtyUntracked(r.dir);
  assert.match(untracked, /newmod\/a\.js/);
  assert.match(untracked, /newmod\/b\.js/);
});

test('#86: a clean tree reads clean on all three', () => {
  const r = repo();
  assert.strictEqual(dirtyTracked(r.dir), '');
  assert.strictEqual(dirtyUntracked(r.dir), '');
  assert.strictEqual(dirtyAny(r.dir), '');
});

test('#86: a path git cannot read degrades to clean, so a husk stays removable', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-test-notrepo-'));
  TMP.push(dir);
  fs.writeFileSync(path.join(dir, 'orphan.txt'), 'x\n');
  // Deliberate, not fail-open-by-accident: `git status` failing where the directory exists means a
  // worktree that is no longer a worktree (#62's husk), and refusing there would strand it forever.
  assert.strictEqual(dirtyAny(dir), '');
});

// --- ghRunForSha (#92) ---------------------------------------------------------

/**
 * A repo with a real bare `origin`, one commit pushed to `main`. Returns the repo's work dir, its
 * HEAD sha, and `withFakeGh(runs, fn)` which points PATH at a `gh` stub returning `runs` as
 * `gh run list --json headSha,status,conclusion` would, for the duration of `fn`.
 */
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-ghrun-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { encoding: 'utf8' });
  execFileSync('git', ['init', '-q', '-b', 'main', work], { encoding: 'utf8' });
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'ghrun test');
  g(work, 'remote', 'add', 'origin', origin);
  fs.writeFileSync(path.join(work, 'f.txt'), 'x\n');
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', 'chore: fixture');
  g(work, 'push', '-q', 'origin', 'main');
  const sha = g(work, 'rev-parse', 'HEAD').trim();

  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  const runsFile = path.join(root, 'runs.json');
  fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/sh\ncat "${runsFile}"\n`, { mode: 0o755 });
  // a `gh` that always fails, for the "gh run list failed" case
  const failBin = path.join(root, 'bin-fail');
  fs.mkdirSync(failBin);
  fs.writeFileSync(path.join(failBin, 'gh'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });

  function withFakeGh(runs, binDir, fn) {
    if (runs !== null) fs.writeFileSync(runsFile, JSON.stringify(runs));
    const prevPath = process.env.PATH;
    process.env.PATH = `${binDir}:${prevPath}`;
    try { return fn(); } finally { process.env.PATH = prevPath; }
  }

  return { work, sha, withFakeGh: (runs, fn) => withFakeGh(runs, bin, fn), withFailingGh: (fn) => withFakeGh([], failBin, fn) };
}

test('a cancelled sibling of a passing run on the SAME sha still reads green (#92, the deadlock case)', () => {
  const fx = fixture();
  // gh returns newest-first: the cancelled duplicate is row 0, the passing original is row 1 —
  // exactly the shape measured on the issue (two runs racing on one push, cancel-in-progress kills one).
  const result = fx.withFakeGh([
    { headSha: fx.sha, status: 'completed', conclusion: 'cancelled' },
    { headSha: fx.sha, status: 'completed', conclusion: 'success' },
  ], () => git.ghRunForSha(fx.work, 'main'));
  assert.deepStrictEqual(result, { status: 'completed', conclusion: 'success', sha: fx.sha });
});

test('a stale run on an OLD sha does not count as green for the current head', () => {
  const fx = fixture();
  const result = fx.withFakeGh([
    { headSha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef', status: 'completed', conclusion: 'success' },
  ], () => git.ghRunForSha(fx.work, 'main'));
  assert.deepStrictEqual(result, { status: 'none', conclusion: null, sha: fx.sha });
});

test('the sha has runs but none succeeded — surfaces the most informative one, not a false none', () => {
  const fx = fixture();
  const result = fx.withFakeGh([
    { headSha: fx.sha, status: 'completed', conclusion: 'failure' },
  ], () => git.ghRunForSha(fx.work, 'main'));
  assert.deepStrictEqual(result, { status: 'completed', conclusion: 'failure', sha: fx.sha });
});

test('a run still in flight for the sha is preferred over a finished-but-not-successful one', () => {
  const fx = fixture();
  const result = fx.withFakeGh([
    { headSha: fx.sha, status: 'in_progress', conclusion: null },
    { headSha: fx.sha, status: 'completed', conclusion: 'cancelled' },
  ], () => git.ghRunForSha(fx.work, 'main'));
  assert.strictEqual(result.status, 'in_progress');
  assert.strictEqual(result.sha, fx.sha);
});

test('a branch absent on origin returns null rather than a misleading verdict', () => {
  const fx = fixture();
  const result = fx.withFakeGh([{ headSha: fx.sha, status: 'completed', conclusion: 'success' }],
    () => git.ghRunForSha(fx.work, 'no-such-branch'));
  assert.strictEqual(result, null);
});

test('gh failing returns null, distinct from "no runs for this sha"', () => {
  const fx = fixture();
  const result = fx.withFailingGh(() => git.ghRunForSha(fx.work, 'main'));
  assert.strictEqual(result, null);
});
