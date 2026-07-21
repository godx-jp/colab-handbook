'use strict';
/**
 * Tests for squash-message composition (tools/lib/squash.js).
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up, so these are
 * gated without touching the workflow.
 *
 * The property under test is "does the squash carry the branch's real headline". A wrong subject
 * here fails SILENTLY: nothing errors, CI is green, the issues close, and the only symptom is a
 * feature missing from release notes that group on the Conventional Commit prefix. That is why the
 * fixtures below are the two real branches from issue #17 — both shipped genuine feat/fix work
 * under a `docs:` subject, and both are inside a published tag that can no longer be corrected.
 */

const test = require('node:test');
const assert = require('node:assert');

const squash = require('./squash.js');
const { parseSubject, commitWeight, pickSubjectIndex, harvestTrailers, composeSquashMessage } = squash;

/** Commits are NEWEST-FIRST everywhere, matching `git log` order. */
const c = (subject, body = '') => ({ subject, body });

// --- the two regressions from issue #17 -------------------------------------

// Branch: a new CI template + audit toolchain support + an audit exemption, finished with a docs
// pass. Shipped as "docs: python in the toolchain precedence and pin lists".
const TEMPLATE_BRANCH = [
  c('docs: python in the toolchain precedence and pin lists'),
  c('test(audit): cover the python toolchain resolution'),
  c('feat(audit): resolve the python toolchain from project.yml then manifest'),
  c('feat(templates): a CI template for the python stack'),
];

// Branch: a new CLI subcommand + a skill rewrite, finished with a docs pass.
const SUBCOMMAND_BRANCH = [
  c('docs(skills): code-start stops calling the session URL optional'),
  c('feat(tools): colab release-notes builds the grouped summary locally'),
];

test('the #17 regressions: a feat branch ending in docs is titled feat, not docs', () => {
  assert.strictEqual(
    composeSquashMessage(TEMPLATE_BRANCH, []).split('\n')[0],
    'feat(templates): a CI template for the python stack',
  );
  assert.strictEqual(
    composeSquashMessage(SUBCOMMAND_BRANCH, []).split('\n')[0],
    'feat(tools): colab release-notes builds the grouped summary locally',
  );
});

test('the demoted subject is not lost — it becomes a bullet', () => {
  const msg = composeSquashMessage(SUBCOMMAND_BRANCH, []);
  assert.match(msg, /^- docs\(skills\): code-start stops calling the session URL optional$/m);
});

// --- subject selection ------------------------------------------------------

test('weight order: breaking > feat > fix > perf > refactor > docs > test > chore', () => {
  const w = (s, body) => commitWeight(c(s, body));
  assert.ok(w('feat!: drop the v1 field') > w('feat: add a field'));
  assert.ok(w('feat: x') > w('fix: x'));
  assert.ok(w('fix: x') > w('perf: x'));
  assert.ok(w('perf: x') > w('refactor: x'));
  assert.ok(w('refactor: x') > w('docs: x'));
  assert.ok(w('docs: x') > w('test: x'));
  assert.ok(w('test: x') > w('chore: x'));
  assert.ok(w('chore: x') > w('no prefix at all'));
});

test('BREAKING CHANGE in the body outranks a higher type without one', () => {
  const commits = [c('feat: add an optional flag'), c('fix: reject the old field', 'BREAKING CHANGE: the old field is gone')];
  assert.strictEqual(composeSquashMessage(commits, []).split('\n')[0], 'fix: reject the old field');
});

test('ties go to the OLDEST — the commit that established the branch', () => {
  const commits = [c('feat: follow-up widget'), c('feat: the headline widget')];
  assert.strictEqual(pickSubjectIndex(commits), 1);
  assert.strictEqual(composeSquashMessage(commits, []).split('\n')[0], 'feat: the headline widget');
});

test('a single-commit branch is unchanged from the old behaviour', () => {
  const commits = [c('docs: fix a typo in the runbook', 'The path was wrong.')];
  const msg = composeSquashMessage(commits, []);
  assert.strictEqual(msg, 'docs: fix a typo in the runbook\n\nThe path was wrong.');
});

test('no recognised prefix anywhere → newest commit, the old fallback', () => {
  const commits = [c('tidy up the parser'), c('start on the parser')];
  assert.strictEqual(composeSquashMessage(commits, []).split('\n')[0], 'tidy up the parser');
});

test('a prefix-shaped word that is not a Conventional Commit type does not win', () => {
  // "wip:" looks like a prefix but is not a type — it must not outrank a real feat.
  const commits = [c('wip: still poking at it'), c('feat: the actual change')];
  assert.strictEqual(composeSquashMessage(commits, []).split('\n')[0], 'feat: the actual change');
});

