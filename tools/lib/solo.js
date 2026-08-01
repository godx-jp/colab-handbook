'use strict';
/**
 * Solo flow (CONVENTIONS.md, "Solo flow") — the entry/exit gate `colab solo` runs.
 *
 * Extracted from tools/colab so the gate is testable against a REAL git repo (same reason
 * lib/landed.js is a module and not inline in the CLI): the whole point of this gate is "never
 * an honor system", so its answer has to be measured against git's actual state, not a mock that
 * agrees with whatever we believed when we wrote it.
 *
 * Pure with respect to state.json: every function here takes the loaded state object (or its
 * relevant slice) as a parameter and returns a verdict; nothing in this module reads or writes
 * ~/.colab/state.json itself — that stays tools/colab's job, same split as lib/readiness.js.
 */

const git = require('./git');

/**
 * Local branches carrying commits their upstream (or, absent one, `origin/<trunk>`) does not have.
 * Returns `[{branch, reason}]` — empty means every local branch is fully pushed.
 *
 * Checked against ALL local branches, not just the current one: a forgotten feature branch sitting
 * unpushed beside the trunk checkout is exactly the kind of "was somebody already partway into
 * something here" fact solo flow's entry gate exists to catch, and it would be invisible to a check
 * that only looked at HEAD.
 */
function unpushedBranches(repoAbs, trunk) {
  const r = git.git(['for-each-ref', '--format=%(refname:short)', 'refs/heads/'], repoAbs);
  if (!r.ok) return [];
  const out = [];
  for (const b of r.stdout.split('\n').map((s) => s.trim()).filter(Boolean)) {
    const up = git.git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', `${b}@{u}`], repoAbs);
    const remoteRef = up.ok && up.stdout ? up.stdout : `origin/${trunk}`;
    if (!git.git(['rev-parse', '--verify', '--quiet', remoteRef], repoAbs).ok) {
      out.push({ branch: b, reason: `no upstream and no ${remoteRef} — never pushed` });
      continue;
    }
    const ahead = git.git(['rev-list', '--count', `${remoteRef}..${b}`], repoAbs);
    const n = ahead.ok ? (parseInt(ahead.stdout, 10) || 0) : 0;
    if (n > 0) out.push({ branch: b, reason: `${n} commit(s) ahead of ${remoteRef}` });
  }
  return out;
}

/**
 * `git status --porcelain`, tracked AND untracked. Solo's "clean tree" is deliberately the
 * stricter reading (lib/git.js's `dirtyTracked` ignores untracked cruft, which is right for a
 * ship precondition but wrong here — solo flow's whole premise is "this checkout has nothing
 * anyone else needs to know about", and an untracked file is exactly the kind of thing a returning
 * session would otherwise have to notice by eye).
 *
 * #86: this is now a thin adapter over `git.dirtyAny` rather than its own porcelain call. It was
 * written here first, which is how the repo ended up with two independent implementations of one
 * reading — and only this copy counted untracked files, while the teardown gate that most needed
 * them did not. Keeps the array shape solo's callers and tests expect.
 */
function fullyDirty(repoAbs) {
  const d = git.dirtyAny(repoAbs);
  return d ? d.split('\n').filter(Boolean) : [];
}

/**
 * Entry-gate problems for `colab solo` in `repoAbs`, given the already-loaded state and the repo's
 * resolved trunk. Empty array = clear to open solo flow. Never throws; every check degrades to "no
 * problem found" if git itself is unavailable, because a missing git is a bigger failure the CLI
 * surfaces elsewhere, not a reason to silently claim the tree is dirty.
 */
function entryProblems(st, repoAbs, trunk) {
  const problems = [];

  const wts = Object.values((st && st.worktrees) || {}).filter((w) => w.repo === repoAbs);
  if (wts.length) problems.push(`worktree(s) held: ${wts.map((w) => w.name).join(', ')}`);

  const claims = Object.entries((st && st.claims) || {}).filter(([k]) => k.startsWith(`${repoAbs}#`));
  if (claims.length) problems.push(`claim(s) held: ${claims.map(([, c]) => c.issue).join(', ')}`);

  const cur = git.git(['branch', '--show-current'], repoAbs);
  if (cur.ok && cur.stdout && cur.stdout !== trunk) {
    problems.push(`checked out on "${cur.stdout}", not trunk "${trunk}" — solo commits go straight to trunk`);
  }

  for (const u of unpushedBranches(repoAbs, trunk)) problems.push(`unpushed branch "${u.branch}" (${u.reason})`);

  const dirty = fullyDirty(repoAbs);
  if (dirty.length) problems.push(`tree not clean (${dirty.length} path(s) — tracked or untracked)`);

  return problems;
}

/**
 * Exit-gate problems for `colab solo --done`: tree clean, and the checked-out branch fully pushed
 * to `origin/<trunk>`. Deliberately narrower than the entry gate — `--done` is closing THIS
 * checkout's work, not re-auditing every local branch in the repo.
 */
function exitProblems(repoAbs, trunk) {
  const problems = [];

  const dirty = fullyDirty(repoAbs);
  if (dirty.length) problems.push(`tree not clean (${dirty.length} path(s)) — commit or discard first`);

  const cur = git.git(['branch', '--show-current'], repoAbs);
  const branchName = cur.ok && cur.stdout ? cur.stdout : trunk;
  const upstreamRef = `origin/${trunk}`;
  if (git.git(['rev-parse', '--verify', '--quiet', upstreamRef], repoAbs).ok) {
    const ahead = git.git(['rev-list', '--count', `${upstreamRef}..${branchName}`], repoAbs);
    const n = ahead.ok ? (parseInt(ahead.stdout, 10) || 0) : 0;
    if (n > 0) problems.push(`${n} commit(s) not pushed to ${upstreamRef} — push before closing`);
  }

  return problems;
}

module.exports = { unpushedBranches, fullyDirty, entryProblems, exitProblems };
