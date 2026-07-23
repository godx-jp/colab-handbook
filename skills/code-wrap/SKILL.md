---
name: code-wrap
description: "Close a coding session in two phases. Phase A (an agent may do it): distill what you learned back onto the feature's GitHub Issue, update any repo docs the work made stale, run the repo's own quality gate, commit only the deliverable paths, push the session branch as backup — then STOP. Phase B (a human triggers it): verify trunk CI is alive and green, harvest every issue the branch carried, squash-merge with Closes #N, post evidence on each issue, release every claim, tear the worktree down. A Tier A release is a separate ritual, never bundled in. Trigger phrases: 'wrap up the session', 'finish coding', 'ship it', 'close the session', 'merge to trunk', 'merge it', 'done coding', 'update the issue and merge'. Pairs with code-start. Agents prepare releases; humans perform them."
---

# code-wrap — close a session: distill → docs → gate → commit → (stop) → merge

Two phases. **Phase A runs now** and ends with the branch pushed as a backup.
**Phase B runs only when a human says go** — merging to trunk is a human decision.

Notation: `$N` = the feature's Issue number · `<trunk>` = the branch sessions
merge into (from `.github/project.yml`; `main` for Tier B, `dev` for Tier A) ·
`<base>` = **the branch this session ships into** — `<trunk>`, unless it was cut
from a declared `integration:` line, in which case it is that line (B0).

## Principle

**Agents prepare releases; humans perform them.** Your job ends with the trunk
merge prepared and the Issue updated. Do not open a PR, push trunk, promote to
`main`, or tag on your own.

---

## Phase A — do this now

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
that is the breadcrumb back to the context:

```
Filed-by: agent (during code-wrap of #$N, session <name>)
```

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

### A4. Commit only the deliverable paths

```sh
git add <specific deliverable paths>   # NOT git add -A
git status                             # confirm no local/preview/config files sneak in
git commit                             # Conventional Commits: type(scope): summary
```

Conventional-Commit prefix is mandatory — release notes group on it, so an
unprefixed commit is invisible in the changelog (`CONVENTIONS.md` §4).

### A5. Push the session branch as backup — then STOP

```sh
git push -u origin <branch>    # a backup/record, NOT a PR, NOT trunk
```

**Stop here.** Wait for an explicit human go-ahead ("OK, merge it") before Phase B.

---

## Phase B — only after a human says go

**What counts as "a human said go".** Typing it into the session is the ordinary
form, not the only one. A click in an operator dashboard is a human decision too —
provided the prompt that spawned you carries evidence of *when* and *which* click,
so the authorisation can be audited afterwards instead of being asserted by the
agent that benefits from it. The shape:

> `<operator>` triggered the merge via the dashboard Merge button at `<ts>`
> (intent `<id>`) — this click IS the Phase B human go-ahead.

Match on the **timestamp and the intent id**, not on the wording: those are the two
things a dashboard can write and an agent cannot invent, and they are what makes the
click auditable after the fact. Missing either, you hold a claim of authorisation
with nothing behind it — treat it as no go-ahead and ask. **Never compose that
sentence yourself**; a go-ahead you wrote is not a go-ahead you received.

This grants no new latitude. B0–B4 run in full, `autonomy: auto-trunk` still decides
whether you may perform the trunk merge at all, and no click of any kind authorises
a promotion, a tag, or anything that deploys.

### B0. Is there still cargo? Then sync `<base>` into the branch

**First, know what you are merging into.** `<base>` is the branch's base: `<trunk>`
in the ordinary case, or the declared `integration:` line the session was cut from
(`CONVENTIONS.md` §2, recorded by `colab worktree new --base`). Everything below —
the sync, the CI check, the squash, the push — targets `<base>`, not trunk-by-reflex.
Shipping a line-based branch into trunk would drag the whole line in behind it inside
one squash commit.

```sh
colab worktrees --json     # this worktree's .base — trunk if it has none
```

**Then ask whether there is anything left to ship:**

```sh
colab landed --worktree <name>      # landed · cargo · unknown
```

- **cargo** → continue with the wrap. This is the normal path.
- **landed** → the content is already on `<base>`. **Do not merge again.** Go
  straight to B2b (evidence), B3 (release claims) and B4 (teardown).
- **unknown** → treat as cargo and look by hand before merging.

**Never decide this by counting commits.** A squash-merge mints a new sha, so a
shipped branch's own commits look permanently unmerged — a count-only check calls
*every branch we have ever shipped* unshipped and invites re-merging finished work.
Without `colab`, ask the content question directly: `git merge-tree --write-tree
origin/<base> <branch>` printing exactly `git rev-parse origin/<base>^{tree}` means
the branch adds nothing. (`CONVENTIONS.md` §4, "Has it landed?")

