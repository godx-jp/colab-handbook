'use strict';
/**
 * "Has this branch landed?" — the one shared answer, so code-sweep and code-wrap Phase B stop
 * deciding it by eye.
 *
 * THE TRAP, which is why this is a rule and not a habit. The obvious test is "how many commits is
 * the branch ahead?", and it is wrong for every branch we have ever shipped:
 *
 *     still-has-cargo = (git log <base>..<branch> non-empty) AND (git diff <base> <branch> non-empty)
 *
 * BOTH conditions, never either. A squash-merge mints a NEW commit with a NEW sha, so the branch's
 * original commits are never ancestors of the base — a commit-count rule calls finished work
 * unfinished forever, and invites re-merging it. The mirror failure is just as real: zero commits
 * ahead but a non-empty diff, because the base moved on underneath. When this was measured on live
 * worktrees there was one of each, and seven branches in this very repo reported 2–4 commits ahead
 * of a base that already contained all of their content.
 *
 * THE HOLE THE TWO-SIGNAL RULE DOES NOT CLOSE, and how this closes it. Squash-merged AND the base
 * advanced afterwards satisfies both conditions — commits ahead, and a diff that now describes the
 * base's later work in reverse — so the rule says "cargo" about work that shipped. The fix is to
 * stop asking about shas and diffs and ask the actual question:
 *
 *     does merging this branch into its base change the base's tree at all?
 *
 * `git merge-tree --write-tree <base> <branch>` answers exactly that without touching the working
 * tree, the index, or the network. Tree equal to the base's tree ⇒ the branch introduces nothing
 * ⇒ it has landed, however it was merged and however far the base has moved since.
 *
 * WHY NOT `git cherry` / patch-id, which is the intuitive way to close the same hole: it only works
 * when the branch had exactly ONE commit. A squash of n>1 commits has no patch-id in common with any
 * of them — the squash's patch is their sum — so `git cherry` marks every one `+` (unmerged). We
 * measured it: single-commit squash `-`, two-commit squash `+ +`. It would close the hole for the
 * smallest branches and stay silently wrong for the rest, which is worse than not closing it.
 *
 * WHAT IS STILL NOT COVERED, stated precisely rather than rounded up. If the base has REWRITTEN the
 * branch's work (the same lines, differently), the merge conflicts, so no tree comes back and no
 * content answer is possible. That is reported as `unknown`, never as `landed`. Callers must treat
 * `unknown` as cargo: telling someone their unmerged work is spent costs work, telling them to look
 * again costs a minute. `hasCargo()` encodes that asymmetry so no caller has to remember it.
 *
 * BASE, not trunk. The question is asked against the branch's base — trunk for an ordinary session,
 * a declared `integration:` line for a session cut from one (project.schema.md). A branch cut from a
 * long-lived line and measured against trunk reads as enormous cargo that must never be shipped to
 * trunk. Resolving the base is the caller's job; this module only ever compares the two refs it is
 * given, and never defaults one of them to `main`.
 *
 * No network. Every command here is local; a stale `origin/<base>` is the caller's problem to fetch.
 *
 * WHY THIS EXISTS AS CODE *AND* AS PROSE (CONVENTIONS.md §4), which is normally the duplication this
 * handbook warns about. The two carry different things and neither substitutes:
 *   - Prose alone was the status quo, and the status quo is what produced the wrong rule twice in
 *     two skills. A rule stated in English is re-derived by whoever reads it, and "count the commits
 *     ahead" is what people derive.
 *   - Code alone cannot be adopted by a repo that vendors its own copy rather than depending on this
 *     one — which a consumer deliberately did, precisely because depending on us means depending on
 *     a working tree. They need the RULE, not our implementation of it.
 * So the prose states the rule and its limit, this file is the executable reference, and the tests
 * are what keep them from drifting apart. What the prose must never become is a second, subtly
 * different algorithm — it describes this one.
 *
 * A HAZARD WORTH KNOWING when editing anything executable here: installs symlink into the working
 * TREE (see install.sh). Checking this repo out onto a branch changes the rule for every session on
 * the machine, immediately. Hence: work in a worktree, leave the main checkout on trunk, and keep
 * the fixed corpus in lib/landed.test.js green — it is the only thing standing between a
 * half-finished edit here and every consumer's teardown decision.
 */

const git = require('./git.js');

/** Content relationship between a branch and its base. */
const CONTAINED = 'contained'; // merging the branch would not change the base's tree
const DIVERGED = 'diverged';   // it would
const UNKNOWN = 'unknown';     // cannot tell: missing ref, conflict, git too old

/**
 * The pure half — signals in, verdict out, so CI can test the rule without building repositories
 * for every case. `containment` is authoritative when it has an answer; the two-signal rule is the
 * fallback for a git too old for `merge-tree --write-tree` (< 2.38) and is documented as such in
 * the verdict, because a caller reading `method: 'two-signal'` is being told which hole is open.
 *
 * Returns { state: 'landed'|'cargo'|'unknown', method, why }.
 */
