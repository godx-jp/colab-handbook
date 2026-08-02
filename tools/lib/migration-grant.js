'use strict';
/**
 * The migration-grant marker (#98) — a per-issue, human-only, branch-bound, expiring exemption
 * to `colab ship`'s no-new-migrations precondition (`newMigrations()` in tools/colab).
 *
 * WHY A GRANT EXISTS AT ALL. The no-new-migrations gate is right by default: a schema change
 * merged into trunk is pulled by every other worktree next, and where dev data is shared a bad
 * one costs everyone at once. But it makes one legitimate class of work permanently un-shippable
 * without a person — an issue whose entire deliverable IS a schema change. Under a scheduled
 * driver such an issue parks forever, every tick. This module is the narrow yes: a human reviewed
 * THIS branch's migration and said so, for THIS issue, until THIS issue closes.
 *
 * TWO MARKERS, TWO DIFFERENT JOBS — read together, never one alone:
 *   - a LABEL (`migration-granted`, tools/lib/labels.js) — makes an outstanding grant a cheap
 *     `gh issue list --label` query (requirement 7), and — the load-bearing half — applying a
 *     label on GitHub requires triage/write permission on the repo, so a drive-by commenter on a
 *     public repo cannot manufacture a grant merely by posting a well-formed comment.
 *   - a COMMENT (this module's GRANT_MARK/REVOKE_MARK) — carries what a label cannot: the BRANCH
 *     the grant is bound to (label names cap at 50 chars; this repo's branch names run longer),
 *     who granted it, and when. The comment is the authority; the label is the gate.
 *
 * Both are required for a grant to read as live (evaluateIssue, below) — a label with no live
 * comment is exactly the state a rolled-back/failed write leaves, and must refuse, not "grant".
 *
 * PURE BY CONSTRUCTION, same posture as readiness.js / landed.js / shipguard.js: signals in,
 * verdict out. No git, no network, no `gh`. `tools/colab` has no test harness of its own (see the
 * comment at its `branchCommits` — the reason logic worth pinning lives in tools/lib/*.js instead),
 * so every decision here that is worth getting right on purpose lives in a file `node --test` can
 * reach directly.
 *
 * WHO IS ALLOWED TO WRITE THE COMMENT is a DIFFERENT question from who is allowed to APPLY the
 * label, and this module answers only the second by requiring TRUSTED_ASSOCIATIONS on read —
 * closing the "drive-by comment on a public repo" hole the label already narrows but does not, by
 * itself, close (a repo collaborator could still be a machine account; that is a policy question
 * for the repo, not this module). The human-only property on the WRITE path (nobody but a person
 * may run `colab migration-grant`) is enforced in tools/colab via COLAB_HUMAN=1 — the identical
 * bar `cmdPromote` already holds a production promotion to. This module has no opinion on how the
 * comment got posted; it only judges whether what's on the tracker, right now, is a live grant
 * this branch and this issue may rely on.
 */

/** The two comment markers. STABLE WIRE FORMAT — do not reword casually; `tools/colab` and any
 *  vendored reader parse these verbatim, the same posture as CLAIM_MARK/RELEASE_MARK in tools/colab. */
const GRANT_MARK = '🛢 Migration grant';
const REVOKE_MARK = '🚫 Migration grant revoked';

