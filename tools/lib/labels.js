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
 */

const CONVENTION_LABELS = [
  { name: 'in-progress', color: 'FBCA04', description: 'Claimed by an active session' },
  { name: 'deps-checked', color: '0E8A16', description: 'Dependencies verified — no open blocker' },
  { name: 'agent-filed', color: 'C5DEF5', description: 'Filed by an agent on its own initiative — not human-approved' },
  { name: 'epic', color: '3E4B9E', description: 'Container for sub-issues — informative, never a start candidate, never claimed as a unit of work' },
  { name: 'needs-ruling', color: 'B60205', description: 'Needs a human design ruling before this can start' },
];

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

// The `gh issue edit` label arguments for owning the readiness marker. Pure, so the mapping
// "set ⇒ add, clear ⇒ remove" is pinned by a test without a network call: the command is a thin
// shell around ghIssueEdit(repo, num, readinessLabelArgs(...)), and the part worth getting right
// is exactly this arg vector.
function readinessLabelArgs({ clear } = {}) {
  return clear
    ? ['--remove-label', READINESS_LABEL]
    : ['--add-label', READINESS_LABEL];
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
  GROUP_LABEL_PREFIX, isGroupLabel, groupLabelNames,
};
