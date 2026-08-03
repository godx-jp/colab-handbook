'use strict';
/**
 * Tests for the ci-grant marker (tools/lib/ci-grant.js, #105).
 *
 * Pure cases only — no git, no gh, no network. The subprocess/CLI half (the `colab ci-grant`
 * command, the human-only enforcement, and the wiring into `colab ship`'s two CI-check call
 * sites) lives in tools/lib/ship-ci-grant.test.js instead, same split as migration-grant's.
 */

const test = require('node:test');
const assert = require('node:assert');

const {
  GRANT_MARK, REVOKE_MARK, GRANT_RE, REVOKE_RE,
  grantCommentBody, revokeCommentBody,
  liveGrants, TRUSTED_ASSOCIATIONS,
  evaluateIssue, evaluateShipSet, stackingVerdict,
} = require('./ci-grant.js');

const {
  GRANT_MARK: MIG_GRANT_MARK, REVOKE_MARK: MIG_REVOKE_MARK,
  GRANT_RE: MIG_GRANT_RE, REVOKE_RE: MIG_REVOKE_RE,
  grantCommentBody: migGrantCommentBody, revokeCommentBody: migRevokeCommentBody,
} = require('./migration-grant.js');

const HOST = 'silvercube';
const NOW = '2026-08-02T10:00:00Z';
const LATER = '2026-08-02T11:00:00Z';
const LATEST = '2026-08-02T12:00:00Z';
const LABEL = 'ci-granted';
const TRUNK = 'main';
const RED_SHA = 'aaaaaaa';
const OTHER_RED_SHA = 'bbbbbbb';
const EVID_SHA = 'ccccccc';
const OTHER_EVID_SHA = 'ddddddd';

function comment(body, { createdAt = NOW, login = 'vo2vo', authorAssociation = 'MEMBER' } = {}) {
  return { body, createdAt, author: { login }, authorAssociation };
}

function grantComment(branch, opts = {}) {
  const at = opts.at || NOW;
  return comment(
    grantCommentBody(branch, opts.trunk || TRUNK, opts.redSha || RED_SHA, opts.evidenceSha || EVID_SHA, opts.host || HOST, at),
    { ...opts, createdAt: at },
  );
}

function revokeComment(branch, opts = {}) {
  const at = opts.at || NOW;
  return comment(revokeCommentBody(branch, opts.host || HOST, at), { ...opts, createdAt: at });
}

function openRecord({ labels = [LABEL], comments = [] } = {}) {
  return { state: 'OPEN', labels: labels.map((n) => ({ name: n })), comments };
}

function okEvidence(sha = EVID_SHA) {
  return { ok: true, sha };
}

// --- marker bodies round-trip through their own regex --------------------------------------

test('grantCommentBody round-trips through GRANT_RE, including a branch with / and -', () => {
  const body = grantCommentBody('feat/import-fixes-115-114-113', TRUNK, RED_SHA, EVID_SHA, HOST, NOW);
  const m = body.match(GRANT_RE);
  assert.ok(m, body);
  assert.equal(m[1], 'feat/import-fixes-115-114-113');
  assert.equal(m[2], TRUNK);
  assert.equal(m[3], RED_SHA);
  assert.equal(m[4], EVID_SHA);
  assert.equal(m[5], HOST);
  assert.equal(m[6], NOW);
  assert.match(body, /THIS BRANCH/);
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
  const grant = grantCommentBody('feat/x-1', TRUNK, RED_SHA, EVID_SHA, HOST, NOW);
  const revoke = revokeCommentBody('feat/x-1', HOST, NOW);
  assert.ok(!revoke.match(GRANT_RE), 'revoke body must never parse as a grant');
  assert.ok(!grant.match(REVOKE_RE), 'grant body must never parse as a revoke');
  assert.notEqual(GRANT_MARK.codePointAt(0), REVOKE_MARK.codePointAt(0),
    'the two marks must lead with different emoji code points');
});