**Now sync.** Merge conflicts here are almost always **generated files** (codegen
locks, duplicate-timestamp migrations, generated route/type files) — they happen when
a branch regenerated on an old base while `<base>` moved ahead. Cure it in the branch,
before touching `<base>`. Skip if `<base>` hasn't moved since you branched
(`git rev-list --count <branch>..origin/<base>` = 0):

```sh
git fetch origin <base>
git merge origin/<base>        # conflicts in generated files → the regen below overwrites them
# then re-run the repo's codegen on the merged base, e.g. npm run build / codegen
git add -A && git commit -m "chore(sync): merge <base> + regen generated files"
```

Re-run the gate (A3) — a fresh-migrate test must pass, proving both branches'
migrations run clean together. *(Machine-specific reconcile — e.g. deduping a
migration against one already on trunk — hooks in here; the universal rule is
"regen on the merged base, never hand-merge generated files".)*

### B1. Verify CI on `<base>` is alive AND green

```sh
gh run list --branch <base> -L 1
```

A "failure" that never started (billing lockout, runner outage) still means
**stop** — we once merged for 12 hours into repos whose CI was silently dead
(`CONVENTIONS.md` §4). Branch protection can't check this for us; this command must.

If `<base>` is a declared line with **no runs at all**, it is not yet CI-gated: check
`<trunk>` instead and say so in the report. That is a normal early state for a line,
not a green light — a line that *has* runs and is red still stops the wrap.

### B1b. Harvest every issue the branch carried

B2 needs the **complete** set of issue numbers at the moment it writes the squash
message. Build the set here — after the merge is pushed you can no longer add a
missing `Closes` line without amending a commit that is already on trunk.

**Primary source — git. Always works, no CLI required:**

```sh
{ git log --format=%B origin/<trunk>..<branch> | grep -oE '#[0-9]+' | tr -d '#'
  printf '%s\n' "<branch>" | grep -oE '(-[0-9]+)+$' | tr -- '-' '\n'
} | grep -E '^[0-9]+$' | sort -un
```

Commit bodies carry `#N`; branch names carry **bare** trailing digits
(`fix/import-fixes-115-114-113`) — hence the two different extractions. Anchoring
the branch half to the trailing group is deliberate: a plain `[0-9]+` sweep turns
`feat/oauth2-login-88` into issues 2 and 88.

**Optional cross-check — the claims registry, if `colab` is installed:**

```sh
colab claims --json    # filter .worktree == "<name>", or .repo for a trunk session
```

