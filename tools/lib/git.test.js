'use strict';
/**
 * Tests for tools/lib/git.js — currently just `worktreeListDetailed` (#67).
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * `worktreeListDetailed` is the ground-truth read `colab worktrees` reconciles its own records
 * against (tools/colab: `unrecordedWorktrees`). Getting the porcelain parse wrong in either
 * direction is exactly the failure #67 is about — a real worktree the parse drops is invisible
 * again, just one function lower — so this is built against real git, like landed.test.js, rather
 * than against a hand-written porcelain fixture that could quietly stop matching git's actual
 * output.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { worktreeListDetailed } = require('./git.js');

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
