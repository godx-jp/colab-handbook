'use strict';
/**
 * Tests for process/port ownership (tools/lib/procs.js).
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * Only the PURE parts are tested here: lsof's output format and the cwd containment rule. Spawning
 * lsof in CI would test the runner's process table rather than our logic, and would be flaky on a
 * machine where lsof is absent or restricted.
 *
 * The property under test is "does a directory own this process". Getting it wrong in the
 * permissive direction orphans a server onto a deleted checkout (issue #22); getting the ownership
 * TEST wrong — by using the port instead of the cwd — kills an unrelated process that legitimately
 * holds a port the registry is merely confused about.
 */

const test = require('node:test');
const assert = require('node:assert');

const { isInside, parseLsofCwd } = require('./procs.js');

const WT = '/repo/.claude/worktrees/feat-x';

test('isInside: the directory itself and its descendants, nothing else', () => {
  assert.ok(isInside(WT, WT), 'the directory owns itself');
  assert.ok(isInside(WT, WT + '/server'), 'a descendant is owned');
  assert.ok(!isInside(WT, '/repo'), 'the parent is not owned');
  assert.ok(!isInside(WT, '/repo/.claude/worktrees/feat-x-2'),
    'a SIBLING sharing the name as a prefix is not owned — plain startsWith gets this wrong');
  assert.ok(!isInside(WT, ''), 'empty is not owned');
  assert.ok(!isInside('', WT), 'no directory owns nothing');
});

// lsof -F is a STREAM of prefixed lines, not one record per line: a `p<pid>` applies to every
// following field line until the next `p`. Splitting per line and expecting pid+path together
// yields pids with no paths — i.e. silently finds nothing, which reads exactly like "all clear".
const LSOF = [
  'p101', 'fcwd', 'n/repo/.claude/worktrees/feat-x',
  'p202', 'fcwd', 'n/repo/.claude/worktrees/feat-x/server',
  'p303', 'fcwd', 'n/somewhere/else',
  'p404', 'fcwd', 'n/repo',
].join('\n');

test('parseLsofCwd carries the pid across following field lines', () => {
  assert.deepStrictEqual(parseLsofCwd(LSOF, WT), [
    { pid: '101', cwd: '/repo/.claude/worktrees/feat-x' },
    { pid: '202', cwd: '/repo/.claude/worktrees/feat-x/server' },
  ]);
});

test('parseLsofCwd excludes processes outside the directory, including its parent', () => {
  const pids = parseLsofCwd(LSOF, WT).map((p) => p.pid);
  assert.ok(!pids.includes('303'), 'unrelated cwd must not be claimed as owned');
  assert.ok(!pids.includes('404'), 'the parent repo must not be claimed as owned');
});

test('parseLsofCwd tolerates empty and malformed input rather than throwing', () => {
  assert.deepStrictEqual(parseLsofCwd('', WT), []);
  assert.deepStrictEqual(parseLsofCwd(null, WT), []);
  assert.deepStrictEqual(parseLsofCwd('n/orphan/path\nfcwd', WT), [],
    'a path line with no preceding pid is not a process');
});