function classify({ commitsAhead, diffEmpty, containment }) {
  if (containment === CONTAINED) {
    return { state: 'landed', method: 'content', why: 'merging the branch would not change the base tree' };
  }
  if (containment === DIVERGED) {
    return { state: 'cargo', method: 'content', why: 'merging the branch would change the base tree' };
  }

  // containment === UNKNOWN → the two-signal rule, with its hole named.
  //
  // Guard the inputs FIRST. This function is exported as the pure half precisely so a repo that
  // vendors its own copy can feed it facts it gathered itself, and a fact that failed to compute
  // arrives here as undefined/null rather than as an error. Unguarded, `undefined > 0` is false,
  // so "I could not measure this branch" would classify as `landed` — the one direction this
  // module exists to never fail in. Absent facts mean no answer, not a clean one.
  const factsUsable = Number.isInteger(commitsAhead) && commitsAhead >= 0 && typeof diffEmpty === 'boolean';
  if (!factsUsable) {
    return {
      state: 'unknown',
      method: 'none',
      why: 'no content answer, and the two-signal facts are missing or malformed ' +
        `(commitsAhead=${JSON.stringify(commitsAhead)}, diffEmpty=${JSON.stringify(diffEmpty)}) — treat as cargo`,
    };
  }

  const cargo = commitsAhead > 0 && !diffEmpty;
  if (!cargo) {
    return {
      state: 'landed',
      method: 'two-signal',
      why: commitsAhead === 0
        ? 'no commits ahead of the base'
        : 'commits ahead, but no diff against the base (squash-merged)',
    };
  }
  return {
    state: 'unknown',
    method: 'two-signal',
    why: 'commits ahead AND a diff, but no content answer — a squash followed by base movement ' +
      'looks identical to genuine cargo under this rule; treat as cargo and check by hand',
  };
}

/** Callers act on this, not on `state`: anything short of a positive `landed` keeps its cargo. */
function hasCargo(verdict) {
  return !verdict || verdict.state !== 'landed';
}

/**
 * The git half. `base` and `branch` are ref names (`dev`, `origin/dev`, `feat/x-12`) — no defaulting
 * happens here; a caller that cannot resolve a base must fail rather than guess `main`.
 *
 * Returns { state, method, why, base, branch, commitsAhead, diffEmpty, containment }.
 */
function landedState(repoAbs, base, branch) {
  const facts = { base, branch, commitsAhead: null, diffEmpty: null, containment: UNKNOWN };

  if (!base || !branch || base === branch) {
    return { ...classifyUnresolvable('base and branch must be two different refs'), ...facts };
  }
  const haveBase = git.git(['rev-parse', '--verify', '--quiet', base], repoAbs).ok;
  const haveBranch = git.git(['rev-parse', '--verify', '--quiet', branch], repoAbs).ok;
  if (!haveBase || !haveBranch) {
    const missing = [!haveBase ? base : null, !haveBranch ? branch : null].filter(Boolean).join(', ');
    return { ...classifyUnresolvable(`ref not found: ${missing}`), ...facts };
  }

  const count = git.git(['rev-list', '--count', `${base}..${branch}`], repoAbs);
  facts.commitsAhead = count.ok ? parseInt(count.stdout, 10) || 0 : 0;
  // `diff --quiet` exits 0 when identical, 1 when they differ. Any other code is an error, and an
  // error must not read as "identical" — that is the direction that loses work.
  const diff = git.git(['diff', '--quiet', base, branch], repoAbs);
  facts.diffEmpty = diff.code === 0;

  facts.containment = containmentOf(repoAbs, base, branch);
  return { ...classify(facts), ...facts };
}

/**
 * `git merge-tree --write-tree` exit codes, verified rather than assumed:
 *   0 → clean merge; stdout's first line is the resulting tree (equal to the base's tree ⇒ contained)
 *   1 → CONFLICT. Not "a clean merge with changes" — a clean merge with changes also exits 0, with a
 *        different tree. A conflict yields no usable tree, so the honest answer is UNKNOWN.
 *   other → the flag is unsupported (git < 2.38) or the invocation failed → UNKNOWN.
 */
function containmentOf(repoAbs, base, branch) {
  const baseTree = git.git(['rev-parse', `${base}^{tree}`], repoAbs);
  if (!baseTree.ok) return UNKNOWN;
  const mt = git.git(['merge-tree', '--write-tree', base, branch], repoAbs);
  if (mt.code !== 0) return UNKNOWN;
  const mergedTree = mt.stdout.split('\n')[0].trim();
  if (!/^[0-9a-f]{40,64}$/.test(mergedTree)) return UNKNOWN;
  return mergedTree === baseTree.stdout ? CONTAINED : DIVERGED;
}

function classifyUnresolvable(why) {
  return { state: 'unknown', method: 'none', why };
}

module.exports = { classify, landedState, hasCargo, containmentOf, CONTAINED, DIVERGED, UNKNOWN };
