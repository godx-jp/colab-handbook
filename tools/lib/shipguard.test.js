'use strict';
/**
 * Tests for tools/lib/shipguard.js — the guards over what `colab ship` writes into an immutable
 * commit message (#87, #88) and the zero-commit completion path (#90).
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * Every case below is a REGRESSION of something measured, not a hypothetical: each names the
 * incident it reproduces. Pure functions, so no git or gh fixture is needed here — the git reads
 * these consume are exercised at the call sites in tools/colab.
 */

const test = require('node:test');
const assert = require('node:assert');
const g = require('./shipguard.js');
const { parseSubject } = require('./squash.js');

// --- #87: the registry says one thing, git says another ---

test('branchIssueNumbers reads only the TRAILING run — feat/oauth2-login-88 is issue 88, not 2 and 88', () => {
  assert.deepStrictEqual(g.branchIssueNumbers('feat/oauth2-login-88'), [88]);
  assert.deepStrictEqual(g.branchIssueNumbers('fix/import-fixes-115-114-113'), [115, 114, 113]);
  assert.deepStrictEqual(g.branchIssueNumbers('fix/ship-close-path-87-88-90'), [87, 88, 90]);
});

test('a branch with no trailing number group yields [] — "nothing to say", not "claims nothing"', () => {
  assert.deepStrictEqual(g.branchIssueNumbers('docs/code-wrap-issue-sweep'), []);
  assert.deepStrictEqual(g.branchIssueNumbers(''), []);
  assert.deepStrictEqual(g.branchIssueNumbers(null), []);
});

test('the #87 incident, exactly: a co-tenant claim on the same branch is uncorroborated', () => {
  // Branch carried #71 and #76; a second session claimed #74 onto the same worktree minutes after
  // the ship was authorised. Nothing on the branch implements #74.
  const commits = [
    { subject: 'fix(colab): ship verify fallback', body: 'Closes #71' },
    { subject: 'fix(colab): branch-keyed claim is invisible to ship', body: 'Refs #76' },
  ];
  const r = g.corroborateIssues([71, 74, 76], 'fix/ship-nonzero-verify-claim-fallback-71-76', commits);
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(r.uncorroborated, [{ issue: 74 }]);
  assert.deepStrictEqual(r.corroborated.map((c) => c.issue), [71, 76]);
});

test('corroboration accepts EITHER git-side source — branch name or commit body', () => {
  const viaName = g.corroborateIssues([90], 'fix/ship-close-path-87-88-90', []);
  assert.strictEqual(viaName.ok, true);
  assert.strictEqual(viaName.corroborated[0].via, 'branch name');

  const viaBody = g.corroborateIssues([92], 'fix/ship-close-path-87-88-90',
    [{ subject: 'fix(ship): judge CI by sha', body: 'Closes #92' }]);
  assert.strictEqual(viaBody.ok, true);
  assert.strictEqual(viaBody.corroborated[0].via, 'commit body');
});

test('an empty claim set corroborates vacuously — ship has its own separate warning for that', () => {
  assert.strictEqual(g.corroborateIssues([], 'fix/thing-1', []).ok, true);
});

// --- #88 Case 1: the subject describes the last fix, not the deliverable ---

test('type-mismatch: a feat/ branch shipping under fix: is surfaced', () => {
  const f = g.subjectSanity({
    subject: 'fix(labels): correct mechanical-readiness tests after 5-label merge',
    branchName: 'feat/needs-ruling-design-artifacts-75-84',
    chosenFiles: ['a'], branchFiles: ['a'], commitCount: 1, parseSubject,
  });
  assert.deepStrictEqual(f.map((x) => x.kind), ['type-mismatch']);
  assert.match(f[0].detail, /file this unit under fix/);
});

test('narrow-subject: the #88 Case 1 shape — the titling commit did almost none of the work', () => {
  const f = g.subjectSanity({
    subject: 'fix(labels): correct mechanical-readiness tests after 5-label merge',
    branchName: 'fix/needs-ruling-design-artifacts-75-84',   // types AGREE here
    chosenFiles: ['tools/lib/labels.test.js'],
    branchFiles: ['CONVENTIONS.md', 'skills/code-triage/SKILL.md', 'skills/code-wrap/SKILL.md',
      'tools/colab', 'tools/lib/labels.js', 'tools/lib/labels.test.js'],
    commitCount: 3, parseSubject,
  });
  assert.deepStrictEqual(f.map((x) => x.kind), ['narrow-subject']);
  assert.match(f[0].detail, /1 of the 6 files/);
});

test('a single-commit branch is never narrow — that commit IS the branch', () => {
  const f = g.subjectSanity({
    subject: 'fix: one thing', branchName: 'fix/one-thing-1',
    chosenFiles: ['a'], branchFiles: ['a', 'b', 'c', 'd', 'e', 'f'], commitCount: 1, parseSubject,
  });
  assert.deepStrictEqual(f, []);
});

test('a healthy squash produces no findings', () => {
  const f = g.subjectSanity({
    subject: 'feat(colab): ship close-path guards',
    branchName: 'feat/ship-close-path-87',
    chosenFiles: ['tools/colab', 'tools/lib/shipguard.js'],
    branchFiles: ['tools/colab', 'tools/lib/shipguard.js', 'CONVENTIONS.md'],
    commitCount: 2, parseSubject,
  });
  assert.deepStrictEqual(f, []);
});

// --- #88 Case 2: an inherited body asserts something false at merge time ---

