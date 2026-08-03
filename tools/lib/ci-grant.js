'use strict';
/**
 * The ci-grant marker (#105) — a per-issue, human-only, branch-bound, RED-TRUNK-SHA-bound,
 * expiring exemption to `colab ship`'s trunk-CI-green precondition (`shipCiCheck` in tools/colab).
 *
 * WHY A GRANT EXISTS AT ALL. `ship`'s first precondition — a completed, successful CI run for the
 * target's head sha — is right by default: unattended merges into a red trunk are exactly how a
 * broken repo stays broken. But it has exactly one un-exitable case: a GENUINELY red trunk, where
 * the candidate branch's entire content IS the fix. Nothing inside the merge can clear the
 * precondition, and nothing outside it can either — the fix cannot reach trunk without shipping,
 * and shipping requires the green the fix would produce. Without a sanctioned door the repo is
 * bricked for unattended work until a human performs the whole of Phase B by hand — squash
 * trailers, guard push, teardown, evidence, claim release, group-label cleanup — precisely the
 * surface the gates exist to get right, and the hand path is where their mistakes come back (a
 * wrong `Closes #N` is immutable once pushed).
 *
 * THIS IS NOT THE SAME DEADLOCK AS THE ONE CONVENTIONS.md:505 ALREADY NAMES. That text (and the
 * "ask by sha, not by recency" fix) resolves a FALSE red — a cancelled `cancel-in-progress`
 * straggler outranking a passing run on the same commit. Asking per-sha fixed a red that was never
 * real. A genuinely red trunk is untreated by that fix: the sha really did fail, and no amount of
 * asking differently changes the answer.
 *
 * MODELLED ON tools/lib/migration-grant.js (#98) — same problem SHAPE (a precondition right in
 * general, wrong for exactly one legitimate deliverable), so it gets the same solution rather than
 * a new mechanism: two markers (a LABEL gating who may even attempt the read, a COMMENT carrying
 * what the label cannot), written under `COLAB_HUMAN=1`, read on `ship`, visible from any machine.
 * DELIBERATELY A SEPARATE MODULE, not a shared base extracted from migration-grant.js — extracting
 * would touch a passing safety-critical module for a reason unrelated to migrations, the same
 * argument tools/lib/ship-migration-grant.test.js makes about its own fixture.
 *
 * WHY THIS GRANT IS STRICTLY MORE DANGEROUS THAN THE MIGRATION ONE, and what compensates:
 *   - A bad migration grant merges ONE reviewed schema change. A bad CI grant merges into a repo
 *     whose OWN TEST SUITE is known-failing — the merge itself is unverified by the gate that
 *     exists to verify it.
 *   - So, unlike migration-grant, THIS grant is bound to the RED TRUNK SHA it was reviewed
 *     against, and expires the instant trunk's head moves — granted-and-consumed or not. A grant
 *     surviving into a DIFFERENT red (trunk moved, a new and different failure) was never reviewed
 *     against that failure and must not silently keep working.
 *   - And it requires MEASURED evidence — a real, completed, successful CI run on the branch's OWN
 *     head — never a human's say-so alone. `--evidence-run` (tools/colab) is a recording-only
 *     pointer for the audit trail; it can never substitute for the measured run this module checks.
 *   - Anti-stacking (evaluated at grant-CREATE time in tools/colab, not here — this module is pure)
 *     refuses a second grant while trunk is STILL red after one grant already merged something:
 *     otherwise the exemption becomes the way work ships on a permanently broken repo, exactly the
 *     failure the gate was built to prevent.
 *
 * TWO MARKERS, TWO DIFFERENT JOBS — read together, never one alone, same split as migration-grant:
 *   - a LABEL (`ci-granted`, tools/lib/labels.js) — a cheap `gh issue list --label` query, and the
 *     load-bearing half: applying a label on GitHub requires triage/write permission, so a
 *     drive-by commenter on a public repo cannot manufacture a grant merely by posting a
 *     well-formed comment.
 *   - a COMMENT (this module's GRANT_MARK/REVOKE_MARK) — carries what a label cannot: the branch,
 *     the RED TRUNK SHA, the EVIDENCE RUN SHA, who granted it, and when.
 *
 * Both are required for a grant to read as live (evaluateIssue, below) — a label with no live
 * comment is exactly the state a rolled-back/failed write leaves, and must refuse, not "grant".
 *
 * PURE BY CONSTRUCTION, same posture as migration-grant.js / readiness.js / landed.js /
 * shipguard.js: signals in, verdict out. No git, no network, no `gh`. The caller (tools/colab)
 * measures the red trunk sha and the branch's evidence run and hands them in — this module never
 * reads either off the network itself, so every decision worth pinning lives where `node --test`
 * can reach it directly.
 *
 * WHO IS ALLOWED TO WRITE THE COMMENT is a DIFFERENT question from who is allowed to APPLY the
 * label — identical split to migration-grant.js. This module answers only the READ side
 * (TRUSTED_ASSOCIATIONS), closing the "drive-by comment on a public repo" hole the label narrows
 * but does not by itself close. The human-only WRITE path is enforced in tools/colab via
 * `COLAB_HUMAN=1`, the same bar `cmdPromote` and `cmdMigrationGrant` already hold.
 */

