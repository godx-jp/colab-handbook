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
const { parseSubject, commitWeight, unweightedCommits, pickSubjectIndex, harvestTrailers, composeSquashMessage } = squash;

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

// --- #88: the ranking's blind spot — an unrecognised type is invisible, not merely low-weight ---
//
// #160 shipped titled `docs:` because its only real headline commit was typed `wip:`. `wip` was
// never in the race against `docs` (weight 30) — it scored 0, same as no prefix at all — so a
// LOWER-WEIGHT recognised commit won on merit while the branch's actual feature vanished from the
// changelog. `unweightedCommits` exists so a caller (`colab ship`) can warn about exactly this
// before it ships, not just discover it by reading trunk afterwards.

test('unweightedCommits: the #88 regression, exactly — wip: outranked by docs: and invisible', () => {
  const commits = [
    c('docs(#160): the gate reads a CLOCK, not the delete scale'),
    c('wip(#160): 🛟 Reload rescue — gate, dialog, executors, tests'),
  ];
  // docs wins the subject — this IS the bug, reproduced, so the warning helper has something to catch.
  assert.strictEqual(composeSquashMessage(commits, []).split('\n')[0],
    'docs(#160): the gate reads a CLOCK, not the delete scale');
  const flagged = unweightedCommits(commits);
  assert.strictEqual(flagged.length, 1);
  assert.strictEqual(flagged[0].subject, 'wip(#160): 🛟 Reload rescue — gate, dialog, executors, tests');
});

test('unweightedCommits: a fully-conventional branch flags nothing', () => {
  assert.deepStrictEqual(unweightedCommits([c('feat: a thing'), c('docs: tidy')]), []);
});

test('unweightedCommits: no-prefix-at-all commits are flagged too — same blind spot, different shape', () => {
  const commits = [c('feat: a thing'), c('fixed the bug, oops')];
  assert.strictEqual(unweightedCommits(commits).length, 1);
  assert.strictEqual(unweightedCommits(commits)[0].subject, 'fixed the bug, oops');
});

test('unweightedCommits: chore(sync) merge noise is never flagged — it has its own name for what it is', () => {
  const commits = [c('chore(sync): merge main into the branch'), c('feat: a thing')];
  assert.deepStrictEqual(unweightedCommits(commits), []);
});

