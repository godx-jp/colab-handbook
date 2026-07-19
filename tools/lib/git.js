'use strict';
/**
 * Thin wrappers over `git` and `gh` via child_process. No dependencies.
 * Every function degrades gracefully: git/gh missing, no remote, not a repo — return null/false,
 * never throw for "environment doesn't have it". Real failures (bad args) still surface.
 */

const { spawnSync } = require('child_process');
const path = require('path');

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  return {
    ok: res.status === 0,
    code: res.status,
    stdout: (res.stdout || '').trim(),
    stderr: (res.stderr || '').trim(),
    error: res.error || null,
  };
}

function git(args, cwd) {
  return run('git', args, cwd ? { cwd } : {});
}

/** Absolute repo root for a path (default cwd), or null if not a git repo. */
function repoRoot(cwd) {
  const r = git(['rev-parse', '--show-toplevel'], cwd);
  return r.ok ? r.stdout : null;
}

/** origin remote URL, or null. */
function originUrl(repo) {
  const r = git(['remote', 'get-url', 'origin'], repo);
  return r.ok && r.stdout ? r.stdout : null;
}

/** Trunk branch name from origin/HEAD, best-effort. */
function detectTrunk(repo) {
  let r = git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], repo);
  if (r.ok && r.stdout) return r.stdout.replace(/^origin\//, '');
  r = git(['remote', 'show', 'origin'], repo);
  if (r.ok) {
    const m = r.stdout.match(/HEAD branch:\s*(\S+)/);
    if (m) {
      git(['remote', 'set-head', 'origin', m[1]], repo); // cache it
      return m[1];
    }
  }
  return null;
}

/** List worktree paths registered in a repo (porcelain). */
function worktreeList(repo) {
  const r = git(['worktree', 'list', '--porcelain'], repo);
  if (!r.ok) return [];
  return r.stdout.split('\n')
    .filter((l) => l.startsWith('worktree '))
    .map((l) => l.slice('worktree '.length));
}

/** Tracked (non-untracked) uncommitted changes in a worktree, or '' if clean. */
function dirtyTracked(wtPath) {
  const r = git(['status', '--porcelain'], wtPath);
  if (!r.ok) return '';
  return r.stdout.split('\n').filter((l) => l && !l.startsWith('??')).join('\n');
}

// ---- gh ----

let _ghAvail = null;
function ghAvailable() {
  if (_ghAvail !== null) return _ghAvail;
  const which = run('gh', ['--version']);
  if (!which.ok) { _ghAvail = false; return false; }
  const auth = run('gh', ['auth', 'status']);
  _ghAvail = auth.ok;
  return _ghAvail;
}

/** gh issue edit — returns {ok, stderr}. cwd must be inside the repo so gh resolves the remote. */
function ghIssueEdit(repo, issueNum, args) {
  return run('gh', ['issue', 'edit', String(issueNum), ...args], { cwd: repo });
}

/**
 * Issues claimed by the current gh user in a repo = assigned to @me AND labeled in-progress
 * (that pairing is exactly what `colab claim` writes). Returns array of numbers, or null on failure.
 */
function ghAssignedIssues(repo) {
  const r = run('gh', ['issue', 'list', '--assignee', '@me', '--label', 'in-progress', '--state', 'open',
    '--json', 'number', '--limit', '200'], { cwd: repo });
  if (!r.ok) return null;
  try { return JSON.parse(r.stdout).map((o) => o.number); }
  catch (_) { return null; }
}

module.exports = {
  run, git, repoRoot, originUrl, detectTrunk, worktreeList, dirtyTracked,
  ghAvailable, ghIssueEdit, ghAssignedIssues,
};
