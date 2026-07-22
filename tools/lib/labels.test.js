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

const { CONVENTION_LABELS, conventionLabelNames, missingConventionLabels } = require('./labels.js');

test('the convention set is exactly the three labels §9 provisions, in canonical order', () => {
  assert.deepStrictEqual(conventionLabelNames(), ['in-progress', 'deps-checked', 'agent-filed']);
  // Each carries what a provisioner needs — a name, a color, a description — so the audit
  // and `gh label create` cannot disagree about how the label is meant to look.
  for (const l of CONVENTION_LABELS) {
    assert.match(l.color, /^[0-9A-Fa-f]{6}$/, `${l.name} needs a 6-hex color`);
    assert.ok(l.description && l.description.length, `${l.name} needs a description`);
  }
});

test('a repo with every label is not flagged', () => {
  assert.deepStrictEqual(missingConventionLabels(['in-progress', 'deps-checked', 'agent-filed', 'bug']), []);
});

test('the readiness label absent is reported — the exact gap that silently un-fills the column', () => {
  assert.deepStrictEqual(missingConventionLabels(['in-progress', 'bug']), ['deps-checked', 'agent-filed']);
});

test('a repo with the claim label only is missing the other two', () => {
  assert.deepStrictEqual(missingConventionLabels(['in-progress']), ['deps-checked', 'agent-filed']);
});

test('missing preserves canonical order regardless of the input order', () => {
  assert.deepStrictEqual(missingConventionLabels(['agent-filed']), ['in-progress', 'deps-checked']);
});

test('empty / null / undefined input reports the whole set (a bare repo, or unread labels)', () => {
  const all = ['in-progress', 'deps-checked', 'agent-filed'];
  assert.deepStrictEqual(missingConventionLabels([]), all);
  assert.deepStrictEqual(missingConventionLabels(null), all);
  assert.deepStrictEqual(missingConventionLabels(undefined), all);
});

test('label OBJECTS count as present, not as always-missing', () => {
  // gh can return {name,...}; the diff must read the name, or it flags labels that exist.
  const present = [{ name: 'in-progress' }, { name: 'deps-checked' }, { name: 'agent-filed' }];
  assert.deepStrictEqual(missingConventionLabels(present), []);
});