/** The two comment markers. STABLE WIRE FORMAT — do not reword casually; `tools/colab` and any
 *  vendored reader parse these verbatim. Deliberately a DIFFERENT leading emoji from BOTH
 *  migration-grant's marks (🛢/🚫) AND each other, so no regex here or in migration-grant.js can
 *  ever cross-match — a four-way collision test in ci-grant.test.js pins this. */
const GRANT_MARK = '🚨 Red-trunk CI grant';
const REVOKE_MARK = '🧯 Red-trunk CI grant revoked';

const GRANT_RE = /^🚨 Red-trunk CI grant — branch `([^`]*)` · red `([^`]*)`@`([^`]*)` · evidence `([^`]*)` · host `([^`]*)` · (\S+)/;
const REVOKE_RE = /^🧯 Red-trunk CI grant revoked — branch `([^`]*)` · host `([^`]*)` · (\S+)/;

/** The exact grant-comment body. Keep in lockstep with GRANT_RE. Carries strictly more than
 *  migration-grant's equivalent: the TRUNK NAME + RED SHA it was reviewed against, and the
 *  EVIDENCE RUN sha that proved the branch's own head green — both are read back and re-checked
 *  by evaluateIssue, not merely stored for audit. */
function grantCommentBody(branch, trunk, redSha, evidenceSha, host, iso) {
  return `${GRANT_MARK} — branch \`${branch}\` · red \`${trunk}\`@\`${redSha}\` · evidence \`${evidenceSha}\` · host \`${host}\` · ${iso}`
    + ` — this exempts THIS BRANCH from the trunk-CI-green precondition ONLY, only while \`${trunk}\``
    + ` is still at \`${redSha}\`, and expires when this issue closes.`;
}

/** The exact revoke-comment body. Keep in lockstep with REVOKE_RE. `branch` is the branch named in
 *  the record for the audit trail — revocation itself is NOT branch-scoped (see evaluateIssue doc
 *  in migration-grant.js; identical reasoning applies here). */
function revokeCommentBody(branch, host, iso) {
  return `${REVOKE_MARK} — branch \`${branch}\` · host \`${host}\` · ${iso}`
    + ' — every grant on this issue up to this point is cancelled.';
}

/**
 * Every GRANT_MARK comment not cancelled by a LATER REVOKE_MARK — identical algorithm to
 * migration-grant.js's liveGrants (see that module's doc for why revocation is NOT author-scoped).
 * Sort is by `createdAt` (GitHub's own timestamp, authoritative — never comment array order).
 *
 * Returns [{branch, trunk, redSha, evidenceSha, host, at, login, authorAssociation}], oldest-first.
 */