test('unweightedCommits: empty input is empty output', () => {
  assert.deepStrictEqual(unweightedCommits([]), []);
  assert.deepStrictEqual(unweightedCommits(undefined), []);
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

// --- #105: extraTrailerLines — composed trailers, distinct from harvested/inherited ones --------

test('extraTrailerLines: a composed trailer (e.g. CI-Grant:) lands in the block, appended after inherited ones', () => {
  const commits = [
    c('docs: tidy', 'Co-Authored-By: Someone <s@example.com>'),
    c('feat: the work', 'Body of the real change.'),
  ];
  const msg = composeSquashMessage(commits, [], [], undefined, ['CI-Grant: #105 branch fix/x-105 over-red main@aaaaaaa evidence ccccccc']);
  assert.match(msg, /Body of the real change\./);
  assert.match(msg, /Co-Authored-By: Someone <s@example\.com>/);
  assert.match(msg, /CI-Grant: #105 branch fix\/x-105 over-red main@aaaaaaa evidence ccccccc/);
  // Appended AFTER the inherited trailer, never before it.
  const coIdx = msg.indexOf('Co-Authored-By');
  const grantIdx = msg.indexOf('CI-Grant');
  assert.ok(coIdx < grantIdx, 'composed trailer must land after an inherited one, never before');
});

test('extraTrailerLines: never duplicated if the text already carries the identical line', () => {
  const commits = [c('feat: x', 'CI-Grant: #105 branch fix/x-105 over-red main@aaaaaaa evidence ccccccc')];
  const msg = composeSquashMessage(commits, [], [], undefined, ['CI-Grant: #105 branch fix/x-105 over-red main@aaaaaaa evidence ccccccc']);
  assert.strictEqual((msg.match(/CI-Grant:/g) || []).length, 1);
});

test('extraTrailerLines: empty/undefined adds nothing, and never inside a trailer VALUE', () => {
  const commits = [c('feat: x', 'Co-Authored-By: A <a@example.com>')];
  const withNone = composeSquashMessage(commits, [], [], undefined, []);
  const withUndef = composeSquashMessage(commits, [], [], undefined);
  assert.strictEqual(withNone, withUndef);
  assert.ok(!/CI-Grant/.test(withNone));
  // The trailer's own value line must never be corrupted by a glued composed trailer.
  assert.match(withNone, /^Co-Authored-By: A <a@example\.com>$/m);
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

// --- issue #25.2: the --message path must SPLICE Closes, never concatenate ---
//
// `colab ship --message "<msg>"` used to build `${message}${closes}`, appending " — Closes #N" to
// whatever the message ended with. For any message carrying a trailer block that welds text onto
// the LAST TRAILER'S VALUE. GitHub still auto-closes, so it fails silently — and the resulting
// commit is immutable. One is already on trunk with a corrupted Claude-Session URL.

test('spliceCloses puts Closes under the subject, leaving a trailer block intact', () => {
  const msg = [
    'fix(tools): the thing',
    '',
    'Why it exists.',
    '',
    'Co-Authored-By: A <a@example.com>',
    'Claude-Session: https://claude.ai/code/session_01ABC',
  ].join('\n');
  assert.strictEqual(squash.spliceCloses(msg, [25]), [
    'fix(tools): the thing',
    '',
    'Closes #25',
    '',
    'Why it exists.',
    '',
    'Co-Authored-By: A <a@example.com>',
    'Claude-Session: https://claude.ai/code/session_01ABC',
  ].join('\n'));
});

test('spliceCloses never appends to the final trailer (the #25 regression, exactly)', () => {
  const msg = 'fix: x\n\nClaude-Session: https://claude.ai/code/session_01BLZ';
  const out = squash.spliceCloses(msg, [17]);
  assert.ok(!/session_01BLZ — Closes/.test(out), 'Closes was welded onto the session URL');
  assert.ok(out.endsWith('Claude-Session: https://claude.ai/code/session_01BLZ'),
    'the trailer block must still be the last paragraph, uncorrupted');
});

test('spliceCloses skips issues the message already closes, and handles a subject-only message', () => {
  assert.strictEqual(squash.spliceCloses('fix: x\n\nCloses #7', [7]), 'fix: x\n\nCloses #7');
  assert.strictEqual(squash.spliceCloses('fix: x', [7, 8]), 'fix: x\n\nCloses #7, Closes #8');
  assert.strictEqual(squash.spliceCloses('fix: x', []), 'fix: x');
});

// --- issue #48: a claimed tracking/memory issue is Ref'd, not Closed ---------
//
// A long-lived memory issue is claimed to signal work in its domain but not completed by the branch.
// Closing it buries its accumulated knowledge and its still-open checklist. `ship` passes such an
// issue on the `refs` list; the message must say `Refs #N` (which GitHub does not auto-close) rather
// than `Closes #N`. Claim release is unconditional in the CLI — only the keyword changes here.

test('a ref issue gets Refs #N, a close issue gets Closes #N, in one paragraph', () => {
  const msg = composeSquashMessage([c('feat: a domain fix')], [17], [48]);
  const [subject, blank, refline] = msg.split('\n');
  assert.strictEqual(subject, 'feat: a domain fix');
  assert.strictEqual(blank, '');
  assert.strictEqual(refline, 'Closes #17, Refs #48');
});

test('a refs-only ship still emits the reference paragraph, and never a Closes for it', () => {
  const msg = composeSquashMessage([c('chore: hygiene in the area')], [], [48]);
  assert.match(msg, /\bRefs #48\b/);
  assert.ok(!/\bCloses #48\b/.test(msg), 'a tracking issue must never be closed');
});

test('an issue named in BOTH lists is Ref\'d, never Closed — refs wins', () => {
  const msg = squash.spliceCloses('fix: x', [48], [48]);
  assert.strictEqual(msg, 'fix: x\n\nRefs #48');
});

test('spliceCloses does not emit Refs #N when the text already Closes it (pure layer cannot un-close)', () => {
  // ship warns about this after the push; here we must at least not print both keywords for one issue.
  const out = squash.spliceCloses('feat: x\n\nCloses #48', [], [48]);
  assert.strictEqual(out, 'feat: x\n\nCloses #48');
  assert.ok(!/\bRefs #48\b/.test(out));
});

test('an existing Refs #N in the carried text is not duplicated', () => {
  const commits = [c('chore: touch the domain', 'Refs #48')];
  const msg = composeSquashMessage(commits, [], [48]);
  assert.strictEqual(msg.match(/Refs #48\b/g).length, 1);
});

test('refs defaults to empty: the two-arg form is unchanged (backward compatible)', () => {
  assert.strictEqual(composeSquashMessage([c('feat: a thing')], [17, 21]).split('\n')[2], 'Closes #17, Closes #21');
  assert.strictEqual(squash.spliceCloses('fix: x', [7, 8]), 'fix: x\n\nCloses #7, Closes #8');
});

// --- issue #58: an inherited `Refs #N` must not survive alongside a composed `Closes #N` ---------
//
// A session writes `Refs #53` into its own commit body while #53 is still open — an honest trailer
// at the time. By the time `ship` runs, #53 is one of the issues THIS branch closes. The old code
// only ever checked whether `Closes #N` was already present before appending one; it never looked at
// a pre-existing `Refs #N` for the same number, so the squash carried both — two contradictory,
// immutable trailers for one issue.

test('an inherited Refs #N for an issue this call CLOSES is dropped, not carried alongside Closes', () => {
  const commits = [c('fix(colab): the real fix', 'Why this exists.\n\nRefs #53')];
  const msg = composeSquashMessage(commits, [53]);
  assert.strictEqual(msg.match(/Closes #53\b/g).length, 1);
  assert.ok(!/Refs #53\b/.test(msg), 'the stale Refs #53 must not survive next to Closes #53');
});

test('spliceCloses reports the dropped trailer via the optional conflicts sink', () => {
  const conflicts = [];
  squash.spliceCloses('fix: x\n\nRefs #53', [53], [], conflicts);
  assert.deepStrictEqual(conflicts, [{ num: '53', from: 'Refs', to: 'Closes' }]);
});

test('no conflicts sink passed is still safe (default parameter, not a crash)', () => {
  assert.strictEqual(squash.spliceCloses('fix: x\n\nRefs #53', [53]), 'fix: x\n\nCloses #53');
});

test('a Refs #N for a DIFFERENT issue on the same line survives; only the conflicting clause drops', () => {
  const msg = squash.spliceCloses('fix: x\n\nRefs #53, Refs #48', [53], [48]);
  assert.ok(!/Refs #53\b/.test(msg), 'the conflicting clause must be gone');
  assert.match(msg, /Refs #48\b/);
  assert.strictEqual(msg.match(/Refs #48\b/g).length, 1);
});

test('Refs #N in ordinary prose (not a self-contained reference line) is left untouched', () => {
  // Only a line that IS a reference clause (or several) end-to-end is touched — rewriting inside a
  // sentence is not a safe mechanical operation, and this is not the shape either #58 or ship's own
  // composed line takes.
  const msg = squash.spliceCloses('fix: x\n\nSee the discussion in Refs #53 for background.', [53]);
  assert.match(msg, /See the discussion in Refs #53 for background\./);
  assert.match(msg, /Closes #53/);
});

test('the mirror direction (#48) is unaffected: an inherited Closes #N for a Refs issue still stays', () => {
  // Locking in the pre-existing, deliberate asymmetry: reconciliation only ever removes a stale
  // Refs when ship intends Closes, never the other way (composeSquashMessage's doc comment explains
  // why — this pure layer cannot un-close what GitHub will read as a closing keyword regardless).
  const out = squash.spliceCloses('feat: x\n\nCloses #48', [], [48]);
  assert.strictEqual(out, 'feat: x\n\nCloses #48');
});

test('reconcileClosesRefsConflict is a no-op with no closeNums, and safe on a message with no match', () => {
  assert.strictEqual(squash.reconcileClosesRefsConflict('fix: x\n\nRefs #53', [], []), 'fix: x\n\nRefs #53');
  assert.strictEqual(squash.reconcileClosesRefsConflict('fix: x\n\nno reference here', ['53'], []), 'fix: x\n\nno reference here');
});

// --- #119: closedIssueNumbers is the SAME recogniser spliceCloses uses — anti-drift ---

test('closedIssueNumbers finds every Closes #N, de-duplicated, case-insensitive keyword', () => {
  assert.deepStrictEqual(squash.closedIssueNumbers('feat: x\n\nCloses #58, closes #59\n\nCloses #58'), ['58', '59']);
  assert.deepStrictEqual(squash.closedIssueNumbers('no closing directive here, just #58 mentioned'), []);
  assert.deepStrictEqual(squash.closedIssueNumbers(''), []);
  assert.deepStrictEqual(squash.closedIssueNumbers(null), []);
});

test('closedIssueNumbers does not false-positive on a near-miss number', () => {
  assert.deepStrictEqual(squash.closedIssueNumbers('Closes #5'), ['5']);
  assert.ok(!squash.closedIssueNumbers('Closes #58').includes('5'));
});

test('anti-drift: every number closedIssueNumbers reports, spliceCloses leaves untouched; every number it does not, spliceCloses adds', () => {
  const cases = [
    'feat: x\n\nCloses #58, Closes #59\n\nbody',
    'fix: x',
    'feat: x\n\nCloses #7\n\nCo-authored-by: a <a@x.com>',
  ];
  for (const msg of cases) {
    const already = squash.closedIssueNumbers(msg);
    for (const n of already) {
      const out = squash.spliceCloses(msg, [n]);
      assert.strictEqual(out, msg, `spliceCloses should not re-add an already-closed #${n} in: ${msg}`);
    }
    const notYet = '999999';
    assert.ok(!already.includes(notYet));
    assert.match(squash.spliceCloses(msg, [notYet]), new RegExp(`Closes #${notYet}\\b`));
  }
});
