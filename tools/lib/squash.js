'use strict';
/**
 * Composing the squash-commit message for `colab ship` (Phase B1).
 *
 * This module is PURE — it takes an array of already-read commits and returns a string. All git
 * I/O stays in the CLI. That split exists so this logic can be unit-tested: `tools/colab` has no
 * test harness, `tools/lib/*.test.js` is wired into CI, and the bug this module was extracted to
 * fix was invisible precisely because nothing tested it.
 *
 * THE BUG IT FIXES. The subject used to be the branch's NEWEST commit, verbatim. On a well-run
 * branch the newest commit is the SMALLEST — the docs pass you do last — so `feat` work shipped
 * under a `docs:` subject. Release notes group on that prefix (CONVENTIONS §4), so the feature was
 * invisible in the changelog: nothing failed, CI stayed green, the issues closed. Two such subjects
 * are baked into a published tag and cannot be corrected.
 *
 * WHAT REPLACES IT. The subject comes from the HIGHEST-WEIGHT commit on the branch (breaking >
 * feat > fix > perf > refactor > docs > test > chore), ties going to the OLDEST — the commit that
 * established what the branch is for; later commits of the same type are follow-ups. A branch with
 * one commit therefore behaves exactly as before. A branch where nothing carries a Conventional
 * Commit prefix also falls back to the old behaviour (newest), because there is nothing to weigh.
 *
 * WHAT IS DELIBERATELY UNCHANGED. The body design was never at fault: `Closes #N` for every claimed
 * issue, the other subjects as bullets, `chore(sync)` merge-noise filtered, footers preserved. The
 * one body change is a consequence of the subject change — since the chosen commit may no longer be
 * the newest, trailers are harvested from EVERY commit on the branch rather than only the newest,
 * or a `Co-Authored-By:` on the last commit would now be silently dropped.
 */

/**
 * Conventional Commit type → weight. Ordering follows the semantic-release convention that decides
 * what a change means to a consumer: feat is a minor bump, fix a patch, the rest cosmetic. The
 * numbers are spaced so a type can be inserted without renumbering; only the ORDER is meaningful.
 */
const TYPE_WEIGHT = {
  feat: 70,
  fix: 60,
  perf: 50,
  refactor: 40,
  revert: 40,
  docs: 30,
  test: 20,
  build: 15,
  ci: 15,
  style: 12,
  chore: 10,
};

/** A breaking change outranks every non-breaking one, whatever its type. */
const BREAKING_BONUS = 1000;

const SUBJECT_RE = /^([a-z]+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/;

/** Trailer keys worth carrying across a squash. An allowlist, not a general trailer parser: a
 *  loose `^\w+:` rule swallows ordinary prose lines ("Note: ...") and `Closes #N`, which is
 *  composed separately and must not be duplicated. */
const TRAILER_RE = /^(?:Co-authored-by|Signed-off-by|Claude-Session|Reviewed-by):\s*\S/i;

/** Sync-merge noise: a commit produced by B0 pulling trunk into the branch, not by the author. */
function isSyncNoise(subject) {
  return /^chore\(sync\)/.test(String(subject || ''));
}

/** Parse a Conventional Commit subject → {type, scope, breaking, description} or null. */
function parseSubject(subject) {
  const m = SUBJECT_RE.exec(String(subject || '').trim());
  if (!m) return null;
  return { type: m[1], scope: m[2] || null, breaking: !!m[3], description: m[4] };
}

/**
 * Weight of one commit. 0 means "carries no Conventional Commit prefix we recognise" — which is a
 * finding in its own right (§4: an unprefixed commit is invisible in the changelog), but here it
 * only means the commit cannot claim the subject on merit.
 */
function commitWeight(commit) {
  const parsed = parseSubject(commit && commit.subject);
  if (!parsed) return 0;
  const base = TYPE_WEIGHT[parsed.type];
  if (base === undefined) return 0; // a prefix-shaped word that is not a known type
  const breaking = parsed.breaking || /^BREAKING[ -]CHANGE:/m.test(String((commit && commit.body) || ''));
  return base + (breaking ? BREAKING_BONUS : 0);
}

/**
 * Index of the commit whose subject should title the squash. `commits` is NEWEST-FIRST (git log
 * order).
 *
 * Rules, in order:
 *   1. sync-merge noise never titles a squash (unless it is all there is);
 *   2. highest weight wins;
 *   3. ties go to the OLDEST of the tied commits — on a branch of three `feat`s, the first one
 *      names the branch's purpose and the rest extend it;
 *   4. if nothing carries a recognised prefix, fall back to the newest commit. There is no signal
 *      to weigh, and the previous behaviour is at least predictable.
 */
function pickSubjectIndex(commits) {
  if (!Array.isArray(commits) || commits.length === 0) return -1;
  const candidates = commits.map((c, i) => ({ i, w: commitWeight(c), noise: isSyncNoise(c && c.subject) }))
    .filter((c) => !c.noise);
  const pool = candidates.length ? candidates : commits.map((c, i) => ({ i, w: commitWeight(c) }));
  const best = Math.max(...pool.map((c) => c.w));
  if (best === 0) return pool[0].i; // no prefixes anywhere → newest, as before
  // pool is newest-first, so the LAST entry at the best weight is the oldest of the tied commits.
  const tied = pool.filter((c) => c.w === best);
  return tied[tied.length - 1].i;
}

/** Trailer lines from every commit, newest-first, de-duplicated case-insensitively. */
function harvestTrailers(commits) {
  const seen = new Set();
  const out = [];
  for (const c of commits || []) {
    for (const line of String((c && c.body) || '').split('\n')) {
      const t = line.trim();
      if (!TRAILER_RE.test(t)) continue;
      const key = t.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t);
    }
  }
  return out;
}

