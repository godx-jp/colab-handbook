'use strict';
/**
 * Thin wrappers over `git` and `gh` via child_process. No dependencies.
 * Every function degrades gracefully: git/gh missing, no remote, not a repo — return null/false,
 * never throw for "environment doesn't have it". Real failures (bad args) still surface.
 */

const { spawnSync } = require('child_process');
const path = require('path');

/**
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs] - bound how long we'll wait (see #62: `git worktree remove` on
 *   a slow/synced volume, or a hook script blocked on a dead network call, used to hang forever
 *   with NO output — indistinguishable from slow-but-working). Omit for the historical unbounded
 *   behavior; every call site that can plausibly block on something outside the repo should pass one.
 */
function run(cmd, args, opts = {}) {
  const { timeoutMs, ...spawnOpts } = opts;
  const res = spawnSync(cmd, args, { encoding: 'utf8', ...(timeoutMs ? { timeout: timeoutMs } : {}), ...spawnOpts });
  const timedOut = !!(res.error && res.error.code === 'ETIMEDOUT');
  return {
    ok: res.status === 0 && !timedOut,
    code: res.status,
    stdout: (res.stdout || '').trim(),
    stderr: timedOut ? `timed out after ${timeoutMs}ms with no output` : (res.stderr || '').trim(),
    error: res.error || null,
    timedOut,
  };
}

function git(args, cwd, opts = {}) {
  return run('git', args, { ...(cwd ? { cwd } : {}), ...opts });
}

/** Absolute repo root for a path (default cwd), or null if not a git repo. */
function repoRoot(cwd) {
  const r = git(['rev-parse', '--show-toplevel'], cwd);
  return r.ok ? r.stdout : null;
}

/**
 * The MAIN working tree's root, even when `cwd` is inside a linked worktree.
 *
 * `repoRoot` answers "which tree am I standing in", which is a different question and the wrong
 * one for anything keyed by repo identity. Claims, ports and worktree records are all stored
 * under the main repo path, so resolving from inside a worktree used to miss every one of them:
 * `colab ship` composed its squash message with an EMPTY issue list and never emitted `Closes #N`,
 * silently, while the issue stayed open with its code merged.
 *
 * `--git-common-dir` is the shared `.git` for every worktree of a repo, so its parent is the main
 * tree. Falls back to `repoRoot` whenever the layout is not the ordinary one (bare repos, a
 * `.git` file that is not named `.git`) rather than guessing.
 */
