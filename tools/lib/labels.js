'use strict';
/**
 * The labels the conventions define, in one place — CONVENTIONS.md §9 (step 3) is the
 * prose source; this is the machine copy the tooling reads, kept beside it the way the
 * tier set lives in both the prose and the audit's VALID_TIERS.
 *
 * Why a single list matters here specifically: a repo that adopted at an OLDER handbook
 * version — before one of these labels entered the set — silently never back-filled it,
 * and the check that label powers can then never fire. The claim (`in-progress`) cannot
 * land; the readiness column (`deps-checked`) can never leave "nobody looked"; provenance
 * (`agent-filed`) reads every filed issue as human-approved. So adoption provisions the
 * WHOLE set (not a subset marked optional), sync back-fills what a later version added,
 * and the audit reports the gap — all three reading this one list, so they cannot drift
 * about what "the full set" is.
 *
 * Each entry carries color + description so a provisioner (`gh label create`) and the
 * audit's presence check share not just the names but how the label is meant to look.
 *
 * `epic` joined the set in #78: the scheduled-drivers model (#70) needs a driver to
 * exclude tracking/umbrella records from what it starts unattended, exactly the way it
 * already excludes `agent-filed` issues (CONVENTIONS.md §5, *Provenance*). An
 * `epic`-labelled issue is informative — a container for sub-issues — never a start
 * candidate and never claimed as a unit of work. It joins CONVENTION_LABELS rather than
 * staying repo-local because an unattended decision now depends on it, the same bar the
 * other three met; contrast `TRACKING_LABEL` below, which stays opt-in because nothing
 * unattended reads it (yet).
 *
 * `needs-ruling` joined the set in #75: a designer producing a spec decides whether the
 * surface needs a human pre-approval before code starts, and marks the issue so — a
 * readiness gate exactly like an open hard blocker or `in-progress`, not a softer
 * advisory. Absent this label a repo cannot apply that gate at all, and a surface nobody
 * has ruled on reads as a normal start candidate to a human session or a scheduled driver
 * alike (CONVENTIONS.md §5, *Design ruling*). It joins CONVENTION_LABELS for the same
 * reason `epic` did: an unattended decision (a scheduler's start-or-skip) depends on it.
 *
 * `needs-plan` joined the set in #94: `code-triage` flags an issue it judges genuinely
 * hard — ambiguous scope, a novel design with no repo precedent, a coupling wider than
 * file overlap — and `code-start` reads the flag to decide whether to run `code-plan`
 * before coding, rather than the default 3-5-line stub. Unlike `needs-ruling` it is NOT a
 * readiness gate — a flagged issue is still startable now, it just should not go straight
 * to code (CONVENTIONS.md §5, *Planning*). It is provisioned like the rest of this set,
 * not created on demand the way `group:<key>` is, because its name is fixed and every
 * adopting repo needs it before the first triage pass can flag anything.
 *
 * `migration-granted` joined the set in #98: a human-only, per-issue, branch-bound, expiring
 * exemption to `colab ship`'s no-new-migrations precondition, for the one legitimate class of
 * work that gate would otherwise make permanently un-shippable unattended — an issue whose
 * entire deliverable IS a schema change (CONVENTIONS.md §5, *Migration exemption*). `colab ship`
 * reads it, on EVERY issue a branch carries, when — and only when — that branch touches a
 * migration path; absence is the ordinary, unexempted case and costs nothing. Its nearest
 * neighbour is `needs-ruling`, and the two point opposite directions: `needs-ruling` *blocks* a
 * start pending a human review of the design; `migration-granted` *unblocks* a ship because a
 * human already reviewed the schema change. It joins `CONVENTION_LABELS` rather than staying
 * repo-opt-in like `tracking`/`graph-empty` because its absence fails MALIGNANTLY, not benignly:
 * a repo that adopted before this label existed cannot create a grant at all, so the schema-
 * change issue parks forever under a scheduled driver — discovered only at the moment it hits
 * the wall, with no prior signal — which is exactly the "silently never back-filled it, and the
 * check that label powers can then never fire" failure this file's own opening paragraph names.
 * The label alone authorizes nothing (the branch binding lives in a comment marker,
 * tools/lib/migration-grant.js, and no automated path ever writes either half) — an unused label
 * is inert, an absent one is a wall.
 *
 * `delivery:*` joined the set in #112: a tracker mixes issues whose delivery is NOT a code
 * commit — a content push, an ops/production check, a docs sync outside code review — into a
 * pipeline whose every stage (worktree, gate, mergeable, squash, `Closes #N`) assumes one. Such
 * an issue can never reach a mergeable state, so it reads as eternally stuck, and — the expensive
 * half — it looks STARTABLE to triage and a scheduled driver alike, because no existing readiness
 * label says "this is real work, but not a diff" the way `epic` says "this is not a unit of work
 * at all". Four labels, one classifier, deliberately THREE-VALUED rather than boolean
 * (CONVENTIONS.md §5, *Delivery type*): no `delivery:*` label at all reads as **not asked**, and
 * must behave exactly as before this label set existed — every issue in every tracker is
 * unlabelled the day this lands, so absence collapsing into "non-code" would freeze the start
 * gate for everyone on day one. `delivery:code` is the explicit affirmative for a code issue;
 * `content` / `ops` / `docs-only` are the explicit non-code types, which triage and the readiness
 * gate treat as route-not-start — a companion to the `epic` rule and the `needs-ruling` gate, not
 * a merge of either. It joins `CONVENTION_LABELS` for the same reason `epic` did: an unattended
 * decision (a scheduler's or triage's start-or-skip) depends on being able to tell the three
 * states apart, and a repo that adopted before this set existed cannot create the label at all —
 * the malignant-absence failure this file's opening paragraph names.
 */

