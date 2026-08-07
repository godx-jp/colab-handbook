'use strict';
/**
 * The three guards `colab ship` runs over what it is ABOUT to write into an immutable commit
 * message, plus the one that decides a zero-commit branch's completion path. All pure: they take
 * facts already read from git/gh and return findings. Git I/O stays in the CLI, same split as
 * lib/squash.js — and for the same reason, which that module states plainly: `tools/colab` has no
 * test harness, `tools/lib/*.test.js` is wired into CI, and every bug these functions exist to stop
 * was invisible precisely because nothing tested it.
 *
 * WHY ALL THREE LIVE TOGETHER. They are one composition path — the harvest that decides `Closes
 * #N`, the message that describes it, and the close that follows — and they were filed as three
 * issues (#87, #88, #90) only because they were measured on three different days. Splitting them
 * across modules would hide that a change to one can invalidate the others.
 *
 * THE SHARED CONSTRAINT, which is why these are gates and not advice: a squash message cannot be
 * corrected without a force-push that rewrites published history and any tag pointing at it, and a
 * `Closes #N` GitHub has honoured cannot be un-honoured — reopening leaves the false claim in the
 * commit. Check before the merge, not after.
 *
 * A FOURTH GUARD, added for #119: `closesCoverage` re-reads the FINAL message — the exact string
 * about to be handed to `git commit -m` — and asserts every issue this ship resolved to CLOSE has a
 * `Closes #N` line in it. Investigation for #119 found both message paths (`--message` override and
 * the composed path) already funnel through `lib/squash.js`'s `spliceCloses`, which guarantees this
 * on every reachable path today — so the hard gate here is regression-proofing against a future
 * path that composes a message some other way, not a fix for a currently-reachable failure. The
 * genuinely reachable incident #119 describes (a branch's own `Closes #N`, written in a commit body
 * that the squash does not carry verbatim, silently dropped) is caught by this same function as an
 * ADVISORY finding (`dropped`), not a hard failure — see the doc comment on `closesCoverage`.
 */

const squash = require('./squash.js');

/**
 * Issue numbers a branch NAME claims, per CONVENTIONS.md §4: the numbers live in one trailing run.
 *
 * Anchored to the trailing run deliberately — a naive sweep for every `\d+` reads
 * `feat/oauth2-login-88` as issues 2 and 88, and an invented issue number is exactly the class of
 * error this module exists to prevent. `fix/import-fixes-115-114-113` → [115, 114, 113].
 *
 * Returns [] for a branch that carries no trailing number group. That is not an error: plenty of
 * legitimate branches predate the rule (§4 grandfathers them), so callers must treat [] as "this
 * source has nothing to say", never as "this branch claims no issues".
 */
function branchIssueNumbers(branchName) {
  const m = /-(\d+(?:-\d+)*)$/.exec(String(branchName || ''));
  if (!m) return [];
  return m[1].split('-').map(Number).filter((n) => Number.isInteger(n) && n > 0);
}