// Deliberately DIFFERENT leading emoji (not just different trailing text) so neither `startsWith`
// nor either regex can ever match the other mark's body — a revoke mark that merely suffixed the
// grant mark would make every revoke parse as a fresh grant, silently reopening exactly the door
// it was posted to close. Covered by a dedicated test (grant-revoke-mark-collision).
const GRANT_RE = /^🛢 Migration grant — branch `([^`]*)` · host `([^`]*)` · (\S+)/;
const REVOKE_RE = /^🚫 Migration grant revoked — branch `([^`]*)` · host `([^`]*)` · (\S+)/;

/** The exact grant-comment body. Keep in lockstep with GRANT_RE. */
function grantCommentBody(branch, host, iso) {
  return `${GRANT_MARK} — branch \`${branch}\` · host \`${host}\` · ${iso}`
    + ' — this exempts THIS BRANCH only, and expires when this issue closes.';
}

/** The exact revoke-comment body. Keep in lockstep with REVOKE_RE. `branch` is the branch named in
 *  the record for the audit trail — revocation itself is NOT branch-scoped (see evaluateIssue doc). */
function revokeCommentBody(branch, host, iso) {
  return `${REVOKE_MARK} — branch \`${branch}\` · host \`${host}\` · ${iso}`
    + ' — every grant on this issue up to this point is cancelled.';
}

/**
 * Every GRANT_MARK comment not cancelled by a LATER REVOKE_MARK — whoever posted the revoke.
 *
 * Deliberately NOT author-scoped, unlike liveClaimComments() in tools/colab: a claim is a
 * per-identity assertion racing other identities, so cancellation there is scoped to "the same
 * author can undo their own claim." A grant has no race to settle — it is a standing authorization
 * a human is meant to be able to pull the instant it looks wrong, from any trusted account, on any
 * machine. Scoping revocation by author would let a grant outlive a revoke posted from the other
 * maintainer's login or the other machine, which is exactly backwards for a safety gate.
 *
 * Sort is by `createdAt` (GitHub's own timestamp, sub-second, authoritative — never comment order
 * in the array, which is not guaranteed). A grant AFTER the latest revoke is live again: grant,
 * revoke, grant is "currently granted," not "permanently revoked."
 *
 * Returns [{branch, host, at, login, authorAssociation}], oldest-first — a live grant is the LAST
 * entry a caller cares about, but the whole ordered list is returned so a caller (e.g. `--list`)
 * can show history, not just the current verdict.
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
      host: m[2],
      at,
      login: (c.author && c.author.login) || '',
      authorAssociation: c.authorAssociation || '',
    });
  }
  return live;
}

/** Association values GitHub reports (`gh issue view --json comments`'s `authorAssociation`) that
 *  this module treats as trustworthy enough to write a permission a scheduled driver will rely on.
 *  This closes a DIFFERENT hole than COLAB_HUMAN (tools/colab): that gates WHO MAY WRITE the
 *  comment (a human, via the CLI); this gates WHOSE COMMENT ship WILL HONOR ON READ — closing the
 *  gap a public repo has by default, where anyone can post a perfectly-formed comment by hand. */
const TRUSTED_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

/**
 * One issue's verdict for a branch about to ship. `record` is exactly what
 * `git.ghIssueView(repo, num, ['state', 'labels', 'comments'])` returns, or `null` when that read
 * FAILED — never treat `null` as "no grant"; that conflates "could not confirm" with "confirmed
 * absent," and the caller (tools/colab) must fail closed on the former exactly as hard as the latter.
 *
 * `labelName` is passed in rather than imported from labels.js, keeping this module free of any
 * dependency beyond its own two regexes — the caller (tools/colab) already has labels.js loaded
 * and is the one place that should know the label's name.
 *
 * Order of checks is deliberate: cheapest/most-fundamental failures first, and each has a distinct,
 * actionable reason string — an operator or a scheduled driver's park-and-say-once log reads this
 * directly, so vague reasons cost a person re-deriving what to do.
 */
function evaluateIssue(record, branch, issueNum, labelName) {
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
  return { issue, ok: true, grant: g, reason: '' };
}

/**
 * The ship set's verdict (#98 requirement 5) — every issue the branch carries, not just the
 * subset that would close (`closeIssues`). A migration cannot be mechanically attributed to one
 * member of a group branch, so if ANY claimed issue lacks a valid grant, the whole set fails —
 * one granted issue must never smuggle an unreviewed migration in for its siblings.
 *
 * NON-VACUITY, on purpose: `[].every(...)` is `true` in JavaScript, and a branch carrying a
 * migration with ZERO claimed issues must NOT read as granted by default — there is no issue for
 * a human to have reviewed against. Refuses explicitly rather than falling through an empty loop.
 *
 * `records` maps issue number → the `ghIssueView` result for that issue, or `null` on a failed
 * read (the caller's job, not this function's — see tools/colab's shipMigrationGrants).
 */
function evaluateShipSet(issues, records, branch, labelName) {
  const list = Array.isArray(issues) ? issues : [];
  if (list.length === 0) {
    return { ok: false, granted: [],
      missing: [{ issue: null, reason: 'no claimed issue on this branch could carry a grant' }] };
  }
  const granted = [];
  const missing = [];
  for (const n of list) {
    const v = evaluateIssue(records ? records[n] : null, branch, n, labelName);
    if (v.ok) granted.push({ issue: n, branch: v.grant.branch, by: v.grant.login, at: v.grant.at });
    else missing.push({ issue: n, reason: v.reason });
  }
  return { ok: missing.length === 0, granted, missing };
}

module.exports = {
  GRANT_MARK, REVOKE_MARK, GRANT_RE, REVOKE_RE,
  grantCommentBody, revokeCommentBody,
  liveGrants, TRUSTED_ASSOCIATIONS,
  evaluateIssue, evaluateShipSet,
};
