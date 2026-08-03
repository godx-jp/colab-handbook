'use strict';
/**
 * Detecting a directory that LOOKS like a worktree but that git never linked at all — no `.git`
 * file or directory inside it, so it never appears in `git worktree list` and is therefore
 * invisible to `unrecordedWorktrees()` (tools/colab), which reconciles disk against records only
 * for paths git already knows about (#67's blind spot is the mirror of this one: a record naming
 * a vanished directory, not a directory naming no record).
 *
 * #97 found the shape and fixed the actual corruption risk (an un-ignored path) plus corrected
 * `code-sweep`'s completeness claim to admit this blind spot; #99 (this module) is the detector.
 *
 * `classifyOrphanCandidate` is pure decision logic — booleans in, a verdict out — and is
 * unit-testable without a real repo or a real filesystem walk. `scanForOrphans` is the walk that
 * finds candidates and calls it; it used to live only in tools/colab (a CLI entrypoint, not a
 * module) with its own test-local reimplementation, which meant the shipped walk was never
 * actually exercised (#107). It moved here, behind injectable fs primitives, for the same reason
 * classification was extracted one layer down: so it can be called directly by both the CLI and
 * its tests, with one implementation instead of two.
 */

const fs = require('fs');
const path = require('path');

/**
 * Candidate subdirectory names that might hold worktrees for a given repo, in the SAME repo-scoped
 * sense `unrecordedWorktrees()` already uses — never a filesystem-wide scan. `config.worktreeSubdir`
 * is a machine-global setting (`~/.colab/config.json`, see tools/lib/state.js), not per-repo, so an
 * orphan left behind under a value the config used to hold (before someone ran `colab config set
 * worktreeSubdir <x>`) would otherwise be permanently invisible to a scan keyed only off today's
 * config. Include the current value plus known historical ones so a config change doesn't strand
 * old orphans outside the swept set.
 *
 * @param {{worktreeSubdir?: string}} config
 * @returns {string[]} deduped, in stable order (today's config value first)
 */
function worktreeSubdirCandidates(config) {
  const today = (config && config.worktreeSubdir) || '.worktrees';
  const historical = ['.worktrees', '.claude/worktrees'];
  const out = [];
  for (const v of [today, ...historical]) {
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

/**
 * Classify one candidate directory found under a `worktreeSubdirCandidates()` path.
 *
 * Requires BOTH `CLAUDE.md` AND `.github/project.yml` present to call something "worktree-shaped"
 * — either signal alone is too weak and produces false positives that would make this detector
 * noise rather than signal:
 *   - `CLAUDE.md` alone hits any stray doc copy (a template, an example, a docs snapshot) that has
 *     nothing to do with a worktree.
 *   - `.github/project.yml` alone hits a vendored/backup copy of a repo's config with no other
 *     worktree characteristics.
 * Requiring both narrows the match to "a full copy of an adopting repo's tracked tree", which is
 * what a real worktree actually is (mirrors audit.mjs's own `isLinkedWorktree()` reasoning: look
 * for the shape colab's own worktrees have, not a single loose file).
 *
 * @param {object} shape
 * @param {boolean} shape.hasClaudeMd
 * @param {boolean} shape.hasProjectYml
 * @param {boolean} shape.hasGitEntry - does `<candidate>/.git` exist (file OR directory)? If so,
 *   git already knows about this directory one way or another (a linked worktree, or a nested full
 *   clone) — not this detector's problem regardless of the other two signals.
 * @returns {'orphan'|'linked'|'not-worktree-shaped'}
 */
function classifyOrphanCandidate({ hasClaudeMd, hasProjectYml, hasGitEntry }) {
  if (hasGitEntry) return 'linked';
  if (hasClaudeMd && hasProjectYml) return 'orphan';
  return 'not-worktree-shaped';
}

/**
 * Walk `worktreeSubdirCandidates()` paths under each of `repos` and return every candidate
 * `classifyOrphanCandidate` calls `'orphan'` — scoped exactly the way tools/colab's
 * `knownReposFor()` already scopes its callers, never a filesystem-wide scan.
 *
 * `opts.linkedPaths`, if given, is a `Set` of resolved paths git already lists for these repos
 * (`git.worktreeListDetailed()` in tools/colab, which requires git — kept out of this module so
 * it stays fs-only and independently testable). A candidate in that set is skipped before
 * classification even runs (#106): a worktree whose `.git` FILE was lost mid-teardown still keeps
 * its admin entry in the main repo's `.git/worktrees/`, so `git worktree list` still reports it —
 * `prunable (gitdir file points to non-existent location)` — even though `hasGitEntry` would read
 * false. That husk satisfies every one of the three booleans the classifier tests and is not an
 * orphan at all: git already knows about it, however broken its state. Without the cross-check the
 * same directory would be reported twice, once by `unrecordedWorktrees()` as "recorded by git but
 * not by us" and once here as "git never linked this" — two commands contradicting each other
 * about the identical path.
 *
 * `opts.fs`, if given, replaces the three fs primitives used (`existsSync`, `readdirSync`,
 * `statSync`) — the hook a fixture-backed test needs without touching global fs.
 *
 * @param {string[]} repos
 * @param {{worktreeSubdir?: string}} config
 * @param {{linkedPaths?: Set<string>, fs?: {existsSync: Function, readdirSync: Function, statSync: Function}}} [opts]
 * @returns {{repo: string, path: string}[]}
 */
function scanForOrphans(repos, config, opts = {}) {
  const { existsSync, readdirSync, statSync } = opts.fs || fs;
  const linkedPaths = opts.linkedPaths || new Set();
  const out = [];
  for (const repo of repos) {
    for (const sub of worktreeSubdirCandidates(config)) {
      const base = path.join(repo, sub);
      if (!existsSync(base)) continue;
      let entries;
      try { entries = readdirSync(base); } catch { continue; }
      for (const name of entries) {
        const cand = path.join(base, name);
        const resolved = path.resolve(cand);
        if (linkedPaths.has(resolved)) continue; // git already lists it — not "never linked" (#106)
        let isDir;
        try { isDir = statSync(cand).isDirectory(); } catch { continue; }
        if (!isDir) continue;
        const hasGitEntry = existsSync(path.join(cand, '.git'));
        const hasClaudeMd = existsSync(path.join(cand, 'CLAUDE.md'));
        const hasProjectYml = existsSync(path.join(cand, '.github/project.yml'));
        const verdict = classifyOrphanCandidate({ hasClaudeMd, hasProjectYml, hasGitEntry });
        if (verdict === 'orphan') out.push({ repo, path: resolved });
      }
    }
  }
  return out;
}

module.exports = { worktreeSubdirCandidates, classifyOrphanCandidate, scanForOrphans };