test('chore(sync) merge noise never titles a squash and never becomes a bullet', () => {
  const commits = [c("chore(sync): merge trunk into the branch"), c('fix: the real change')];
  const msg = composeSquashMessage(commits, []);
  assert.strictEqual(msg.split('\n')[0], 'fix: the real change');
  assert.doesNotMatch(msg, /chore\(sync\)/);
});

test('an all-noise branch still produces a message rather than throwing', () => {
  const msg = composeSquashMessage([c('chore(sync): merge trunk into the branch')], []);
  assert.strictEqual(msg.split('\n')[0], 'chore(sync): merge trunk into the branch');
});

test('parseSubject reads type, scope and the breaking marker', () => {
  assert.deepStrictEqual(parseSubject('feat(tools)!: x'), { type: 'feat', scope: 'tools', breaking: true, description: 'x' });
  assert.strictEqual(parseSubject('no prefix'), null);
});

test('empty input is empty output, not a crash', () => {
  assert.strictEqual(composeSquashMessage([], [1]), '');
  assert.strictEqual(pickSubjectIndex([]), -1);
});

// --- the body design that must survive unchanged ----------------------------

test('Closes is emitted per claimed issue, in the body and never the subject', () => {
  const msg = composeSquashMessage([c('feat: a thing')], [17, 21]);
  const [subject, blank, closes] = msg.split('\n');
  assert.strictEqual(subject, 'feat: a thing');
  assert.strictEqual(blank, '');
  assert.strictEqual(closes, 'Closes #17, Closes #21');
});

test('an issue already closed in the carried text is not duplicated', () => {
  const commits = [c('feat: a thing', 'Closes #17')];
  const msg = composeSquashMessage(commits, [17, 21]);
  assert.strictEqual(msg.match(/Closes #17\b/g).length, 1);
  assert.match(msg, /Closes #21/);
});

test('a Closes living in a commit the squash does NOT carry is re-emitted', () => {
  // The old code tested the input for "Closes #N" and skipped it — but that commit's body is not
  // part of the squash, so the issue silently never auto-closed. Test the OUTPUT, not the input.
  const commits = [c('docs: tidy'), c('feat: the work', 'Closes #17')];
  const msg = composeSquashMessage(commits, [17]);
  // #17's body IS carried here (it is the chosen commit), so exactly one mention:
  assert.strictEqual(msg.match(/Closes #17\b/g).length, 1);

  const dropped = [c('feat: the work'), c('docs: tidy', 'Closes #17')];
  const msg2 = composeSquashMessage(dropped, [17]);
  assert.match(msg2, /Closes #17/); // the tidy body is dropped, so Closes must be re-added
});

test('trailers are harvested from every commit, not only the chosen one', () => {
  const commits = [
    c('docs: tidy', 'Co-Authored-By: Someone <s@example.com>'),
    c('feat: the work', 'Body of the real change.\n\nClaude-Session: https://example.invalid/s/1'),
  ];
  const msg = composeSquashMessage(commits, []);
  assert.match(msg, /Co-Authored-By: Someone <s@example\.com>/);
  assert.match(msg, /Claude-Session: https:\/\/example\.invalid\/s\/1/);
  assert.match(msg, /Body of the real change\./);
});

test('duplicate trailers collapse, case-insensitively', () => {
  const commits = [
    c('docs: tidy', 'Co-authored-by: Someone <s@example.com>'),
    c('feat: the work', 'Co-Authored-By: Someone <s@example.com>'),
  ];
  const msg = composeSquashMessage(commits, []);
  assert.strictEqual(msg.match(/co-authored-by:/gi).length, 1);
});

test('harvestTrailers ignores prose that merely contains a colon', () => {
  const found = harvestTrailers([c('feat: x', 'Note: this is prose.\nCloses #4\nSigned-off-by: A <a@example.com>')]);
  assert.deepStrictEqual(found, ['Signed-off-by: A <a@example.com>']);
});

test('full message layout: subject, Closes, bullets, body, trailers', () => {
  const commits = [
    c('docs: tidy the runbook'),
    c('fix: handle the empty case'),
    c('feat: the headline', 'Why this exists.\n\nCo-Authored-By: A <a@example.com>'),
  ];
  assert.strictEqual(composeSquashMessage(commits, [17]), [
    'feat: the headline',
    '',
    'Closes #17',
    '',
    '- docs: tidy the runbook',
    '- fix: handle the empty case',
    '',
    'Why this exists.',
    '',
    'Co-Authored-By: A <a@example.com>',
  ].join('\n'));
});
