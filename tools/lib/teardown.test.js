'use strict';
/**
 * Tests for the worktree-directory teardown decision matrix (tools/lib/teardown.js).
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * #62: `colab worktree rm` (and the `doctor --prune` sweep) used to hang forever with no output
 * on a slow/synced volume — no timeout — and, worse, would proceed to release claims and delete
 * the worktree's state record even when `git worktree remove` FAILED, silently turning "we could
 * not remove this" into "we did". This module is the pure decision logic that a caller now checks
 * before doing either of those things — see cmdWorktreeRm's use of it in tools/colab.
 */

const test = require('node:test');
const assert = require('node:assert');

const { classifyWorktreeDir, decideTeardown } = require('./teardown.js');

test('classifyWorktreeDir: no directory on disk is "gone"', () => {
  assert.strictEqual(classifyWorktreeDir({ pathExists: false, gitEntryExists: false }), 'gone');
  // gitEntryExists is meaningless once the path itself is gone — must not flip the answer
  assert.strictEqual(classifyWorktreeDir({ pathExists: false, gitEntryExists: true }), 'gone');
});

test('classifyWorktreeDir: directory present with .git missing is a "husk"', () => {
  assert.strictEqual(classifyWorktreeDir({ pathExists: true, gitEntryExists: false }), 'husk');
});

test('classifyWorktreeDir: directory present with .git present is "live"', () => {
  assert.strictEqual(classifyWorktreeDir({ pathExists: true, gitEntryExists: true }), 'live');
});

test('decideTeardown: "gone" is a no-op, never touches anything', () => {
  const d = decideTeardown('gone');
  assert.strictEqual(d.action, 'noop');
});

test('decideTeardown: "husk" is finished by hand (rm-rf), never re-attempted through git', () => {
  const d = decideTeardown('husk');
  assert.strictEqual(d.action, 'rm-rf');
  assert.match(d.reason, /\.git missing/);
});

test('decideTeardown: "live" + successful git removal is "done"', () => {
  const d = decideTeardown('live', { ok: true });
  assert.strictEqual(d.action, 'done');
});

test('decideTeardown: "live" + failed git removal is "blocked", not silently accepted', () => {
  const d = decideTeardown('live', { ok: false, stderr: "fatal: validation failed, cannot remove working tree: '.git' does not exist" });
  assert.strictEqual(d.action, 'blocked');
  assert.match(d.reason, /validation failed/);
});

test('decideTeardown: "live" + timeout is "blocked" with a distinct, actionable reason', () => {
  const d = decideTeardown('live', { ok: false, timedOut: true });
  assert.strictEqual(d.action, 'blocked');
  assert.match(d.reason, /timed out/);
});

test('decideTeardown: "live" without a removeOutcome is a programmer error, not a silent guess', () => {
  assert.throws(() => decideTeardown('live'), /requires a removeOutcome/);
});

test('decideTeardown never returns "done" or "noop" for a shape it has not verified', () => {
  // The whole point of #62's fix: "blocked" must be reachable, and reachable specifically for the
  // failure modes measured (a stale husk re-fought with git, and a hang). A regression that makes
  // failed/timed-out removal read as success would pass every OTHER test above while breaking the
  // one property that actually matters, so it gets checked directly.
  for (const removeOutcome of [
    { ok: false },
    { ok: false, timedOut: true },
    { ok: false, timedOut: false, stderr: 'anything' },
  ]) {
    const d = decideTeardown('live', removeOutcome);
    assert.notStrictEqual(d.action, 'done');
    assert.notStrictEqual(d.action, 'noop');
  }
});
