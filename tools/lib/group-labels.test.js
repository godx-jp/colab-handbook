'use strict';
/**
 * Tests for spent group-label classification (tools/lib/group-labels.js, #85).
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * The value here is not the counting. It is that this module is the only thing standing
 * between `colab doctor --sync --prune` and `gh label delete`, which is destructive and
 * cannot be undone in kind: recreating a deleted label does not restore the issues it bound
 * or the description carrying the group's rationale. So every case below is really one
 * question — "can this label be deleted?" — and the ones that must answer NO are the ones
 * worth having. A refactor that lets `empty`, `unknown`, or a part-open group become
 * deletable is the regression this file exists to fail against.
 */

const test = require('node:test');
const assert = require('node:assert');

const {
  isOpenMember, classifyGroupLabel, classifyGroupLabels, deletableLabels, reportableLabels,
} = require('./group-labels.js');

const closed = (n) => ({ number: n, state: 'CLOSED' });
const open = (n) => ({ number: n, state: 'OPEN' });

// --- the three real populations -------------------------------------------------------

test('every member closed → spent (this is B4\'s condition, reached late)', () => {
  const v = classifyGroupLabel('group:convention-gaps', [closed(70), closed(74)]);
  assert.strictEqual(v.verdict, 'spent');
  assert.strictEqual(v.total, 2);
  assert.strictEqual(v.open, 0);
  assert.deepStrictEqual(v.members, [70, 74]);
});

test('one member still open → mid-flight, and mid-flight is NOT reported', () => {
  const v = classifyGroupLabel('group:import-fixes', [closed(115), open(114), closed(113)]);
  assert.strictEqual(v.verdict, 'mid-flight');
  assert.strictEqual(v.open, 1);
  // A group part-closed is the normal state of a group being worked. Reporting it would be
  // reporting rot that is not rot — the thing #85 explicitly asked not to do.
  assert.deepStrictEqual(reportableLabels([v]), []);
  assert.deepStrictEqual(deletableLabels([v]), []);
});

test('no members → empty: reported, but NEVER deletable', () => {
  const v = classifyGroupLabel('group:vanished', []);
  assert.strictEqual(v.verdict, 'empty');
  // Surfaced for a human …
  assert.deepStrictEqual(reportableLabels([v]).map((x) => x.name), ['group:vanished']);
  // … and withheld from --prune, because "every member was transferred away" and "a triage
  // session created it seconds ago and has not applied it yet" are indistinguishable: the
  // labels API exposes no creation time. Deleting the second case breaks a live grouping.
  assert.deepStrictEqual(deletableLabels([v]), []);
});

// --- the failure contract -------------------------------------------------------------

test('membership that could not be read is unknown — never "no members", never deletable', () => {
  // ghIssueListByLabel returns null on gh failure / no remote / network, and states that null
  // means "could not read". Reading that as an empty array would classify a live group as
  // spent and delete it on the next --prune. That is the sharp edge this case pins.
  for (const bad of [null, undefined]) {
    const v = classifyGroupLabel('group:unreadable', bad);
    assert.strictEqual(v.verdict, 'unknown');
    assert.deepStrictEqual(deletableLabels([v]), []);
    // still surfaced, so a human sees the check was incomplete rather than assuming clean
    assert.deepStrictEqual(reportableLabels([v]).map((x) => x.name), ['group:unreadable']);
  }
});

test('an unrecognised member state counts as OPEN — deletion fails toward keeping', () => {
  assert.strictEqual(isOpenMember({ number: 1, state: 'OPEN' }), true);
  assert.strictEqual(isOpenMember({ number: 1, state: 'CLOSED' }), false);
  assert.strictEqual(isOpenMember({ number: 1, state: 'closed' }), false, 'case-tolerant');
  // No state field at all, or a state nobody has seen before: cannot prove closed.
  assert.strictEqual(isOpenMember({ number: 1 }), true);
  assert.strictEqual(isOpenMember({ number: 1, state: 'MERGED' }), true);
  // …which makes the whole label non-deletable, the safe direction.
  const v = classifyGroupLabel('group:odd', [closed(1), { number: 2 }]);
  assert.strictEqual(v.verdict, 'mid-flight');
  assert.deepStrictEqual(deletableLabels([v]), []);
});

test('the bare "group:" prefix names no group and is never deletable', () => {
  // labels.isGroupLabel already guards this; classification must not undo the guard by
  // treating an unparseable name as an empty group.
  const v = classifyGroupLabel('group:', []);
  assert.strictEqual(v.verdict, 'unknown');
  assert.deepStrictEqual(deletableLabels([v]), []);
});

// --- the repo-level sweep --------------------------------------------------------------

test('classifyGroupLabels picks group labels out of the tracker and leaves the rest alone', () => {
  const all = ['bug', 'in-progress', 'group:alpha', 'epic', 'group:beta', 'group:gamma'];
  const members = {
    'group:alpha': [closed(1), closed(2)],   // spent
    'group:beta': [closed(3), open(4)],      // mid-flight
    'group:gamma': null,                     // unreadable
  };
  const verdicts = classifyGroupLabels(all, (n) => members[n]);

  assert.deepStrictEqual(verdicts.map((v) => [v.name, v.verdict]), [
    ['group:alpha', 'spent'],
    ['group:beta', 'mid-flight'],
    ['group:gamma', 'unknown'],
  ], 'convention labels are not group labels and must not be classified — let alone deleted');

  assert.deepStrictEqual(deletableLabels(verdicts).map((v) => v.name), ['group:alpha']);
  assert.deepStrictEqual(reportableLabels(verdicts).map((v) => v.name),
    ['group:alpha', 'group:gamma']);
});

test('a tracker whose labels could not be listed yields nothing, not an empty tracker', () => {
  // Same contract one level up: ghListLabels returns null on failure. Answering [] here is
  // correct precisely BECAUSE it produces no verdicts — and therefore nothing deletable.
  assert.deepStrictEqual(classifyGroupLabels(null, () => []), []);
  let looked = 0;
  classifyGroupLabels(null, () => { looked++; return []; });
  assert.strictEqual(looked, 0, 'a failed label list must not fan out into membership calls');
});

test('the three labels measured spent on the tracker in #85 all classify as deletable', () => {
  // The concrete evidence from the issue: three fully spent labels that ship's B4 can never
  // reach, because none has an unshipped member left to trigger one.
  const all = ['group:ceremony-vocabulary', 'group:cli-ship-release', 'group:convention-gaps'];
  const members = {
    'group:ceremony-vocabulary': [closed(78), closed(79), closed(80)],
    'group:cli-ship-release': [closed(77), closed(81)],
    'group:convention-gaps': [closed(75), closed(84)],
  };
  const verdicts = classifyGroupLabels(all, (n) => members[n]);
  assert.deepStrictEqual(deletableLabels(verdicts).map((v) => v.name), all);
});