// --- four-way collision against migration-grant.js's marks (#105 is a SEPARATE grant) --------
// Two independent exemptions must never cross-parse — a ci-grant comment misread as a migration
// grant (or vice versa) would authorize the wrong precondition's bypass.

test('ci-grant marks never collide with migration-grant marks, in either direction, either mark', () => {
  const ciGrant = grantCommentBody('feat/x-1', TRUNK, RED_SHA, EVID_SHA, HOST, NOW);
  const ciRevoke = revokeCommentBody('feat/x-1', HOST, NOW);
  const migGrant = migGrantCommentBody('feat/x-1', HOST, NOW);
  const migRevoke = migRevokeCommentBody('feat/x-1', HOST, NOW);

  assert.ok(!ciGrant.match(MIG_GRANT_RE), 'a ci-grant comment must never parse as a migration grant');
  assert.ok(!ciRevoke.match(MIG_REVOKE_RE), 'a ci-grant revoke must never parse as a migration revoke');
  assert.ok(!migGrant.match(GRANT_RE), 'a migration grant comment must never parse as a ci-grant');
  assert.ok(!migRevoke.match(REVOKE_RE), 'a migration revoke must never parse as a ci-grant revoke');

  // All four leading code points pairwise distinct.
  const points = new Set([
    GRANT_MARK.codePointAt(0), REVOKE_MARK.codePointAt(0),
    MIG_GRANT_MARK.codePointAt(0), MIG_REVOKE_MARK.codePointAt(0),
  ]);
  assert.equal(points.size, 4, 'all four marker emoji must lead with distinct code points');
});

// --- liveGrants: live / cancelled / revived resolution --------------------------------------