const CONVENTION_LABELS = [
  { name: 'in-progress', color: 'FBCA04', description: 'Claimed by an active session' },
  { name: 'deps-checked', color: '0E8A16', description: 'Dependencies verified — no open blocker' },
  { name: 'agent-filed', color: 'C5DEF5', description: 'Filed by an agent on its own initiative — not human-approved' },
  { name: 'epic', color: '3E4B9E', description: 'Container for sub-issues — informative, never a start candidate, never claimed as a unit of work' },
  { name: 'needs-ruling', color: 'B60205', description: 'Needs a human design ruling before this can start' },
  { name: 'needs-plan', color: '0052CC', description: 'Triage judged this hard — code-start should run code-plan before coding' },
  { name: 'migration-granted', color: 'D93F0B', description: "A human granted this issue's branch an exemption from ship's no-new-migrations gate" },
  { name: 'delivery:code', color: '1D76DB', description: 'Delivery is a code commit — the ordinary code pipeline applies' },
  { name: 'delivery:content', color: 'FEF2C0', description: 'Delivery is a content push, not a code commit — route, do not start in the code pipeline' },
  { name: 'delivery:ops', color: 'D4C5F9', description: 'Delivery is an ops/production check, not a code commit — route, do not start in the code pipeline' },
  { name: 'delivery:docs-only', color: 'BFD4F2', description: "Delivery is a docs sync outside code review, not a commit — route, don't start" },
];

// The DELIVERY label prefix (CONVENTIONS.md §5, Delivery type). Four fixed values, unlike
// `group:<key>` — provisioned up front in CONVENTION_LABELS above, not created on demand.
const DELIVERY_LABEL_PREFIX = 'delivery:';

// The three non-code delivery types — the ones triage and the readiness gate treat as
// route-not-start. `delivery:code` is deliberately excluded: it is the explicit CODE
// affirmative, not a non-code type.
const NON_CODE_DELIVERY_TYPES = ['content', 'ops', 'docs-only'];

/**
 * The three-valued delivery classifier (CONVENTIONS.md §5, *Delivery type*).
 *
 * Returns one of:
 *   - `null`     — NOT ASKED. No `delivery:*` label present. Must read identically to how the
 *                  issue behaved before this label set existed — never as non-code.
 *   - `'code'`   — `delivery:code` present.
 *   - `'content' | 'ops' | 'docs-only'` — the matching `delivery:*` label present.
 *
 * Tolerant of label objects or bare strings, the same shape every other helper in this file
 * accepts. If more than one `delivery:*` label is somehow present (a tracker mistake, not a
 * state this repo's tooling ever writes), the first match in CONVENTION_LABELS order wins —
 * deterministic, and it is a contradiction worth surfacing rather than silently averaging.
 */
function deliveryType(present) {
  const have = new Set(
    (present || []).map((n) => (n && typeof n === 'object' ? n.name : n)).map((n) => String(n)),
  );
  for (const type of ['code', ...NON_CODE_DELIVERY_TYPES]) {
    if (have.has(`${DELIVERY_LABEL_PREFIX}${type}`)) return type;
  }
  return null;
}

// Is this issue's delivery type one triage/the readiness gate should route rather than start?
// `null` (not asked) and `'code'` both read false here — only an explicit non-code type routes.
function isRouteNotStart(present) {
  return NON_CODE_DELIVERY_TYPES.includes(deliveryType(present));
}

