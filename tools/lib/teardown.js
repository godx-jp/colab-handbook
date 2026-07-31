'use strict';
/**
 * Pure decision logic for tearing down a worktree DIRECTORY (the `git worktree remove` step of
 * `colab worktree rm` / `colab doctor --prune`). Side effects (fs, git, timing) live in tools/colab;
 * this module only maps observable state to an action, so the matrix is unit-testable without a
 * real repo, a real slow filesystem, or a real hung process.
 *
 * Why this exists (#62): `git worktree remove` validates that `<path>/.git` exists before it will
 * touch anything. An earlier attempt that got as far as deleting `.git` — then was interrupted, by
 * a kill after a hang with no timeout, or by anything else — leaves a directory that still exists
 * but that git can no longer recognize as a worktree AT ALL. Every subsequent `git worktree remove`
 * on that path fails "validation failed: cannot remove working tree" FOREVER; retrying the identical
 * command is not a fix, because the precondition it needs is exactly the thing that is gone. That
 * shape is called a "husk" below, and the fix is to recognize it BEFORE asking git to do a job git
 * is structurally unable to do, and finish the deletion by hand instead.
 *
 * The second half of the bug was silent success: the caller used to proceed to release claims and
 * delete the worktree's state record even when the directory removal failed or hung, because
 * nothing checked. That turned "we could not remove this" into "we did remove this" from every
 * consumer's point of view — the registry said gone, the disk said still there, and the only way
 * back was manual surgery. `decideTeardown` returning `'blocked'` is what a caller uses to refuse
 * that silent success (see cmdWorktreeRm's use of it in tools/colab).
 */

/**
 * What shape is the worktree directory in, BEFORE any removal is attempted?
 *
 * @param {object} state
 * @param {boolean} state.pathExists - does the worktree directory exist on disk at all?
 * @param {boolean} state.gitEntryExists - does `<path>/.git` exist? Only meaningful when
 *   pathExists is true; pass false (or anything falsy) when the path itself is gone.
 * @returns {'gone'|'husk'|'live'}
 *   - 'gone': nothing on disk. Already torn down (or never created) — nothing to do.
 *   - 'husk': the directory exists but `.git` does not. An earlier removal was interrupted;
 *     `git worktree remove` will never succeed against this path again. Finish by hand.
 *   - 'live': an ordinary, still-registered worktree. Attempt the normal git removal.
 */
function classifyWorktreeDir({ pathExists, gitEntryExists }) {
  if (!pathExists) return 'gone';
  if (!gitEntryExists) return 'husk';
  return 'live';
}

/**
 * Decide the next action from a shape (see classifyWorktreeDir) and, for 'live' only, the outcome
 * of having attempted `git worktree remove --force`.
 *
 * @param {'gone'|'husk'|'live'} shape
 * @param {object} [removeOutcome] - required when shape === 'live'; ignored otherwise.
 * @param {boolean} removeOutcome.ok
 * @param {boolean} [removeOutcome.timedOut]
 * @param {string} [removeOutcome.stderr]
 * @returns {{action: 'noop'|'rm-rf'|'done'|'blocked', reason: string}}
 *   - 'noop': nothing on disk to remove — treat as already torn down.
 *   - 'rm-rf': shape was a husk — the caller should `git worktree prune` (best-effort, to clear
 *     git's admin-dir reference) then delete the directory itself directly; git cannot help here.
 *   - 'done': `git worktree remove` succeeded — normal path, fully torn down.
 *   - 'blocked': the directory is NOT gone and NOT cleanly removed. The caller must NOT proceed to
 *     release claims or delete the worktree's state record — doing so is exactly the bug this
 *     module exists to prevent. The caller should surface `reason` and let a human (or --force)
 *     decide, and a retry against the same path will very likely reclassify as 'husk' next time.
 */
function decideTeardown(shape, removeOutcome) {
  if (shape === 'gone') return { action: 'noop', reason: 'nothing on disk — already removed' };
  if (shape === 'husk') {
    return {
      action: 'rm-rf',
      reason: '.git missing — an earlier removal was interrupted partway through; finishing it directly instead of asking git (which can never remove a path once .git is gone)',
    };
  }
  // shape === 'live'
  if (!removeOutcome) throw new Error('decideTeardown: shape "live" requires a removeOutcome');
  if (removeOutcome.ok) return { action: 'done', reason: 'git worktree remove succeeded' };
  if (removeOutcome.timedOut) {
    return {
      action: 'blocked',
      reason: 'git worktree remove timed out with no output — directory left as-is; re-run to retry (if it made partial progress, the retry will detect a husk and finish by hand)',
    };
  }
  return { action: 'blocked', reason: removeOutcome.stderr || 'git worktree remove failed' };
}

module.exports = { classifyWorktreeDir, decideTeardown };