test('bodyShaClaims finds the bare sha the #88 Case 2 body asserted', () => {
  const body = [
    'Closes #71, Closes #74, Closes #76',
    '',
    'Refs #74 (this ship carries #74 alone; #71/#76 already landed in a825aad',
    'on this shared group:ship-close-gate branch and are not touched here)',
  ].join('\n');
  assert.deepStrictEqual(g.bodyShaClaims(body), ['a825aad']);
});

test('issue refs and trailer lines are not shas', () => {
  const body = [
    'feat: a thing',
    'Closes #1234567',                       // 7 digits, but a #-ref
    'Co-authored-by: someone <deadbeef@example.com>',
    'Claude-Session: https://claude.ai/code/session_01abcdef1234',
  ].join('\n');
  assert.deepStrictEqual(g.bodyShaClaims(body), []);
});

// --- #90: the evidence gate on a zero-commit close ---

test('an issue holding ONLY colab markers has no evidence — must not auto-close', () => {
  const comments = [
    { body: '🔒 Claimed — worktree `x` · branch `y` · host `z` · 2026-08-01' },
    { body: '✅ Released' },
    { body: '🚢 Shipped to main by colab ship — abc1234' },
    { body: '🔖 Referenced by colab ship (kept open — tracking issue) — abc1234' },
  ];
  assert.strictEqual(g.hasEvidence(comments), false);
  assert.deepStrictEqual(g.evidenceComments(comments), []);
});

test('one comment colab did not write IS the evidence the ruling asks for', () => {
  const comments = [
    { body: '🔒 Claimed — worktree `x` · branch `y` · host `z` · 2026-08-01' },
    { body: 'Ruling: we keep the current tier. The design artifact is stored outside the repo at …' },
  ];
  assert.strictEqual(g.hasEvidence(comments), true);
  assert.strictEqual(g.evidenceComments(comments).length, 1);
});

test('no comments at all is no evidence — and an empty/whitespace comment does not count', () => {
  assert.strictEqual(g.hasEvidence([]), false);
  assert.strictEqual(g.hasEvidence(null), false);
  assert.strictEqual(g.hasEvidence([{ body: '   ' }]), false);
});

// --- #119: the final squash message must actually close everything ship resolved to close ---

test('closesCoverage: all closes present — ok, everything empty', () => {
  const r = g.closesCoverage({
    message: 'feat: x\n\nCloses #58, Closes #59, Closes #60\n\nbody',
    closeIssues: [58, 59, 60],
  });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.missing, []);
  assert.deepStrictEqual(r.dropped, []);
  assert.deepStrictEqual(r.stray, []);
});

test('closesCoverage: missing one — hard failure, named', () => {
  const r = g.closesCoverage({
    message: 'feat: x\n\nCloses #58, Closes #59\n\nbody',
    closeIssues: [58, 59, 60],
  });
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(r.missing, [60]);
});

test('closesCoverage: the #119 incident — a branch Closes not carried by this ship is a DROPPED warning, not a failure', () => {
  // Three grouped issues; the chosen commit's body closes #58, an earlier (non-chosen) commit's body
  // closes #60 — but this ship's claim registry only carries #58 and #59. #60 is silently dropped by
  // the composer (it only carries the chosen commit's body verbatim), and closesCoverage must SEE it
  // without blocking the ship, because nothing ship resolved to close is missing.
  const commits = [
    { subject: 'feat: part one', body: 'Closes #60' },
    { subject: 'feat: part two (chosen)', body: 'Closes #58' },
    { subject: 'chore: tidy', body: '' },
  ];
  const r = g.closesCoverage({
    message: 'feat: part two (chosen)\n\nCloses #58, Closes #59\n\nbody',
    closeIssues: [58, 59],
    commits,
  });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.missing, []);
  assert.deepStrictEqual(r.dropped, [60]);
});

test('closesCoverage: a dropped number that was deliberately --refs is NOT a dropped finding', () => {
  const commits = [{ subject: 'feat: part one', body: 'Closes #60' }];
  const r = g.closesCoverage({
    message: 'feat: x\n\nCloses #58\n\nbody',
    closeIssues: [58],
    refsIssues: [60],
    commits,
  });
  assert.deepStrictEqual(r.dropped, []);
});

test('closesCoverage: stray Closes for an issue not carried — advisory, ok stays true, tagged by reason', () => {
  const notCarried = g.closesCoverage({
    message: 'feat: x\n\nCloses #58, Closes #12\n\nbody',
    closeIssues: [58],
  });
  assert.strictEqual(notCarried.ok, true);
  assert.deepStrictEqual(notCarried.stray, [{ issue: 12, reason: 'not-carried' }]);

  const keptOpen = g.closesCoverage({
    message: 'feat: x\n\nCloses #58, Closes #12\n\nbody',
    closeIssues: [58],
    refsIssues: [12],
  });
  assert.strictEqual(keptOpen.ok, true);
  assert.deepStrictEqual(keptOpen.stray, [{ issue: 12, reason: 'refs' }]);
});

test('closesCoverage: no near-miss — #5 does not satisfy a claim on #58 and vice versa', () => {
  const a = g.closesCoverage({ message: 'feat: x\n\nCloses #5\n\nbody', closeIssues: [58] });
  assert.strictEqual(a.ok, false);
  assert.deepStrictEqual(a.missing, [58]);

  const b = g.closesCoverage({ message: 'feat: x\n\nCloses #58\n\nbody', closeIssues: [5] });
  assert.strictEqual(b.ok, false);
  assert.deepStrictEqual(b.missing, [5]);
});

test('closesCoverage: no claimed issues at all is vacuously ok', () => {
  const r = g.closesCoverage({ message: 'feat: x\n\nbody', closeIssues: [] });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.missing, []);
});
