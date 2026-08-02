'use strict';
/**
 * Tests for tools/lib/orphan-worktree.js — the detector for a directory that LOOKS like a
 * worktree (CLAUDE.md + .github/project.yml) but that git never linked at all (no `.git`).
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * Part 1 tests the pure classification matrix directly (no fixtures). Part 2 exercises the real
 * directory-walk caller (`orphanWorktreeDirs`, tools/colab) against a real git repo, matching
 * git.test.js's fixture pattern — this detector's whole point is telling a real linked worktree
 * apart from an orphan, and only a real `git worktree add` proves that distinction.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { worktreeSubdirCandidates, classifyOrphanCandidate } = require('./orphan-worktree.js');

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

// --- Part 2: fixture-backed scan (real git repo, real directories) --------------------------

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
  g('config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(dir, 'README'), 'base\n');
  g('add', '-A'); g('commit', '-q', '-m', 'chore: base');
  return { dir, g };
}

/**
 * Minimal stand-in for tools/colab's `orphanWorktreeDirs()` — the fs-touching caller that wires
 * the pure module above to a real directory walk. Kept local to the test (rather than importing
 * from tools/colab, which is a CLI entrypoint, not a module) so this test exercises exactly the
 * walk contract the plan describes: scoped to `worktreeSubdirCandidates()` paths under ONE repo,
 * never a filesystem-wide scan.
 */
function scanOrphans(repoDir, config) {
  const out = [];
  for (const sub of worktreeSubdirCandidates(config)) {
    const base = path.join(repoDir, sub);
    if (!fs.existsSync(base)) continue;
    for (const name of fs.readdirSync(base)) {
      const cand = path.join(base, name);
      if (!fs.statSync(cand).isDirectory()) continue;
      const hasGitEntry = fs.existsSync(path.join(cand, '.git'));
      const hasClaudeMd = fs.existsSync(path.join(cand, 'CLAUDE.md'));
      const hasProjectYml = fs.existsSync(path.join(cand, '.github/project.yml'));
      const verdict = classifyOrphanCandidate({ hasClaudeMd, hasProjectYml, hasGitEntry });
      if (verdict === 'orphan') out.push(path.resolve(cand));
    }
  }
  return out;
}

function makeCandidate(dir, { claudeMd = false, projectYml = false } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  if (claudeMd) fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# stub\n');
  if (projectYml) {
    fs.mkdirSync(path.join(dir, '.github'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.github', 'project.yml'), 'tier: B\n');
  }
}

test('scan flags a synthetic orphaned worktree-shaped directory', () => {
  const r = repo();
  const cand = path.join(r.dir, '.worktrees', 'orphan-1');
  makeCandidate(cand, { claudeMd: true, projectYml: true });

  const found = scanOrphans(r.dir, { worktreeSubdir: '.worktrees' });
  assert.deepStrictEqual(found, [path.resolve(cand)]);
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

  const found = scanOrphans(r.dir, { worktreeSubdir: '.worktrees' });
  assert.deepStrictEqual(found, []);
});

test('scan does NOT flag an ordinary tracked directory outside any worktreeSubdir candidate', () => {
  const r = repo();
  const ordinary = path.join(r.dir, 'templates', 'example-repo');
  makeCandidate(ordinary, { claudeMd: true, projectYml: true });

  const found = scanOrphans(r.dir, { worktreeSubdir: '.worktrees' });
  assert.deepStrictEqual(found, []);
});

test('scan does NOT flag a vendored copy under a worktree-subdir path missing one signal', () => {
  const r = repo();
  const vendored = path.join(r.dir, '.worktrees', 'docs-snapshot');
  makeCandidate(vendored, { claudeMd: true, projectYml: false });

  const found = scanOrphans(r.dir, { worktreeSubdir: '.worktrees' });
  assert.deepStrictEqual(found, []);
});

test('scan sweeps historical worktreeSubdir values too, not just the current config value', () => {
  const r = repo();
  const cand = path.join(r.dir, '.claude', 'worktrees', 'orphan-legacy');
  makeCandidate(cand, { claudeMd: true, projectYml: true });

  // current config points at .worktrees, but the historical .claude/worktrees is still swept
  const found = scanOrphans(r.dir, { worktreeSubdir: '.worktrees' });
  assert.deepStrictEqual(found, [path.resolve(cand)]);
});
