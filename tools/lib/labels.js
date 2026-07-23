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
 */

const CONVENTION_LABELS = [
  { name: 'in-progress', color: 'FBCA04', description: 'Claimed by an active session' },
  { name: 'deps-checked', color: '0E8A16', description: 'Dependencies verified — no open blocker' },
  { name: 'agent-filed', color: 'C5DEF5', description: 'Filed by an agent on its own initiative — not human-approved' },
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

module.exports = {
  CONVENTION_LABELS, conventionLabelNames, missingConventionLabels,
  READINESS_LABEL, readinessLabelArgs, readinessMissingLabelHint,
};