function conventionLabelNames() {
  return CONVENTION_LABELS.map((l) => l.name);
}

// The readiness marker, named once. CONVENTIONS.md §5 (Readiness) is the prose source; the
// audit, the provisioner and now `colab readiness` all read the name from HERE rather than
// spelling the string themselves — a second literal is a second thing to typo, and a readiness
// write that targets `deps_checked` while the audit checks `deps-checked` fails silently, which
// is the whole class of bug this single list exists to make impossible.
const READINESS_LABEL = 'deps-checked';

// The marker for a long-lived MEMORY / TRACKING issue (CONVENTIONS.md §5, Tracking issues).
// A tracking issue is external memory for a whole domain — accumulated decisions and gotchas plus
// a checklist of still-open items — that a hygiene session legitimately CLAIMS (to signal work in
// the area) and REFERENCES, but does not complete. `colab ship` reads this name and emits `Refs #N`
// instead of `Closes #N` for any claimed issue that carries it, so shipping a small fix in the
// domain does not bury the memory behind a closed-issue lookup.
//
// Deliberately NOT in CONVENTION_LABELS: those are the labels whose absence makes a check silently
// impossible (a claim that cannot land, a readiness column that can never fill). This one is opt-in
// per repo and per issue — its absence just means every issue closes as before, which is the
// correct default. So adoption/sync do not force-provision it and the audit does not report its
// absence. A repo that wants the behaviour creates the label and applies it to its tracking issues.
const TRACKING_LABEL = 'tracking';

// The marker for a MECHANICAL readiness check (CONVENTIONS.md §5, Mechanical readiness — #69).
// `deps-checked` asserts a reasoning session looked and judged the issue clear — a claim a bare
// API read cannot make, because a blocker described only in prose is invisible to it. This label
// asserts the strictly weaker thing a mechanical read CAN prove honestly: the recorded graph
// (`blockedBy`) reads empty as of that read. It is a distinct name on purpose, never a synonym or
// a second color for `deps-checked` — the whole point of #69's resolution is that the two claims
// must not be allowed to collapse into one label a consumer cannot tell apart.
//
// Deliberately NOT in CONVENTION_LABELS, same reasoning as TRACKING_LABEL above: nothing
// unattended reads it (yet), so adoption/sync do not force-provision it and the audit does not
// report its absence. A repo that wants the faster, weaker lane creates the label itself and
// opts a consumer into `readiness.isStartableMechanical()`.
const MECHANICAL_READINESS_LABEL = 'graph-empty';

// The `gh issue edit` label arguments for owning the readiness marker. Pure, so the mapping
// "set ⇒ add, clear ⇒ remove" is pinned by a test without a network call: the command is a thin
// shell around ghIssueEdit(repo, num, readinessLabelArgs(...)), and the part worth getting right
// is exactly this arg vector.
function readinessLabelArgs({ clear } = {}) {
  return clear
    ? ['--remove-label', READINESS_LABEL]
    : ['--add-label', READINESS_LABEL];
}

// The `gh issue edit` label arguments for owning the MECHANICAL readiness marker. Same shape as
// readinessLabelArgs, kept as a separate function rather than a parameter on that one: the two
// markers must never be writable through the same call site, or a caller could flip one when it
// meant the other. See MECHANICAL_READINESS_LABEL above for what the label asserts.
function mechanicalReadinessLabelArgs({ clear } = {}) {
  return clear
    ? ['--remove-label', MECHANICAL_READINESS_LABEL]
    : ['--add-label', MECHANICAL_READINESS_LABEL];
}

// The migration-grant marker, named once (#98). CONVENTIONS.md §5 (Migration exemption) is the
// prose source; `colab migration-grant`, `colab ship`'s grant read, and the provisioner all read
// the name from HERE — the identical reason READINESS_LABEL is a shared constant, not a literal
// repeated at each call site.
const MIGRATION_GRANT_LABEL = 'migration-granted';

// The `gh issue edit` label arguments for owning the migration-grant marker. Pure, same shape and
// same reason as readinessLabelArgs: the write is a thin shell around
// ghIssueEdit(repo, num, migrationGrantLabelArgs(...)), and the arg vector is the part worth
// pinning with a test that makes no network call.
function migrationGrantLabelArgs({ clear } = {}) {
  return clear
    ? ['--remove-label', MIGRATION_GRANT_LABEL]
    : ['--add-label', MIGRATION_GRANT_LABEL];
}

