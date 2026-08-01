'use strict';
/**
 * Tests for the close gate (tools/lib/checklist.js, #74).
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * The whole point of this module is that a `## Plan` checklist is verified MECHANICALLY, not by
 * honour system — so these tests pin exact parsing edges (heading spellings, where a section ends,
 * mixed-case `[X]`) and the two "safe to close anyway" escape hatches (nothing to verify, a
 * declared remainder) against the one failure mode that must never regress: an issue with a real
 * unticked box and no remainder reading as closeable.
 */

const test = require('node:test');
const assert = require('node:assert');

const { parsePlanSection, parseChecklistItems, planVerdict, findRemainder, closeGate } = require('./checklist.js');

// ---- parsePlanSection ----

test('parsePlanSection finds "## Plan" and stops at the next heading', () => {
  const body = '## Goal\n\nDo the thing.\n\n## Plan\n\n- [ ] one\n- [x] two\n\n## Gotchas\n\nnope\n';
  assert.strictEqual(parsePlanSection(body), '\n- [ ] one\n- [x] two\n');
});

test('parsePlanSection also matches "## Plan (checklist)" — the code-start template heading', () => {
  const body = '## Goal\n\n## Plan (checklist)\n- [ ] a\n\n## Decisions / Knowledge\n';
  assert.strictEqual(parsePlanSection(body), '- [ ] a\n');
});

test('parsePlanSection returns null when there is no Plan heading at all', () => {
  assert.strictEqual(parsePlanSection('## Goal\n\nJust prose, no plan.\n'), null);
});

test('parsePlanSection returns null for a null/undefined body (a failed gh read)', () => {
  assert.strictEqual(parsePlanSection(null), null);
  assert.strictEqual(parsePlanSection(undefined), null);
});

test('parsePlanSection runs to the end of the body when Plan is the last section', () => {
  const body = '## Plan\n- [ ] only item\n';
  assert.strictEqual(parsePlanSection(body), '- [ ] only item\n');
});

// ---- parseChecklistItems ----

test('parseChecklistItems reads checked and unchecked boxes, mixed case mark', () => {
  const items = parseChecklistItems('- [ ] todo\n- [x] done\n- [X] also done\n');
  assert.deepStrictEqual(items, [
    { checked: false, text: 'todo' },
    { checked: true, text: 'done' },
    { checked: true, text: 'also done' },
  ]);
});

test('parseChecklistItems ignores a bullet that is not a checklist box', () => {
  // CONVENTIONS §5/code-wrap B2c: "a bullet is not a checklist" — same rule applies here.
  assert.deepStrictEqual(parseChecklistItems('- just a bullet\n- [ ] a real one\n'), [{ checked: false, text: 'a real one' }]);
});

test('parseChecklistItems on prose (no boxes) returns empty', () => {
  assert.deepStrictEqual(parseChecklistItems('Ship the whole thing, three parts.\n'), []);
});

// ---- planVerdict ----

test('planVerdict: no Plan heading at all is complete (pre-convention issue, nothing to verify)', () => {
  const v = planVerdict('## Goal\n\nOld-style issue.\n');
  assert.strictEqual(v.hasHeading, false);
  assert.strictEqual(v.complete, true);
  assert.strictEqual(v.proseOnly, false);
  assert.strictEqual(v.total, 0);
});

test('planVerdict: a Plan heading with prose and zero boxes is complete AND flagged proseOnly', () => {
  // This is exactly the incident #74 fixes: prose scope, unparseable, previously honour-system.
  const v = planVerdict('## Plan\n\nDo three things: A, B, and C.\n');
  assert.strictEqual(v.hasHeading, true);
  assert.strictEqual(v.total, 0);
  assert.strictEqual(v.proseOnly, true);
  assert.strictEqual(v.complete, true); // reported, not blocked — see module doc comment
});

test('planVerdict: a Plan heading with zero content (nothing after it) is complete, not proseOnly', () => {
  const v = planVerdict('## Plan\n\n## Gotchas\nnone\n');
  assert.strictEqual(v.hasHeading, true);
  assert.strictEqual(v.total, 0);
  assert.strictEqual(v.proseOnly, false); // empty section, not prose describing scope
  assert.strictEqual(v.complete, true);
});

test('planVerdict: all boxes ticked is complete', () => {
  const v = planVerdict('## Plan\n- [x] a\n- [x] b\n');
  assert.strictEqual(v.complete, true);
  assert.strictEqual(v.checked, 2);
  assert.strictEqual(v.unchecked, 0);
  assert.strictEqual(v.total, 2);
});

test('planVerdict: one unticked box among ticked ones is NOT complete', () => {
  const v = planVerdict('## Plan\n- [x] a\n- [ ] b\n- [x] c\n');
  assert.strictEqual(v.complete, false);
  assert.strictEqual(v.checked, 2);
  assert.strictEqual(v.unchecked, 1);
  assert.strictEqual(v.total, 3);
});

// ---- findRemainder ----

test('findRemainder reads a "Remainder: #M" line from the body', () => {
  assert.strictEqual(findRemainder('some text\nRemainder: #123\nmore text', []), 123);
});

test('findRemainder reads it from a comment when the body has none', () => {
  const comments = [{ body: 'shipped part of it' }, { body: 'Remainder: #45\nfiled the rest here' }];
  assert.strictEqual(findRemainder('## Plan\n- [ ] x\n', comments), 45);
});

test('findRemainder returns null when nothing declares one', () => {
  assert.strictEqual(findRemainder('## Plan\n- [ ] x\n', [{ body: 'just a status update' }]), null);
});

test('findRemainder tolerates missing/malformed comments array', () => {
  assert.strictEqual(findRemainder('no remainder here', null), null);
  assert.strictEqual(findRemainder('no remainder here', undefined), null);
});

// ---- closeGate — the whole feature, end to end ----

test('closeGate: ok when there is nothing to verify (no Plan heading)', () => {
  const g = closeGate('## Goal\nold issue\n', []);
  assert.strictEqual(g.ok, true);
  assert.strictEqual(g.remainderIssue, null);
});

test('closeGate: ok when every box is ticked', () => {
  const g = closeGate('## Plan\n- [x] a\n- [x] b\n', []);
  assert.strictEqual(g.ok, true);
});

test('closeGate: REFUSED — unticked box, no remainder declared anywhere', () => {
  const g = closeGate('## Plan\n- [x] shipped\n- [ ] not shipped yet\n', [{ body: 'a status update, no remainder' }]);
  assert.strictEqual(g.ok, false);
  assert.strictEqual(g.unchecked, 1);
  assert.strictEqual(g.total, 2);
  assert.match(g.reason, /unticked/);
});

test('closeGate: ok — unticked box, but a Remainder issue is declared in a comment', () => {
  const g = closeGate('## Plan\n- [x] shipped\n- [ ] not shipped yet\n', [{ body: 'Remainder: #99' }]);
  assert.strictEqual(g.ok, true);
  assert.strictEqual(g.remainderIssue, 99);
  assert.strictEqual(g.unchecked, 1); // still reports the true count — ok does not mean "complete"
});

test('closeGate: prose-only Plan section is ok (reported via proseOnly, not blocked)', () => {
  const g = closeGate('## Plan\nJust ship the whole thing.\n', []);
  assert.strictEqual(g.ok, true);
  assert.strictEqual(g.proseOnly, true);
});