/**
 * Full-line reference clauses ship itself composes ("Closes #17", "Refs #48", or several of either
 * joined by ", "). Only a line matching this shape end-to-end is ever touched by
 * `reconcileClosesRefsConflict` below — arbitrary prose that merely mentions an issue number (a
 * sentence, not a trailer) is left alone, because rewriting inside a sentence is not a safe
 * mechanical operation. The keyword casing mirrors the rest of this file: `[Cc]loses`, `[Rr]efs` —
 * not a general case-insensitive match, and not the full GitHub closing-keyword vocabulary.
 */
const REF_LINE_RE = /^(?:(?:[Cc]loses|[Rr]efs) #\d+)(?:,\s*(?:[Cc]loses|[Rr]efs) #\d+)*$/;
const REF_CLAUSE_RE = /([Cc]loses|[Rr]efs) #(\d+)/g;

/**
 * Drop an inherited `Refs #N` clause for any N ship is about to CLOSE (#58).
 *
 * The scenario: a session writes `Refs #53` into its own commit body while the issue is still open
 * (an honest trailer at the time). By the time `ship` runs, #53 is one of the issues this branch
 * CLOSES — but the pure layer only ever APPENDED a missing reference; it never looked at what the
 * carried text already said. The result was two contradictory, immutable trailers on one commit:
 * `Closes #53` (composed) and `Refs #53` (inherited), both true-looking, one of them stale.
 *
 * Only a self-contained reference LINE is touched (see `REF_LINE_RE`) — this is exactly the shape
 * both ship's own composed line and the live #58 report take (a commit body ending in a bare
 * `Refs #53`). A clause naming an issue NOT in `closeNums` survives untouched, including a `Refs #N`
 * for a number that is genuinely only in `refs` — that is not a conflict, just a duplicate the
 * caller's "already present" check already declines to repeat.
 *
 * Deliberately NOT symmetric: an inherited `Closes #N` for a number ship intends to `Refs` (a
 * tracking issue, #48) is left alone here. `composeSquashMessage`'s doc comment explains why that
 * half stays a post-push warning instead of a rewrite — GitHub reads the carried `Closes #N` and
 * closes the issue regardless of what this pure layer emits, so stripping the text would produce a
 * message that reads correct while the actual merge still closes the memory issue silently.
 *
 * @param {string} message
 * @param {string[]} closeNums   normalised (no leading `#`) issue numbers ship will CLOSE
 * @param {Array} [conflicts]    when given, one `{num, from, to}` is pushed per clause dropped —
 *                                the caller's hook for warning a human that a hand-written trailer
 *                                was overruled
 * @returns {string}
 */
function reconcileClosesRefsConflict(message, closeNums, conflicts) {
  if (!closeNums || !closeNums.length) return message;
  const closeSet = new Set(closeNums);
  let changed = false;
  const lines = String(message).split('\n').map((line) => {
    const trimmed = line.trim();
    if (!trimmed || !REF_LINE_RE.test(trimmed)) return line;
    const kept = [];
    let m;
    REF_CLAUSE_RE.lastIndex = 0;
    while ((m = REF_CLAUSE_RE.exec(trimmed))) {
      const isRefs = /^[Rr]efs$/.test(m[1]);
      const num = m[2];
      if (isRefs && closeSet.has(num)) {
        changed = true;
        if (conflicts) conflicts.push({ num, from: 'Refs', to: 'Closes' });
        continue; // drop this clause — ship's own Closes #N replaces it
      }
      kept.push(`${isRefs ? 'Refs' : 'Closes'} #${num}`);
    }
    return kept.length ? kept.join(', ') : null; // null marks the whole line for removal
  });
  if (!changed) return message;
  return lines.filter((l) => l !== null).join('\n')
    // a fully-dropped line can leave a dangling blank run — mid-message (two adjacent blank
    // separators) or trailing (the dropped line was last). Collapse both; never touches content.
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\n+$/, '');
}