Claims live in `colab claims`, **not** on the worktree record — `colab worktrees
--json` has no `issues` field (verified 2026-07-20; the table's ISSUES column is
derived by filtering claims, so don't go looking for it in the JSON).

The two sources fail in **opposite** directions, which is the point of running
both: git catches an issue worked on but never claimed; the registry catches one
claimed but never mentioned in a commit. A number in one set and not the other is
a **finding** — chase it down, don't average it away.

**Verify by code, not by commit message.** A commit saying `#88` proves only that
someone typed `#88`. Grep trunk for the thing the issue actually describes — the
column, route, UI string, function:

```sh
git log --oneline --all --grep="#88"
grep -rn "<thing the issue describes>" <paths>
```

**Sort every number into one of three buckets — none may stay unsorted:**

| Bucket | Action |
|---|---|
| **Done** | `Closes #N` in B2; confirm it actually closed; evidence in B2b. |
| **Partial** | Close it **and** open a new linked issue for the remainder. |
| **Untouched** | Leave open, with the next step written into it. |

Never close a partial issue bare — that buries the open question where nobody
will find it again. Never leave it whole either — the next session reads an
untouched issue as untouched work and redoes what you already shipped. This is
the same failure mode as `(#N)`: issues sitting open with their code long since
merged (`CONVENTIONS.md` §4).

### B2. Squash-merge with `Closes #N`

```sh
git checkout <base> && git pull
git merge --squash <branch>
git commit    # subject: type(scope): …  · body: Closes #N   (one line per issue in the group)
git push origin <base>
```

**`<base>`, every line of it.** If `<base>` is a declared line rather than trunk, the
main checkout must not be parked on it to do this — use `colab ship`, which merges in
an ephemeral worktree, or make one yourself. The at-rest invariant does not pause for
a merge. And merging that **line into trunk** afterwards is never part of a wrap: it
is a human integration event of a promotion's weight.

- **`Closes #N`, not a bare `(#N)`** — GitHub only auto-closes on the keyword. We
  measured 26/30 issues left open with their code long merged because commits
  said `(#N)` (`CONVENTIONS.md` §4).
- One `Closes #N` per issue the branch carried — the set you harvested in B1b, not
  just the "main" one.
- **A long-lived tracking/memory issue is `Refs #N`, not `Closes #N`.** If the branch
  claimed an issue used as external memory for a whole domain — a checklist of still-open
  items you touched but did not complete — reference it, don't close it, or you bury its
  knowledge behind a closed-issue lookup (`CONVENTIONS.md` §5, *Tracking issues*). Through
  the blessed door this is automatic for an issue carrying the `tracking` label, or opt in
  per-ship with `colab ship --refs <N>`; the claim is still released either way.
- *(Machine-specific automation — migrate the trunk DB, restart the trunk dev
  server — hooks in here: `.colab/hooks/`. It is the one moment trunk may go down;
  keep the window short.)*

### B2b. Post evidence on EVERY issue — including the auto-closed ones

`Closes #N` closes the issue the instant trunk is pushed: silently, with nothing
attached. So the best-evidenced rule in the handbook is exactly the one that skips
the evidence step — the issue goes green and no one ever records *what* shipped.

**Comment evidence on every issue the branch carried, whether it auto-closed or you
closed it by hand.** This runs **after** the merge, because the sha you cite must be
the **trunk squash sha** — the branch sha is gone once the branch is deleted (a
squash leaves no merge relation, which is why deleting the branch needs
`git branch -D`, not `-d`).

Evidence is three parts: **the `<base>` squash sha · `file:line` · what you checked and
what came back.** When `<base>` is a declared line, say so in the comment: that code is
**not in trunk yet**, and an evidence comment that implies otherwise will be read as
"this is in the next release".

```sh
gh issue comment 88 -b "Shipped in \`a1b2c3d\` on <trunk>.
\`app/Models/Payroll.php:142\` — added the \`overtime_rate\` column.
Checked: ran the payroll fixture for a 25%-overtime employee; the premium is now
applied once, not twice — the double-count this issue reported is gone."
```

**Not evidence:** quoting your own commit message · restating the ticked checklist ·
"done in `feat/x-23`". All three assert the work happened; none show it did.

### B2c. Update the parent epic — if, and only if, it is hand-maintained

`code-triage` instructs its readers to **trust the epic's checklist table over its
title**, on the grounds that only the table is maintained. Nothing in this family
maintained it. Measured across one repo in one day: one epic stayed correct purely
because the operator happened to remember it existed through four consecutive merges,
while a second — that nobody remembered — held two lines wrong in *opposite*
directions: one claiming a branch that no longer existed, one ticked but annotated
"held open for review" on an issue already closed. A document that says "trust X"
while nothing updates X does not fail neutrally; it produces confidently wrong plans.

**First ask which kind of parent it is**, because #34's mechanism removed most of
this work rather than adding to it:

```sh
gh issue view $N --json parent -q '.parent.number // "none"'
```

- **A native parent (sub-issue link)** → **do nothing.** GitHub maintains
  `subIssuesSummary` itself; the child closing *is* the update. Ticking a checklist
  line here would be inventing a second, hand-run source of truth beside a correct
  automatic one.
- **No native parent** → look for a hand-written checklist that references this issue:

```sh
gh issue list --state open --search "#$N in:body" --json number,title
```

For each open parent whose body has a **checklist line** containing `#$N`, tick that
one line and record the trunk sha beside it. Prefer converting the epic to native
sub-issues if the owner wants it — then this step stops applying forever.

**Four things not to do** — each is a way this step turns destructive:

1. **Never close the epic**, even when the last box ticks. Boxes running out does not
   mean work running out: an epic can have two phases complete and two whose issues
   are not written yet. Closing it buries the unwritten part.
2. **Never rewrite the epic's prose.** Edit the one checklist line for the issue that
   just closed. The body is where the owner records decisions; a skill has no business
   editing there.
3. **No checklist, no action.** Do not create a table the repo did not choose.
4. **Never infer parentage from a title.** Accept it only from a native `parent` link,
   or from a literal `#$N` on a checklist line. Prose that merely mentions `#$N`
   ("related to #$N", "unlike #$N") is **not** a checklist line and must not be edited.

   A checklist line is `- [ ]` or `- [x]` — **a bullet is not a checklist**:

   ```sh
   grep -nE '^\s*-\s*\[[ x]\].*#'"$N"      # a hit here may be ticked; anything else may not
   ```

   This is not hypothetical. The issue that asked for this step lists its own related
   work as `- **#28** (…)` — a bullet, matching any loose "list line mentioning #N"
   rule, and editing it would tick a line that tracks nothing. Verified against that
   body: the anchored pattern rejects it, a `-.*#N` pattern accepts it.

### B3. Release the claim(s)

```sh
colab release $N        # if colab is installed …
gh issue edit $N --remove-label in-progress    # … else raw, one per issue
```

Release **every** issue in the group, even ones you didn't finish — a stale claim
silently blocks others (`CONVENTIONS.md` §5).

**No exceptions — not "unless unfinished", not "unless the worktree stays".**
code-start adds the claim, code-wrap removes it: symmetric and unconditional.
Because:

- A conditional release rule is one agents skip. The unconditional one is the one
  that actually gets executed.
- A claim is scoped to a **session**. Once the session ends it names a holder who
  no longer exists.
- Nothing ages a claim out. A kept-but-forgotten worktree would hold its issues
  indefinitely and **no health check flags it** — the worktree is alive, so the
  claim looks healthy.
- Re-claiming next session is one command already in the code-start flow. The cost
  of releasing is near zero; the cost of a stale claim is someone else blocked.

*Tradeoff, chosen deliberately:* releasing gives up the lock that stopped a second
session starting a colliding branch on a kept worktree. That protection now rests
on the **session-start check** — before starting, verify whether the work already
exists (`git log --grep`, grep the code, and look for an existing branch or
worktree for that issue) rather than trusting the absence of a label. code-start
already says *open ≠ untouched*; this is why.

### B4. Tear down the worktree — remove by DEFAULT

Made a worktree? **Remove it.** Finished-but-not-removed worktrees are the single
most-skipped step we measured (8 of 9 sessions, 2.9 GB) — and the permissive
"(optional)" this step used to open with is what produced that miss rate. Removal
is the default path; keeping one is the exception you must justify.

```sh
colab worktree rm <name>    # if colab is installed (releases its claims, frees its ports) …
git worktree remove <path>  # … else raw git
```

`colab worktree rm` runs the repo's `.colab/hooks/pre-remove` (e.g. dropping a
cloned DB) and refuses if there's uncommitted tracked work.

