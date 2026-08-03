---
name: code-wrap
description: "Close the IMPLEMENTER half of a coding session: distill what you learned back onto the feature's GitHub Issue, update any repo docs the work made stale, run the repo's own quality gate, commit only the deliverable paths, push the session branch as backup — then assert the hand-off contract and stop. Never merges, never touches trunk. That is a separate skill, code-ship, run by a coordinator session once a human says go. Trigger phrases: 'wrap up the session', 'finish coding', 'close the session', 'done coding', 'update the issue'. Pairs with code-start before it and code-ship after it."
---

# code-wrap — close a session: distill → docs → gate → commit → hand off

**This is the implementer's half only.** It distills, gates, commits, and pushes a
backup — then stops. It never merges to trunk; that is
[`code-ship`](../code-ship/SKILL.md)'s job, run by a coordinator session once a human
says go. If you came here expecting to merge or find `Phase B`, you want that skill —
this one asserts a checklist for it to pick up, nothing more.

Notation: `$N` = the feature's Issue number · `<trunk>` = the branch sessions
merge into (from `.github/project.yml`; `main` for Tier B, `dev` for Tier A) ·
`<base>` = **the branch this session ships into** — `<trunk>`, unless it was cut
from a declared `integration:` line, in which case it is that line.

**Read `ceremony:` from `.github/project.yml` before the first write.** Absent, or
`ceremony: standard` — everything below applies as written. `ceremony: light`
(project.schema.md#ceremony--optional) thins one step here and nothing else: A1's
narration distills real gotchas only, no progress commentary. (Its other thinned step —
`code-ship`'s evidence comment — lives in that skill, not this one.) Every other step in
this file — claim discipline, squash-eligibility, the quality gate — runs exactly the
same regardless of `ceremony`.

### Did this session open with `colab solo`? Its exit is different, not thinner

Solo flow (CONVENTIONS.md, *Solo flow*) made no worktree and holds no claim, so there is
nothing here — or in `code-ship` — for either skill to harvest or tear down. This is not
`ceremony: light` again, it is a genuinely different shape, and running the sections
below against it produces confusing no-ops. The solo exit is its own, short path:

1. **Run the quality gate anyway** (A3) — solo flow relaxes ceremony, never the gate.
2. **Distill onto an Issue only if a decision emerged** this sitting (A1's spirit,
   not its letter) — solo flow's whole premise is that the commit *is* the memory
   when nothing needs to outlive the session; do not manufacture a narration Issue
   for the sake of having one.
3. **Verify clean and pushed, then release the lock:**
   ```sh
   colab solo --done
   ```
   `--done` re-derives both facts itself (tree clean, fully pushed to
   `origin/<trunk>`) and refuses if either is false — it is the check, not a
   formality that trusts you. A refusal means finish the commit/push first; it is
   not a signal to fall back into the worktree-shaped steps below.
4. **Nothing else runs, and `code-ship` never runs at all.** No B0 sync, no B1 CI
   gate beyond what already ran on trunk post-push, no B2 squash (there is no branch
   to squash), no B2c/B2d/B3/B4. A Tier A release (`code-ship` B5) is unaffected
   either way — solo flow is `ceremony: light` only, which already requires
   `production: null`.

If you are unsure whether this session is a solo session, check
`colab claims`/`colab worktrees` for a row naming your branch — none, on a
`ceremony: light` repo, is the signature of solo flow. When genuinely unsure,
treat it as the ordinary worktree flow below; the ordinary steps degrade safely
(they just find nothing to do), where the solo path degrades unsafely if run
against a session that DOES hold a claim or worktree.

## Do this now

### A1. Distill knowledge onto the Issue

The Issue is the feature's external memory — write so the next session gets full
context from `gh issue view $N` without re-reading the codebase.

```sh
gh issue view $N                         # then edit the body:
gh issue edit $N --body-file <tmpfile>   # tick the checklist, add Decisions/Gotchas
gh issue comment $N -b "**<YYYY-MM-DD>** — did X, decided Y, left Z open."
```

- Record **reusable knowledge** — a decision and *why*, a gotcha, a dead end —
  not a copy of the diff. The code is already in git.
- No GitHub remote? Write the same into the session notes file from code-start.
- **`ceremony: light` repo** — distill real gotchas only; skip the progress-commentary
  comment (the `**<YYYY-MM-DD>** — did X…` line above). A tick of the checklist and a
  genuine decision/gotcha still belong here — this thins commentary, not knowledge.
- **Wrote or extended a plan file this session** (`$PLAN`, i.e.
  `<main checkout>/.claude/plans/issue-$N.md` — resolve via `--git-common-dir`, never a
  bare relative path, #113; #94)? Anything in it worth keeping past this session moves
  here, now — the file itself is disposable and dies at `code-ship` teardown. A rung-2
  plan's *Approach* and *Risks* sections are the likeliest candidates when the reasoning
  behind a non-obvious choice would otherwise be lost with the file.

#### Filing a follow-up here? It is agent-filed, and it must say so

This step is where most agent-initiated issues in the fleet are born: you found
something real, it is out of scope, so you file it rather than lose it. Keep doing
that — but a follow-up you decided to file is **work no human has approved yet**,
and it must be labelled so a batch-start tool can leave it alone
(`CONVENTIONS.md` §5, *Provenance*):

```sh
gh label create agent-filed --color C5DEF5 --description "Filed by an agent on its own initiative — not human-approved" 2>/dev/null || true
gh issue create --title "<type>: <thing>" --label agent-filed --body-file <tmpfile>
```

End the body with the origin, naming the issue you were wrapping when you found it —
that is the breadcrumb back to the context — and, on the next line, the ask class
(`CONVENTIONS.md` §5, *Ask*) so a decision surface never has to re-derive it from
prose:

```
Filed-by: agent (during code-wrap of #$N, session <name>)
Ask: backlog
```

Use `permission` for a request to touch machine/prod state, `ruling` for a question
that resolves to a human judgment and never to a diff, `deferred(<trigger>)` when
you have already decided no action is needed until something else happens, and
`backlog` — the default a missing line reads as anyway — for an ordinary work
proposal.

The distinction is intent, not keyboard. **If the human asked for the follow-up
during this session, it is theirs** — `Filed-by: boss (via session <name>)`, no
label. Only what you decided to raise on your own is `agent-filed`.

### A2. Update repo docs the work made stale — in `docs/`, not in `CLAUDE.md`

The Issue is the feature's log; **docs in the repo are the living knowledge** the
next person reads without digging through Issues. If this session changed any of
these, update the doc **in the same session** (don't leave "will update later" in
a comment while the file stays wrong). All three destinations are in `docs/`:

- Domain model changed (new entity/table, renamed concept, new flow) → the
  architecture doc.
- Infra/ops changed (deploy, env, DNS, service account, runbook) → the deploy doc.
- A long-lived gotcha (bites again, not tied to one feature) → the contributing/gotchas
  doc. **Missing? Create it** (`docs/gotchas.md`) rather than appending to whichever
  file is already in your context — which is always `CLAUDE.md`.

#### `CLAUDE.md` is a router, not an archive

It holds conventions, tier/trunk, ports, run commands, and **pointers** to the docs
that carry the depth. It is also the one file loaded in full into **every** session
before any work starts, which makes it the worst place in the repo for append-only
accretion — and currently the place accretion lands.

Measured across six repos: **~30 lines added per session, and not one commit ever
made one smaller.** The furthest along went 66 → 452 lines (39 KB, ~10-12k tokens)
in two days; every session in it — including one that only touched CSS — pays that
before doing anything, which is the opposite of code-start's whole premise.

A better destination existing is not enough: the repos that already had a
contributing/gotchas doc grew at exactly the same rate, because nothing pointed
there. So the counter-pressure has to be here:

- **If the knowledge belongs in `docs/`, the `CLAUDE.md` change is a pointer, not a
  copy.** Duplicating is worse than misfiling — whichever copy rots first, the other
  keeps being read. We found a restart procedure living in both, and three other
  rules living *only* in `CLAUDE.md`, so no after-the-fact routing rule can sort
  them: "ops → the deploy doc" silently loses a rule, "gotchas → `CLAUDE.md`"
  returns a second drifting copy.
- **Prefer editing an existing line to adding one.** If nothing already in
  `CLAUDE.md` has become wrong, the correct diff to it is often no diff at all.
- **This is not licence to distill less.** The content is worth keeping — location
  and unboundedness are what's wrong. Move it; never drop it.

This paragraph used to be enforcement-by-prose only, and that failed silently: a repo
was measured at 112,382 bytes / 197 lines — the line count read as healthy while one
"pointer" row alone had grown to 68,350 bytes (60.8% of the file), because nothing
mechanical was watching bytes. `audit/audit.mjs` now flags this — a `CLAUDE.md` over
~40 KB, or any single physical line more than 6x the file's median and over 2 KB — as
an advisory (`audit/README.md`, #64). It is a starting-point threshold, not a hard
gate, but it means a session no longer has to catch this by eye.

#### A *new rule* is a follow-up unit, not a line in this session's diff

A2 covers docs your work made **wrong** — the domain moved, the deploy changed, a
gotcha surfaced. It does not cover a session that *concluded something new*: a rule
about how people work, a decision with alternatives that were weighed. Those go on an
Issue now and get written by a claimed unit of their own (`CONVENTIONS.md` §5,
*Writing a conclusion down*). Two reasons, and the second is the one agents miss:

- The reasoning needs a home a reader can find, and a squash commit body is not one.
- Normative prose is the most-contended file in a repo. Slipping an unclaimed rewrite
  of it into an unrelated feature's diff is exactly the parallel-branch collision the
  claim model exists to prevent — with nothing claimed, so nothing can warn anyone.

Do not use this to postpone A2's actual job. "This doc is now wrong" is this session;
"here is something new we decided" is the next one.

**Touched `CLAUDE.md`? Re-check its pointer section against `ls docs/`.** An index
that omits half the docs is worse than no index, because a reader trusts it and
stops looking. Measured: one repo's pointer section lists a session-notes file and
the README while omitting four docs totalling 120 KB — this step grew the body for
14 commits and never once maintained the index.

Never write a secret into docs — only *where it lives* (a GitHub Secret, `.env`
on the server, a password manager). Docs are deliverable paths; commit them in A3.

### A3. Run the repo's own quality gate

Run whatever this repo's CI runs — resolve it from the repo, don't assume:

```sh
# Node:    npm run lint / types:check / test   (whichever scripts exist)
# Laravel: vendor/bin/pint --dirty ; php artisan test --compact
# else:    read .github/project.yml `stack` and .github/workflows/ to find the gate
```

Gate red because of your change → fix it. Never make it green by loosening the
test. If it's red for a reason unrelated to your work, that's a finding — report
it, don't paper over it (`CONVENTIONS.md` §8).

**The gate going green against the plan's stated oracle IS the stop condition
(#94).** Not a floor to build past — polishing beyond what the oracle asks for is
scope creep, not diligence. If the plan file (`$PLAN`, when one exists) names the
oracle, that is what "done" means for this session; a green gate that satisfies it is
the signal to move to A4, not a reason to keep going.

#### Read the verdict, not the transcript

On a repo with a real suite, the gate's raw output is not a rounding error next to
`CLAUDE.md` — measured on one mature repo, 366,594 bytes (~104,700 tokens) of
combined stdout+stderr against a 113,989-byte `CLAUDE.md`, at 3,212/3,213 green.
The volume is structural, not a sign of trouble: a TAP-style runner emits a
`# Subtest:` line **and** an `ok N` line per assertion, so it scales with
assertion count — which every convention here encourages growing. And it does not
cost once: gate output joins the cached prompt prefix, so a run at turn 10 of a
40-turn session is re-read on every turn after, not paid for a single time.

A list of test names that passed is the least informative text a session can hold.
Filter before reading it back:

```sh
<gate command> 2>&1 | grep -E '^(not ok|# fail|# pass|Test Files| *Tests )'
```

Adjust the pattern to the runner's own vocabulary — Jest/Vitest, `phpunit`,
`pytest` each summarize differently; grep the one line format that carries
pass/fail counts and failing test names, not the runner's default default verbosity.

- **Quiet on green: pass counts only.** Detailed on red: the failure count and the
  name + `file:line` of each failing test, not just that some failed.
- **The exit code is the verdict — preserve it.** A naive pipe through `grep`
  returns the filter's exit status, not the gate's; `set -o pipefail` (or capture
  the gate's own exit code before piping) so a red gate cannot read as green. Get
  this wrong and it is worse than reading the raw transcript.
- **More than one runner (e.g. lint + tests) → filter each one.** A filter tuned
  to one runner's output silently drops the other's failures, which reads as a
  pass.
- Truncation is not a substitute for filtering: a long run can push the one
  failing line past a tool's read window while the summary sits further down
  still — the filtered command above avoids ever emitting the noise, rather than
  hoping the reader's truncation point lands somewhere safe.

### A4. Commit only the deliverable paths

```sh
git add <specific deliverable paths>   # NOT git add -A
git status                             # confirm no local/preview/config files sneak in
git commit                             # Conventional Commits: type(scope): summary
```

Conventional-Commit prefix is mandatory — release notes group on it, so an
unprefixed commit is invisible in the changelog (`CONVENTIONS.md` §4).

### A5. Push the session branch as backup

```sh
git push -u origin <branch>    # a backup/record, NOT a PR, NOT trunk
```

## Hand off — assert the contract, then stop

**Do not merge. Do not open a PR. Do not push trunk.** Wait for an explicit human
go-ahead ("OK, merge it") before anything in `code-ship` runs — clicking Start on
this session was not that go-ahead.

The reason the two phases used to be one skill is that the seam between them is
where things get lost. Replace implicit continuity — "Phase A ended, so Phase B has
what it needs" — with an explicit checklist this skill **asserts** and
[`code-ship`](../code-ship/SKILL.md) **verifies** independently, from git and GitHub,
never by trusting this session's word for it:

- [ ] session branch pushed (A5)
- [ ] distill comment posted on each carried issue (A1)
- [ ] gate result recorded — green, or red-for-an-unrelated-reason reported (A3)
- [ ] claim(s) still held — nothing here releases them; `code-ship` B3 does
- [ ] plan file present at `$MAIN_REPO/.claude/plans/issue-$N.md` — the **absolute main
      checkout path**, resolved via `--git-common-dir`, not "present in `.claude/plans/`"
      relative to wherever this checklist happens to be asserted from (#113) — **if** one
      was written this session (#94); absent is fine when the work never needed one
      (rung 0)

State this checklist, filled in, as the last thing you report. A box you cannot
check is not a reason to force it true — say what is missing and why, and let
whoever picks up `code-ship` decide, rather than asserting a contract you did not
actually meet.

## Verify complete

- `gh issue view $N`: checklist ticked, Decisions/Gotchas updated, session comment added.
- Durable knowledge landed in `docs/`, and `git diff --stat -- CLAUDE.md` shows a pointer
  or an edit — not a transplanted section. If it grew by ~30 lines, A2 was read backwards.
- `<base>` is unchanged — no session commit in `git log <base>`. This skill never merges;
  if `<base>` moved, something ran that belonged to `code-ship`, not here.
- **The main checkout is back on trunk** — `git -C <repo-root> branch --show-current`
  must print `<trunk>`. If you branched in place rather than using a worktree, this is
  the step that pays that debt: a checkout left on a feature branch means anything
  reading that tree (dev server, symlink, LaunchAgent) is serving unmerged code.
- The hand-off checklist above is stated, filled in, in your final report — not implied.