/**
 * Compose the full squash message.
 *
 * @param {Array<{subject:string, body?:string}>} commits  NEWEST-FIRST, merge commits already excluded
 * @param {Array<number|string>} closes                    claimed issue numbers to CLOSE (`Closes #N`)
 * @param {Array<number|string>} refs                       claimed issue numbers to REFERENCE but keep
 *                                                          open (`Refs #N`) — long-lived memory/tracking
 *                                                          issues the branch touched but did not complete
 * @param {Array} [conflicts]                               when given, collects `{num, from, to}` for
 *                                                          every inherited trailer `spliceCloses`
 *                                                          overruled — see `reconcileClosesRefsConflict`
 * @returns {string} the commit message
 *
 * Layout — subject, then body blocks in this order:
 *   Closes #N, Refs #M       one paragraph: Closes for completed issues, Refs for tracking ones,
 *                            each skipped if the assembled text already references it that way
 *   - other subjects         every commit except the chosen one, newest-first, sync-noise dropped
 *   <chosen commit's body>   verbatim
 *   <harvested trailers>     only those not already present above
 */
function composeSquashMessage(commits, closes = [], refs = [], conflicts) {
  const list = Array.isArray(commits) ? commits.filter(Boolean) : [];
  if (list.length === 0) return '';

  const pick = pickSubjectIndex(list);
  const chosen = list[pick];
  const subject = String(chosen.subject || '').replace(/\s+$/, '');
  const chosenBody = String(chosen.body || '').replace(/^\n+/, '').replace(/\s+$/, '');

  const bullets = list
    .filter((_, i) => i !== pick)
    .map((c) => String(c.subject || '').trim())
    .filter((s) => s && !isSyncNoise(s))
    .map((s) => `- ${s}`);

  // Assemble everything EXCEPT Closes first: the "already referenced?" test must run against what
  // will actually ship. Testing the input instead (as the original did) can drop a `Closes #N` that
  // lived in a commit body the squash does not carry — the issue then never auto-closes.
  const tail = [];
  if (bullets.length) tail.push(bullets.join('\n'));
  if (chosenBody) tail.push(chosenBody);
  let assembled = [subject, ...tail].join('\n\n');

  // Case-insensitive, exactly as harvestTrailers de-duplicates: git tooling is inconsistent about
  // `Co-authored-by` vs `Co-Authored-By`, and an exact-match test appends a second copy of a trailer
  // the body already carries.
  const present = new Set(assembled.split('\n').map((l) => l.trim().toLowerCase()));
  const extraTrailers = harvestTrailers(list).filter((t) => !present.has(t.toLowerCase()));
  if (extraTrailers.length) {
    // Glue trailers onto an existing trailer block; otherwise start a new paragraph, so git still
    // reads the last paragraph as trailers.
    const lastLine = assembled.split('\n').pop().trim();
    assembled += (TRAILER_RE.test(lastLine) ? '\n' : '\n\n') + extraTrailers.join('\n');
  }

  return spliceCloses(assembled, closes, refs, conflicts);
}