function liveGrants(comments) {
  const list = Array.isArray(comments) ? comments : [];
  const sorted = [...list].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));

  let lastRevokeAt = null;
  for (const c of sorted) {
    const body = String(c.body || '').trim();
    if (REVOKE_RE.test(body)) {
      if (lastRevokeAt === null || c.createdAt > lastRevokeAt) lastRevokeAt = c.createdAt;
    }
  }

  const live = [];
  for (const c of sorted) {
    const body = String(c.body || '').trim();
    const m = body.match(GRANT_RE);
    if (!m) continue;
    const at = c.createdAt;
    const cancelled = lastRevokeAt !== null && lastRevokeAt > at;
    if (cancelled) continue;
    live.push({
      branch: m[1],
      trunk: m[2],
      redSha: m[3],
      evidenceSha: m[4],
      host: m[5],
      at,
      login: (c.author && c.author.login) || '',
      authorAssociation: c.authorAssociation || '',
    });
  }
  return live;
}

/** Association values this module treats as trustworthy enough to write a permission a scheduled
 *  driver will rely on — identical set and identical reasoning to migration-grant.js's. */
const TRUSTED_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

/**
 * One issue's verdict for a branch about to ship, against the trunk sha it is CURRENTLY red at
 * and the evidence run CURRENTLY measured for the branch's head.
 *
 * `record` is exactly what `git.ghIssueView(repo, num, ['state', 'labels', 'comments'])` returns,
 * or `null` when that read FAILED — never treat `null` as "no grant" (see migration-grant.js's
 * identical warning; the caller must fail closed on a failed read exactly as hard as on a
 * confirmed absence).
 *
 * `redTrunkSha` is the trunk head sha the caller measured as CURRENTLY red — passed in, never
 * re-derived here, because this module is pure. `evidence` is `{ok, sha}` — `ok` true only for a
 * completed, successful run measured on `branch`'s current head; `sha` is that head's sha. Passing
 * `evidence: null` means the caller's own read of the branch's run FAILED — refuses, same
 * fail-closed posture as a null `record`.
 *
 * `labelName` is passed in rather than imported from labels.js, keeping this module free of any
 * dependency beyond its own two regexes — identical reasoning to migration-grant.js.
 *
 * Order of checks: cheapest/most-fundamental first, each with a distinct actionable reason string.
 */
function evaluateIssue(record, branch, trunk, redTrunkSha, evidence, issueNum, labelName) {
  const issue = issueNum;
  if (!record) {
    return { issue, ok: false, grant: null,
      reason: `#${issue} could not be read from the tracker — a failed read is never a grant` };
  }
  if (record.state !== 'OPEN') {
    return { issue, ok: false, grant: null,
      reason: `#${issue} is ${record.state || 'not open'} — a grant expires when its issue closes` };
  }
  const labelNames = (record.labels || []).map((l) => (l && typeof l === 'object' ? l.name : l));
  if (!labelNames.includes(labelName)) {
    return { issue, ok: false, grant: null,
      reason: `#${issue} does not carry the \`${labelName}\` label` };
  }
  const grants = liveGrants(record.comments);
  if (grants.length === 0) {
    return { issue, ok: false, grant: null,
      reason: `#${issue} carries the label but has no live grant comment (revoked, or never posted)` };
  }
  const g = grants[grants.length - 1]; // most recent live grant
  if (g.branch !== branch) {
    return { issue, ok: false, grant: g,
      reason: `#${issue}'s grant is bound to branch "${g.branch}", not "${branch}"` };
  }
  if (!TRUSTED_ASSOCIATIONS.has(g.authorAssociation)) {
    return { issue, ok: false, grant: g,
      reason: `#${issue}'s grant was posted by ${g.login || '(unknown)'} (${g.authorAssociation || 'unknown association'}) — not a repo owner/member/collaborator` };
  }
  if (g.trunk !== trunk || g.redSha !== redTrunkSha) {
    return { issue, ok: false, grant: g,
      reason: `#${issue}'s grant was reviewed against \`${g.trunk}\`@\`${g.redSha}\`, not the current \`${trunk}\`@\`${redTrunkSha}\` — trunk moved since the review, and the new head was never reviewed` };
  }
  if (!evidence) {
    return { issue, ok: false, grant: g,
      reason: `#${issue}'s grant could not be checked against the branch's current CI run — a failed evidence read is never a grant` };
  }
  if (!evidence.ok) {
    return { issue, ok: false, grant: g,
      reason: `#${issue}'s grant requires a completed, successful CI run on \`${branch}\`'s current head — none exists` };
  }
  if (evidence.sha !== g.evidenceSha) {
    return { issue, ok: false, grant: g,
      reason: `#${issue}'s grant was reviewed against evidence run \`${g.evidenceSha}\`, but \`${branch}\`'s head is now \`${evidence.sha}\` — the branch moved since the human reviewed it` };
  }
  return { issue, ok: true, grant: g, reason: '' };
}