**It also refuses when the worktree still owns running processes** — anything
whose cwd is inside it, typically the dev server you started. That is not an
obstacle to route around: remove the tree underneath a live server and it keeps
listening on a port the registry now calls free, serving a checkout that no
longer exists. Stop the server and re-run, or pass `--force` to have `colab`
terminate what it owns. Ownership is decided by cwd, never by port, so `--force`
cannot reach an unrelated process that merely holds the same port.

**Keep it only for a named reason,** and write the reason in your report — never
leave one standing silently:

- the group branch still has unfinished issues,
- a human just told you to keep working in it,
- teardown is blocked by uncommitted tracked work.

> **If you keep it, release its claims by hand.** `colab worktree rm` is *what*
> releases claims — skip the removal and that automatic path never runs, so B3
> did not happen for you. Do it explicitly:
> ```sh
> colab release <N>                              # … or, without colab:
> gh issue edit <N> --remove-label in-progress
> ```
> B3 is unconditional: a kept worktree changes **who runs** the release, never
> **whether** it runs.

### B5. Tier A release — a SEPARATE ritual, and not yours

Merging to trunk is **not** a release. A Tier A release is promotion `dev` →
`main` (`--no-ff`, never squash) plus a `v*.*.*` tag — performed by the human
operator, per `CONVENTIONS.md` §6. If you believe a release is overdue (a
production fix is merged but unreleased), say so explicitly in your report; do
not perform it.

---

## Verify complete

- `gh issue view $N`: checklist ticked, Decisions/Gotchas updated, session comment added.
- Durable knowledge landed in `docs/`, and `git diff --stat -- CLAUDE.md` shows a pointer
  or an edit — not a transplanted section. If it grew by ~30 lines, A2 was read backwards.
- Every issue the branch carried (B1b's harvested set) is either closed with evidence,
  split into a new issue for the leftover, or left open with a written reason. No number
  left dangling.
- Every one of those issues has an evidence comment — **including the ones `Closes #N`
  auto-closed**, which attach nothing on their own.
- If Phase A only: `<base>` is unchanged (no session commit in `git log <base>`).
- **The main checkout is back on trunk** — `git -C <repo-root> branch --show-current`
  must print `<trunk>`. If you branched in place rather than using a worktree, this is
  the step that pays that debt: a checkout left on a feature branch means anything
  reading that tree (dev server, symlink, LaunchAgent) is serving unmerged code.
- After Phase B: `git log --oneline -5 <base>` shows the squash-merge; **every** claim
  released (unconditionally, finished or not); worktree removed — or kept with the reason
  written in your report and its claims released by hand.
- **Your report names the branch you merged into.** Not "merged" — merged *into what*.
  It is the difference between shipped-to-trunk and parked-on-a-line, and only one of
  those is on its way to users.
