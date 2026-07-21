'use strict';
/**
 * "Can this issue start right now?" — the one shared answer, so every consumer of the dependency
 * graph stops re-deriving it, and stops deriving it as a boolean.
 *
 * THE TRAP. "Open ∧ unclaimed ∧ no open blocker" evaluates the third term as a yes/no, and that
 * yes/no covers two situations that are not alike:
 *
 *   - a blocker nobody has started — no code exists anywhere;
 *   - a blocker whose code is written, pushed, and stopped at the human merge gate.
 *
 * For the second, "blocked" is false in practice: the thing being waited for already exists, and
 * only a merge stands between it and the trunk. A dependent told "blocked" there is parked for no
 * reason. So readiness has THREE values, not two:
 *
 *     blocked · ready-with-a-note (the dependency exists, unmerged) · ready
 *
 * WHERE THE MIDDLE STATE LIVES, which is the part with no obvious answer. Not in the graph. The
 * relationship stays recorded exactly as it is true — `blocked_by` says *this waits for that*, and
 * that fact does not stop being true because the blocker grew a branch. The middle state is
 * COMPUTED here, at read time, from the relationship PLUS the blocker's state.
 *
 * Two alternatives were considered and rejected, and the rejections are the load-bearing half:
 *   - A NEW MARKER for the soft case (a label). It is derived state, so it is stale the moment the
 *     blocker moves — the identical hazard the `deps-checked` marker already carries, now with a
 *     second label to keep fresh and two markers free to disagree.
 *   - DELETING the `blocked_by` edge once the blocker's code is written. This destroys a true fact
 *     for a display's convenience, and does not survive the blocker being reverted: the dependency
 *     returns, the edge does not, and nothing is left that knows the two are related.
 * A relationship is a fact; readiness is a judgement. Recording a judgement where the facts live is
 * how the two start contradicting each other, and the graph is what everything else trusts.
 *
 * AN ACTIVE SESSION IS NOT EVIDENCE, and this module will not be talked into treating it as any.
 * `session` is accepted on a blocker and deliberately ignored — accepted so a caller passing it
 * learns from the verdict that it did not count, rather than believing it did. Measured: a session
 * open ten minutes was already dead, having never claimed the issue it was opened for. A dependent
 * started on that evidence waits for something that never arrives. An open session is intent. A
 * pushed branch with real commits is evidence. Only the second moves a verdict.
 *
 * UNPUSHED IS NOT EVIDENCE EITHER, for the same reason claims are authoritative only when they are
 * visible from any machine: a branch that exists on one laptop cannot be seen, reviewed or merged
 * by the session that would depend on it.
 *
 * WHICH DIRECTION THIS FAILS IN — the opposite one from landed.js, which is why they are two
 * functions and not one. There, an unmeasurable branch must never read `landed`, because telling
 * someone their unmerged work is spent destroys it. Here, an unmeasurable blocker must never read
 * `ready`, because starting into a wall wastes a session. Both refuse to be optimistic; optimism
 * just points elsewhere. Absent or malformed facts therefore yield `blocked`, never `ready`.
 *
 * WHY THIS REUSES landed.classify() RATHER THAN ASKING ITS OWN QUESTION. "Is the blocker's code
 * written but unmerged?" is "does the blocker's branch still carry cargo?", asked from the other
 * side. A second evidence classifier would be a second commit-counting rule to get wrong — the
 * exact failure landed.js documents, which took two skills two tries. This module supplies the
 * mapping and none of the git reasoning.
 *
 * PURE BY CONSTRUCTION: signals in, verdict out. No git, no network, no `gh`. The caller gathers
 * (the graph edge, the blocker's open/closed state, its branch facts) and this decides. That is
 * what lets a consumer outside this repo — a dashboard, a vendored copy — reach the same verdict
 * from facts it collected its own way.
 */

const landed = require('./landed.js');

/** The four verdicts. `UNCHECKED` is not a fourth kind of ready — it is "nobody looked". */
const READY = 'ready';
const SOFT = 'ready-with-a-note'; // a real blocker, whose code is already written and pushed
const BLOCKED = 'blocked';
const UNCHECKED = 'unchecked';

/** Per-blocker verdicts, in increasing order of how much they stop you. */
const CLEAR = 'clear';       // this one does not block: closed, or its work is already on the base
const SOFT_BLOCK = 'soft';   // the dependency exists as pushed, unmerged code
const HARD_BLOCK = 'hard';   // no code exists, or we cannot tell