/** Every `#N` mentioned in any commit subject or body on the branch, de-duplicated. */
function commitIssueNumbers(commits) {
  const out = new Set();
  for (const c of Array.isArray(commits) ? commits : []) {
    const text = `${(c && c.subject) || ''}\n${(c && c.body) || ''}`;
    for (const m of text.matchAll(/#(\d+)\b/g)) out.add(Number(m[1]));
  }
  return [...out];
}

/**
 * B1b's cross-check, performed by the tool instead of by whoever is reading (#87).
 *
 * `ship` resolves what it will close from the CLAIM REGISTRY, read at ship time. A claim written by
 * a different, still-running session onto the same branch is indistinguishable from one the
 * shipping session made itself — so a co-tenant joining a `group:` branch silently enlarges what
 * the ship closes. Measured: a branch carrying #71 and #76 reported `issues: [71, 74, 76]`, because
 * a second session claimed #74 onto the same worktree minutes after the ship was authorised and had
 * only just started work. Nothing on the branch implemented #74. Had it proceeded, `Closes #74`
 * would have gone into trunk's history and GitHub would have closed an issue whose work had not
 * begun.
 *
 * CLAUDE.md's B1b already prescribed the fix in prose — git and the registry "fail in opposite
 * directions… a number in one set and not the other is a finding" — and it was performed by hand.
 * This is that same comparison, mechanical.
 *
 * `issues` is the registry's contribution; the branch NAME and the COMMIT BODIES are the two
 * git-side sources §4 makes load-bearing. An issue corroborated by neither is the finding.
 *
 * Deliberately NOT downgraded to `Refs #N` here: `--refs` already exists for the case an operator
 * means, and silently turning a suspicious Closes into a quiet Refs would hide the co-tenant
 * collision that is the actual news.
 */
function corroborateIssues(issues, branchName, commits) {
  const fromName = new Set(branchIssueNumbers(branchName));
  const fromCommits = new Set(commitIssueNumbers(commits));
  const corroborated = [];
  const uncorroborated = [];
  for (const n of Array.isArray(issues) ? issues : []) {
    const inName = fromName.has(n);
    const inCommits = fromCommits.has(n);
    if (inName || inCommits) corroborated.push({ issue: n, via: inName ? (inCommits ? 'branch name + commits' : 'branch name') : 'commit body' });
    else uncorroborated.push({ issue: n });
  }
  return { corroborated, uncorroborated, ok: uncorroborated.length === 0 };
}

/** A Conventional Commit type prefix on a BRANCH name (`fix/ship-close-path-87` → `fix`), or null. */
function branchType(branchName) {
  const m = /^([a-z]+)\//.exec(String(branchName || ''));
  return m ? m[1] : null;
}

/**
 * Does the subject the walk chose actually describe the unit being shipped (#88, Case 1)?
 *
 * The measured failure: a branch shipping a readiness gate and a whole design-artifact convention
 * (+104 lines of CONVENTIONS.md) landed titled `fix(labels): correct mechanical-readiness tests…`
 * — a test correction made incidental to a trunk sync. Release notes group on the Conventional
 * Commit prefix, so a feature filed under `fix:`; and the one line a reader ever sees for that unit
 * describes none of the work. The contributing cause is in lib/squash.js: the only commit that DID
 * describe the deliverable carried `wip:`, which is ineligible to become the subject, so the walk
 * landed on whatever housekeeping commit happened to be last.
 *
 * Two independent signals, both mechanical, neither blocking on its own — the operator is told
 * before the irreversible step and can pass `--message`:
 *
 *   - `type-mismatch`: the chosen subject's type disagrees with the branch's own type prefix. A
 *     `feat/` branch shipping under `fix:` is either a mis-titled squash or a mis-named branch, and
 *     both are worth a look before the message is immutable.
 *   - `narrow-subject`: the chosen commit touches a small fraction of the files the branch changed.
 *     This is the shape that catches Case 1 even when the types happen to agree — the subject is
 *     borrowed from a commit that did almost none of the work.
 *
 * `chosenFiles`/`branchFiles` are file-path arrays the caller read from git. A branch of one commit
 * is exempt from `narrow-subject` by construction: that commit IS the branch.
 */
function subjectSanity({ subject, branchName, chosenFiles, branchFiles, commitCount, parseSubject }) {
  const findings = [];
  const parsed = typeof parseSubject === 'function' ? parseSubject(subject) : null;
  const bType = branchType(branchName);
  if (parsed && bType && parsed.type !== bType) {
    findings.push({
      kind: 'type-mismatch',
      detail: `subject is "${parsed.type}:" but the branch is "${bType}/" — the changelog will file this unit under ${parsed.type}`,
    });
  }
  const chosen = Array.isArray(chosenFiles) ? chosenFiles.length : 0;
  const total = Array.isArray(branchFiles) ? branchFiles.length : 0;
  if (commitCount > 1 && total > 0 && chosen > 0 && chosen * 3 < total) {
    findings.push({
      kind: 'narrow-subject',
      detail: `the commit titling this squash touches ${chosen} of the ${total} files the branch changed — it is unlikely to describe the deliverable`,
    });
  }
  return findings;
}

/**
 * Bare 40/7-hex shas asserted inside a message body (#88, Case 2).
 *
 * Measured: a squash body carried "…#71/#76 already landed in a825aad on this shared branch and are
 * not touched here". `a825aad` was only ever a commit ON THAT BRANCH — the first ship attempt had
 * been deferred, so all three issues in fact landed together in that very squash. The statement was
 * true of the session's local view when it was written and false by the time it merged. The
 * machine-generated `Closes` line directly above it was correct, so nothing broke; the two lines
 * now contradict each other inside an immutable commit message, and the wrong one is the prose a
 * human reads.
 *
 * The caller checks each returned sha with `git merge-base --is-ancestor <sha> <target>`. Only bare
 * hex words are returned: a `#N` issue reference is not a sha, and a sha inside a URL belongs to
 * whatever it links to, not to this repo's history.
 */
function bodyShaClaims(message) {
  const out = new Set();
  for (const line of String(message || '').split('\n')) {
    if (/^\s*(?:Co-authored-by|Signed-off-by|Claude-Session|Reviewed-by):/i.test(line)) continue;
    for (const m of line.matchAll(/(?<![\w/#-])([0-9a-f]{7,40})(?![\w/-])/g)) {
      const sha = m[1];
      if (/^\d+$/.test(sha)) continue; // an all-digit run is a number in prose, not a sha
      out.add(sha);
    }
  }
  return [...out];
}

/**
 * Does this issue carry evidence of a delivery that produced no diff (#90)?
 *
 * The gate on evidence-close mode. A session can finish with a real deliverable and ZERO commits —
 * a decision recorded on its issue, an investigation concluding "no change needed", a design
 * artifact stored outside the repo. Today `ship` refuses such a branch at B1 and no skill path ever
 * closes the issue, so the claim is released, the worktree torn down, and the issue stays open
 * forever. The fleet owner's ruling: an agent may perform the close WHEN the issue carries an
 * evidence comment describing what was delivered.
 *
 * "Evidence" is deliberately defined as *a comment the tool did not write itself*. colab's own
 * markers (🔒 Claimed / ✅ Released / 🚢 Shipped / 🔖 Referenced) are bookkeeping — an issue holding
 * only those has had a session attached and nothing recorded, which is precisely the state that must
 * NOT auto-close. Anything else is a human or an agent having written down what happened, which is
 * the whole standard being asked for.
 *
 * The zero-diff fact itself is measured from git by the caller, never declared by the session — so
 * an issue that carries no delivery-type label is still covered.
 */
const TOOL_MARKS = ['🔒 Claimed', '✅ Released', '🚢 Shipped', '🔖 Referenced'];
function evidenceComments(comments) {
  return (Array.isArray(comments) ? comments : []).filter((c) => {
    const body = String((c && c.body) || '').trim();
    if (!body) return false;
    return !TOOL_MARKS.some((mark) => body.startsWith(mark));
  });
}

/** True when the issue holds at least one comment colab did not write. */
function hasEvidence(comments) {
  return evidenceComments(comments).length > 0;
}

/**
 * The #119 gate: does the FINAL squash message — exactly the string about to be passed to
 * `git commit -m` — carry a `Closes #N` for every issue this ship resolved to close?
 *
 * Uses `squash.closedIssueNumbers`, the SAME recogniser `spliceCloses` uses to decide what still
 * needs adding, deliberately — a second, independently-written regex here is exactly the drift that
 * would let this guard and the composer disagree about a message they are both looking at.
 *
 * Three findings, two different severities (see the module header for why they split this way):
 *
 *   - `missing`: a number in `closeIssues` with no `Closes #N` in `message`. HARD FAILURE — this is
 *     ship's own resolved intent contradicting the text it is about to commit, with no inference
 *     involved. Investigation for #119 found no path today that reaches this (both `--message` and
 *     the composed path already run through `spliceCloses`, which guarantees it) — so this is
 *     regression-proofing a future composer bypass, not a fix for a reachable bug.
 *   - `dropped`: a number some commit's own text closes, that is in none of `closeIssues`,
 *     `refsIssues`, or `message` — the genuinely reachable #119 incident: a branch's own `Closes #N`
 *     lived in a commit body the squash did not carry verbatim (only the CHOSEN commit's body
 *     survives; others contribute only their subject as a bullet), and the number was never in the
 *     claim registry to begin with. ADVISORY — inferred from prose, which can be a mention of
 *     another repo's issue, a revert note, or a deliberate `--refs` decision the operator already
 *     made; not authoritative enough to block.
 *   - `stray`: a number `message` closes that is NOT in `closeIssues` — the mirror image. Tagged
 *     `refs` when the operator explicitly kept it open (`refsIssues`, the settled case
 *     `squash.js:176`/`reconcileClosesRefsConflict` documents: GitHub still honours an inherited
 *     `Closes #N` even when a `Refs #N` sits beside it, and this is deliberately NOT rewritten —
 *     ship already warns after the push), `not-carried` otherwise. ADVISORY for the same reason
 *     `dropped` is: rejecting a hand-written `Closes` here would overturn that settled rule, not add
 *     to it.
 *
 * @param {string}                 o.message      the FINAL message, exactly as passed to `git commit -m`
 * @param {Array<number|string>}   o.closeIssues  what ship resolved to CLOSE
 * @param {Array<number|string>}   [o.refsIssues] what ship resolved to keep open
 * @param {Array<{subject,body}>}  [o.commits]    branchCommits() output — feeds `dropped` only
 * @returns {{ok:boolean, missing:number[], dropped:number[],
 *            stray: Array<{issue:number, reason:'refs'|'not-carried'}>}}
 */
function closesCoverage({ message, closeIssues, refsIssues = [], commits = [] }) {
  const closed = new Set(squash.closedIssueNumbers(message).map(Number));
  const closeSet = new Set((Array.isArray(closeIssues) ? closeIssues : []).map(Number));
  const refsSet = new Set((Array.isArray(refsIssues) ? refsIssues : []).map(Number));

  const missing = [...closeSet].filter((n) => !closed.has(n));

  const fromCommits = new Set();
  for (const c of Array.isArray(commits) ? commits : []) {
    const text = `${(c && c.subject) || ''}\n${(c && c.body) || ''}`;
    for (const n of squash.closedIssueNumbers(text)) fromCommits.add(Number(n));
  }
  const dropped = [...fromCommits].filter((n) => !closeSet.has(n) && !refsSet.has(n) && !closed.has(n));

  const stray = [...closed]
    .filter((n) => !closeSet.has(n))
    .map((n) => ({ issue: n, reason: refsSet.has(n) ? 'refs' : 'not-carried' }));

  return { ok: missing.length === 0, missing, dropped, stray };
}

module.exports = {
  branchIssueNumbers, commitIssueNumbers, corroborateIssues, branchType,
  subjectSanity, bodyShaClaims, evidenceComments, hasEvidence, TOOL_MARKS,
  closesCoverage,
};
