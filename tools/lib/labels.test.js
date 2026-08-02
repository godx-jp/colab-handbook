'use strict';
/**
 * Tests for the convention-label set (tools/lib/labels.js).
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * These are pure cases: they pin WHICH labels the conventions require and the exact
 * diff the audit uses to report a gap. The value is not the trivial set-difference — it
 * is that the list is load-bearing in three places (adoption provisions it, sync back-
 * fills it, the audit reports it missing), so a future edit that drops a label from the
 * set, or lets the diff read a label object as always-present, would silently disable the
 * very check #44 added. That is the regression this file exists to fail against.
 */

const test = require('node:test');
const assert = require('node:assert');

const {
  CONVENTION_LABELS, conventionLabelNames, missingConventionLabels,
  READINESS_LABEL, readinessLabelArgs, readinessMissingLabelHint,
  MECHANICAL_READINESS_LABEL, mechanicalReadinessLabelArgs,
  GROUP_LABEL_PREFIX, isGroupLabel, groupLabelNames,
} = require('./labels.js');

test('the convention set is exactly the six labels §9 provisions, in canonical order', () => {
  assert.deepStrictEqual(
    conventionLabelNames(),
    ['in-progress', 'deps-checked', 'agent-filed', 'epic', 'needs-ruling', 'needs-plan'],
  );
  // Each carries what a provisioner needs — a name, a color, a description — so the audit
  // and `gh label create` cannot disagree about how the label is meant to look.
  for (const l of CONVENTION_LABELS) {
    assert.match(l.color, /^[0-9A-Fa-f]{6}$/, `${l.name} needs a 6-hex color`);
    assert.ok(l.description && l.description.length, `${l.name} needs a description`);
  }
});

test('a repo with every label is not flagged', () => {
  assert.deepStrictEqual(
    missingConventionLabels(['in-progress', 'deps-checked', 'agent-filed', 'epic', 'needs-ruling', 'needs-plan', 'bug']),
    [],
  );
});

test('the readiness label absent is reported — the exact gap that silently un-fills the column', () => {
  assert.deepStrictEqual(
    missingConventionLabels(['in-progress', 'bug']),
    ['deps-checked', 'agent-filed', 'epic', 'needs-ruling', 'needs-plan'],
  );
});

test('a repo with the claim label only is missing the other five', () => {
  assert.deepStrictEqual(
    missingConventionLabels(['in-progress']),
    ['deps-checked', 'agent-filed', 'epic', 'needs-ruling', 'needs-plan'],
  );
});

test('missing preserves canonical order regardless of the input order', () => {
  assert.deepStrictEqual(missingConventionLabels(['epic', 'agent-filed']), ['in-progress', 'deps-checked', 'needs-ruling', 'needs-plan']);
});

test('a repo missing only epic (adopted before #78) is flagged for exactly that gap', () => {
  assert.deepStrictEqual(
    missingConventionLabels(['in-progress', 'deps-checked', 'agent-filed', 'needs-ruling', 'needs-plan']),
    ['epic'],
  );
});

test('a repo missing only needs-ruling (adopted before #75) is flagged for exactly that gap', () => {
  assert.deepStrictEqual(
    missingConventionLabels(['in-progress', 'deps-checked', 'agent-filed', 'epic', 'needs-plan']),
    ['needs-ruling'],
  );
});

test('a repo missing only needs-plan (adopted before #94) is flagged for exactly that gap', () => {
  assert.deepStrictEqual(
    missingConventionLabels(['in-progress', 'deps-checked', 'agent-filed', 'epic', 'needs-ruling']),
    ['needs-plan'],
  );
});

test('empty / null / undefined input reports the whole set (a bare repo, or unread labels)', () => {
  const all = ['in-progress', 'deps-checked', 'agent-filed', 'epic', 'needs-ruling', 'needs-plan'];
  assert.deepStrictEqual(missingConventionLabels([]), all);
  assert.deepStrictEqual(missingConventionLabels(null), all);
  assert.deepStrictEqual(missingConventionLabels(undefined), all);
});

test('the readiness marker name is one of the convention labels, not a second literal', () => {
  // `colab readiness`, the audit and the provisioner must all target the SAME string; if this
  // name ever drifts from the set, a readiness write lands a label the audit never checks.
  assert.equal(READINESS_LABEL, 'deps-checked');
  assert.ok(conventionLabelNames().includes(READINESS_LABEL));
});

test('readinessLabelArgs maps set⇒add and clear⇒remove against the one marker name', () => {
  assert.deepStrictEqual(readinessLabelArgs(), ['--add-label', 'deps-checked']);
  assert.deepStrictEqual(readinessLabelArgs({}), ['--add-label', 'deps-checked']);
  assert.deepStrictEqual(readinessLabelArgs({ clear: false }), ['--add-label', 'deps-checked']);
  assert.deepStrictEqual(readinessLabelArgs({ clear: true }), ['--remove-label', 'deps-checked']);
});

test('label OBJECTS count as present, not as always-missing', () => {
  // gh can return {name,...}; the diff must read the name, or it flags labels that exist.
  const present = [
    { name: 'in-progress' }, { name: 'deps-checked' }, { name: 'agent-filed' },
    { name: 'epic' }, { name: 'needs-ruling' }, { name: 'needs-plan' },
  ];
  assert.deepStrictEqual(missingConventionLabels(present), []);
});