/**
 * Insert an issue-reference paragraph directly under the subject: `Closes #N` for issues the branch
 * completes, `Refs #N` for long-lived memory/tracking issues it touched but must NOT close (#48).
 * Each number is skipped if the message already references it that way.
 *
 * Never append: a message whose last paragraph is a trailer block (`Co-Authored-By:`,
 * `Claude-Session:`) is the normal case, and gluing ` — Closes #N` onto the end corrupts the final
 * trailer's VALUE. GitHub still auto-closes, so nothing fails loudly — but a `Claude-Session:` URL
 * with text welded to it no longer resolves, and the commit is immutable once pushed.
 *
 * `refs` wins over `closes` for a number named in both — a tracking issue must never be closed,
 * even if it was also passed on the close path. The two lists therefore ship disjoint.
 *
 * One thing this pure layer CANNOT do: if a carried commit body literally says `Closes #N` for a
 * number in `refs`, GitHub will still close it on merge — adding `Refs #N` does not un-close it.
 * `colab ship` detects that after the push (the ref issue reads CLOSED) and warns; here we simply
 * do not emit a redundant `Refs #N` when a `Closes #N` for it already sits in the text.
 *
 * The mirror case — an inherited `Refs #N` for a number THIS call closes — is not a limitation the
 * same way: nothing here needs GitHub to un-do anything, so it is reconciled up front by
 * `reconcileClosesRefsConflict` (#58) rather than left for ship to warn about after the fact.
 *
 * Exported so every caller composes the same way. The composed path always did this correctly; the
 * `--message` override concatenated instead, which is exactly the drift a shared helper prevents.
 *
 * @param {string} message
 * @param {Array<number|string>} closes
 * @param {Array<number|string>} refs
 * @param {Array} [conflicts]  see `reconcileClosesRefsConflict` — passed straight through
 */
function spliceCloses(message, closes = [], refs = [], conflicts) {
  const norm = (arr) => (arr || []).map((n) => String(n).replace(/^#/, '')).filter(Boolean);
  const refNums = norm(refs);
  const refSet = new Set(refNums);
  const closeNums = norm(closes).filter((n) => !refSet.has(n)); // refs wins — a tracking issue is never closed

  // Drop any inherited `Refs #N` the branch wrote for an issue THIS call is about to close, before
  // deciding what still needs adding — otherwise the stale trailer survives verbatim alongside the
  // freshly composed `Closes #N` (#58).
  const text = reconcileClosesRefsConflict(message, closeNums, conflicts);

  const missingCloses = closeNums
    .filter((n) => !new RegExp(`[Cc]loses #${n}\\b`).test(text));
  const missingRefs = refNums
    // Skip a ref already referenced. Also skip one the message already CLOSES: this layer only adds
    // text, so it cannot un-close it — ship warns after the push instead of us emitting both keywords.
    .filter((n) => !new RegExp(`[Rr]efs #${n}\\b`).test(text) && !new RegExp(`[Cc]loses #${n}\\b`).test(text));

  const parts = [
    ...missingCloses.map((n) => `Closes #${n}`),
    ...missingRefs.map((n) => `Refs #${n}`),
  ];
  if (!parts.length) return text;

  const refLine = parts.join(', ');
  const nl = text.indexOf('\n');
  const head = nl === -1 ? text : text.slice(0, nl);
  const rest = nl === -1 ? '' : text.slice(nl + 1).replace(/^\n+/, '');
  return rest ? `${head}\n\n${refLine}\n\n${rest}` : `${head}\n\n${refLine}`;
}

module.exports = {
  TYPE_WEIGHT, BREAKING_BONUS, TRAILER_RE,
  isSyncNoise, parseSubject, commitWeight, pickSubjectIndex, harvestTrailers, composeSquashMessage,
  spliceCloses, reconcileClosesRefsConflict,
};
