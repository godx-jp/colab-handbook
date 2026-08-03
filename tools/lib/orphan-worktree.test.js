'use strict';
/**
 * Tests for tools/lib/orphan-worktree.js — the detector for a directory that LOOKS like a
 * worktree (CLAUDE.md + .github/project.yml) but that git never linked at all (no `.git`).
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * Part 1 tests the pure classification matrix directly (no fixtures). Part 2 exercises the SHIPPED
 * walk, `scanForOrphans` — imported from this module, not reimplemented here (#107: a test-local
 * copy of the walk pins nothing about the code the CLI actually runs; five tests here used to do
 * exactly that, silently, and would have stayed green through a change to the shipped walk's
 * candidate paths, signal set, or return shape). Matches git.test.js's fixture pattern — this
 * detector's whole point is telling a real linked worktree apart from an orphan, and only a real
 * `git worktree add` proves that distinction. Part 3 drives the real `colab worktrees --json` CLI
 * against a fixture repo, pinning the JSON shape's `orphaned` key (also #107).
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const { worktreeSubdirCandidates, classifyOrphanCandidate, scanForOrphans } = require('./orphan-worktree.js');
const git = require('./git.js');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const COLAB = path.join(REPO_ROOT, 'tools', 'colab');

// --- Part 1: pure classification, no fs -----------------------------------------------------

test('classifyOrphanCandidate: both signals present, no .git -> orphan', () => {
  assert.strictEqual(
    classifyOrphanCandidate({ hasClaudeMd: true, hasProjectYml: true, hasGitEntry: false }),
    'orphan',
  );
});

test('classifyOrphanCandidate: .git present -> linked, regardless of the other two signals', () => {
  assert.strictEqual(classifyOrphanCandidate({ hasClaudeMd: true, hasProjectYml: true, hasGitEntry: true }), 'linked');
  assert.strictEqual(classifyOrphanCandidate({ hasClaudeMd: false, hasProjectYml: false, hasGitEntry: true }), 'linked');
});

test('classifyOrphanCandidate: only CLAUDE.md, no .git -> not-worktree-shaped (single signal insufficient)', () => {
  assert.strictEqual(
    classifyOrphanCandidate({ hasClaudeMd: true, hasProjectYml: false, hasGitEntry: false }),
    'not-worktree-shaped',
  );
});

test('classifyOrphanCandidate: only project.yml, no .git -> not-worktree-shaped', () => {
  assert.strictEqual(
    classifyOrphanCandidate({ hasClaudeMd: false, hasProjectYml: true, hasGitEntry: false }),
    'not-worktree-shaped',
  );
});

test('classifyOrphanCandidate: neither signal, no .git -> not-worktree-shaped', () => {
  assert.strictEqual(
    classifyOrphanCandidate({ hasClaudeMd: false, hasProjectYml: false, hasGitEntry: false }),
    'not-worktree-shaped',
  );
});

test('worktreeSubdirCandidates: includes today\'s config value plus known historical values, deduped', () => {
  const c = worktreeSubdirCandidates({ worktreeSubdir: '.worktrees' });
  assert.deepStrictEqual(c, ['.worktrees', '.claude/worktrees']);
});

test('worktreeSubdirCandidates: a custom config value is included alongside the historical ones', () => {
  const c = worktreeSubdirCandidates({ worktreeSubdir: 'wt' });
  assert.deepStrictEqual(c, ['wt', '.worktrees', '.claude/worktrees']);
});

test('worktreeSubdirCandidates: missing config falls back to the package default, still deduped', () => {
  const c = worktreeSubdirCandidates({});
  assert.deepStrictEqual(c, ['.worktrees', '.claude/worktrees']);
});

// --- Part 2: fixture-backed scan (real git repo, real directories, the SHIPPED walk) --------

const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

function tmp(prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  TMP.push(dir);
  return dir;
}

function repo() {
  const dir = tmp('orphan-wt-test-');
  const g = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q', '-b', 'main', '.');
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'orphan-worktree test');
  // Identity and hooks are set locally: the machine's global config must not decide whether this
  // fixture can commit, and a global `core.hooksPath` (this handbook installs one) would run the
  // repo's own pre-commit guard inside a fixture that is not a real project (#108 — this was the
  // only git-fixture helper in tools/lib/ missing this line; 5 of 13 tests here went red against a
  // hostile global hooksPath before this was added).
  g('config', 'core.hooksPath', path.join(dir, '.nohooks'));
  g('config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(dir, 'README'), 'base\n');
  g('add', '-A'); g('commit', '-q', '-m', 'chore: base');
  return { dir, g };
}

function makeCandidate(dir, { claudeMd = false, projectYml = false } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  if (claudeMd) fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# stub\n');
  if (projectYml) {
    fs.mkdirSync(path.join(dir, '.github'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.github', 'project.yml'), 'tier: B\n');
  }
}

/** Every path `git worktree list` reports for `repoDir`, resolved — the cross-check `scanForOrphans`
 * takes as `linkedPaths` (#106), built the same way tools/colab's `orphanWorktreeDirs()` builds it.
 */
