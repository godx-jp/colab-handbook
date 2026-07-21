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
 * Compose the full squash message.
 *
 * @param {Array<{subject:string, body?:string}>} commits  NEWEST-FIRST, merge commits already excluded
 * @param {Array<number|string>} issues                    claimed issue numbers to close
 * @returns {string} the commit message
 *
 * Layout — subject, then body blocks in this order:
 *   Closes #N, Closes #M     only for issues not already referenced in the assembled text
 *   - other subjects         every commit except the chosen one, newest-first, sync-noise dropped
 *   <chosen commit's body>   verbatim
 *   <harvested trailers>     only those not already present above
 */
function composeSquashMessage(commits, issues = []) {
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

  return spliceCloses(assembled, issues);
}

/**
 * Insert `Closes #N` as its own paragraph directly under the subject, skipping any number the
 * message already closes.
 *
 * Never append: a message whose last paragraph is a trailer block (`Co-Authored-By:`,
 * `Claude-Session:`) is the normal case, and gluing ` — Closes #N` onto the end corrupts the final
 * trailer's VALUE. GitHub still auto-closes, so nothing fails loudly — but a `Claude-Session:` URL
 * with text welded to it no longer resolves, and the commit is immutable once pushed.
 *
 * Exported so every caller composes the same way. The composed path always did this correctly; the
 * `--message` override concatenated instead, which is exactly the drift a shared helper prevents.
 */
function spliceCloses(message, issues = []) {
  const missing = (issues || [])
    .map((n) => String(n).replace(/^#/, ''))
    .filter((n) => n && !new RegExp(`[Cc]loses #${n}\\b`).test(message));
  if (!missing.length) return message;

  const closesLine = missing.map((n) => `Closes #${n}`).join(', ');
  const nl = message.indexOf('\n');
  const head = nl === -1 ? message : message.slice(0, nl);
  const rest = nl === -1 ? '' : message.slice(nl + 1).replace(/^\n+/, '');
  return rest ? `${head}\n\n${closesLine}\n\n${rest}` : `${head}\n\n${closesLine}`;
}

module.exports = {
  TYPE_WEIGHT, BREAKING_BONUS, TRAILER_RE,
  isSyncNoise, parseSubject, commitWeight, pickSubjectIndex, harvestTrailers, composeSquashMessage,
  spliceCloses,
};
