'use strict';
/**
 * Tests for the migration-grant marker (tools/lib/migration-grant.js, #98).
 *
 * Pure cases only — no git, no gh, no network. The subprocess/CLI half (the two `colab ship`
 * call sites, the `colab migration-grant` command, and the human-only enforcement) lives in
 * tools/lib/ship-migration-grant.test.js instead, because THIS module is deliberately built so
 * the safety-relevant decision can be pinned without a live `gh`.
 */

const test = require('node:test');
const assert = require('node:assert');

const {
  GRANT_MARK, REVOKE_MARK, GRANT_RE, REVOKE_RE,
  grantCommentBody, revokeCommentBody,
  liveGrants, TRUSTED_ASSOCIATIONS,
  evaluateIssue, evaluateShipSet,
} = require('./migration-grant.js');

const HOST = 'silvercube';
const NOW = '2026-08-02T10:00:00Z';
const LATER = '2026-08-02T11:00:00Z';
const LATEST = '2026-08-02T12:00:00Z';
const LABEL = 'migration-granted';

function comment(body, { createdAt = NOW, login = 'vo2vo', authorAssociation = 'MEMBER' } = {}) {
  return { body, createdAt, author: { login }, authorAssociation };
}

function grantComment(branch, opts = {}) {
  const at = opts.at || NOW;
  return comment(grantCommentBody(branch, opts.host || HOST, at), { ...opts, createdAt: at });
}

function revokeComment(branch, opts = {}) {
  const at = opts.at || NOW;
  return comment(revokeCommentBody(branch, opts.host || HOST, at), { ...opts, createdAt: at });
}

function openRecord({ labels = [LABEL], comments = [] } = {}) {
  return { state: 'OPEN', labels: labels.map((n) => ({ name: n })), comments };
}

// --- marker bodies round-trip through their own regex --------------------------------------

test('grantCommentBody round-trips through GRANT_RE, including a branch with / and -', () => {
  const body = grantCommentBody('feat/import-fixes-115-114-113', HOST, NOW);
  const m = body.match(GRANT_RE);
  assert.ok(m, body);
  assert.equal(m[1], 'feat/import-fixes-115-114-113');
  assert.equal(m[2], HOST);
  assert.equal(m[3], NOW);
  assert.match(body, /THIS BRANCH only/);
});

test('revokeCommentBody round-trips through REVOKE_RE', () => {
  const body = revokeCommentBody('feat/x-1', HOST, NOW);
  const m = body.match(REVOKE_RE);
  assert.ok(m, body);
  assert.equal(m[1], 'feat/x-1');
  assert.equal(m[2], HOST);
  assert.equal(m[3], NOW);
});

test('GRANT_MARK and REVOKE_MARK never collide — a revoke body does not match GRANT_RE and vice versa', () => {
  const grant = grantCommentBody('feat/x-1', HOST, NOW);
  const revoke = revokeCommentBody('feat/x-1', HOST, NOW);
  assert.ok(!revoke.match(GRANT_RE), 'revoke body must never parse as a grant');
  assert.ok(!grant.match(REVOKE_RE), 'grant body must never parse as a revoke');
  // Compare full Unicode code points, not UTF-16 code units: both emoji sit in the same
  // astral-plane block (U+1F680-U+1F6FF, "Transport and Map Symbols") and SHARE a high
  // surrogate, so `GRANT_MARK[0] !== REVOKE_MARK[0]` would be a false positive here.
  assert.notEqual(GRANT_MARK.codePointAt(0), REVOKE_MARK.codePointAt(0),
    'the two marks must lead with different emoji code points');
});

// --- liveGrants: live / cancelled / revived resolution --------------------------------------

test('liveGrants: a lone grant comment is live', () => {
  const live = liveGrants([grantComment('feat/x-1')]);
  assert.equal(live.length, 1);
  assert.equal(live[0].branch, 'feat/x-1');
  assert.equal(live[0].login, 'vo2vo');
  assert.equal(live[0].authorAssociation, 'MEMBER');
});

test('liveGrants: a grant followed by a LATER revoke is cancelled', () => {
  const live = liveGrants([
    grantComment('feat/x-1', { at: NOW }),
    revokeComment('feat/x-1', { at: LATER }),
  ]);
  assert.equal(live.length, 0);
});

test('liveGrants: grant, revoke, then a LATER grant is live again', () => {
  const live = liveGrants([
    grantComment('feat/x-1', { at: NOW }),
    revokeComment('feat/x-1', { at: LATER }),
    grantComment('feat/x-1', { at: LATEST }),
  ]);
  assert.equal(live.length, 1);
  assert.equal(live[0].at, LATEST);
});

test('liveGrants: revocation is NOT author-scoped — a different login can cancel', () => {
  const live = liveGrants([
    grantComment('feat/x-1', { at: NOW, login: 'alice' }),
    revokeComment('feat/x-1', { at: LATER, login: 'bob' }),
  ]);
  assert.equal(live.length, 0, 'a revoke from a different identity must still cancel — no race to protect here');
});

test('liveGrants: resolution is by createdAt, not array order', () => {
  // revoke appears FIRST in the array but its timestamp is EARLIER — the grant must still be live.
  const live = liveGrants([
    revokeComment('feat/x-1', { at: NOW }),
    grantComment('feat/x-1', { at: LATER }),
  ]);
  assert.equal(live.length, 1);
});

test('liveGrants tolerates missing/malformed input', () => {
  assert.deepStrictEqual(liveGrants([]), []);
  assert.deepStrictEqual(liveGrants(null), []);
  assert.deepStrictEqual(liveGrants(undefined), []);
  assert.deepStrictEqual(liveGrants([{ body: 'unrelated comment', createdAt: NOW }]), []);
});