/**
 * The ship set's verdict — every issue the branch carries, not just the subset that would close.
 * A red-trunk merge cannot be mechanically attributed to one member of a group branch, so if ANY
 * claimed issue lacks a valid grant, the whole set fails — one granted issue must never smuggle an
 * unreviewed red-trunk merge in for its siblings. Identical reasoning to migration-grant.js's
 * evaluateShipSet, including the NON-VACUITY guard: `[].every(...)` is `true` in JavaScript, and a
 * branch with ZERO claimed issues must NOT read as granted by default.
 *
 * `records` maps issue number → the `ghIssueView` result for that issue, or `null` on a failed
 * read (the caller's job, not this function's).
 */
function evaluateShipSet(issues, records, branch, trunk, redTrunkSha, evidence, labelName) {
  const list = Array.isArray(issues) ? issues : [];
  if (list.length === 0) {
    return { ok: false, granted: [],
      missing: [{ issue: null, reason: 'no claimed issue on this branch could carry a grant' }] };
  }
  const granted = [];
  const missing = [];
  for (const n of list) {
    const v = evaluateIssue(records ? records[n] : null, branch, trunk, redTrunkSha, evidence, n, labelName);
    if (v.ok) granted.push({ issue: n, branch: v.grant.branch, by: v.grant.login, at: v.grant.at, redSha: v.grant.redSha, evidenceSha: v.grant.evidenceSha });
    else missing.push({ issue: n, reason: v.reason });
  }
  return { ok: missing.length === 0, granted, missing };
}

/**
 * Anti-stacking verdict (#105 guard 2) — pure, used by the `colab ci-grant` CREATE path (tools/
 * colab), NOT by ship's read path above (ship only ever re-checks a grant already made; whether a
 * NEW one may be MADE is a separate, narrower question this function answers).
 *
 * `trunkIsRed` — the caller's OWN measurement of whether trunk currently has a completed,
 * successful run. Refuses outright when trunk is NOT red: an exemption with nothing to exempt is a
 * loaded gun sitting on an issue, never a no-op grant.
 *
 * `priorGrantMerge` — `null` when no `CI-Grant:`-trailer merge was found on trunk since the last
 * time trunk was confirmed green (the caller's job to search, via `git log --grep`), or
 * `{sha, at}` naming the most recent one. When one exists, a second grant is refused UNLESS trunk
 * has gone green at some point since that merge (i.e. the red the new grant would exempt is a
 * DIFFERENT, later red than the one the prior grant fixed) — the caller signals this via
 * `redSince`, `null`/absent meaning "still the same continuous red".
 */
function stackingVerdict({ trunkIsRed, priorGrantMerge, redContinuousSincePriorGrant }) {
  if (!trunkIsRed) {
    return { ok: false, reason: 'trunk is not currently red — nothing for a CI grant to exempt' };
  }
  if (priorGrantMerge && redContinuousSincePriorGrant) {
    return { ok: false, reason: `a CI grant already merged ${priorGrantMerge.sha} against this red trunk and trunk has been red ever since — a second exemption is how a permanently broken repo ships anyway. Revert the bad merge or fix trunk by hand instead of granting again.` };
  }
  return { ok: true, reason: '' };
}

module.exports = {
  GRANT_MARK, REVOKE_MARK, GRANT_RE, REVOKE_RE,
  grantCommentBody, revokeCommentBody,
  liveGrants, TRUSTED_ASSOCIATIONS,
  evaluateIssue, evaluateShipSet, stackingVerdict,
};
