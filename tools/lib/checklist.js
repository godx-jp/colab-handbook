'use strict';
/**
 * The close gate (#74): `Closes #N` may only be composed when issue #N's `## Plan` checklist is
 * fully accounted for — every box ticked, or the leftover boxes consciously handed to a declared
 * `Remainder: #M` issue. This module is PURE (string in, verdict out) — all `gh` I/O stays in the
 * CLI, the same split `lib/squash.js` uses and for the same reason: `tools/colab` has no test
 * harness, `tools/lib/*.test.js` is wired into CI, and a parsing bug here is invisible without one.
 *
 * THE INCIDENT THIS FIXES. An issue was closed by squash-merge with one third of its three-section
 * scope unimplemented. The sections were PROSE, so nothing could parse them — B1b's Done/Partial/
 * Untouched classification (CONVENTIONS.md §4, code-ship SKILL.md B1b) was honour-system, and the
 * honour system missed a section. A `## Plan` checklist is the mechanical version of the same
 * classification: a box is either `[x]` or it is not, and nothing about reading it requires
 * judgment the way "is this prose paragraph done" does.
 *
 * WHAT THIS DOES NOT COVER. An issue with no `## Plan` heading at all, or a `## Plan` section
 * written as prose with no `- [ ]` lines, cannot be mechanically verified — there is nothing to
 * count. `planVerdict` reports that shape (`proseOnly`) as a FINDING, not a block: `complete`
 * comes back `true` for it, the same as a genuinely empty plan, because refusing every issue that
 * predates this convention would make the gate impossible to adopt. The Convention this module
 * backs (CONVENTIONS.md §4) is that a prose-section scope is itself worth reporting — reporting is
 * this module's job via `proseOnly`; refusing is not.
 */

/** Heading that opens the checklist section — `## Plan` or `## Plan (checklist)`, either level 2. */
const PLAN_HEADING_RE = /^#{2,6}\s*Plan\b/i;

/** Any markdown heading, used to find where the Plan section ENDS. */
const ANY_HEADING_RE = /^#{1,6}\s+\S/;

/** A GitHub checklist line: `- [ ] …` or `- [x] …` (case-insensitive on the mark). */
const ITEM_RE = /^-\s*\[([ xX])\]\s*(.+)$/;

/** `Remainder: #M` — the trailer that hands unticked boxes to a follow-up issue, same shape as
 *  the `Filed-by:` / `Group:` / `Because:` trailers this repo already writes onto issues. */
const REMAINDER_RE = /^Remainder:\s*#(\d+)\b/im;

/**
 * The raw text of the `## Plan` section (between its heading and the next heading, or the end of
 * the body), or `null` if the body has no such heading at all. Body may be `null`/`undefined`
 * (a `gh` read that failed) — treated the same as "no heading found".
 */
function parsePlanSection(body) {
  const lines = String(body || '').split('\n');
  let start = -1;
  let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (start === -1) {
      if (PLAN_HEADING_RE.test(lines[i])) start = i + 1;
      continue;
    }
    if (ANY_HEADING_RE.test(lines[i])) { end = i; break; }
  }
  if (start === -1) return null;
  return lines.slice(start, end).join('\n');
}

/** Checklist items (`{checked, text}`) found in a section's text, in document order. */
function parseChecklistItems(sectionText) {
  if (!sectionText) return [];
  const out = [];
  for (const raw of String(sectionText).split('\n')) {
    const m = ITEM_RE.exec(raw.trim());
    if (m) out.push({ checked: m[1].toLowerCase() === 'x', text: m[2].trim() });
  }
  return out;
}

/**
 * The scope verdict for one issue body.
 *
 * `complete` is `true` in three shapes, deliberately conflated because none of them is a reason to
 * block a close: no `## Plan` heading at all (pre-convention issue), a heading with zero checklist
 * items (nothing to verify — `proseOnly` distinguishes "genuinely empty" from "prose scope, a
 * finding" for a caller that wants to report it), or a heading whose items are all ticked. It is
 * `false` in exactly one shape: at least one real, unticked `- [ ]` box.
 */
function planVerdict(body) {
  const section = parsePlanSection(body);
  const hasHeading = section !== null;
  const items = hasHeading ? parseChecklistItems(section) : [];
  const total = items.length;
  const checked = items.filter((i) => i.checked).length;
  const unchecked = total - checked;
  const proseOnly = hasHeading && total === 0 && section.trim().length > 0;
  const complete = total === 0 || unchecked === 0;
  return { hasHeading, items, total, checked, unchecked, proseOnly, complete };
}

/**
 * The declared remainder issue number, or `null`. Searched across the body AND every comment body
 * (`gh issue view --json body,comments`'s `comments[].body`) — the remainder is typically declared
 * in a wrap-time comment, written after the issue itself was opened, never by editing history into
 * the original body.
 */
function findRemainder(body, comments) {
  const texts = [String(body || ''), ...(Array.isArray(comments) ? comments : []).map((c) => String((c && c.body) || ''))];
  for (const t of texts) {
    const m = REMAINDER_RE.exec(t);
    if (m) return Number(m[1]);
  }
  return null;
}

/**
 * The close-gate verdict for one issue: may `colab ship` (or a human doing code-ship B2) write
 * `Closes #N` for it?
 *
 * `ok: true` covers: nothing to verify (see `planVerdict`), a fully-ticked checklist, OR an
 * unticked checklist with a declared `Remainder: #M` — the plan explicitly permits closing once
 * the leftover boxes have a named home, they do not need to be ticked false-positive first.
 *
 * `ok: false` is the one shape the whole feature exists to catch: real unticked boxes, no
 * remainder declared anywhere the caller looked.
 */
function closeGate(body, comments) {
  const verdict = planVerdict(body);
  if (verdict.complete) {
    return {
      ok: true, remainderIssue: null,
      reason: verdict.total === 0 ? 'no Plan checklist to verify' : 'Plan checklist fully ticked',
      ...verdict,
    };
  }
  const remainderIssue = findRemainder(body, comments);
  if (remainderIssue) {
    return {
      ok: true, remainderIssue,
      reason: `${verdict.unchecked}/${verdict.total} Plan item(s) unticked — remainder declared as #${remainderIssue}`,
      ...verdict,
    };
  }
  return {
    ok: false, remainderIssue: null,
    reason: `${verdict.unchecked}/${verdict.total} Plan item(s) unticked, no declared remainder`,
    ...verdict,
  };
}

module.exports = {
  PLAN_HEADING_RE, ANY_HEADING_RE, ITEM_RE, REMAINDER_RE,
  parsePlanSection, parseChecklistItems, planVerdict, findRemainder, closeGate,
};