// --- evaluateIssue: branch binding, expiry, label, author trust ------------------------------

test('evaluateIssue: a failed read (null record) is never a grant', () => {
  const v = evaluateIssue(null, 'feat/x-1', 98, LABEL);
  assert.equal(v.ok, false);
  assert.match(v.reason, /could not be read/);
});

test('evaluateIssue: a fully valid grant on the right branch reads ok', () => {
  const record = openRecord({ comments: [grantComment('feat/x-1')] });
  const v = evaluateIssue(record, 'feat/x-1', 98, LABEL);
  assert.equal(v.ok, true, v.reason);
  assert.equal(v.grant.branch, 'feat/x-1');
});

test('evaluateIssue (req 2 — branch binding): a grant for one branch does not authorize another', () => {
  const record = openRecord({ comments: [grantComment('feat/a-1')] });
  const v = evaluateIssue(record, 'feat/b-2', 98, LABEL);
  assert.equal(v.ok, false);
  assert.match(v.reason, /feat\/a-1/);
  assert.match(v.reason, /feat\/b-2|not "feat\/b-2"/);
});

test('evaluateIssue (req 3 — expiry): a closed issue never reads granted, even with a live comment + label', () => {
  const record = { ...openRecord({ comments: [grantComment('feat/x-1')] }), state: 'CLOSED' };
  const v = evaluateIssue(record, 'feat/x-1', 98, LABEL);
  assert.equal(v.ok, false);
  assert.match(v.reason, /closed|CLOSED/i);
});

test('evaluateIssue: label required — a live comment with the label absent still refuses', () => {
  const record = openRecord({ labels: [], comments: [grantComment('feat/x-1')] });
  const v = evaluateIssue(record, 'feat/x-1', 98, LABEL);
  assert.equal(v.ok, false);
  assert.match(v.reason, new RegExp(LABEL));
});

test('evaluateIssue: the label present with no live grant comment still refuses', () => {
  const record = openRecord({ comments: [] });
  const v = evaluateIssue(record, 'feat/x-1', 98, LABEL);
  assert.equal(v.ok, false);
  assert.match(v.reason, /no live grant comment/);
});

test('evaluateIssue: a revoked grant (label still on) refuses', () => {
  const record = openRecord({
    comments: [grantComment('feat/x-1', { at: NOW }), revokeComment('feat/x-1', { at: LATER })],
  });
  const v = evaluateIssue(record, 'feat/x-1', 98, LABEL);
  assert.equal(v.ok, false);
  assert.match(v.reason, /no live grant comment/);
});

test('evaluateIssue (author trust): NONE and CONTRIBUTOR are rejected, naming the association', () => {
  for (const assoc of ['NONE', 'CONTRIBUTOR']) {
    const record = openRecord({ comments: [grantComment('feat/x-1', { authorAssociation: assoc })] });
    const v = evaluateIssue(record, 'feat/x-1', 98, LABEL);
    assert.equal(v.ok, false, assoc);
    assert.match(v.reason, new RegExp(assoc));
  }
});

test('evaluateIssue (author trust): OWNER, MEMBER, COLLABORATOR are all accepted', () => {
  for (const assoc of [...TRUSTED_ASSOCIATIONS]) {
    const record = openRecord({ comments: [grantComment('feat/x-1', { authorAssociation: assoc })] });
    const v = evaluateIssue(record, 'feat/x-1', 98, LABEL);
    assert.equal(v.ok, true, `${assoc}: ${v.reason}`);
  }
});

// --- evaluateShipSet: requirement 5 (group branch) + non-vacuity -----------------------------

test('evaluateShipSet (req 5): three issues, two granted and one not — refuses, naming exactly the ungranted one', () => {
  const branch = 'feat/schema-98-99-100';
  const records = {
    98: openRecord({ comments: [grantComment(branch)] }),
    99: openRecord({ comments: [grantComment(branch)] }),
    100: openRecord({ comments: [] }), // no grant
  };
  const v = evaluateShipSet([98, 99, 100], records, branch, LABEL);
  assert.equal(v.ok, false);
  assert.deepStrictEqual(v.missing.map((m) => m.issue), [100]);
  assert.equal(v.granted.length, 2);
});

test('evaluateShipSet (req 5): flipping the third issue to granted makes the whole set ok', () => {
  const branch = 'feat/schema-98-99-100';
  const records = {
    98: openRecord({ comments: [grantComment(branch)] }),
    99: openRecord({ comments: [grantComment(branch)] }),
    100: openRecord({ comments: [grantComment(branch)] }),
  };
  const v = evaluateShipSet([98, 99, 100], records, branch, LABEL);
  assert.equal(v.ok, true, JSON.stringify(v.missing));
  assert.equal(v.granted.length, 3);
});

test('evaluateShipSet: non-vacuity — zero claimed issues never reads granted by default', () => {
  const v = evaluateShipSet([], {}, 'feat/x-1', LABEL);
  assert.equal(v.ok, false);
  assert.match(v.missing[0].reason, /no claimed issue/);
});

test('evaluateShipSet tolerates a null issues array the same way', () => {
  const v = evaluateShipSet(null, {}, 'feat/x-1', LABEL);
  assert.equal(v.ok, false);
});

test('evaluateShipSet: a failed read for one issue in the set is reported, never silently granted', () => {
  const branch = 'feat/x-1-2';
  const records = { 1: openRecord({ comments: [grantComment(branch)] }), 2: null };
  const v = evaluateShipSet([1, 2], records, branch, LABEL);
  assert.equal(v.ok, false);
  assert.deepStrictEqual(v.missing.map((m) => m.issue), [2]);
  assert.match(v.missing[0].reason, /could not be read/);
});
