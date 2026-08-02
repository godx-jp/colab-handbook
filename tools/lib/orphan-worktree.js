'use strict';
/**
 * Pure decision logic for detecting a directory that LOOKS like a worktree but that git never
 * linked at all — no `.git` file or directory inside it, so it never appears in
 * `git worktree list` and is therefore invisible to `unrecordedWorktrees()` (tools/colab), which
 * reconciles disk against records only for paths git already knows about (#67's blind spot is the
 * mirror of this one: a record naming a vanished directory, not a directory naming no record).
 *
 * #97 found the shape and fixed the actual corruption risk (an un-ignored path) plus corrected
 * `code-sweep`'s completeness claim to admit this blind spot; #99 (this module) is the detector.
 *
 * Side effects (fs reads, directory walks) live in tools/colab, in `orphanWorktreeDirs()`; this
 * module only maps observable booleans to a verdict, so the matrix is unit-testable without a
 * real repo or a real filesystem walk.
 */

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

module.exports = { worktreeSubdirCandidates, classifyOrphanCandidate };