/**
 * One blocker, judged on its state rather than on the existence of the edge.
 *
 * Input: {
 *   number,                 // for the note; not used in the judgement
 *   open,                   // boolean — false/absent means closed
 *   branch,                 // null, or { pushed, commitsAhead, diffEmpty, containment }
 *   session,                // ACCEPTED AND IGNORED, on purpose — see the header
 * }
 *
 * Returns { state: 'clear'|'soft'|'hard', why }.
 */
function classifyBlocker(blocker) {
  if (!blocker || typeof blocker !== 'object') {
    return { state: HARD_BLOCK, why: 'blocker facts missing — treat as blocking' };
  }
  if (!blocker.open) {
    return { state: CLEAR, why: 'blocker is closed' };
  }

  const branch = blocker.branch;
  if (!branch || typeof branch !== 'object') {
    return { state: HARD_BLOCK, why: 'open, and no branch: no code exists yet' };
  }
  if (branch.pushed !== true) {
    return {
      state: HARD_BLOCK,
      why: 'open, and its branch is not pushed — work nobody else can see is not evidence',
    };
  }

  const verdict = landed.classify({
    commitsAhead: branch.commitsAhead,
    diffEmpty: branch.diffEmpty,
    containment: branch.containment,
  });

  if (verdict.state === 'landed') {
    // GUARD, and it closes a real fail-open hole. `landed` also comes back for a branch that is
    // ahead by nothing — a branch pushed and never committed to introduces no content, so it reads
    // exactly like a squash-merged one. Merged work and an empty branch are opposite facts about
    // whether the dependency exists; only the first clears anything.
    if (!(Number.isInteger(branch.commitsAhead) && branch.commitsAhead > 0)) {
      return {
        state: HARD_BLOCK,
        why: 'its branch is pushed but carries no commits — an empty branch is not code',
      };
    }
    return {
      state: CLEAR,
      why: `its work is already on the base (${verdict.why}); the open issue is tracker lag`,
    };
  }
  if (verdict.state === 'cargo') {
    return { state: SOFT_BLOCK, why: 'its code is written and pushed, waiting at the merge gate' };
  }
  return { state: HARD_BLOCK, why: `cannot tell whether its work exists (${verdict.why})` };
}

/**
 * The whole verdict for one issue.
 *
 * Input: {
 *   blockers,      // array of blocker facts. undefined/null means NOBODY LOOKED — not "none".
 *   depsChecked,   // the marker meaning someone verified an empty blocker list
 * }
 *
 * Returns { state, why, notes: [{ number, why }], hard: [{ number, why }] }.
 */
function classify({ blockers, depsChecked } = {}) {
  if (!Array.isArray(blockers)) {
    return {
      state: UNCHECKED,
      why: 'no dependency data — an absent blocker list means nobody looked, not that none exist',
      notes: [],
      hard: [],
    };
  }

  const judged = blockers.map((b) => ({ number: b && b.number, ...classifyBlocker(b) }));
  const hard = judged.filter((j) => j.state === HARD_BLOCK);
  const notes = judged.filter((j) => j.state === SOFT_BLOCK);

  if (hard.length) {
    return {
      state: BLOCKED,
      why: hard.map((j) => `#${j.number}: ${j.why}`).join('; '),
      notes,
      hard,
    };
  }
  if (notes.length) {
    return {
      state: SOFT,
      why: notes.map((j) => `#${j.number}: ${j.why}`).join('; '),
      notes,
      hard: [],
    };
  }
  if (blockers.length === 0 && !depsChecked) {
    return {
      state: UNCHECKED,
      why: 'blocker list is empty and unverified — "none" and "nobody checked" look identical',
      notes: [],
      hard: [],
    };
  }
  return {
    state: READY,
    why: blockers.length ? 'every blocker is closed or already landed' : 'checked: no blockers',
    notes: [],
    hard: [],
  };
}

/**
 * Callers act on this, not on `state`: work may begin on a positive `ready` or `ready-with-a-note`
 * and on nothing else. `unchecked` is not startable — that is the distinction the marker exists for.
 */
function isStartable(verdict) {
  return Boolean(verdict) && (verdict.state === READY || verdict.state === SOFT);
}

module.exports = {
  classify, classifyBlocker, isStartable,
  READY, SOFT, BLOCKED, UNCHECKED,
  CLEAR, SOFT_BLOCK, HARD_BLOCK,
};