function mainRepoRoot(cwd) {
  let dir = null;
  // --path-format needs git >= 2.31; fall back to resolving the relative answer ourselves.
  const abs = git(['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd);
  if (abs.ok && abs.stdout) dir = abs.stdout;
  else {
    const rel = git(['rev-parse', '--git-common-dir'], cwd);
    if (rel.ok && rel.stdout) dir = path.resolve(cwd || process.cwd(), rel.stdout);
  }
  if (dir && path.basename(dir) === '.git') return path.dirname(dir);
  return repoRoot(cwd);
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

/**
 * Does a branch name resolve to a ref in this repo — locally, or as origin's copy?
 *
 * The local check alone is not enough: a session on another machine pushed the branch, and a claim
 * naming it is perfectly healthy here. False in this function therefore means "nothing anywhere
 * knows this name", which is the only claim strong enough to refuse a ship over. A falsy branch
 * (null = "no branch") is false without asking git.
 */
function branchExists(repo, branch) {
  if (!branch || typeof branch !== 'string') return false;
  for (const ref of [`refs/heads/${branch}`, `refs/remotes/origin/${branch}`]) {
    if (git(['rev-parse', '--verify', '--quiet', ref], repo).ok) return true;
  }
  return false;
}

/** List worktree paths registered in a repo (porcelain). */
function worktreeList(repo) {
  const r = git(['worktree', 'list', '--porcelain'], repo);
  if (!r.ok) return [];
  return r.stdout.split('\n')
    .filter((l) => l.startsWith('worktree '))
    .map((l) => l.slice('worktree '.length));
}

/**
 * `git worktree list --porcelain`, parsed per-block instead of flattened — a caller that needs
 * "which branch is checked out at THIS path" (not just "is this branch checked out somewhere")
 * needs the path/branch pairing, which a flat line-filter throws away. Returns
 * `[{path, branch, detached, bare}]`; `branch` is null for a detached or bare entry.
 *
 * Ground truth for what worktrees actually exist, independent of anyone's record of them — see
 * `worktreeList` above for the flat form, kept because `shippedBranches` only ever needed "is this
 * branch checked out anywhere" and a block parse would be pure overhead there.
 */
function worktreeListDetailed(repo) {
  const r = git(['worktree', 'list', '--porcelain'], repo);
  if (!r.ok) return [];
  const out = [];
  let cur = null;
  for (const line of r.stdout.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (cur) out.push(cur);
      cur = { path: line.slice('worktree '.length), branch: null, detached: false, bare: false };
    } else if (cur && line.startsWith('branch ')) {
      cur.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
    } else if (cur && line === 'detached') {
      cur.detached = true;
    } else if (cur && line === 'bare') {
      cur.bare = true;
    }
  }
  if (cur) out.push(cur);
  return out;
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

/** The current gh user's login (`gh api user`), or null if it can't be determined. Cached. */
let _ghLogin;
function ghCurrentLogin() {
  if (_ghLogin !== undefined) return _ghLogin;
  const r = run('gh', ['api', 'user', '-q', '.login']);
  _ghLogin = r.ok && r.stdout ? r.stdout : null;
  return _ghLogin;
}

/**
 * `gh issue view N --json <fields>` → parsed object, or null on any failure (gh missing,
 * bad repo, network, unparseable). Callers treat null as "couldn't read" — never as "empty".
 */
function ghIssueView(repo, issueNum, fields) {
  const r = run('gh', ['issue', 'view', String(issueNum), '--json', fields.join(',')], { cwd: repo });
  if (!r.ok) return null;
  try { return JSON.parse(r.stdout); }
  catch (_) { return null; }
}

/** Post a comment on an issue — returns {ok, stderr}. Best-effort at the call sites. */
function ghIssueComment(repo, issueNum, body) {
  return run('gh', ['issue', 'comment', String(issueNum), '--body', body], { cwd: repo });
}

/**
 * The label names defined on a repo's tracker (`gh label list`), or null on any failure (gh
 * missing, no remote, network). Null means "could not read" — never "empty set", the same
 * contract as ghIssueView: a caller must not read absence as proof a label is missing.
 */
function ghListLabels(repo) {
  const r = run('gh', ['label', 'list', '--limit', '500', '--json', 'name', '-q', '.[].name'], { cwd: repo });
  if (!r.ok) return null;
  return r.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
}

/**
 * `gh issue list --label <name> --state <state>` → array of parsed objects (the requested JSON
 * fields), or null on failure (gh missing, no remote, network). Null means "could not read" —
 * the same contract as ghIssueView; a caller must not read a failed call as "no issues".
 */
function ghIssueListByLabel(repo, label, state, fields) {
  const r = run('gh', ['issue', 'list', '--label', label, '--state', state,
    '--json', fields.join(','), '--limit', '200'], { cwd: repo });
  if (!r.ok) return null;
  try { return JSON.parse(r.stdout); }
  catch (_) { return null; }
}

/**
 * `gh label delete <name> --yes` — returns {ok, stderr}. Deletes the LABEL OBJECT from the
 * repo's tracker, not one issue's use of it — every issue that carried it loses it. Callers
 * that mean "remove this label from one issue" want ghIssueEdit(..., ['--remove-label', name])
 * instead; this is only for tearing down a spent `group:<key>` label (CONVENTIONS.md §5).
 */
function ghLabelDelete(repo, name) {
  return run('gh', ['label', 'delete', name, '--yes'], { cwd: repo });
}

/**
 * CI verdict for a branch, judged by SHA rather than by recency (#92).
 *
 * The naive "read the newest run" reading breaks under the repo's own
 * `concurrency: { cancel-in-progress: true }`: two runs can race on one push, one gets cancelled by
 * design, and if THAT one happens to land last, the gate reports red while an identical run on the
 * exact same commit already passed. Nothing inside `colab ship` can clear that — the branch that
 * would produce a newer run is the one the gate is blocking — so it deadlocked every queued ship
 * until a human re-ran the cancelled workflow by hand.
 *
 * Ask the right question instead: does a completed, successful run exist for `branch`'s CURRENT
 * remote head? `git ls-remote` reads that head without touching local refs — this may run before
 * any fetch, mid-precondition. `-L limit` widens the window past "the latest row" because the
 * duplicate this exists for can be two runs deep.
 *
 * Returns { status, conclusion, sha }:
 *   - a run for the head sha completed successfully  → {status:'completed', conclusion:'success', sha}
 *   - the head sha has run(s), none succeeded         → {status, conclusion} of the most informative
 *     one (a still-running row over a finished-but-failed/cancelled one), sha set
 *   - the head sha has no run in the recent window     → {status:'none', conclusion:null, sha}
 *     (still not green — this is also how a billing-style fail-to-start reads: no run was ever
 *     created for the commit that would need one)
 *   - the branch does not exist on origin, or `git`/`gh` failed → null
 *
 * A cancelled sibling of a passing run on the SAME sha is not evidence of anything — it is simply
 * not read, because the passing run for that sha is what answers the question.
 */
function ghRunForSha(repo, branch, limit = 10) {
  const head = run('git', ['ls-remote', 'origin', `refs/heads/${branch}`], { cwd: repo });
  if (!head.ok) return null;
  const sha = (head.stdout.split('\n')[0] || '').split('\t')[0].trim();
  if (!sha) return null; // branch does not exist on origin

  const r = run('gh', ['run', 'list', '--branch', branch, '-L', String(limit), '--json', 'headSha,status,conclusion'], { cwd: repo });
  if (!r.ok) return null;
  let runs;
  try { runs = JSON.parse(r.stdout); } catch (_) { return null; }
  if (!Array.isArray(runs)) return null;

  const forSha = runs.filter((x) => x && x.headSha === sha);
  if (forSha.length === 0) return { status: 'none', conclusion: null, sha };

  const success = forSha.find((x) => x.status === 'completed' && x.conclusion === 'success');
  if (success) return { status: 'completed', conclusion: 'success', sha };

  // None succeeded for this sha — report the most informative row: a run still in flight (it may
  // yet succeed) over a finished-but-not-successful one (gh returns newest-first; forSha[0] is the
  // newest of the non-successes either way).
  const pending = forSha.find((x) => x.status !== 'completed');
  const pick = pending || forSha[0];
  return { status: pick.status, conclusion: pick.conclusion || null, sha };
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
  run, git, repoRoot, mainRepoRoot, originUrl, detectTrunk, branchExists,
  worktreeList, worktreeListDetailed, dirtyTracked,
  ghAvailable, ghIssueEdit, ghListLabels, ghAssignedIssues,
  ghCurrentLogin, ghIssueView, ghIssueComment, ghRunForSha,
  ghIssueListByLabel, ghLabelDelete,
};