function linkedPathsFor(repoDir) {
  const out = new Set();
  for (const w of git.worktreeListDetailed(repoDir)) {
    if (w.bare) continue;
    out.add(path.resolve(w.path));
  }
  return out;
}

test('scan flags a synthetic orphaned worktree-shaped directory', () => {
  const r = repo();
  const cand = path.join(r.dir, '.worktrees', 'orphan-1');
  makeCandidate(cand, { claudeMd: true, projectYml: true });

  const found = scanForOrphans([r.dir], { worktreeSubdir: '.worktrees' });
  assert.deepStrictEqual(found, [{ repo: r.dir, path: path.resolve(cand) }]);
});

test('scan does NOT flag a real linked worktree (it has a real .git file)', () => {
  const r = repo();
  const wtDir = path.join(r.dir, '.worktrees', 'real-1');
  fs.mkdirSync(path.join(r.dir, '.worktrees'), { recursive: true });
  r.g('worktree', 'add', '-b', 'feat/thing', wtDir);
  // give it worktree-shaped files too, on top of the real .git — must still not be flagged
  fs.writeFileSync(path.join(wtDir, 'CLAUDE.md'), '# stub\n');
  fs.mkdirSync(path.join(wtDir, '.github'), { recursive: true });
  fs.writeFileSync(path.join(wtDir, '.github', 'project.yml'), 'tier: B\n');

  const found = scanForOrphans([r.dir], { worktreeSubdir: '.worktrees' });
  assert.deepStrictEqual(found, []);
});

test('scan does NOT flag a husk — a real worktree whose .git file was lost mid-teardown (#106)', () => {
  const r = repo();
  const wtDir = path.join(r.dir, '.worktrees', 'husk-1');
  fs.mkdirSync(path.join(r.dir, '.worktrees'), { recursive: true });
  r.g('worktree', 'add', '-b', 'feat/husk', wtDir);
  fs.writeFileSync(path.join(wtDir, 'CLAUDE.md'), '# stub\n');
  fs.mkdirSync(path.join(wtDir, '.github'), { recursive: true });
  fs.writeFileSync(path.join(wtDir, '.github', 'project.yml'), 'tier: B\n');
  // Simulate an interrupted `worktree rm`: the .git FILE inside the worktree is gone, but the
  // admin entry under the main repo's .git/worktrees/ still exists, so git keeps listing it
  // (prunable) — the wrong belief this issue fixes is "no .git file means git never linked it".
  fs.rmSync(path.join(wtDir, '.git'));

  const listed = git.worktreeListDetailed(r.dir);
  assert.ok(listed.some((w) => path.resolve(w.path) === path.resolve(wtDir)),
    'fixture invalid: git worktree list must still report the husk for this test to mean anything');

  const found = scanForOrphans([r.dir], { worktreeSubdir: '.worktrees' }, { linkedPaths: linkedPathsFor(r.dir) });
  assert.deepStrictEqual(found, []);
});

