---
name: code-ship
description: "Close the COORDINATOR half of a coding session, human-authorized: verify code-wrap's hand-off contract, grade the diff against the session's plan (or the Issue's stated ask), verify trunk CI is alive and green, harvest every issue the branch carried, squash-merge with Closes #N, post evidence on each issue (including the grade verdict), release every claim, tear the worktree down — and, if a plan file existed, journal one line about its usage and delete it. A Tier A release is a separate ritual, never bundled in. Trigger phrases: 'ship it', 'merge to trunk', 'merge it', 'update the issue and merge'. Runs after code-wrap, only once a human says go — a dashboard Merge click counts, an agent's own say-so never does."
---

# code-ship — merge a wrapped session: verify hand-off → grade → CI → squash → evidence → release → teardown

This is the **coordinator's** half of closing a session — [`code-wrap`](../code-wrap/SKILL.md)
is the implementer's. Where that skill asserts a checklist and stops, this one verifies
the checklist independently and then performs the merge a human authorized. It runs in a
coordinator session, typically a different one from the implementer's, sometimes at a
different model tier.

Notation: `$N` = the feature's Issue number · `<trunk>` = the branch sessions merge into
(from `.github/project.yml`; `main` for Tier B, `dev` for Tier A) · `<base>` = **the
branch this session ships into** — `<trunk>`, unless the worktree was cut from a declared
`integration:` line, in which case it is that line.

**`ceremony: light`? B2b's evidence comment is skipped entirely** (the squash's
`Closes #N` suffices) — project.schema.md#ceremony--optional. Every other step here —
claim discipline, worktree teardown, squash + `Closes #N`, the CI gate — runs exactly
the same regardless of `ceremony`.

## Principle

**Agents prepare releases; humans perform them.** A trunk merge here is authorized, not
inferred — see *What counts as "a human said go"*, below. Do not open a PR, push trunk,
promote to `main`, or tag on your own initiative; those never follow from this skill,
under any authorization.

## 0. Verify the hand-off contract — don't trust the report, re-derive it

`code-wrap` **asserts** five things when it stops. Re-check each from git and GitHub
directly — a session's own report of its state is exactly the kind of self-grading #94
exists to add a second check on top of:

**Resolve `$MAIN_REPO` first, from wherever this coordinator session happens to be
running** — it may itself be inside a worktree, and every plan-file path below is
meaningless unless it is anchored to the main checkout rather than `$PWD` (#113):

```sh
MAIN_REPO="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"

git ls-remote origin <branch>                              # branch actually pushed?
gh issue view $N --comments | tail -5                       # distill comment present?
colab claims                                                 # claim(s) still held?
ls "$MAIN_REPO/.claude/plans/issue-$N.md" 2>/dev/null        # plan file, if one was written
```

- **Branch not on the remote** → `code-wrap` did not finish A5. Stop; do not improvise a
  push from here.
- **No recent distill comment** → A1 did not happen, or happened somewhere this can't
  see. Ask, don't assume it was verbal.
- **Claim released already** → someone (or something) other than this skill let it go.
  That is a finding — B3 below is supposed to be the only unconditional release — chase
  it before merging over a claim that may no longer mean what it used to.
- **Gate result** has no independent artifact to re-derive from outside the report itself
  on most repos — trust the report here, but if anything else on this list is off, treat
  the gate claim as unverified too and re-run it (`code-wrap` A3) before proceeding.

A contract that fails to verify is not a reason to skip the merge — it is a reason to
fix the gap (re-push, re-comment, re-claim) before continuing, or to hand back to an
implementer session rather than papering over it here.

## What counts as "a human said go"

Typing it into the session is the ordinary form, not the only one. A click in an
operator dashboard is a human decision too — provided the prompt that spawned you
carries evidence of *when* and *which* click, so the authorisation can be audited
afterwards instead of being asserted by the agent that benefits from it. The shape:

> `<operator>` triggered the merge via the dashboard Merge button at `<ts>`
> (intent `<id>`) — this click IS the human go-ahead for this skill.

Match on the **timestamp and the intent id**, not on the wording: those are the two
things a dashboard can write and an agent cannot invent, and they are what makes the
click auditable after the fact. Missing either, you hold a claim of authorisation
with nothing behind it — treat it as no go-ahead and ask. **Never compose that
sentence yourself**; a go-ahead you wrote is not a go-ahead you received.

This grants no new latitude. Every step below runs in full, `autonomy: auto-trunk` still
decides whether you may perform the trunk merge at all, and no click of any kind
authorises a promotion, a tag, or anything that deploys.

## B0. Is there still cargo? Then sync `<base>` into the branch

**First, know what you are merging into.** `<base>` is the branch's base: `<trunk>`
in the ordinary case, or the declared `integration:` line the session was cut from
(`CONVENTIONS.md` §2, recorded by `colab worktree new --base`). Everything below —
the sync, the CI check, the squash, the push — targets `<base>`, not trunk-by-reflex.
Shipping a line-based branch into trunk would drag the whole line in behind it inside
one squash commit.

```sh
colab worktrees --json     # .worktrees["<name>"].base — trunk if it has none (shape: #67)
```

**Then ask whether there is anything left to ship:**

```sh
colab landed --worktree <name>      # landed · cargo · unknown
```

- **cargo** → continue with the ship. This is the normal path.
- **landed** → the content is already on `<base>`. **Do not merge again.** Go
  straight to B2b (evidence), B3 (release claims) and B4 (teardown).
- **unknown** → treat as cargo and look by hand before merging.

**`landed` with ZERO commits of its own is a different thing, and it has its own
door (#90).** A session can finish with a real deliverable and no diff at all: a
decision recorded on its issue, an investigation concluding "no change needed", a
design artifact stored outside the repo. That is not an exotic shape, and the route
above does not close it — B2b wants "the `<base>` squash sha", which does not exist
here, and no step in this skill has ever run `gh issue close`. Measured: the claim was
released, the worktree torn down, and the issue stayed open until a human said in
prose that finishing with no commit was acceptable.

```sh
colab ship --worktree <name> --dry     # → MODE: evidence-close, if that is this branch
colab ship --worktree <name>           # posts evidence, CLOSES each issue, tears down
```

It merges nothing, pushes nothing, and writes no empty marker commit. It is gated on
each issue **already carrying a comment colab did not write** — so record what you
delivered on the Issue first (`code-wrap` A1 is where that happens anyway), or ship will
report the issue and leave it open. The zero-diff fact is measured from git; you do not
declare it.

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

Re-run the gate (`code-wrap` A3) — a fresh-migrate test must pass, proving both branches'
migrations run clean together. *(Machine-specific reconcile — e.g. deduping a
migration against one already on trunk — hooks in here; the universal rule is
"regen on the merged base, never hand-merge generated files".)*

## B1. Verify CI on `<base>` is alive AND green

```sh
gh run list --branch <base> -L 1
```

A "failure" that never started (billing lockout, runner outage) still means
**stop** — we once merged for 12 hours into repos whose CI was silently dead
(`CONVENTIONS.md` §4). Branch protection can't check this for us; this command must.

If `<base>` is a declared line with **no runs at all**, it is not yet CI-gated: check
`<trunk>` instead and say so in the report. That is a normal early state for a line,
not a green light — a line that *has* runs and is red still stops the ship.

## B1b. Harvest every issue the branch carried

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

**This sort is now MECHANICALLY checked, not honour-system (#74).** The
incident that motivated it: an issue was closed by squash-merge with a third
of its three-section scope unimplemented — the sections were prose, so
nothing could catch it. If the issue's `## Plan` is a real GitHub checklist
(`- [ ]` one line per deliverable — CONVENTIONS.md §4, *Merging*), `colab
ship` parses it before composing the squash body and refuses to write
`Closes #N` for any issue with an unticked box and no declared remainder —
it writes `Refs #N` instead, leaves the issue open, and reports it (loud, not
silent). Doing B2 **by hand** (no `colab ship`, or a repo without
`autonomy: auto-trunk`): run the same check yourself before you write the
commit message —

```sh
gh issue view $N --json body,comments -q '.body, (.comments[].body)' | grep -E '^\s*- \[[ ]\]|^Remainder: #'
```

any `- [ ]` line with no `Remainder: #M` anywhere in that output means **Partial**,
not **Done** — file the remainder issue and tick what shipped (B2b's evidence
template below) *before* you write `Closes #N`, the same order `colab ship`
enforces mechanically. A `## Plan` with no checkboxes at all — written as
prose — cannot be checked this way; that shape is itself a finding, worth a
line in the Issue, but it does not block the close (nothing here can predate
this convention and be held to it retroactively).

## B1c. Grade the diff against the plan (#94)

Read the plan file, if one exists, from the **main checkout** — `$MAIN_REPO/.claude/plans/issue-<N>.md`
(`$MAIN_REPO` as resolved in §0, not `$PWD` — #113) per issue in the harvested set (B1b),
not the worktree, which may be mid-teardown by the time anything reads this:

```sh
cat "$MAIN_REPO/.claude/plans/issue-<N>.md" 2>/dev/null   # per issue that carried one
```

- **Plan file present** → grade the diff against its *Acceptance oracle* and *Files*
  sections.
- **No plan file** (rung 0, or a session that predates #94) → grade against the Issue's
  own stated ask — its `## Plan` checklist if it has one (B1b's per-item verdict already
  covers this shape), else its prose Goal.

Verdict is one of two, and it is a **judgement**, not a line-count — the same posture
B1b's per-item verdict already takes toward the checklist, applied here to the plan (or
ask) as a whole:

- **pass** — the diff satisfies the stated oracle, or the plan's own deviation note
  (`code-start`/`code-plan`, *Deviating from what you wrote*) explains why it does
  something different and that reason holds up. Proceed to B2; the verdict rides on
  B2b's evidence comment.
- **reject** — the diff does not satisfy the oracle, or drifts from the plan's Files
  list with no written reason anywhere in the plan file. **Do not merge.** Post a
  comment on the issue naming specifically what falls short — not "does not match the
  plan," the actual gap. Leave every claim in the harvested set held; this is a stop for
  a human to resolve (accept the shortfall, send it back, or override), never an
  automatic revert of the branch and never a silent merge-anyway.

A rejected grade ends this skill's run for that issue set. Nothing past B1c executes
until a human has seen the reject comment and said what happens next.

## B2. Squash-merge with `Closes #N`

```sh
git checkout <base> && git pull
git merge --squash <branch>
git commit    # subject: type(scope): …  · body: Closes #N   (one line per issue in the group)
git push origin <base>
```

**`<base>`, every line of it.** If `<base>` is a declared line rather than trunk, the
main checkout must not be parked on it to do this — use `colab ship`, which merges in
an ephemeral worktree, or make one yourself. The at-rest invariant does not pause for
a merge. And merging that **line into trunk** afterwards is never part of a ship: it
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

## B2b. Post evidence on EVERY issue — including the auto-closed ones

**`ceremony: light` repo? Skip this whole step.** The squash's `Closes #N` is the
record; there is no evidence comment to post (project.schema.md#ceremony--optional).
Everything below applies only on `standard` (the default — absent `ceremony:` key).

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

**An issue with a real `## Plan` checklist gets a per-item verdict, not one prose
paragraph (#74).** One line per box: shipped-with-evidence (the `file:line` that proves
it), or moved to `#M` (the remainder issue). A single paragraph summarising "did the
whole thing" is exactly the shape that let a partially-done issue close silently in the
first place — a reader auditing later cannot tell which box a general paragraph actually
covers.

**Carry B1c's grade verdict here too — one line, not a second comment.** `Grade: pass —
<what confirmed it>` for a plan/ask that was satisfied. A `reject` never reaches this
step at all (B1c stopped before B2); if you are here, the verdict is `pass` by
construction, but say what confirmed it so the record does not read as a bare rubber
stamp.

```sh
gh issue comment 88 -b "<!-- colab:evidence sha=a1b2c3d -->
Shipped in \`a1b2c3d\` on <trunk>.
Grade: pass — diff matches the plan's Files list and the payroll fixture in the oracle
confirms the double-count is gone.
- [x] add the overtime_rate column — \`app/Models/Payroll.php:142\`; ran the payroll
      fixture for a 25%-overtime employee, the premium now applies once, not twice.
- [x] backfill existing rows — \`database/migrations/2026_08_01_backfill.php\`; ran
      against a copy of prod data, 0 rows left at the old rate.
- [ ] moved to #91 — the reporting-UI column was out of scope for this branch."
```

**UI-affecting issues additionally require a screenshot of the BUILT app**, not a DOM
assertion and not a static mockup with tokens redefined to match the design system —
both are blind to the real rendering cascade (measured 2026-08-01: a component passed
every token-level assertion and still rendered wrong once actually built, because the
mockup never went through the app's real CSS cascade). Run the app (`/run` skill),
screenshot the changed surface, attach it to the evidence comment.

**Prepend one invisible marker line** — a stable, machine-readable first line, exactly
the pattern the claim comments already use (`CONVENTIONS.md` §5 *Rules*: a stable first
line as wire format, everything after it human). It names the trunk sha the comment
attests, so an external consumer (a closure-review view on a fleet dashboard, say) can
find and verify the evidence comment without heuristics — "first comment after merge
by the closing actor" is brittle; a stable marker is not.

```sh
gh issue comment 88 -b "<!-- colab:evidence sha=a1b2c3d -->
Shipped in \`a1b2c3d\` on <trunk>.
\`app/Models/Payroll.php:142\` — added the \`overtime_rate\` column.
Checked: ran the payroll fixture for a 25%-overtime employee; the premium is now
applied once, not twice — the double-count this issue reported is gone."
```

**Degrade, never gate.** The marker is an upgrade to an already-required comment, never
a new requirement of its own: a comment missing it (an older ship, a hand-written one)
still counts as evidence and must never be treated as absent by anything reading these
comments. Everything after the marker line stays free prose — **not** a structured
evidence format. A schema with fields invites padding (a 3-line honest comment becomes
a 15-line template of restated obviousness); the marker's whole job is being findable,
not being complete.

**Not evidence:** quoting your own commit message · restating the ticked checklist ·
"done in `feat/x-23`". All three assert the work happened; none show it did.

**Made a significant design decision mid-work, without a pre-approved spec?** Add
`design-not-preapproved` as plain text in the same comment, after the marker line
(`CONVENTIONS.md` §5, *Design ruling*). Not a second marker — the marker's job is being
findable, not enumerating every condition a comment might report — just a word a human
reviewer greps for:

```sh
gh issue comment 88 -b "<!-- colab:evidence sha=a1b2c3d -->
Shipped in \`a1b2c3d\` on <trunk>.
design-not-preapproved — the spec did not cover the empty-state illustration; chose one
consistent with the existing icon set. Flagging for review.
\`app/Views/EmptyState.tsx:12\` — added the illustration and copy."
```

This is the human-review path for a design decision the `needs-ruling` gate did not
catch because nobody could have: the surface did not look significant until someone was
already building it. The session does not stop to request a ruling first — it continues
on the designer's spec and lets the evidence comment carry the flag instead.

## B2c. Update the parent epic — if, and only if, it is hand-maintained

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

## B2d. Tear down a spent `group:<key>` label (#82)

**`colab ship` does this for you** — its B4 unions the `group:` labels the branch's
issues carried and, per label, checks whether any issue anywhere still carries it
**open**. None left → the label OBJECT is deleted (`gh label delete`); one still open
→ left exactly as it was, because it still binds the remainder. Nothing here to do on
that path — it runs automatically, after the evidence comments in B2b.

**Only if you merged by hand** (no `colab ship` — a repo without `autonomy:
auto-trunk`), do the equivalent yourself, once B2 has pushed:

```sh
for GL in $(gh issue view $N --json labels -q '.labels[].name' | grep '^group:'); do
  gh issue list --label "$GL" --state open --json number -q length \
    | grep -qx 0 && gh label delete "$GL" --yes
done
```

Only `group:*` labels are ever in scope — never `in-progress`, `deps-checked`,
`agent-filed`, `needs-plan`, or `epic`. Deleting the label does not erase the record:
the closed issues' timelines still show it was applied, and each member's `Because:`
comment (`CONVENTIONS.md` §5, *Grouping*) is the durable evidence of *why*, independent
of whether the label object survives.

## B3. Release the claim(s)

```sh
colab release $N        # if colab is installed …
gh issue edit $N --remove-label in-progress    # … else raw, one per issue
```

Release **every** issue in the group, even ones you didn't finish — a stale claim
silently blocks others (`CONVENTIONS.md` §5).

**No exceptions — not "unless unfinished", not "unless the worktree stays".**
`code-start` adds the claim, this skill removes it: symmetric and unconditional.
Because:

- A conditional release rule is one agents skip. The unconditional one is the one
  that actually gets executed.
- A claim is scoped to a **session**. Once the session ends it names a holder who
  no longer exists.
- Nothing ages a claim out. A kept-but-forgotten worktree would hold its issues
  indefinitely and **no health check flags it** — the worktree is alive, so the
  claim looks healthy.
- Re-claiming next session is one command already in the `code-start` flow. The cost
  of releasing is near zero; the cost of a stale claim is someone else blocked.

*Tradeoff, chosen deliberately:* releasing gives up the lock that stopped a second
session starting a colliding branch on a kept worktree. That protection now rests
on the **session-start check** — before starting, verify whether the work already
exists (`git log --grep`, grep the code, and look for an existing branch or
worktree for that issue) rather than trusting the absence of a label. `code-start`
already says *open ≠ untouched*; this is why.

**A `reject` verdict from B1c never reaches this step** — the claim stays held until a
human resolves the rejection, which is the whole point of stopping at B1c rather than
merging past it.

## B4. Tear down the worktree — remove by DEFAULT

Made a worktree? **Remove it.** Finished-but-not-removed worktrees are the single
most-skipped step we measured (8 of 9 sessions, 2.9 GB) — and the permissive
"(optional)" this step used to open with is what produced that miss rate. Removal
is the default path; keeping one is the exception you must justify.

```sh
colab worktree rm <name>    # if colab is installed (releases its claims, frees its ports) …
git worktree remove <path>  # … else raw git
```

`colab worktree rm` runs the repo's `.colab/hooks/pre-remove` (e.g. dropping a
cloned DB) and refuses if there's uncommitted work — tracked changes **or**
untracked, non-ignored files. Untracked counts because it is the only category
with no copy anywhere else: not in the index, not in a commit, not on the remote.
Ignored files (build output, a copied `.env`) never block.

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
- teardown is blocked by uncommitted work (tracked or untracked).

> **If you keep it, release its claims by hand.** `colab worktree rm` is *what*
> releases claims — skip the removal and that automatic path never runs, so B3
> did not happen for you. Do it explicitly:
> ```sh
> colab release <N>                              # … or, without colab:
> gh issue edit <N> --remove-label in-progress
> ```
> B3 is unconditional: a kept worktree changes **who runs** the release, never
> **whether** it runs.

### Delete the plan file and journal its usage, in the same breath (#94)

For **each** issue in the harvested set (B1b) that had a plan file — check the main
checkout, not the worktree, which this step may already be removing. `$MAIN_REPO` is
`§0`'s resolved absolute path; re-derive it here if this step runs in a fresh shell
that no longer has it (#113):

```sh
MAIN_REPO="${MAIN_REPO:-$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")}"
for N in <harvested issue numbers>; do
  PLAN="$MAIN_REPO/.claude/plans/issue-$N.md"
  [ -f "$PLAN" ] || continue
  RUNG=$(sed -n 's/^rung: *//p' "$PLAN" | head -1)
  CAUSE=$(sed -n 's/^cause: *//p' "$PLAN" | head -1)
  mkdir -p "$(dirname ~/.colab/plan-journal.jsonl)"
  python3 -c '
import json, sys, datetime
n, rung, cause, verdict = sys.argv[1:5]
print(json.dumps({
    "ts": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
    "issue": int(n), "rung": rung, "cause": cause, "verdict": verdict,
}))' "$N" "${RUNG:-1}" "${CAUSE:-none}" "$GRADE_VERDICT" >> ~/.colab/plan-journal.jsonl \
    && rm -f "$PLAN"
done
```

- **Machine-local, never the tracker.** `~/.colab/plan-journal.jsonl` never leaves this
  machine and is never committed — it is not a second source of truth about the feature,
  only a record of how the planning mechanism itself is being used.
- **One line per issue that had a plan file**, not one per branch — a group branch can
  carry several issues, and rung/cause are recorded per plan file, not per branch.
- **This is the one moment everything about the plan's life is known**: rung, cause
  (flagged vs self-escalated), and B1c's grade verdict. Weeks of this file answer rung
  frequencies, flag precision (flagged but the diff graded clean with no friction?), and
  flag recall (unflagged but a mid-session escalation caught it?) — the evidence to tune
  or retire the `needs-plan` mechanism. Nothing reads it automatically; a human greps it.
- **Delete only after the journal line lands, and chain it — never split across
  statements.** The append and the `rm` are one `&&`-joined command, not two lines, because
  a compose that fails silently (wrong interpreter, a bad argument) must not let control
  reach the delete. This is `python3`, not `jq`, on purpose (#96): `jq` was pulled in for
  this one line and appears nowhere else this skill family actually depends on, while
  `python3` is already an assumed interpreter elsewhere (`code-sweep` §1's worktree-filter
  snippets) — so this removes an undeclared dependency rather than adding one more thing
  every machine running this skill must have installed. Measured failure mode this
  replaces: `jq` missing → the old `$(jq …)` command substitution failed, `printf` still
  wrote a bare newline (exit 0) into the journal, and the un-chained `rm -f "$PLAN"` on the
  next line still ran — the plan file was gone with no journal line to show for it.
- **Delete only after the journal line lands**, and only issues with no plan file are a
  silent no-op here — a rung-0 session never had one, and this loop skips it correctly.

## B5. Tier A release — a SEPARATE ritual, and not yours

Merging to trunk is **not** a release. A Tier A release is promotion `dev` →
`main` (`--no-ff`, never squash) plus a `v*.*.*` tag — performed by the human
operator, per `CONVENTIONS.md` §6. If you believe a release is overdue (a
production fix is merged but unreleased), say so explicitly in your report; do
not perform it.

---

## Verify complete

- The hand-off contract was **verified**, not assumed — each item re-derived from git
  or GitHub, any gap fixed or escalated before continuing.
- B1c's grade verdict is recorded — `pass`, carried into B2b's evidence comment, or
  `reject`, standing alone with nothing past it executed for that issue set.
- `gh issue view $N`: checklist ticked (inherited from `code-wrap`), and now closed
  with evidence, or left open with the next step written into it.
- Every issue the branch carried (B1b's harvested set) is either closed with evidence,
  split into a new issue for the leftover, or left open with a written reason. No number
  left dangling.
- Every one of those issues has an evidence comment — **including the ones `Closes #N`
  auto-closed**, which attach nothing on their own.
- `git log --oneline -5 <base>` shows the squash-merge; **every** claim released
  (unconditionally, finished or not) — unless B1c rejected, in which case every claim in
  that set is still, correctly, held.
- Worktree removed — or kept with the reason written in your report and its claims
  released by hand.
- Every plan file in the harvested set is gone, and the journal line for it landed first.
- **Your report names the branch you merged into.** Not "merged" — merged *into what*.
  It is the difference between shipped-to-trunk and parked-on-a-line, and only one of
  those is on its way to users.