// Given the label names a repo actually has, return the convention labels it is missing,
// in the canonical order. Tolerant of null/undefined (a repo whose labels could not be
// read is handled by the caller, not here) and of label objects vs bare strings.
function missingConventionLabels(present) {
  const have = new Set(
    (present || []).map((n) => (n && typeof n === 'object' ? n.name : n)).map((n) => String(n)),
  );
  return conventionLabelNames().filter((n) => !have.has(n));
}

// A readiness ADD (`gh issue edit --add-label deps-checked`) fails for one recurring, diagnosable
// reason: the repo adopted the conventions before `deps-checked` entered the set and never
// back-filled it, so the label the write targets does not exist. Given the labels the repo
// actually has, return an actionable message naming that cause and its fix — or null, meaning
// "not this cause, use the generic error". Two nulls, deliberately different:
//   - `present` is null → the label set could not be READ (no gh, no remote, network). We must
//     not guess the cause from a read we did not get; fall back to the raw gh error.
//   - the readiness label IS present → the ADD failed for some other reason; not ours to explain.
// This is where the doubly-silent failure of #49 is made loud: never report success on a write
// that did not land, and when it did not land for this reason, say precisely why and what fixes it.
function readinessMissingLabelHint(present) {
  if (!present) return null;
  if (!missingConventionLabels(present).includes(READINESS_LABEL)) return null;
  return `this repo has no \`${READINESS_LABEL}\` label, so readiness cannot be marked — it adopted `
    + `the conventions before that label entered the set and never back-filled it. Run handbook-sync `
    + `(§7) to create the convention label set, then re-run the command.`;
}

// Same diagnosis as readinessMissingLabelHint, for the migration-grant marker (#98): a repo that
// adopted before `migration-granted` entered the set has no such label, so a grant ADD hits a
// label that does not exist. Same two-null contract: `present` null means the read itself failed
// (fall back to the raw gh error), the label being present means the ADD failed for some other
// reason — this function is not the one to explain that.
function migrationGrantMissingLabelHint(present) {
  if (!present) return null;
  if (!missingConventionLabels(present).includes(MIGRATION_GRANT_LABEL)) return null;
  return `this repo has no \`${MIGRATION_GRANT_LABEL}\` label, so a migration grant cannot be marked — it `
    + `adopted the conventions before that label entered the set and never back-filled it. Run `
    + `handbook-sync (§7) to create the convention label set, then re-run the command.`;
}

// The GROUP label prefix (CONVENTIONS.md §5, Grouping). `group:<key>` records that a set of
// issues must share one branch — the key is the branch slug minus its trailing issue numbers.
// Deliberately NOT in CONVENTION_LABELS: it is per-group (one label PER key, not one fixed
// name), created on demand by whoever computes the grouping (`code-triage`), not provisioned
// up front the way the fixed convention set is.
const GROUP_LABEL_PREFIX = 'group:';

// Is this label name a group marker? Guards against the bare prefix itself ("group:" with no
// key) reading as one — that string names no group and nothing should ever try to delete it.
function isGroupLabel(name) {
  return typeof name === 'string' && name.length > GROUP_LABEL_PREFIX.length && name.startsWith(GROUP_LABEL_PREFIX);
}

// The group label names carried by a label list — same tolerant shape as missingConventionLabels
// (bare strings or {name} objects), so a caller can hand this `info.labels` straight off
// `gh issue view` / `gh issue list` without mapping first. Order-preserving, deduplicated: a
// caller unioning group labels across several issues (colab ship's B4, per #82) must not visit
// the same key twice.
function groupLabelNames(present) {
  const out = [];
  const seen = new Set();
  for (const n of (present || [])) {
    const name = n && typeof n === 'object' ? n.name : n;
    const s = name === undefined || name === null ? '' : String(name);
    if (isGroupLabel(s) && !seen.has(s)) { seen.add(s); out.push(s); }
  }
  return out;
}

module.exports = {
  CONVENTION_LABELS, conventionLabelNames, missingConventionLabels,
  READINESS_LABEL, readinessLabelArgs, readinessMissingLabelHint,
  TRACKING_LABEL,
  MECHANICAL_READINESS_LABEL, mechanicalReadinessLabelArgs,
  MIGRATION_GRANT_LABEL, migrationGrantLabelArgs, migrationGrantMissingLabelHint,
  GROUP_LABEL_PREFIX, isGroupLabel, groupLabelNames,
  DELIVERY_LABEL_PREFIX, NON_CODE_DELIVERY_TYPES, deliveryType, isRouteNotStart,
};