test('without the cross-check, that same husk WOULD be flagged — pinning what #106 actually fixed', () => {
  const r = repo();
  const wtDir = path.join(r.dir, '.worktrees', 'husk-2');
  fs.mkdirSync(path.join(r.dir, '.worktrees'), { recursive: true });
  r.g('worktree', 'add', '-b', 'feat/husk-2', wtDir);
  fs.writeFileSync(path.join(wtDir, 'CLAUDE.md'), '# stub\n');
  fs.mkdirSync(path.join(wtDir, '.github'), { recursive: true });
  fs.writeFileSync(path.join(wtDir, '.github', 'project.yml'), 'tier: B\n');
  fs.rmSync(path.join(wtDir, '.git'));

  const found = scanForOrphans([r.dir], { worktreeSubdir: '.worktrees' }); // no linkedPaths
  assert.deepStrictEqual(found, [{ repo: r.dir, path: path.resolve(wtDir) }]);
});

test('scan does NOT flag an ordinary tracked directory outside any worktreeSubdir candidate', () => {
  const r = repo();
  const ordinary = path.join(r.dir, 'templates', 'example-repo');
  makeCandidate(ordinary, { claudeMd: true, projectYml: true });

  const found = scanForOrphans([r.dir], { worktreeSubdir: '.worktrees' });
  assert.deepStrictEqual(found, []);
});

test('scan does NOT flag a vendored copy under a worktree-subdir path missing one signal', () => {
  const r = repo();
  const vendored = path.join(r.dir, '.worktrees', 'docs-snapshot');
  makeCandidate(vendored, { claudeMd: true, projectYml: false });

  const found = scanForOrphans([r.dir], { worktreeSubdir: '.worktrees' });
  assert.deepStrictEqual(found, []);
});

test('scan sweeps historical worktreeSubdir values too, not just the current config value', () => {
  const r = repo();
  const cand = path.join(r.dir, '.claude', 'worktrees', 'orphan-legacy');
  makeCandidate(cand, { claudeMd: true, projectYml: true });

  // current config points at .worktrees, but the historical .claude/worktrees is still swept
  const found = scanForOrphans([r.dir], { worktreeSubdir: '.worktrees' });
  assert.deepStrictEqual(found, [{ repo: r.dir, path: path.resolve(cand) }]);
});

// --- Part 3: the real CLI, `colab worktrees --json` — the `orphaned` shape (#107) ------------

/** A repo with a real bare `origin` (colab's `worktree new` needs one to fetch from) and a
 * private COLAB_HOME, matching colab-base.test.js's fixture pattern. */
function cliFixture() {
  const root = tmp('orphan-wt-cli-');
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  fs.mkdirSync(home);
  const g = (...args) => execFileSync('git', args, { cwd: work, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { encoding: 'utf8' });
  execFileSync('git', ['init', '-q', '-b', 'main', work], { encoding: 'utf8' });
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'orphan-worktree cli test');
  g('config', 'core.hooksPath', path.join(root, '.nohooks'));
  g('remote', 'add', 'origin', origin);
  fs.mkdirSync(path.join(work, '.github'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\n');
  g('add', '-A');
  g('commit', '-q', '-m', 'chore: fixture');
  g('push', '-q', 'origin', 'main');
  return { root, origin, work, home };
}

function colabWorktreesJson(fx) {
  const r = spawnSync('node', [COLAB, 'worktrees', '--json'], {
    cwd: fx.work,
    encoding: 'utf8',
    env: { ...process.env, COLAB_HOME: fx.home, COLAB_SESSION: '', COLAB_SESSION_NAME: '' },
  });
  assert.strictEqual(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test('`colab worktrees --json` shape carries `orphaned` — present and additive, empty when clean', () => {
  const fx = cliFixture();
  const out = colabWorktreesJson(fx);
  assert.ok(Object.prototype.hasOwnProperty.call(out, 'worktrees'), 'worktrees key missing');
  assert.ok(Object.prototype.hasOwnProperty.call(out, 'unrecorded'), 'unrecorded key missing');
  assert.ok(Object.prototype.hasOwnProperty.call(out, 'orphaned'), 'orphaned key missing');
  assert.deepStrictEqual(out.orphaned, []);
});

test('`colab worktrees --json` reports a real orphan directory in `orphaned`', () => {
  const fx = cliFixture();
  const cand = path.join(fx.work, '.worktrees', 'orphan-cli-1');
  makeCandidate(cand, { claudeMd: true, projectYml: true });

  const out = colabWorktreesJson(fx);
  assert.strictEqual(out.orphaned.length, 1);
  assert.strictEqual(path.resolve(out.orphaned[0].path), path.resolve(cand));
});