test('readinessMissingLabelHint fires exactly when the repo lacks deps-checked (#49)', () => {
  // The whole point of #49: a readiness ADD that fails because the label was never back-filled
  // must be diagnosed, not passed off as gh's raw "not found". So when the label is absent, the
  // hint names the label and the fix (handbook-sync); when it is present, there is no hint.
  const hint = readinessMissingLabelHint(['in-progress', 'bug']);
  assert.match(hint, /deps-checked/);
  assert.match(hint, /handbook-sync/);
  assert.equal(readinessMissingLabelHint(['in-progress', 'deps-checked', 'agent-filed']), null);
  // Objects, not just strings — gh label reads can arrive either shape (mirrors the test above).
  assert.equal(readinessMissingLabelHint([{ name: 'deps-checked' }]), null);
});

test('readinessMissingLabelHint returns null when the label set could not be READ', () => {
  // null present ≠ empty set. A read we did not get (no gh, no remote, network) must fall back to
  // the generic gh error, NEVER assert "the label is missing" — that would misdiagnose every
  // offline failure as an adoption gap. Distinct from [] / bare repo, which genuinely lacks it.
  assert.equal(readinessMissingLabelHint(null), null);
  assert.equal(readinessMissingLabelHint(undefined), null);
  assert.match(readinessMissingLabelHint([]), /deps-checked/);
});

// #82 — colab ship's B4 group-label teardown: once every member of a group:<key> label is
// closed, the label OBJECT is deleted (gh label delete). These two functions are the pure half
// of that: which label names on an issue are group markers, and — unioned across a branch's
// issues — which ones colab ship should even bother checking membership for.

test('isGroupLabel matches only the prefixed shape, never the bare prefix or an unrelated label', () => {
  assert.equal(isGroupLabel('group:import-fixes'), true);
  assert.equal(isGroupLabel('group:x'), true);
  assert.equal(isGroupLabel(GROUP_LABEL_PREFIX), false); // "group:" with no key names no group
  assert.equal(isGroupLabel('in-progress'), false);
  assert.equal(isGroupLabel('grouped'), false); // prefix-ish but not the prefix
  assert.equal(isGroupLabel(''), false);
  assert.equal(isGroupLabel(null), false);
  assert.equal(isGroupLabel(undefined), false);
});

test('groupLabelNames extracts group markers from a label list, ignoring everything else', () => {
  assert.deepStrictEqual(
    groupLabelNames(['in-progress', 'group:import-fixes', 'deps-checked']),
    ['group:import-fixes'],
  );
  assert.deepStrictEqual(groupLabelNames(['in-progress', 'bug']), []);
});

test('groupLabelNames accepts label OBJECTS — the shape gh issue view actually returns', () => {
  const present = [{ name: 'in-progress' }, { name: 'group:aging-buckets' }];
  assert.deepStrictEqual(groupLabelNames(present), ['group:aging-buckets']);
});

test('groupLabelNames dedupes and preserves first-seen order — a branch unions several issues', () => {
  assert.deepStrictEqual(
    groupLabelNames(['group:b', 'group:a', 'group:b']),
    ['group:b', 'group:a'],
  );
});

test('groupLabelNames tolerates empty / null / undefined the same way missingConventionLabels does', () => {
  assert.deepStrictEqual(groupLabelNames([]), []);
  assert.deepStrictEqual(groupLabelNames(null), []);
  assert.deepStrictEqual(groupLabelNames(undefined), []);
});

// --- mechanical readiness marker (#69) ---------------------------------------
// `graph-empty` is a deliberately SEPARATE, weaker claim from `deps-checked` — see
// CONVENTIONS.md §5 "Mechanical readiness". These tests pin that it stays out of the set an
// unattended adoption/sync/audit provisions (opt-in, like `tracking`), and that its write helper
// never shares a name or a code path with `readinessLabelArgs`.

test('graph-empty is not one of the six provisioned convention labels', () => {
  assert.equal(MECHANICAL_READINESS_LABEL, 'graph-empty');
  assert.ok(!conventionLabelNames().includes(MECHANICAL_READINESS_LABEL),
    'a mechanical-only check must stay opt-in — forcing it defeats the point of a cheaper lane');
});

test('a repo missing graph-empty is never reported by missingConventionLabels — it is not in the set', () => {
  assert.deepStrictEqual(
    missingConventionLabels(['in-progress', 'deps-checked', 'agent-filed', 'epic', 'needs-ruling', 'needs-plan']),
    [],
  );
});

test('mechanicalReadinessLabelArgs maps set⇒add and clear⇒remove against its OWN marker name', () => {
  assert.deepStrictEqual(mechanicalReadinessLabelArgs(), ['--add-label', 'graph-empty']);
  assert.deepStrictEqual(mechanicalReadinessLabelArgs({}), ['--add-label', 'graph-empty']);
  assert.deepStrictEqual(mechanicalReadinessLabelArgs({ clear: true }), ['--remove-label', 'graph-empty']);
  // And never the other marker's name — the two writers must not be interchangeable.
  assert.notDeepStrictEqual(mechanicalReadinessLabelArgs(), readinessLabelArgs());
});