test('liveGrants: a lone grant comment is live', () => {
  const live = liveGrants([grantComment('feat/x-1')]);
  assert.equal(live.length, 1);
  assert.equal(live[0].branch, 'feat/x-1');
  assert.equal(live[0].trunk, TRUNK);
  assert.equal(live[0].redSha, RED_SHA);
  assert.equal(live[0].evidenceSha, EVID_SHA);
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

// --- evaluateIssue: branch binding, expiry, label, author trust, red-sha, evidence -----------

test('evaluateIssue: a failed read (null record) is never a grant', () => {
  const v = evaluateIssue(null, 'feat/x-1', TRUNK, RED_SHA, okEvidence(), 105, LABEL);
  assert.equal(v.ok, false);
  assert.match(v.reason, /could not be read/);
});

test('evaluateIssue: a fully valid grant, right branch, right red sha, matching evidence reads ok', () => {
  const record = openRecord({ comments: [grantComment('feat/x-1')] });
  const v = evaluateIssue(record, 'feat/x-1', TRUNK, RED_SHA, okEvidence(), 105, LABEL);
  assert.equal(v.ok, true, v.reason);
  assert.equal(v.grant.branch, 'feat/x-1');
});

test('evaluateIssue: a grant for one branch does not authorize another', () => {
  const record = openRecord({ comments: [grantComment('feat/a-1')] });
  const v = evaluateIssue(record, 'feat/b-2', TRUNK, RED_SHA, okEvidence(), 105, LABEL);
  assert.equal(v.ok, false);
  assert.match(v.reason, /feat\/a-1/);
});

test('evaluateIssue: a closed issue never reads granted, even with a live comment + label', () => {
  const record = { ...openRecord({ comments: [grantComment('feat/x-1')] }), state: 'CLOSED' };
  const v = evaluateIssue(record, 'feat/x-1', TRUNK, RED_SHA, okEvidence(), 105, LABEL);
  assert.equal(v.ok, false);
  assert.match(v.reason, /closed|CLOSED/i);
});

test('evaluateIssue: label required — a live comment with the label absent still refuses', () => {
  const record = openRecord({ labels: [], comments: [grantComment('feat/x-1')] });
  const v = evaluateIssue(record, 'feat/x-1', TRUNK, RED_SHA, okEvidence(), 105, LABEL);
  assert.equal(v.ok, false);
  assert.match(v.reason, new RegExp(LABEL));
});

test('evaluateIssue: the label present with no live grant comment still refuses', () => {
  const record = openRecord({ comments: [] });
  const v = evaluateIssue(record, 'feat/x-1', TRUNK, RED_SHA, okEvidence(), 105, LABEL);
  assert.equal(v.ok, false);
  assert.match(v.reason, /no live grant comment/);
});

test('evaluateIssue: a revoked grant (label still on) refuses', () => {
  const record = openRecord({
    comments: [grantComment('feat/x-1', { at: NOW }), revokeComment('feat/x-1', { at: LATER })],
  });
  const v = evaluateIssue(record, 'feat/x-1', TRUNK, RED_SHA, okEvidence(), 105, LABEL);
  assert.equal(v.ok, false);
  assert.match(v.reason, /no live grant comment/);
});

test('evaluateIssue (author trust): NONE and CONTRIBUTOR are rejected, naming the association', () => {
  for (const assoc of ['NONE', 'CONTRIBUTOR']) {
    const record = openRecord({ comments: [grantComment('feat/x-1', { authorAssociation: assoc })] });
    const v = evaluateIssue(record, 'feat/x-1', TRUNK, RED_SHA, okEvidence(), 105, LABEL);
    assert.equal(v.ok, false, assoc);
    assert.match(v.reason, new RegExp(assoc));
  }
});

test('evaluateIssue (author trust): OWNER, MEMBER, COLLABORATOR are all accepted', () => {
  for (const assoc of [...TRUSTED_ASSOCIATIONS]) {
    const record = openRecord({ comments: [grantComment('feat/x-1', { authorAssociation: assoc })] });
    const v = evaluateIssue(record, 'feat/x-1', TRUNK, RED_SHA, okEvidence(), 105, LABEL);
    assert.equal(v.ok, true, `${assoc}: ${v.reason}`);
  }
});

// --- the two NEW guards ci-grant carries that migration-grant does not ----------------------

test('evaluateIssue: red-sha mismatch refuses — a grant does not survive trunk moving to a DIFFERENT red', () => {
  const record = openRecord({ comments: [grantComment('feat/x-1', { redSha: RED_SHA })] });
  const v = evaluateIssue(record, 'feat/x-1', TRUNK, OTHER_RED_SHA, okEvidence(), 105, LABEL);
  assert.equal(v.ok, false);
  assert.match(v.reason, /trunk moved|never reviewed/);
});

test('evaluateIssue: trunk-name mismatch refuses (grant reviewed against a different trunk name)', () => {
  const record = openRecord({ comments: [grantComment('feat/x-1', { trunk: 'main' })] });
  const v = evaluateIssue(record, 'feat/x-1', 'dev', RED_SHA, okEvidence(), 105, LABEL);
  assert.equal(v.ok, false);
});

test('evaluateIssue: evidence null (caller could not read the branch run) refuses', () => {
  const record = openRecord({ comments: [grantComment('feat/x-1')] });
  const v = evaluateIssue(record, 'feat/x-1', TRUNK, RED_SHA, null, 105, LABEL);
  assert.equal(v.ok, false);
  assert.match(v.reason, /failed evidence read|could not be checked/);
});

test('evaluateIssue: evidence not-success refuses', () => {
  const record = openRecord({ comments: [grantComment('feat/x-1')] });
  const v = evaluateIssue(record, 'feat/x-1', TRUNK, RED_SHA, { ok: false, sha: EVID_SHA }, 105, LABEL);
  assert.equal(v.ok, false);
  assert.match(v.reason, /completed, successful CI run/);
});

test('evaluateIssue: evidence sha mismatch (branch moved since the human reviewed it) refuses', () => {
  const record = openRecord({ comments: [grantComment('feat/x-1', { evidenceSha: EVID_SHA })] });
  const v = evaluateIssue(record, 'feat/x-1', TRUNK, RED_SHA, okEvidence(OTHER_EVID_SHA), 105, LABEL);
  assert.equal(v.ok, false);
  assert.match(v.reason, /branch moved/);
});

// --- evaluateShipSet: group branch + non-vacuity, same shape as migration-grant's -----------

test('evaluateShipSet: three issues, two granted and one not — refuses, naming exactly the ungranted one', () => {
  const branch = 'feat/schema-105-106-107';
  const records = {
    105: openRecord({ comments: [grantComment(branch)] }),
    106: openRecord({ comments: [grantComment(branch)] }),
    107: openRecord({ comments: [] }),
  };
  const v = evaluateShipSet([105, 106, 107], records, branch, TRUNK, RED_SHA, okEvidence(), LABEL);
  assert.equal(v.ok, false);
  assert.deepStrictEqual(v.missing.map((m) => m.issue), [107]);
  assert.equal(v.granted.length, 2);
});

test('evaluateShipSet: flipping the third issue to granted makes the whole set ok', () => {
  const branch = 'feat/schema-105-106-107';
  const records = {
    105: openRecord({ comments: [grantComment(branch)] }),
    106: openRecord({ comments: [grantComment(branch)] }),
    107: openRecord({ comments: [grantComment(branch)] }),
  };
  const v = evaluateShipSet([105, 106, 107], records, branch, TRUNK, RED_SHA, okEvidence(), LABEL);
  assert.equal(v.ok, true, JSON.stringify(v.missing));
  assert.equal(v.granted.length, 3);
});

test('evaluateShipSet: non-vacuity — zero claimed issues never reads granted by default', () => {
  const v = evaluateShipSet([], {}, 'feat/x-1', TRUNK, RED_SHA, okEvidence(), LABEL);
  assert.equal(v.ok, false);
  assert.match(v.missing[0].reason, /no claimed issue/);
});

test('evaluateShipSet tolerates a null issues array the same way', () => {
  const v = evaluateShipSet(null, {}, 'feat/x-1', TRUNK, RED_SHA, okEvidence(), LABEL);
  assert.equal(v.ok, false);
});

test('evaluateShipSet: a failed read for one issue in the set is reported, never silently granted', () => {
  const branch = 'feat/x-1-2';
  const records = { 1: openRecord({ comments: [grantComment(branch)] }), 2: null };
  const v = evaluateShipSet([1, 2], records, branch, TRUNK, RED_SHA, okEvidence(), LABEL);
  assert.equal(v.ok, false);
  assert.deepStrictEqual(v.missing.map((m) => m.issue), [2]);
  assert.match(v.missing[0].reason, /could not be read/);
});

// --- stackingVerdict (#105 guard 2 — anti-stacking, evaluated at CREATE time) ---------------

test('stackingVerdict: refuses to create a grant when trunk is not currently red — nothing to exempt', () => {
  const v = stackingVerdict({ trunkIsRed: false, priorGrantMerge: null, redContinuousSincePriorGrant: false });
  assert.equal(v.ok, false);
  assert.match(v.reason, /not currently red/);
});

test('stackingVerdict: permits the FIRST grant against a red trunk with no prior grant merge', () => {
  const v = stackingVerdict({ trunkIsRed: true, priorGrantMerge: null, redContinuousSincePriorGrant: false });
  assert.equal(v.ok, true, v.reason);
});

test('stackingVerdict: refuses a SECOND grant while trunk has been red continuously since the first', () => {
  const v = stackingVerdict({
    trunkIsRed: true,
    priorGrantMerge: { sha: 'deadbee', at: NOW },
    redContinuousSincePriorGrant: true,
  });
  assert.equal(v.ok, false);
  assert.match(v.reason, /deadbee/);
  assert.match(v.reason, /permanently broken/);
});

test('stackingVerdict: permits a NEW grant when trunk went green at some point after the prior grant merge (a later, different red)', () => {
  const v = stackingVerdict({
    trunkIsRed: true,
    priorGrantMerge: { sha: 'deadbee', at: NOW },
    redContinuousSincePriorGrant: false,
  });
  assert.equal(v.ok, true, v.reason);
});
