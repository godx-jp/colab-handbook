# Engineering Conventions

How we manage branches, releases, and in-flight work across every repo we own — in
our orgs and in personal accounts alike.

Written for **both humans and AI coding agents**. If you are an agent starting a session,
read this file and the repo's `.github/project.yml` before touching anything.

**This handbook decides outcomes, not implementations.** It tells you what must be true —
which branch work lands on, what a release is, how to claim an issue. It never tells you
which Node version to build with, which test runner to use, or what your CI file looks like.
Those belong to each repo. Where you see a command here, it illustrates a rule; it is not a
tool you must adopt.

> **Why enforcement is weak by design:** GitHub branch protection is unavailable on our
> private repos (`403 Upgrade to GitHub Pro`). We cannot make `main` unpushable. Nothing here
> is enforced by GitHub settings. Conformance is checked *from outside* by the audit tool
> ([§8](#8-conformance-and-reconciliation)), and otherwise rests on habit.

---

## 1. The model in one picture

Which model a repo uses depends on **two questions: does it deploy to production, and
if so, what gates that deploy?**

```
TIER B — no production yet
  feat/<slug>-<issue> ──▶ main
                           │
                        your CI

TIER C — live; the promotion IS the deploy
  feat/<slug>-<issue> ──▶ dev ──▶ main
                           │       │
                        fast CI  deploy

TIER A — live; a tag deploys
  feat/<slug>-<issue> ──▶ dev ──▶ main ──▶ tag v1.2.0
                           │       │        │
                        fast CI  full CI  deploy
```

Count the gates between a merge and users: **B** has none (no production), **C**
has one (the promotion), **A** has two (the promotion, then the tag). C is A minus
the tag.

**Tier B is the default.** A repo starts here and stays here until something actually
consumes a release. Do not create `dev` "to be ready" — see [§10](#10-anti-patterns).

### Why the split exists at all

`main` in Tier A is a **pure release branch**. It is not where work lands; it is where work
is *promoted* to. This buys one specific thing: the expensive test suite runs at promotion
time, not on every session merge. Sessions stay fast; releases stay safe.

**If your test suite is fast, you do not need Tier A.** The split is a response to slow CI,
not a badge of seriousness. A repo with no meaningful test suite gains nothing from it — it
gets the ceremony without the benefit, and `main` becomes a branch nobody has a reason to
trust. Write the suite first, then split.

---

## 2. Tiers

| | **Tier B** | **Tier C** | **Tier A** |
|---|---|---|---|
| Has production | no | yes | yes |
| Gates between merge and users | 0 | 1 | 2 |
| Trunk (where sessions merge) | `main` | `dev` | `dev` — or `main`, tag-gated¹ |
| Release branch | — | `main` (= what is live) | `main` |
| CI on trunk | fast | fast | fast |
| CI on `main` | — | full suite | full suite |
| Tags | optional | optional | required, `v*.*.*` |
| Deploy trigger | none | the `dev` → `main` promotion | tag push — or a human running the repo's runbook |

¹ A tag-gated Tier A (`deploy: tag`) may collapse the split and run a single trunk
`main`: the tag marks the release boundary, so the second branch is redundant —
see the *tag-gated Tier A* paragraph below.

**A, B and C are labels, not grades.** Read down the table naively and `C` looks
like a worse `B` — it is not. `B` has no production at all: a tier B repo cannot
break anything for users, because it has none. The letters name *shapes*, not
seriousness or maturity. Moving `B` → `C` is not a demotion, and `C` → `A` is not
a reward for good behaviour; each is a claim about how many gates your pipeline
really has. Claim the one that is true.

**The first tier question is "is there a production target *today*?", not "is
deploying automated?"** No production → Tier B, and an imminent launch is still B.
Production → A or C, and the second question decides which: **does a deliberate
release artifact gate production, or does the promotion itself ship?** A tag ritual
someone actually honours → A. The `dev` → `main` merge goes straight to users → C.

A repo that is live but ships by hand — rsync, `docker compose up -d --build`, an
upload — is Tier A with `deploy: manual`, naming its procedure in `runbook:`: the
promotion there does not itself deploy, a human running the runbook does, which is
still two acts. Automation is a property of the pipeline; the tier is a property of
the *stakes and the gates*, and the stakes are set by production existing. Forcing
any live repo to Tier B would make it declare `production: null` — a lie about a
live product, which is the failure [§10](#10-anti-patterns) is entirely about.

Hand-deployed Tier A keeps the same two branches, and they earn their keep: `main`
is **what is currently running on the host**, `dev` is where sessions land, and the
`dev` → `main` promotion is the deliberate "I am about to deploy" act. That is what
preserves the meaning of `main` in the absence of a workflow — it is the only record
of what shipped and when.

**A tag-gated Tier A may instead run a single trunk `main`.** When `deploy: tag`,
the **tag** is the deliberate release artifact, and the tag itself marks the release
boundary — the last `v*.*.*` is "what shipped and when", the exact job the `dev` →
`main` split does on a hand-deployed repo. A second branch marking the same boundary
is then redundant, so such a repo may land day-to-day work on `main` and cut releases
by tag. This is common in tag-gated GitOps: a release script cuts `vX.Y.Z` and
fast-forwards a long-lived **release branch** that an external poller watches and
redeploys, so the deploy runs **outside** the repo's CI and there is **no in-repo
deploy workflow** by design. The tier is set by the promotion **gate** — a version
tag — not by the trunk **name** and not by where the deploy job runs. This variant is
specific to `deploy: tag`: `manual` and `push-main` have no tag to mark the boundary,
so they keep the `dev`/`main` split. Wherever the deploy runs outside CI — a `manual`
hand-deploy or a `tag` deployed by an external poller — the path to production must be
committed as a [`runbook:`](project.schema.md#runbook--required-when-an-out-of-ci-deploy-has-no-workflow),
since no workflow file records it. **Name that release branch in
[`releaseBranch:`](project.schema.md#releasebranch--optional)** — between releases
it is, by construction, an ancestor of trunk, which reads identically to a spent
session branch to any check reasoning from ancestry alone; undeclared, `colab
doctor` misreads it as safe to delete (issue #63).

**Tier C exists because a tag ritual nobody honours is worse than no tag ritual.** A
live but low-stakes site — a brochure page, an internal dashboard — gains nothing from
cutting versions, and a repo forced to pretend it does ends up with a `main` that
deploys on every push and docs claiming a gate that was never there. C describes that
shape honestly: `deploy: push-main`, `main` is what is live, and the promotion is the
one moment where someone decides to ship. It is not a lesser A; it is a different gate
count, chosen deliberately.

**Deploying straight off a `main` push does not meet Tier A's contract — it meets
C's.** `deploy: push-main` is a legal value and a perfectly reasonable way to ship
software; for the repos on it, pushing `main` genuinely does deploy, and a marker file
that describes something other than reality is the failure
[§8](#8-conformance-and-reconciliation) is about. The mismatch is with the *tier*: A's
contract is that a deliberate release artifact gates production ([§6](#6-releases)),
and where every push to `main` reaches users there is no such artifact. So `tier: A` +
`push-main` is a finding, and the usual fix is **retiering to C** — no pipeline change,
the descriptor simply stops claiming a gate it never had. Migrating to a tag trigger
(`deploy: tag`) or declaring a hand-deploy (`deploy: manual` + `runbook:`) remain the
alternatives when the site has genuinely earned them.

**"Trunk" is a role, not a branch name.** It means *the branch sessions merge into* — `main`
in Tier B, `dev` in Tier C, and `dev` **or** (tag-gated) `main` in Tier A. When our internal
docs say "merge về trunk" or "trunk luôn sống", they mean the role. Read `project.yml` to learn
which branch that is in a given repo. Never create a branch literally named `trunk`.

That includes never *recording* one. The word is a natural placeholder for "no branch — this
work sits on the trunk checkout", and written into a field that names a branch it becomes a
name nothing can resolve. We had one: a session's record read `branch: "trunk"` while the real
branch was healthy, and the damage was invisible because each reader failed politely. The
lifecycle check answered `unknown`; the merge tool matched claims **by branch name**, found
none, reported `(none claimed)` and squashed anyway — so the commit carried **no `Closes #N`**
and the issue stayed open with its code merged, which is the 26-of-30 failure above, reached
by a path nothing was watching. **The absence of a branch is null, not a word.** A tool that
stores this should refuse the role word on write, and should treat "this branch has no claimed
issues" as suspicious rather than routine.

**Trunk is the primary integration point, and not always the only one.** A repo may declare
additional long-lived lines in `project.yml`
[`integration:`](project.schema.md#integration--optional) — a branch accumulating work for a
release weeks out. Sessions may be cut from a declared line and ship back into it, and it is
guarded exactly as trunk is. What it never gets is a path to production: **nothing in the
promote, tag or deploy path reads that field**, so the only way work on a line reaches users
is a human merging the line into trunk and then promoting. That merge is an integration
event of a promotion's weight, and tooling refuses to perform it.

This is a second *development* axis, not a second trunk. `trunk:` stays tier-locked, because
on Tiers A and C trunk **is** the production spine — the branch promotion consumes. Declaring
a long-lived line as trunk would aim the promotion path straight at it, which is the opposite
of what the line is for.

**`trunk:` gets asked a third question, and the ruling is that it stays silent on it.**
Consumers reading `trunk:` fall into two groups. **Group A — correctness:** worktree
classification, the landed/delete-safety check, the base a new worktree is cut from. These
must keep answering against the one shared value — a local answer here would let a machine
call unlanded work "landed", and therefore safe to delete, against a branch nobody else has.
**Group B — deployment:** "which line does *this checkout* serve", read by things like an
auto-build gate, an auto-restart gate, or a "this view is stale" banner. A repo checked out on
more than one host can legitimately want a different answer to B per host — that is a fact
about one machine, not about the repo, and the opposite of what everything else in this file
describes.

**Group B does not get a descriptor field, on any tier, and that is a ruling, not an
oversight.** `project.yml` is fetched, cached and reasoned about as one fact-sheet per
*repository*; a hostname inside it (`deploys: { <host>: <branch> }`) turns a shared, often
public file into one that drifts the moment a machine is renamed or retired, with nothing here
able to tell a stale entry from a live one. `integration:` does not cover it either — it
declares that a line *exists*, never that a given checkout *serves* it. So Group B's answer
lives entirely outside the descriptor, in a per-host mechanism the repo owns: an environment
variable read by that host's own service definitions, or a machine-local config file — the same
shape as `colab`'s own cache ([§5](#5-claiming-work--how-to-say-im-on-this), machine-local,
uncommitted, fenced off from VCS and file-sync) rather than a schema entry. Which of those a
repo picks is its own call; the handbook has no opinion between them.

**One property any such mechanism must keep, wherever it lives:** it must **name** a branch,
unset-by-default, rather than widen or disable the gate it overrides. `HEAD == trunk` is what
makes an unattended rebuild-and-restart safe to run on a timer at all; a knob that turns the
gate off, or accepts "any branch", can no longer answer "which branch is live" — the one
property the gate exists to protect. Replacing the value a host compares against keeps that
property; widening the accepted set destroys it. Unset, the override is byte-identical to
reading `trunk:` today.

A repo running on N hosts with N lines is therefore a supported shape, but only ever as a
deployment detail *of one repo* — it never becomes N repos, N descriptors, or a second entry in
`trunk:` / `integration:`. A future need to make a host's line *visible* rather than purely
local — discoverable from a repo card, say — is a new, explicit field to design at that point,
not a retrofit of `trunk:`, which keeps answering Group A alone.

**Memory ceremony is a fourth axis, and tier cannot carry it.** Tier counts gates to
production; it says nothing about whether anyone will ever comb through a repo's audit
trail. Two Tier B repos can be a heavy, long-lived codebase and a disposable beta
playground, and today both pay identical record-keeping ceremony whether or not the
record is ever read. [`ceremony: light`](project.schema.md#ceremony--optional) lets a
repo opt into thinner Issue narration and skip Phase B evidence comments — never the
rails that protect other sessions and the fleet (claim discipline, worktree isolation,
reserved ports, squash + `Closes #N`, CI secret scan). It is audited coherent with two
rules: a `light` repo must have `production: null` (a live repo cannot skip its own
audit trail — the same class of finding as `tier: A` + `deploy: push-main`), and it may
not combine with `autonomy: auto-trunk` (an unattended merge with no evidence trail is a
closure nobody can audit).

### Solo flow — trunk-direct, issue-on-demand, entry-gated (`ceremony: light` only)

`ceremony: light` (above) relaxed the record-keeping *end* of a session. The *start* —
pre-filed issue, claim, branch, worktree — was left at full weight even there, and on at
least one personal Tier B repo the reality had already diverged from the ritual: every
commit landed straight on trunk with clean Conventional prefixes, issues were used as
*decision memory* rather than pre-work permission slips, and the only branch in the repo
was a stale leftover whose issue had long since closed — the one piece of ceremony
attempted was the one piece that rotted.

**Why this is safe, and why it is not safe everywhere.** The start-side invariants
(claim before you touch it, branch off trunk, worktree so the main checkout stays at
rest) exist to protect *other sessions* — they matter exactly when session multiplicity
is greater than one. A repo one person codes directly, in one conversation-driven
session, has no other session to protect against. Solo flow makes that condition
explicit and machine-checked, rather than a discipline someone merely feels is true:

1. **Entry gate, not honor system** — `colab solo` checks, on every invocation, never
   from a cached answer: no live solo session already open, no worktree, no claim, the
   checkout on trunk with no unpushed branch anywhere in the repo, and a clean tree
   (tracked and untracked). Anything held refuses outright — full ceremony, no
   exception, no partial credit for "mostly clean". *(Cross-machine note: on a
   file-synced checkout, a dirty file or an unpushed commit syncs too, so the clean-tree
   check on one machine can see a session mid-flight on another. The residual
   sync-window race is accepted deliberately — solo flow means a human is personally
   driving, watching the one checkout, not a fleet of unattended sessions.)*
2. **Trunk-direct commits are allowed.** Small Conventional Commits go straight to
   trunk; CI validates after the push. On a Tier B repo with no production and no
   consumers, a red push costs only the repo itself — nobody downstream is exposed
   between the push and the fix. Branching remains available whenever a squash unit is
   actually wanted; solo flow does not forbid it, it just stops requiring it.
3. **An Issue is filed on demand, not on entry.** File one when recording a decision, or
   when the work will span more than this sitting. Otherwise the Conventional Commit
   *is* the memory — it is what release-notes grouping already reads, and a permission
   slip for work nobody else could be colliding with adds narration with no reader.
4. **Exit check, not teardown.** `colab solo --done` re-derives, fresh: tree clean,
   everything pushed. There is nothing to tear down, because solo flow made no worktree
   and holds no claim to release.
5. **Never relaxed, even solo** — these are not ceremony, they are the floor under every
   tier and every repo: CI secret scan · reserved ports · Conventional Commits ·
   `production: null` (already required by `ceremony: light` itself) · not
   `autonomy: auto-trunk`, and no scheduled driver. A driver is already incompatible
   with `light` ([§2](#2-tiers) above); it is doubly so here, because a driver planning
   against a repo means reading its Issues, and a solo repo may have none open at all.

**The boundary is concurrency reality, not a discipline preference someone gets to
skip.** A repo more than one session touches — a fleet-shared Tier A/B/C repo with
active worktrees, a repo a scheduled driver reads — can never legally run solo flow,
because the very thing the entry gate checks (no other live session, no other claim, no
other worktree) is false by construction the moment a second session exists. `ceremony:
light` is necessary for solo flow but not sufficient: a light repo currently host to
someone else's worktree still fails `colab solo`'s check, correctly.

**Consumers that infer activity from worktrees or claims will under-report a solo
session.** A solo sitting produces neither, so a fleet dashboard or a triage sweep that
reads only those two surfaces sees the repo as idle while it is, in fact, being worked.
Whether and how to surface a solo session (e.g. from `state.solo` — machine-local,
see `tools/README.md`) is each such consumer's own call; this convention does not
mandate a fix on their side.

---

## 3. `.github/project.yml` — the marker

Every repo commits this file. It is how a human or an agent learns the repo's state without
guessing, without an API call, and even when the repo has no GitHub remote at all.

```yaml
tier: B                  # A = live, tag deploys · C = live, promotion deploys · B = no production
trunk: main              # dev (tier C; tier A) · main (tier B; or tier A when deploy: tag)
production: null         # url, or null for tier B
deploy: none             # tag · manual (tier A) · push-main (tier C) · none (tier B)
stack: capacitor-vite    # free-form; describe the repo honestly
```

`deploy` says **how** the repo reaches production, never **whether** production exists.
`manual` means a human runs a documented procedure; it then requires
`runbook: <path>` naming that document, and the audit checks the file is really
there. A hand-deploy nobody wrote down is how a repo ends up with exactly one
person able to ship it.

`stack` is a **free-form string**, not a fixed list. Describe what the repo actually is. A
closed enum was tried and immediately failed on a Capacitor app that was neither a plain SPA
nor a mobile-native project.

Optional toolchain keys (`node:`, `php:`, …) may be added — see [§7](#7-ci-and-toolchain).
A repo that keeps a long-lived line declares it in `integration:` — a development-side axis
with no path to production ([§2](#2-tiers), [schema](project.schema.md#integration--optional)).
A beta/throwaway repo may declare
[`ceremony: light`](project.schema.md#ceremony--optional) to scale down memory ceremony —
omit it, and a repo behaves exactly as before ([§2](#2-tiers)).

Mirror the tier as a GitHub **topic** (`tier-a` / `tier-b` / `tier-c`) so `gh repo list --topic tier-a`
gives a fleet-wide view. The file is the source of truth; the topic is for discovery.

Full field reference: [`project.schema.md`](project.schema.md).

### Boot recipe — an entry point the repo owns, not a table a consumer keeps

`ports:` declares **where** a repo's trunk dev server listens. Nothing declares **how**
it starts, so every consumer that wants to start one — a fleet dashboard, a supervisor, a
scheduled job — has kept its own table of start commands, keyed by repo, outside the
repo, maintained by people not working in it and never validated against it. That table
forces a default onto any repo it has no entry for; there is no "unregistered" state,
only a silently wrong one.

**So the entry point is conventional, not a marker field:** if `<repo>/.colab/dev` exists
and is executable, that is how the repo's trunk dev server starts — no arguments,
foreground, exits when the server stops. Absent it, a caller falls back to its own
ecosystem default exactly as before. The marker (`project.yml`) stays untouched — a boot
recipe changes with the code (an interpreter moves, a build step appears, a service
splits in two), so it belongs where the code's own history keeps step with it, not in a
shared schema a consumer merely reads. `.colab/hooks/post-create` already set this
precedent for worktree lifecycle ([§4](#4-branches-and-commits)); this is the same
shape, generalized from "what happens once a worktree exists" to "how does the server
start at all."

Measured cost of the status quo: a repo with no manifest for the external table's
default ecosystem silently inherited that default anyway. Pressing Start created a
session, the session's command failed on the spot, the session closed, and the caller
was told the start had **succeeded** while the port stayed dead — indefinitely, with
nothing to flag it. The same repo also needed a virtualenv interpreter absent from a
non-login shell's `PATH`, so even a corrected command written as a literal in that
external table would have failed identically the next time the interpreter moved.

**A start is verified by the declared port, never by the process manager's exit code.**
A supervisor exits 0 the moment a session is created, not when the command inside it is
still alive a second later — a command that dies on the spot looks exactly like one that
started cleanly. The only evidence a dev server actually came up is the port named in
`ports:` accepting a connection. A control surface that reports success from launch
alone will keep offering to start a server that is not there, indefinitely, with no
error and no red mark.

---

## 4. Branches and commits

**Branch names:**

```
^(feat|fix|docs|chore|refactor|test|perf)/[a-z0-9._-]+$
```

Convention is `feat/<slug>-<issue-number>`, e.g. `feat/onboard-redesign-23`. Putting the
issue number in the name means the claim registry, the worktree, and the Issue line up
without a lookup table.

**A branch may carry a group of related issues** — suffix them all:
`fix/import-fixes-115-114-113`. Claim every issue in the group before starting. The branch
(and its worktree, if any) stays alive until the last one is done, and **every claim in the
group is released together when the session wraps** — unconditionally, including issues
that did not get finished. Releasing is about freeing the issue for someone else, not about
declaring it done; an unfinished issue that stays claimed silently blocks whoever picks it
up next.

**A group is not a chain, and they are recorded differently.** A *group* is issues that
touch the same code, so they must move together on one branch — that is the paragraph
above, and it is spelled with trailing numbers in a branch name. A *chain* is issues that
must happen in an order, across separate sessions and separate branches. A chain is never
expressed by a branch name; it is recorded as a dependency ([§5](#5-claiming-work--how-to-say-im-on-this)).
Mixing them produces the worst of both: a branch carrying work that is not ready, or a
sequence nothing enforces.

**Branches that predate adoption are grandfathered.** Do not rename them — several may be
checked out in live worktrees, and renaming breaks active sessions for no benefit. Apply the
convention to new branches only.

**Never** branch off another feature branch. Always branch off the current trunk — or off a
**declared integration line**, which is not the same thing. A feature branch is one session's
work in flight, so branching off it couples two unfinished things and neither can land alone.
A line declared in `project.yml` [`integration:`](project.schema.md#integration--optional) is
the opposite: a stable, published integration point the team maintains, cut and merged like
trunk. "Declared" is what separates them, and it is a commit in the repo, not a habit.

The base is a **session fact**: recorded when the worktree is created, and the branch ships
back into it. It is trunk unless you said otherwise:

```sh
colab worktree new feat/<slug>-N --issues N              # base = trunk
colab worktree new feat/<slug>-N --issues N --base v2    # base = the declared line v2
```

Base and merge target are **one decision, not two.** A branch cut from a line and merged into
trunk carries the entire line in with it, inside a single squash commit that reads like a small
change. Say which branch you merged into whenever you report a session as done.

**The main checkout stays on trunk at rest — so a worktree is the default, not a preference.**
Things outside your session read that working tree: a dev server, a symlink, a scheduled job.
None of them learn that you branched it. A session branched a repo's main checkout to do a
chore; that repo ran always-on from the tree, so the live app served unmerged feature-branch
code until a human noticed by eye. Leaving the tree merely *dirty* is the same fault with a
wider blast radius — an uncommitted file there blocks every other session's trunk merge in
that repo, including sessions touching files you never opened. A plain branch is still allowed
on a repo nothing reads from; taking it means **you** own returning the checkout to trunk
before you wrap.

**`git stash` is repo-scoped, not worktree-scoped — never reach for a bare stash inside a
worktree session.** `refs/stash` is a single ref per repository; plain git has no way to give
each worktree its own. Two concurrent worktree sessions on the same repo, both stashing around
the same time, can push and pop over each other with no error and no conflict marker. Measured:
on a repo running 10+ concurrent worktree sessions, one session's `git stash pop` — done to
check whether a test failure was pre-existing — restored a *different* session's uncommitted
changes into its own working tree. Nothing signalled a problem; only the second session
noticing its work had vanished caught it, and a re-stash from a third, unrelated, much older
session was already sitting in the same shared stack the entire time. Had either session
reflexively discarded what looked like "unexpected local changes" instead of recognising the
mismatch, the swap would have destroyed the other session's work outright — worse than a merge
conflict, because nothing ever signals that anything went wrong.

Prefer, in order: `git diff` / `git status` to read what changed without moving it; targeted
`git checkout -- <path>` plus a manual re-apply for the few files that actually need to go;
comparing directly against `origin/<trunk>` without ever touching `refs/stash`. If you must
stash, label the message so a colliding session can tell it apart
(`git stash push -m "<issue> wip"`), and **re-run `git stash list` immediately before touching
any `stash@{N}` index** — a concurrent push renumbers every existing entry, so an index you
captured earlier in the same session may already point at someone else's work by the time you
use it; `git stash show -p stash@{N}` against a stale index prints nothing rather than warning
you it moved.

**Commits** — Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`,
`perf:`). This is not decoration: [§6](#6-releases) builds the release summary by grouping on
these prefixes. A commit with no prefix is invisible in release notes.

**Merging:**

- Feature branch → trunk: **squash**, so trunk history is one commit per unit of work.
- `dev` → `main` promotion (Tiers A and C): **`--no-ff` merge commit**, never squash. The merge
  commit *is* the release boundary; squashing it destroys the record of what shipped together.
- **The merge message closes its issues: write `Closes #N`** (one per issue in the group),
  not a bare `(#N)` reference. GitHub auto-closes on the keyword and ignores the reference —
  we measured a repo where 26 of 30 issues sat open with their code long since merged,
  purely because merges said `(#22)` instead of `Closes #22`.
- **`Closes #N` requires the issue's own scope to be fully accounted for — a mechanical
  gate now, not an honour system (#74).** An issue's `## Plan` section is a real GitHub
  checklist — one `- [ ]` line per deliverable, **load-bearing, not decorative.** A `##
  Plan` written as prose, with no checkbox, cannot be verified mechanically; that shape is
  itself a finding, reported but not blocking (it cannot retroactively bind an issue opened
  before this convention). `colab ship` parses the checklist before composing the squash
  body (`tools/lib/checklist.js`): any claimed issue with an unticked box and no declared
  `Remainder: #M` gets `Refs #N` instead of `Closes #N` — it stays open, and the redirect
  is reported, never silent. Tick what shipped (with evidence, one verdict per box — B2b of
  `code-ship`), file `Remainder: #M` for the boxes that did not ship, and the next ship
  closes it clean. Doing the merge by hand (no `colab ship`) runs the identical check by
  reading the same two fields (`gh issue view N --json body,comments`) before writing the
  commit — `code-ship` B1b spells out the command. Motivating incident: an issue was closed
  by squash-merge with a third of its three-section scope unimplemented; the sections were
  prose, so nothing could have caught it before this rule existed.
- **Every issue the merge closes must be corroborated by git, not by the claim registry
  alone (#87).** The set of issues a merge closes is read at merge time, and a claim that a
  *different, still-running* session wrote onto the same branch is indistinguishable from
  one the merging session made. Measured: a branch carrying #71 and #76 resolved to
  `[71, 74, 76]`, because a co-tenant claimed #74 onto the same worktree minutes after the
  merge was authorised and had only just started work — nothing on the branch implemented
  it. Both git-side sources are load-bearing here: the branch name's **trailing** number
  group (§4's naming rule) and the `#N` references in **commit bodies**. An issue named by
  neither is a finding — `colab ship` refuses; a hand merge must perform the same check.
  Do not resolve it by quietly writing `Refs #N` instead: that hides the collision, and
  `--refs` already exists for the case an operator actually means.
- **A deliverable with no diff still has to close (#90).** A session can finish with a real
  result and zero commits — a decision recorded on its issue, an investigation concluding
  "no change needed", an artifact stored outside the repo. There is nothing to squash, so
  `Closes #N` has no commit to ride on, and for a long time that meant the claim was
  released, the worktree torn down, and the issue left open indefinitely. The completion
  path lives in the tool, not in prose: `colab ship` detects `landed ∧ zero own commits`
  (both **measured from git**, never declared by the session) and switches to
  **evidence-close** — post evidence, close each issue, tear down; no merge, no push, and
  no `--allow-empty` marker commit, because inventing a commit to satisfy a code path puts
  a lie in the repo's history. It is gated on the issue **already carrying a comment the
  tool did not write**, which is what replaces the otherwise-nice property that the tracker
  never moves unless trunk moved.
- **Before merging to trunk, check that trunk's last CI run is green — and that it ran at
  all.** Branch protection cannot do this for us; the habit must. We once merged for 12
  straight hours into repos whose CI was silently dead (org billing lockout) — every run
  "failed" without starting, and nothing noticed. **Ask by commit, not by recency (#92):**
  `gh run list --branch <trunk> -L 1` reads whatever ran *last*, and under
  `cancel-in-progress` concurrency two runs race on one push, one is cancelled by design,
  and a cancelled straggler makes the gate report red while an identical run on the same
  commit already passed — a deadlock nothing inside the merge can clear. The question is
  "does a completed, successful run exist for this branch's current head sha?"; `colab ship`
  asks it that way.
- **That fix resolves a FALSE red — a real one has a different, human-only door (#105).**
  Asking by commit fixes the case above precisely because the red was never real: an
  identical run on the same sha already passed, so asking the right question clears it with
  no human involved. A **genuinely** red trunk is the untreated case: the sha really did
  fail, and no amount of asking differently changes the answer. When the candidate branch's
  entire content IS the fix, this is a true deadlock — the fix cannot reach trunk without
  shipping, and shipping requires the green the fix would produce. See *Red-trunk exemption*
  below for the narrow, human-only exit.

### Has it landed? — the one rule, because the obvious one is wrong

Two jobs need this answer: clearing out finished work (which of these worktrees are spent?)
and wrapping a session (is there still cargo on this branch, or did it already ship?). Decide
it the same way in both places:

```sh
colab landed --worktree <name>     # landed · cargo · unknown
colab landed --all                 # every worktree of this repo
```

**Never decide it by counting commits.** A squash-merge mints a new commit with a new sha, so
a shipped branch's own commits are never ancestors of its base — and squash is how sessions
merge. A count-only test therefore reports *every branch we have ever shipped* as unfinished,
which invites re-merging finished work. The mirror test, comparing diffs, fails the opposite
case: zero commits ahead but a non-empty diff, because the base moved on underneath. Both
failures were measured on live worktrees, one of each, in a single sweep.

Requiring **both** signals fixes those two and leaves one open — a squash *followed by* base
movement satisfies both, and that state is common rather than exotic (five of seven shipped
branches in one repo were in it). So the rule asks the question directly instead: **does
merging this branch into its base change the base's tree at all?** That stays correct across
squash merges and later base movement alike.

Two things it is worth knowing about the rule:

- **It is asked against the branch's base**, which is trunk only by default. A branch cut from
  a declared line and measured against trunk looks like enormous unshipped cargo.
- **`unknown` is a real answer, and it means cargo.** If the base has *rewritten* the branch's
  work, the merge conflicts and no content answer exists. Verdicts never round up to `landed`:
  telling someone their unmerged work is spent costs work, telling them to look again costs a
  minute.

**Git state and claim state are two signals, and neither replaces the other.** The
`in-progress` label answers *"does someone believe they hold this"*, which is why it is the
correct veto before teardown; git answers *"what state is this actually in"*. They disagree in
both directions in practice — claims outliving finished work, and finished work never claimed.
Do not collapse them.

---

## 5. Claiming work — how to say "I'm on this"

Parallel sessions and parallel agents must not collide on the same Issue. Two layers:

### Source of truth — GitHub

```sh
gh issue list --label in-progress                               # check, before taking work
gh issue edit <N> --add-assignee @me --add-label in-progress    # claim, at session start
gh issue edit <N> --remove-label in-progress                    # release, at session end
```

Assignee plus the `in-progress` label is authoritative because it is **visible from any
machine and to any person** — another programmer, an agent on a different host, or you on
your phone.

The label does not exist in a fresh repo. Creating it is part of adoption ([§9](#9-adopting-this)).

### Fast path — local cache

The `colab` CLI keeps a machine-local cache at **`~/.colab/state.json`** (override the
directory with `COLAB_HOME`), written automatically when you claim an issue or create a
worktree. It is a zero-latency read for parallel sessions **on the same machine** — no API
call, no rate limit.

**It is a cache, not the truth.** It is machine-local and uncommitted, so it cannot see
work claimed from any other machine or by any other person. When the cache and GitHub
disagree, **GitHub wins.**

Reconcile it rather than trusting it:

```sh
colab claims --sync      # reconcile local cache against GitHub
colab doctor --prune     # free claims whose worktrees no longer exist
```

### Readiness — open and unclaimed is not enough

An issue is **ready to start** when it is open, unclaimed, **and nothing it depends on is
still missing**. That third condition is neither a boolean nor a matter of opinion — it is
computed from the dependency graph and the state of what the graph names, and it has three
values (*blocked* · *ready, with a note* · *ready*). The rule is below; first, the graph,
because the condition used to be uncomputable when dependencies were written in prose:
*"blocked by the other one"*, *"these five must queue behind each other"*. Prose does not
block a parallel session, and no tool can read it. Measured on one
repo: an epic tracking ~14 children by hand-edited checklist reported `subIssues.totalCount
= 0` — the relationships a machine could act on simply did not exist.

**So dependencies are recorded in GitHub's own relationship model, not in prose.** Prose
still explains *why*; it is no longer the record of *what*.

- **Parent/child** — an epic and the issues that implement it: sub-issues.
- **Sequence** — this cannot start until that one lands: blocked-by.

```sh
# read (repo-relative — no owner/name to get wrong)
gh issue view <N> --json blockedBy,blocking,parent,subIssues,subIssuesSummary

# write a sequence — REST, and the payload is the DATABASE id, not the issue number
gh api -X POST   repos/{owner}/{repo}/issues/<N>/dependencies/blocked_by -F issue_id=<db-id>
gh api -X DELETE repos/{owner}/{repo}/issues/<N>/dependencies/blocked_by/<db-id>
gh api repos/{owner}/{repo}/issues/<M> -q .id      # ← how to get that db-id

# write a parent/child — GraphQL, and this one takes NODE ids
gh api graphql -f query='mutation($p:ID!,$c:ID!){addSubIssue(input:{issueId:$p,subIssueId:$c}){clientMutationId}}' \
  -f p=<parent-node-id> -f c=<child-node-id>
gh api graphql -f query='mutation($p:ID!,$c:ID!){removeSubIssue(input:{issueId:$p,subIssueId:$c}){clientMutationId}}' \
  -f p=<parent-node-id> -f c=<child-node-id>
gh issue view <M> --json id -q .id                 # ← how to get that node id
```

`removeSubIssue` requires **both** ids: a child cannot be detached by naming only itself.
(`addSubIssue` is the laxer of the two — it accepts `subIssueUrl` in place of `subIssueId`,
and `replaceParent: true` to move a child that already has a parent.)

**The two halves of this model do not share an API, and that is the trap.** Sub-issues are
GraphQL mutations keyed by **node** id (`I_kwDO…`); dependencies are REST endpoints keyed by
**database** id (an integer). There is no dependency mutation in GraphQL — the schema
exposes `blockedBy`, `blocking` and `issueDependenciesSummary` for *reading* only.

**Both halves are verified by execution, not by reading the schema.** Each was round-tripped
against the live API: written, read back through *both* directions of the relationship,
removed, and read back again to confirm nothing was left behind. Introspection tells you an
input's shape and nothing about what the endpoint does with it — which is the whole point
here, because the wrong-id mistakes do not fail alike.

**Three of them are loud; the fourth is silent, and it is the one to fear.** Give GraphQL an
issue number or a database id and it refuses legibly (`NOT_FOUND`, *"Could not resolve to a
node with the global id of '34'"*); give the REST call a node id and it refuses on type
(HTTP 422, *"is not of type `integer`"*). But give the REST call an **issue number** and it
**succeeds** — the number is a valid integer, so it is read as a database id, and you get a
dependency on whichever issue holds that id *anywhere on GitHub*. Measured here:
`issue_id=34` silently attached a blocker from a repository owned by a stranger, unrelated
to ours in every way. Nothing errors, and the readiness gate then reads a perfectly real
blocker. **Read `blockedBy` back after every write** — a dependency you did not intend is
invisible at the moment you create it.

**Read that confirmation from the `blockedBy` / `blocking` connections, never from
`issueDependenciesSummary` — the summary lags the graph.** Measured both directions, and
within a *single* response: seconds after a `blocked_by` POST, `blockedBy(first:n){totalCount}`
read `1` while `issueDependenciesSummary.blockedBy` in the same payload still read `0`;
seconds after the matching DELETE, the connections read `0` while the summary still read the
pre-delete count. It converges in a few seconds, so the summary is not wrong so much as
**late** — but a read-back that consults it can report a write as not-landed and invite a
duplicate POST, and any digest built on it can record a state that never existed at any
instant. The connections are the record; the summary is a cache of them, useful only where a
few seconds of staleness is acceptable.

**"No blockers" and "nobody checked for blockers" are the same empty list**, so the second
needs a marker of its own. Absent relationship data means nobody has looked — it must never
be read as "ready":

```sh
gh label create deps-checked --color 0E8A16 --description "Dependencies verified — no open blocker"
colab readiness <N>           # set it only after actually looking (raw: gh issue edit <N> --add-label deps-checked)
colab readiness <N> --clear   # on any new blocker, or on reopening (raw: --remove-label deps-checked)
```

Where `colab` is installed, `colab readiness` is the owner of this write and the raw `gh issue
edit` is the portable fallback that does the identical label change. Owning it in colab is not
cosmetic: the write is journaled like every other action, the label name has one source
(`tools/lib/labels.js`, shared with the audit), and it is the single site the observer event
(§ notify, kind `readiness.marked`) emits from — the receiver has agreed the kind and reads it
as an optimistic "ready" hint bridging the provider's read-after-write lag.

The label is *derived* state, so it is only ever as fresh as its last check: whoever adds a
blocker removes it. Prefer leaving it off to leaving it wrong — an absent label costs one
check, a stale one costs the wall you walk into. A prose note saying "checked, no blockers"
does **not** count; that is the practice this section replaces, wearing a different hat.

#### Readiness is not a boolean — read the blocker's state, not just its existence

An open blocker used to end the question. That yes/no hides two situations that are not
alike: a blocker **nobody has started**, where no code exists anywhere, and a blocker
**whose code is written and pushed**, its session finished and stopped at the human merge
gate. For the second, "blocked" is false in practice — the thing being waited for already
exists, and only a merge stands between it and trunk. Reporting them identically parks work
that could safely start.

So the verdict has **three values**, plus the *unchecked* state above, which is not a kind
of ready:

| blocker state | what is actually true | verdict |
|---|---|---|
| no relationship data at all | nobody looked | **unchecked** — not ready |
| open, nobody has started it | no code exists | **blocked** — name the blocker |
| open, code pushed and unmerged | the dependency exists | **ready, with a note** |
| closed, or its work is already on trunk | nothing blocks | **ready** |

**The middle value is computed, never recorded.** The `blocked_by` edge stays exactly as
true as it was: *this waits for that* does not stop being true because the blocker grew a
branch. Consumers derive the verdict at read time from the relationship **plus** the
blocker's state. The rejected alternatives are the load-bearing part of this rule:

- **A second label for the soft case** — readable directly, and stale the moment the blocker
  moves. That is the hazard `deps-checked` already carries, now doubled, with two markers
  free to disagree about the same issue.
- **Deleting the edge once the blocker's code is written** — it destroys a true fact for the
  convenience of a display, and does not survive the blocker being reverted: the dependency
  comes back, the edge does not, and nothing is left that knows the two are related.

**A relationship is a fact; readiness is a judgement.** Recording a judgement where the
facts live is how the two begin to contradict each other, and the graph is what everything
else trusts.

**An active session on the blocker is not evidence — a pushed branch with real commits is.**
Measured: a session open ten minutes was already dead, having never claimed the issue it was
opened for. A dependent started on that evidence waits for something that never arrives. An
open session is intent. The same test rules out an *unpushed* branch, for the reason claims
are authoritative only when they are visible from any machine: work on one laptop cannot be
seen, reviewed or merged by anyone waiting on it. An empty pushed branch is not code either.

**The judgement fails toward `blocked`, never toward `ready`.** A blocker whose state cannot
be measured is blocked. This is the mirror of the landed rule
([§4](#4-branches-and-commits)), which must never fail toward `landed`: both refuse to be
optimistic, and each points its refusal at the verdict that costs work — there, destroying
unmerged code; here, starting into a wall.

The executable reference is `tools/lib/readiness.js` (`classify`, `isStartable`), which is
pure — facts in, verdict out — and takes its "is the blocker's code written but unmerged?"
answer from `tools/lib/landed.js` rather than counting commits a second time. Prose states
the rule; the module is one implementation of it; the tests keep them from drifting apart.

#### Mechanical readiness — a weaker, honest claim for the empty case (#69)

`deps-checked` asserts *somebody looked* — a reasoning session read the issue and judged it
clear. That is a **stronger** claim than "the encoded dependency graph, read via the API,
has zero edges": a blocker described only in prose — a comment saying "hold until the design
call", an open question in the issue body, a relationship someone described but never
encoded as an edge — is invisible to a mechanical read and visible to a reader. So a
mechanical check must never be allowed to write `deps-checked` itself. Doing so would
launder a weaker guarantee into a stronger one, silently, for every consumer that already
trusts that label not to lie.

What a mechanical read **can** assert, honestly, is its own claim: *the recorded graph is
empty as of this read.* That is `graph-empty` — a second, distinct label, deliberately not a
same-meaning color of `deps-checked`:

```sh
gh label create graph-empty --color BFDADC --description "Mechanical check: the recorded dependency graph reads empty — NOT a substitute for deps-checked"
colab readiness <N> --mechanical           # reads blockedBy via the API; if truly empty, applies graph-empty + posts a receipt
colab readiness <N> --mechanical --clear   # removes it
```

- **The write re-derives its own evidence.** `--mechanical` reads `blockedBy` itself rather
  than trusting a flag from whoever called it — the label's whole claim is "the API said so",
  so the command that writes it asks the API on every run instead of accepting a boolean it
  cannot verify.
- **A receipt, not a bare label.** The command posts a comment naming what was read and when
  (`blockedBy totalCount = 0, read <timestamp>`). Auditability costs nothing once the read
  already happened, and it is what lets a human later tell "the API found nothing" apart from
  "somebody claimed the API found nothing" — the receipt option #69 asked for, attached to
  the cheaper label rather than to `deps-checked` itself.
- **Out of scope on purpose: sub-issue (parent/child) relations.** Readiness answers "can
  this be started", which is the *blocking* half of the relationship model (`blocked_by`),
  not the *parent/child* half (§5, above). A mechanical read here checks `blockedBy` only; it
  says nothing about whether the issue is, or belongs to, an epic — `epic` and
  `subIssuesSummary` already cover that separately (*Epics*, below).
- **`readiness.classify()` keeps the two apart at the type level, not just at the label
  name.** `graphEmpty` is a distinct input from `depsChecked`. An empty blocker list with
  `graphEmpty` true but `depsChecked` false reads a fourth verdict, `unchecked-mechanical` —
  `isStartable()` still says no, unchanged. A consumer that wants the faster, weaker lane
  opts in explicitly (`isStartableMechanical()`); the conservative default — every existing
  triage, every existing scheduled driver — is untouched by this label merely existing.
- **Not in the convention label set ([§9](#9-adopting-this)), same reasoning as `tracking`
  (below):** nothing unattended reads it yet, so adoption does not provision it and the audit
  does not report it missing. A repo that wants the faster lane creates the label and opts a
  consumer into `isStartableMechanical()`.
- **No `readiness.marked` event for this.** The receiver has agreed that kind's payload as
  `{state: 'checked'|'unchecked'}`, meaning `deps-checked` specifically (#45, #46) — emitting
  the same kind for a weaker fact would hand the receiver a payload it cannot tell apart from
  the judgement it already agreed to read as an optimistic hint. `--mechanical` writes the
  label and the receipt and stops there; a new event kind for it is a separate negotiation
  with the receiver, not this issue's to open.

**This resolves #69's question as: no and yes.** No — provenance for the strong claim still
requires a reasoning session; the argument that a mechanical read cannot see a prose-only
blocker was correct and stands unchanged, so framing 2 ("widen the writer, keep the
meaning") is rejected outright. Yes — a mechanical read can earn provenance for the *weaker*
claim it is actually capable of making, which is framing 1 (split the value) doing the real
work, surfaced to a consumer the way framing 3 sketched it: as an opt-in sibling signal that
never changes what `deps-checked` means or what today's conservative consumers do by default.

### Provenance — who decided the work should exist

Issues now arrive from three directions: a person, an agent that hit something while
coding, and an agent filing a follow-up as it wraps a session. Readiness above answers
*can this be started*. Provenance answers a different question, and the one that matters
the moment anything starts work in batches: **has a human decided this work should
happen at all?**

Nothing else in the model answers it. An agent-filed issue is open, unclaimed and
unblocked the instant it is created — indistinguishable, to every check in this section,
from work a person asked for.

**So an agent that files an issue on its own initiative labels it `agent-filed` and ends
the body with a machine-readable line:**

```
Filed-by: agent (during code-wrap of #48, session <name>)
Filed-by: boss (via discussion session <name>)
```

- **No label means a human filed it.** That is the default, so existing issues need no
  backfill and a repo adopting this mid-life is instantly consistent.
- **Provenance is whose *intent* it was, not whose keyboard.** An agent transcribing what
  a person just decided in a discussion writes `Filed-by: boss` and adds **no** label —
  the person decided the work exists; the agent only typed it. An agent that noticed a
  problem by itself and filed it is `agent-filed`, even if a human was in the room.
- The `Filed-by:` line is the durable record and stands alone; the label exists so the
  distinction is **queryable** (`gh issue list --label agent-filed`) without reading
  bodies. Write both.

**Why this is a convention and not a tooling detail:** anything that starts work in bulk —
a start button, a batch triage, a scheduled sweep — must be able to exclude work no human
approved. Without the distinction, the closed loop is available by default: an agent files
work, a fan-out tool starts it, that session files more. The label is what lets the
default be *excluded, and started only when a person clicks* — which makes the click the
approval. A tool cannot construct that gate from an issue's contents; only whoever filed
it knows the answer, and only at filing time.

#### Ask — the filer declares the ask class (#89)

`agent-filed` says *a human did not decide this work should exist*; it does not say what
kind of decision the issue is waiting on. Measured on a live 34-item approve queue
(2026-08-01): the queue decomposed into six ask-classes with different verbs — a
permission to touch prod state, a design or process ruling, a bug someone needs to accept,
a work proposal, a self-deferred item waiting on a trigger, an epic — but a reader detected
the lane heuristically, from labels and title phrasing ("needs an explicit OK", "needs an
operator decision", "blocked until <trigger>"). The filer *knows* the class the moment it
writes the issue; nothing downstream should have to guess it back out of prose.

**So an `agent-filed` issue ends its body with one more machine-readable line, next to
`Filed-by:`:**

```
Ask: permission | backlog | ruling | deferred(<trigger>)
```

- **`permission`** — asking to touch machine or production state (a cert, a deploy, a
  config a human must authorize) before the agent proceeds.
- **`backlog`** — a work proposal: code someone should accept and schedule, not a decision
  in itself. This is also the class an absent line means (below) — most `agent-filed`
  issues are exactly this, and the line only earns its keep on the other three.
- **`ruling`** — a question that resolves to a human judgment, not a diff. *Never startable
  as code* — the same class *Design ruling* and *Scheduled drivers* already treat as a
  gate, generalized past the design-specific case that motivated `needs-ruling`.
- **`deferred(<trigger>)`** — the filer has already decided no action is needed *now*; the
  issue carries its own wake condition (`deferred(dep #91 lands)`) and demands no decision
  today.
- **Absent line means `backlog`.** Every `agent-filed` issue written before this convention
  existed reads as the common case with no backfill required — the same compatibility
  `Filed-by:`'s own default gives *Provenance*.
- **Consumers.** A decision surface (an approve queue, a triage board) groups by this line
  instead of re-deriving the lane from title text; *Scheduled drivers* (below) excludes
  `ruling` and `permission` the same way it already excludes a live `needs-ruling` — a
  human judgment or a permission grant is not a thing a driver infers its way past by
  reading the body closely enough.
- **Written at filing time, by whoever files.** Like `Filed-by:`, this is not something a
  reader reconstructs after the fact — an issue that turns out to need a ruling only once a
  session is already elbow-deep in it gets the line added then, not left absent because the
  filer didn't know yet.

This line only ever appears on `agent-filed` issues. A human filing an issue for a human
audience does not need a machine-readable ask class — the whole apparatus above exists to
let a tool tell an agent's request-for-permission apart from an agent's plain proposal
without reading either one's prose.

### Design ruling — a human must approve the design first

*Readiness* and *Provenance* each answer a different question about whether an issue may
be picked up. A third belongs beside them, for one specific class of surface: **has a
human been asked to rule on the design this issue implements, when the surface needed
one?**

A designer producing a spec decides, while producing it, whether the surface is
significant enough to need a human pre-approval before code starts — a new page
template, a brand-facing surface, anything where a wrong default is expensive to unwind
once code exists. When it does, the designer marks the issue `needs-ruling` and attaches
the design artifact. Triage may pre-flag the obvious cases, but the call belongs to
whoever is producing the spec — no mechanical rule infers it from an issue's title or
labels.

**`needs-ruling` blocks starting the issue** — a readiness gate exactly like an open hard
blocker or a live `in-progress` claim, not a softer advisory — until a human reviews the
artifact and removes the label. No session starts an issue that still carries it, manual
or scheduled (*Scheduled drivers*, below, names the scheduled case explicitly). The label
joins the convention set provisioned in [§9](#9-adopting-this).

**A session that discovers a significant design decision mid-work — one the spec did not
anticipate — does not stop and file a ruling request.** It continues on the designer's
spec (parking mid-feature to request a ruling is its own cost, and the spec already on
hand is the best available answer) and instead records `design-not-preapproved` in its
ship evidence ([code-ship §B2b](skills/code-ship/SKILL.md)), so the closure itself is
what a human reviews — after the fact, rather than blocking the session on it. This is a
deliberately different remedy from the gate above: the gate stops a known-significant
surface before code starts; the marker flags a surface that turned out to matter only
once someone was already building it.

Applies in every mode. A human-opened session and a scheduled driver honor the identical
gate, for the identical reason *Scheduled drivers* gives for `agent-filed` and `epic`: a
label a person has not cleared is not a decision a tool gets to infer around.

### Migration exemption — a narrow, human-created door through no-new-migrations (#98)

`colab ship` refuses a branch that touches `database/migrations/` or `prisma/migrations/` —
absolutely, by default, with no flag, env var, or `project.yml` field to lower the bar. That
default is right: a schema change merged into trunk is pulled by every other worktree next, and
where dev data is shared a bad one costs everyone at once.

It also makes one legitimate class of work permanently un-shippable without a person: an issue
whose entire deliverable IS a schema change. Under a scheduled driver that issue gets coded and
wrapped unattended, then parks forever, every tick — the gate is doing its job, there is simply
no sanctioned way to say "this specific schema change was reviewed, and it is authorized."

**A migration grant is that narrow yes — per-issue, branch-bound, human-only, expiring.**
Deliberately *not* a repo-level or tier-level switch, for the same reason `needs-ruling` is
per-issue rather than per-repo: a repo-level key gets set once and then silently covers schema
changes nobody actually reviewed.

- **Human-only to create — the same shape as *Design ruling*, above.** `colab migration-grant`
  refuses (exit 1) unless `COLAB_HUMAN=1` is set — the identical bar a production promotion
  already answers to (`colab promote`) — and the check runs *before* any network call. No agent
  may create a grant, nor infer one from an issue's content, age, or how many times it has
  parked. A human act on the issue is the whole answer, and it is enforced, not merely
  documented: the write path has no other door in, and a test pins that no skill in this repo
  ever sets `COLAB_HUMAN`.
- **Bound to one issue AND the branch it was granted for.** The marker is two parts, both
  required: a `migration-granted` label (applying a label on GitHub requires write/triage
  permission, closing the "drive-by comment on a public repo" hole a comment alone would leave
  open) and a comment naming the exact branch (a label cannot carry that — GitHub caps label
  names at 50 characters). A grant issued for one branch never authorizes a migration arriving
  on a different branch later.
- **Expires the instant its issue closes.** `ship` reads the issue's live open/closed state, not
  a separate expiry date — there is no such thing as a migration grant that outlives the work it
  was reviewed for.
- **Visible from any machine.** Both the label and the comment live on the tracker, the same
  precedent the `deps-checked` readiness marker set: `ship` may run somewhere other than where
  the grant was given, so there is deliberately no local-only fallback for creating, revoking, or
  reading one.
- **Covers the whole ship set, not one member of it.** A group branch carries several issues, and
  a migration cannot be mechanically attributed to one of them — `ship` validates the grant over
  *every* issue the branch carries, never narrowed by `--refs` (narrowing the validated set would
  let a caller-supplied flag shrink a safety gate, which `ship` refuses everywhere else). One
  granted issue must never smuggle an unreviewed migration in for its siblings.
- **Revocable, and auditable afterwards.** `--revoke` removes the label first — the gate is
  restored the same minute — then posts a receipt comment, so it stays answerable later who
  authorized which schema change, when, and for which branch.
- **Reviewable while outstanding.** `colab migration-grant --list` names every issue with a live
  grant right now.

**Nothing here weakens any other precondition, and a grant never reads as blanket authority.** CI
green, claim corroboration, the trunk-checkout check, and the hand-merge conflict check all still
run in full on a granted branch. See [`tools/README.md`](tools/README.md#migration-grants-98--the-one-narrow-human-created-exemption)
for the exact commands and the full precondition-table wiring.

### Red-trunk exemption — the one-shot door through trunk-CI-green (#105)

A **genuinely** red trunk (see *Ask by commit, not by recency*, above, for the false one) makes
`ship`'s first precondition permanently un-satisfiable for the one branch that could clear it: the
fix cannot reach trunk without shipping, and shipping requires the green the fix would produce.
Left there, the repo is bricked for unattended work until a human performs the whole of Phase B by
hand — squash trailers, guard push, teardown, evidence, claim release, group-label cleanup — which
is exactly the surface the gates exist to get right, and the hand path is where their mistakes come
back (a wrong `Closes #N` is immutable once pushed).

**A CI grant is the same shape as a migration grant (#98) — same precedent, same solution, on
purpose** — but it is strictly **more dangerous**, and carries two guards the migration grant does
not need because of it: a bad migration grant merges one reviewed schema change; a bad CI grant
merges into a repo whose *own test suite* is known-failing.

- **Human-only to create, identical bar.** `colab ci-grant` refuses (exit 1) unless
  `COLAB_HUMAN=1` — the same mechanism, the same test coverage (no skill in this repo ever sets it).
- **Bound to one issue, the branch, AND the red trunk sha it was reviewed against.** A migration
  grant only needs the first two; this one also expires the instant trunk's head moves — granted-
  and-consumed by this exact ship, or moved for any other reason. A grant surviving into a
  *different* red (trunk moved, a new and different failure) was never reviewed against that
  failure and must not silently keep working.
- **Evidence is MEASURED, never asserted.** Creating a grant requires a completed, successful CI
  run for the *branch's own current head* — the identical "ask by sha" check `ship` itself uses,
  applied to the branch instead of the target. A human's say-so alone is never enough; `--evidence-
  run` is a recording-only pointer for the audit trail, and can never substitute for the measured
  run.
- **Never stacks.** Creating a grant refuses outright against a green trunk (nothing to exempt),
  and refuses again if a *prior* CI grant already merged something and trunk has been red
  continuously since — a second exemption on a still-broken repo is exactly the failure this gate
  exists to prevent. Fix trunk by hand, or revert the bad merge, instead of granting again.
- **Visible from any machine, covers the whole ship set, revocable and auditable, reviewable while
  outstanding** — identical properties to the migration grant, for the identical reasons. A
  grant-authorized merge additionally carries a `CI-Grant:` trailer in the squash commit itself
  (belt and braces with the tracker comment — the commit is the artifact that survives a later
  tracker read failure).

**Scoped narrowly, and mechanically so.** This exemption covers *only* the trunk-CI-green
precondition. It never exempts the no-new-migrations gate, claim corroboration, the trunk-checkout
check, the hand-merge conflict preview, or `colab promote` — none of those call sites ever consult
it, and it is wired through exactly one integration point (`shipCiCheck`) so it cannot accidentally
widen later. It is also **trunk-only**: an integration line's red already borrows trunk's advisory
verdict when the line has no runs of its own, and widening the exemption to cover a line too is a
decision this feature deliberately does not make.

See [`tools/README.md`](tools/README.md#ci-grants-105--the-one-shot-door-through-a-genuinely-red-trunk)
for the exact commands.

### Planning — a plan file that outlives one command, and who drafts it (#94)

Coordinator (triage/grading) and implementer (coding) sessions often run at different
model tiers — a strong model plans and grades cheaply, a cheaper model executes the
lanes — and until #94 nothing carried the coordinator's read of the work across that
seam: the implementing session re-derived intent and approach from scratch, from a much
narrower view than the one that decided the work was startable in the first place.

**The plan is a repo-local scratch file, not an Issue comment.** Coordinator and
implementer sessions share one machine and one filesystem, so a file is the cheapest bus,
and it never touches the tracker at all. Convention: `.claude/plans/issue-<N>.md` in the
**main checkout — outside any worktree.** That placement is deliberate, not incidental:
it exists before the worktree is created (a session can write to it from step 0) and
survives the worktree's teardown (a grading session reads it after `code-ship` has
already removed the tree it was written for). Git-excluded, **never committed** — every
adopting repo's own `.gitignore` should carry `.claude/plans/`, the way this repo's
does. The file is disposable by design; anything worth keeping past the session moves to
the Issue at wrap ([code-wrap A1](skills/code-wrap/SKILL.md)), same as any other
knowledge this convention set treats as durable.

**"The main checkout" is a resolved absolute path, never a bare relative one (#113).** A
session inside a worktree has its own `.claude/plans/` sitting one `cd` away — a bare
`.claude/plans/issue-<N>.md` resolves against `$PWD`, which is exactly correct when `$PWD`
is the main checkout and silently wrong (writes into, or reads from, the *worktree's* copy)
the rest of the time, with no error to notice the mistake by. Anchor it explicitly, every
time, the same way `code-sweep` and `code-triage` anchor their own repo-root lookups:

```sh
MAIN_REPO="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
PLAN="$MAIN_REPO/.claude/plans/issue-<N>.md"
```

`--git-common-dir` resolves to the main checkout's `.git` from *any* worktree of the same
repo, so this is safe to run from inside one. Every skill that touches the plan file
(`code-start`, `code-plan`, `code-wrap`'s hand-off checklist, `code-ship`) uses `$PLAN`
computed this way — never a bare `.claude/plans/issue-<N>.md`.

**Three rungs, the middle one the default:**

| Rung | When | Content |
|---|---|---|
| 0 — none | trivial/mechanical work, the acceptance oracle is self-evident | nothing |
| **1 — plan-lite (DEFAULT)** | every other session | 3-5 lines, written at session start after reading the Issue: intent in one sentence · files expected to move · the acceptance oracle (what proves it done) · a stop condition |
| 2 — full plan | `needs-plan` is set (below), or a trigger fires mid-session: the ask turned out ambiguous, the design has no precedent in this repo, a long dependency chain, several issues coupled by more than file overlap | drafted by [`code-plan`](skills/code-plan/SKILL.md) into the same file |

**Failing to state rung 1's oracle in one line is itself the signal to stop and ask on
the Issue** — a session that cannot say what proves the work done should not guess and
should not silently drop to rung 0.

**Who flags, who drafts, and when — not the same actor.** `code-triage` may flag a group
it judges hard with the `needs-plan` label plus a one-line reason comment on the group's
lead issue — the flag is a **cross-backlog judgement**, the one thing that dies with the
triage session if it goes unwritten, not a plan of its own. It never drafts the plan
itself: authoring at triage time produced stale artifacts for groups that are reported
startable but not started soon, which is why the earlier design of this feature dropped
per-beat plan authoring entirely. **The plan is drafted at code-session start, inside the
implementing session**, by a stronger-model planning subagent seeded with the Issue plus
the triage reason line — against the repo as it actually is at coding time, not as it was
at triage. A rung-1 stub may still upgrade to rung 2 mid-session on a self-escalation
trigger; the flag decides the *default*, it never caps the ladder.

**Read the flag by direct issue fetch, never the Search API.** `gh issue view <N>` is
read-your-writes consistent — a flag `code-triage` set seconds ago is visible to the very
next session. `gh issue list --search 'label:needs-plan'` reads the eventually-consistent
search index, which can lag by minutes — long enough to miss exactly the flags a triage
run just set. `code-start` already fetches the issue by number for its own context load
([§2](skills/code-start/SKILL.md)), so this rides that call for free; `code-plan`
inherits the same rule rather than re-deciding it.

**A stub still upgrades mid-session, and a plan can still be wrong.** Rung 1 written at
session start is not a contract any more than rung 2 is — the implementer may deviate
when the code demonstrates the plan is wrong, but says so where the plan lives (this
file), so a resuming or grading session reads the actual reasoning rather than a stale
sketch.

**Provisioning.** `needs-plan` joins the label set [§9](#9-adopting-this) provisions on
adoption and back-fills on sync, the identical idempotent pattern as every other fixed
convention label — never created on demand the way a per-group `group:<key>` label is,
because its name is fixed and every repo needs it before the first triage pass can flag
anything.

### Scheduled drivers — provenance and autonomy meet a caller that is not a person

Everything above — provenance, readiness, the autonomy ladder — was written assuming the
caller deciding to act is a person, or an agent a person is watching. A **scheduled
driver** breaks that assumption on purpose: a per-repo autopilot that wakes on a cadence,
ships finished branches, triages the backlog, and starts sessions for groups that read as
ready, with nobody watching the tick. Nothing above stops applying to it — this section is
what a scheduler must additionally honor *because* nothing above assumed it exists.

**It inherits the provenance gate rather than replacing it.** *Provenance* already names the
failure mode a bulk starter creates: "an agent files an issue, a fan-out tool starts it, that
session files more" — a closed loop with no human in it. A scheduler is exactly that fan-out
tool, running unattended and repeatedly, which makes the gate load-bearing on every tick
rather than the one time a human clicks a button:

- **`agent-filed` issues are excluded from what a scheduler starts, by default, every run.**
  Not filtered once and remembered — the exclusion is re-applied on each pass, because the
  backlog changes between ticks.
- **`epic`-labelled issues are excluded from what a scheduler starts, for a different
  reason.** Provenance asks *has a human approved this work*; an epic can pass that test
  cleanly — a person filed it, nothing blocks it, it can even carry `deps-checked` — and
  still not be a pick-up-and-code task, because it is a container for sub-issues, not a
  unit of work itself (*Epics*, below). A driver that cannot tell the two apart starts the
  umbrella instead of its children.
- **`needs-ruling` issues are excluded from what a scheduler starts, for a third reason
  again.** *Design ruling* (above) asks a question neither of the other two do: has a
  human approved *the design* this issue implements — not the decision to do the work at
  all, and not whether the issue is a unit of work. An issue can be human-filed, unblocked,
  and a genuine leaf task, and still sit on a design nobody has ruled on. A scheduler that
  starts it anyway builds against a spec no human has actually seen.
- **The only admission is a human act on the issue itself: removing the label.** A scheduler
  has no other door in — it cannot decide an `agent-filed` issue has "become" approved by
  reading its content, its age, or how many times it has been proposed. The label is the whole
  answer; a scheduler that infers around it has reinvented the closed loop with extra steps.
- **An `agent-filed` issue whose `Ask:` line reads `ruling` or `permission` is excluded from
  what a scheduler starts, for the same reason `needs-ruling` is** (*Ask*, above): the
  deliverable is a human judgment or a permission grant, not a diff, and no amount of reading
  the body substitutes for the human act the line names. `backlog` and `deferred(<trigger>)`
  remain ordinary `agent-filed` exclusions — governed by the bullet above, not by this one.

**A scheduler starts work only by spawning ordinary sessions, and touches the tracker no other
way.** Concretely: it may run `code-triage` to decide what is ready, then spawn a session that
itself runs `code-start` → does the work → `code-wrap` → (where the repo has granted it)
`code-ship`. What it may **not** do is claim,
label, comment, or merge *directly* — every tracker write happens inside a session running the
standard skills, using the same claim-before-start and release-on-wrap discipline as a human-
opened one. A scheduler that shortcuts this — claiming in its own driver code to save a spawn —
produces exactly the anonymous, unaccountable writes [§0 of `code-start`](skills/code-start/SKILL.md)
exists to prevent, except now on a timer instead of from a single unnamed session.

**It may complete a trunk merge only where the repo has granted it, and only through the one
door that checks.** [`autonomy: auto-trunk`](#6-releases) is what makes `colab ship` usable at
all; a scheduler is not a wider grant of that permission, it is one more caller subject to the
identical gate — CI alive and green (unless every claimed issue holds a valid
[CI grant](#red-trunk-exemption--the-one-shot-door-through-trunk-ci-green-105) over trunk's
*current* red sha, #105), no new migrations (unless every claimed issue holds a valid
[migration grant](#migration-exemption--a-narrow-human-created-door-through-no-new-migrations-98)
for this branch, #98), no hand-merge conflict, and no `--force` override, because `ship` has
none. A repo that has not set `autonomy: auto-trunk` gates a scheduler exactly as it gates every
other agent: `ship` refuses, and a human runs Phase B. Nothing about running on a cadence earns a
wider door.

**A genuinely red trunk with no valid CI grant is human-gated, not self-clearing — and unlike a
migration grant, a scheduler must not queue and wait on it.** A missing migration grant is a
stable, expected state a driver can park on indefinitely (the issue simply is not ready yet); a
red trunk with no grant is the repo in a broken state *right now*. A driver parks, says so once
(the same "park-and-say-once" discipline as any other human-gated blocker), and stops — it never
treats a persistently red trunk as "still waiting for someone," because that reads as calm when
the correct read is "this needs a human today."

**The rungs above ship stay untouched, unconditionally.** A scheduler never promotes
(`colab promote`, trunk → main) and never tags — those remain human on every repo, on every
tier, with no field that can say otherwise ([§6](#6-releases)). This is not a narrower version
of the same rule that applies to interactive agents; it is the *same* rule, because the ladder
is a property of the action, not of who or what is asking. A scheduler that could promote or
tag would not be "a faster human-approved release" — it would be the ladder's top two rungs
deciding themselves have no gate.

**A blocker a scheduler meets on its own must be told apart from one only a human can clear** —
because a driver that treats both alike either spins forever on the second or gives up
silently on the first:

- **Self-clearing** — CI temporarily red, a billing outage, a merge conflict a hook can
  regenerate. Nothing here needs a person; the correct behavior is to retry on the next tick
  and say nothing until it either clears or has failed enough ticks to stop being "temporary."
- **Human-gated** — no `autonomy: auto-trunk` grant, a new migration on the branch with no valid
  migration grant covering every claimed issue (#98), an `agent-filed` issue with its label still
  on, a claim held by someone else. These do not change on their own no matter how many ticks
  pass. The correct behavior is to **state it once** — a comment on the Issue, or a single line
  in the driver's own log — and then park: stop re-announcing the same unmet gate every cycle,
  because a driver that repeats itself every tick is indistinguishable from one that is stuck,
  and trains its own operator to ignore it. A migration grant is the one member of this list a
  driver can watch for clearing WITHOUT a person acting again mid-cycle on ITS OWN say-so — but
  the grant itself is still only ever created by a human (`colab migration-grant`, `COLAB_HUMAN=1`);
  the driver's role is to notice the grant already exists on a later tick, not to request or
  infer one.

**Why this belongs in the handbook and not in one tool's docs:** the rules above are not
features of any particular autopilot — they are what makes *any* scheduled caller sanctioned
rather than rogue, in the same way [§5](#5-claiming-work--how-to-say-im-on-this) and the
[autonomy ladder](#6-releases) are not features of `colab` but the shape any tool in that role
must have. A repo adopting a different scheduler owes it these same five properties, not a
rewrite of them.

### Grouping — issues that must share one branch

*Readiness* gave two relationships a native home: parent/child as sub-issues, sequence as
blocked-by. A third one this model leans on constantly had none, and it is the one that
produces branch names like `fix/import-fixes-115-114-113`: **these issues touch the same
files, so they must move on one branch.** Two sessions editing the same files merge over
each other. The group is the prevention, not a tidiness preference.

Triage already computes it — it has to, in order to emit a branch name and a claim
command. A real run in this repo concluded that two issues MUST share a branch because
both rewrite `skills/code-sweep/SKILL.md:3`, named the line and the consequence, printed
it, and ended. Nothing outside that terminal could read it, and the next run re-derived it
from scratch — or did not. That is the failure *Readiness* already named, one relationship
later: *prose does not block a parallel session, and no tool can read it.* The cost is
exact — a second session can claim one member without ever learning the other exists,
which is precisely the collision the grouping was computed to prevent.

**Neither existing mechanism can carry it, because the shape is wrong:**

| | direction | shape | so encoding a group with it asserts |
|---|---|---|---|
| sub-issues | parent → child | hierarchical | one peer is the other's parent — or a parent issue exists that represents no work and sits in the backlog forever |
| blocked-by | blocker → blocked | directional | one waits for the other; and written both ways to stay honest, every member blocks every other |
| **group** | **none** | **symmetric, flat** | — |

The middle row is not a style objection. The readiness gate reads `blockedBy`, so a
mutually-blocked group is one that nothing can ever report as ready.

**So a group is recorded as a label carrying the group key, on every member:**

```sh
KEY=import-fixes    # the branch slug WITHOUT the numbers: fix/import-fixes-115-114-113
gh label create "group:$KEY" --color 5319E7 \
  --description "Must share one branch — these issues touch the same files"
for N in 115 114 113; do gh issue edit "$N" --add-label "group:$KEY"; done
gh issue list --label "group:$KEY"                 # the members, from any machine
```

The key is **the branch slug minus its trailing numbers**, so label and branch name
predict each other in both directions and there is nothing to agree per group.

**A label makes the group queryable; it does not make it justified.** The list above
returns three numbers and not one word of *why*, and the `file:line` collision is the
whole evidence. So each member also gets a comment ending in a machine-readable line —
exactly as *Provenance* pairs `Filed-by:` with `agent-filed`:

```
Group: import-fixes — #115 #114 #113
Because: app/Import/Parser.php:88 — #115 and #114 both rewrite the delimiter branch
```

Write both. The label is what a tool filters on; the `Because:` line is what survives a
human asking whether the grouping was right. Re-quote its `file:line` from the current
tree as you write it — refs rot ([§4](#4-branches-and-commits)).

**Three states, and the third is not the second** — the same discipline `deps-checked`
carries above:

| the label | state |
|---|---|
| on two or more **open** issues | **grouped** — start them together, or not at all |
| on exactly one open issue | **spent** — the others closed, or someone broke the group. Remove it |
| absent | **ungrouped, or nobody triaged.** Never evidence that the ground is clear |

Be clear about the cost: this is *derived* state, only ever as fresh as the triage run
that wrote it. **Whoever breaks a group removes the label from the members it no longer
covers.** Prefer leaving it off to leaving it wrong — an absent label costs one triage
pass, a stale one costs the merge-over the label exists to prevent.

**Who writes it, who reads it, and who tears it down.** `code-triage` writes it: it
is the step that judges which files an issue touches, and a judgement no tool can
re-derive is exactly the kind that has to be persisted. `code-start` reads it before it
branches, alongside the check that a clean `in-progress` label does not prove clean
ground.

**`colab ship`'s B4 tears it down (#82) — the label OBJECT, not just an issue's use of it.**
Left alone, a fully-closed group is picker noise forever: one fleet repo measured
~12 stale `group:*` labels whose every member was closed, and this repo grew two more
within an hour of adopting them. So after B4 posts its per-issue comments, ship unions
the `group:` labels the branch's issues carried and, for each one, asks whether any
issue anywhere still carries it in the **open** state. None left → the label object is
deleted (`gh label delete`). One still open → it is left exactly as it was, because it
still binds that remainder. `code-sweep` inherits the same check for free — it wraps
each candidate through the same path, never a batch.

This does not erase the record. Deleting the label removes it from *future* queries
(`gh issue list --label group:$key` returns nothing once it is gone) — it does not
touch the closed issues' own timelines, which keep showing the label was applied, and
it does not touch the `Because:` comment each member carries: that is the durable
record of *why* the group existed, by design (#43), independent of whether the label
object survives. Only `group:*` labels are ever in scope for this — never the
operational set (`in-progress`, `deps-checked`, `agent-filed`, `epic`).

**Why not "the group is whatever was claimed to one worktree".** It costs no new
vocabulary and is true by construction, and it still does not close the hole: that record
exists only *after* someone has claimed, so it cannot inform the decision to claim — the
one moment the group must be readable. It records a human having acted on triage's
judgement, which is not the same thing as the judgement.

### Writing a conclusion down — the decision and the document are two units

A session can produce nothing but a conclusion. A discussion that settles a rule, a review
that finds a gotcha, a wrap that learns something outliving its feature — the output is
prose, and the natural next move is to write it into the docs tree. That tree is also where
other sessions are merging, and nothing above says how the write reaches trunk without
colliding. **It reaches it as two units, in this order: the decision lands on an Issue now;
the document is a separate claimed unit after.**

**Step 1 — the conclusion goes on an Issue immediately, before any file is touched.** A
comment needs no branch, no worktree and no clean tree; it collides with nobody and is
readable the second it is posted. It is also the part that must survive — the document is
the durable *form* of the decision, not the decision.
[Provenance](#provenance--who-decided-the-work-should-exist) already assumes this shape:
`Filed-by: boss (via discussion session <name>)` describes a decision captured by a session
that wrote no code.

**Step 2 — the write is its own coding unit**: own Issue, claim, branch off trunk in a
worktree, wrapped normally. A conclusion worth documenting changes how people work, which
makes it the *most* consequential kind of doc change, not a typo exempt from ceremony. Being
a unit is what gives it a claim, and the claim is what makes it visible to everyone else.

Decoupling removes the collision rather than scheduling around it: while the discussion runs
there is nothing on disk to conflict with, and by the time anything is written the work is
claimed and can be ordered against whoever else holds the file.

**The collision unit is the file — the hunk, really — and never the folder.** This is worth
stating because "the docs tree is being merged right now" is alarming and wrong: two sessions
each *adding* a new file under one tree cannot conflict, and treating the folder as the unit
either serialises work that never needed it or gets dismissed wholesale. Ask the tree who
holds the file instead:

```sh
git fetch --prune origin
git log --all --not origin/<trunk> --source --format='%S' -- <path> | sort -u
```

Every ref printed is editing that file and has not landed. Empty output — or a path that does
not exist yet — is clean ground, and the write can go on its own branch immediately. Non-empty
output is a [group](#grouping--issues-that-must-share-one-branch) arriving by file rather than
by issue: same file, so same branch, or sequence after theirs lands. The two checks are not
interchangeable, which is why this one is written down — the `group:` label and the
`in-progress` label are both keyed to *issues*, so neither can see a live branch editing your
file under an issue number unrelated to yours. For shared prose that is the ordinary case.

Two rules already stated apply here with unusual force, because prose hides their failure:

- **Never write the final artifact in the main checkout** ([§4](#4-branches-and-commits)). A
  throwaway draft in a git-ignored scratch directory is fine — it is invisible to git. The
  committed version belongs on a branch, in a worktree.
- **Sequence; never batch** ([Has it landed?](#has-it-landed--the-one-rule-because-the-obvious-one-is-wrong)).
  Two doc branches landing in the same window get wrapped one at a time, each re-checked
  against the trunk the other just moved. Then read the region before resolving any prose
  conflict: **a branch that never touched a line still carries the old line as diff context**,
  so taking its side wholesale silently reverts the other session's edit while looking like a
  clean resolution. Measured, on two adjacent edits to one paragraph — the correct resolution
  was their union, not either side.

#### Design conclusions are three units, not two

A design ruling is the conclusion above, plus one part a prose conclusion does not need:
**an immutable visual record.** Repo files drift and supersede — the two-unit shape above
already assumes that — but a design ruling needs the *option that was approved* preserved
exactly as it looked, independent of whatever the file becomes next. So a design
conclusion is three units:

1. **The ruling** — on the Issue, immediately, exactly as Step 1 above: chosen option,
   why, what was rejected. This is the comment
   [`needs-ruling`](#design-ruling--a-human-must-approve-the-design-first) consumes to
   clear itself.
2. **The artifact** — a repo file under `docs/design/`, named `<slug>-<N>-mockup.html` or
   `<slug>-<N>-spec.md` — the issue number is the join key, mirroring branch naming
   ([§4](#4-branches-and-commits)). It lands via a claimed docs branch exactly as Step 2
   above describes; being a design file exempts it from nothing. **Superseded artifacts
   are marked, never deleted** — trunk carries the design lineage, and a preview link made
   months ago keeps resolving.
3. **The frozen evidence** — a screenshot of the approved option, attached to the ruling
   comment. Immutable where the repo file is not: a later session can edit the file, never
   the screenshot. Rejected alternatives need never land on trunk at all — their
   screenshot on the Issue is the whole record they were considered.

**Container rule:** the index of what lives under `docs/design/` belongs in that directory
itself — a README, or the spec document's own header — never accreted into the repo's
`CLAUDE.md`, for the identical reason the
[router-not-archive rule](skills/code-wrap/SKILL.md#claudemd-is-a-router-not-an-archive)
gives: a file loaded into every session is the worst place for an archive that only grows.
`CLAUDE.md` gets one pointer row into `docs/design/`; the design index maintains itself
there.

#### Design exploration files its Issue first — before the first mockup, not after

A mockup happens before any coding session exists for the feature, so the ordinary
sequencing note above — own Issue, claim, branch off trunk — needs one further promise:
**the Issue number has to exist before the first mockup is drawn, not retrofitted once one
is approved.** Filing is one command, cheaper than a single mockup iteration, and it is
what makes Step 2's naming possible at all — a file named `<slug>-<N>-mockup.html` cannot
be named until `N` exists. The provenance shape above already covers exactly this session:
`Filed-by: boss (via discussion session <name>)` for a design exploration a person asked
for, with no code written yet.

From there: a small feature continues on that same Issue through implementation. A large
one turns the design Issue into the
[epic](#epics--a-container-is-not-a-start-candidate) parent, with implementation
sub-issues hanging off it — the spec inherited by reference, never re-attached, and the
branch/worktree names for those children arriving with their own sessions rather than at
mockup time.

**Boundary:** [`ceremony: light`](project.schema.md#ceremony--optional) repos are exempt
from the file ceremony above — a mockup lives as a preview link in conversation, and units
1 and 3 collapse into one screenshot-bearing Issue comment when the decision is worth
keeping at all. This section defines storage, reference and sequencing; the approval gate
itself is [*Design ruling*](#design-ruling--a-human-must-approve-the-design-first) — the
two land together where grouped, but rule on different things.

### Scope — diagnosing across repos is not license to act in them

A recurring shape across a fleet of repos: a session working an issue in one repo
traces the actual root cause to a different one — a shared tool repo this one depends
on, a library, another service in the same system. **Reading and diagnosing across
repos to find a root cause is expected.** Everything else in this section — the label,
the worktree, the local cache, the human go-ahead before a trunk merge — is scoped to
**the repo a session is nominally working in**, and none of it authorizes acting in a
different one just because the diagnosis pointed there.

**Acting in another repo — branching, committing, pushing, rebasing or force-pushing an
existing branch, merging — requires that repo's own claim and its own explicit
go-ahead, scoped to that repo**, even when the session is confident it found the real
fix. The correct move is to report the finding — an Issue there, or a comment pointing
at the existing branch — and stop.

Measured: a session working a downstream repo's issue correctly traced the root cause
to an existing branch in the upstream tool repo the issue pointed at, then — with no
claim there and no go-ahead scoped to it — rebased that branch (which had drifted
materially behind trunk) and force-pushed the result. It was caught and reverted before
anything merged, so no lasting damage landed; the sequence of actions is what this rule
exists to prevent, not the eventual outcome.

### Rules

- Claim **before** you start, not when you open the PR. An unclaimed issue is fair game.
- **A live claim is enforced, not advisory.** `colab claim` and `colab worktree new`
  *refuse* an issue that already has a live claim (local state for same-machine, GitHub for
  cross-machine), naming the holder. `--force` takes over loudly — a takeover is always a
  visible, logged act. Advisory warnings were tried first; measurement showed they get
  skipped exactly when they matter.

  Know the limit of that guarantee: it protects an issue only while a claim is *live*, and
  since a session releases its whole group at wrap, an issue you left unfinished is
  immediately claimable again. The refusal prevents two sessions holding one issue at the
  same time; it does not reserve work for later. If you intend to come back to something,
  say so on the Issue — the claim will not hold it for you.
- **A claim carries its details as a structured Issue comment** —
  `🔒 Claimed — worktree … · branch … · host … · <timestamp>` on claim, `✅ Released` on
  release. The label answers *whether* an issue is taken; the comment answers *by what*,
  from any machine, with an audit trail unlabeling could never keep.
  - **The same pattern names code-ship's evidence comment** (B2b, `ceremony:
    standard` only): one invisible marker line, `<!-- colab:evidence sha=<trunk-sha> -->`,
    prepended to otherwise-free prose. A stable first line as wire format, everything after
    it human — deliberately not a structured evidence schema, which would invite padding
    instead of honesty. **Degrade, never gate**: a comment missing the marker (an older
    wrap, a hand-written one) still counts as evidence: no consumer may treat its absence as
    "no evidence exists".
- **Simultaneous claims break ties deterministically.** GitHub has no atomic check-and-set,
  so two racers can both claim within the same second. After claiming, re-read the issue:
  the earliest live claim comment (by GitHub's own `createdAt`) wins; the loser posts
  `✅ Released (yielded — …)` and moves on. Both racers reach the same verdict
  independently — no coordinator needed.
- Release the claim even if you did not finish. A stale claim is worse than no claim, because
  it silently blocks other people. (`colab doctor --prune` frees claims whose worktrees died,
  so stale state can never block work forever.)
- For long-running work, comment on the Issue with progress. The Issue is the feature's
  external memory — anyone resuming should get full context from `gh issue view N` without
  re-reading the codebase.

### Epics — a container is not a start candidate

*Readiness* and *Provenance* both answer whether an issue is safe to pick up: is it
unblocked, and did a human approve it. Neither answers a third question a scheduled
driver (*Scheduled drivers*, above) or a batch triage needs answered before either of
those: **is this issue a unit of work at all?** An epic — the parent issue that groups a
body of child work — can sail through both existing gates: open, unclaimed, human-filed,
even `deps-checked`, and still be nothing a session should ever branch on, because there
is no code to write for "ship the whole redesign", only for its children.

**The `epic` label marks exactly that: a container for sub-issues, informative, never a
start candidate, never claimed as a unit of work.** Secondary signals corroborate it — an
`epic(` title prefix, native sub-issue parenthood (`subIssuesSummary.total > 0`) — but the
label is the one an unattended tool can filter on without inferring anything from prose or
counting children itself. Apply it when you file (or convert) an epic; a scheduler and a
triage pass both exclude it from what they start, the same way they exclude `agent-filed`
work, and for a related but distinct reason: provenance asks *did a human approve this*,
this asks *is it shaped like a task at all*.

**This is why `epic` lives in the convention label set ([§9](#9-adopting-this)) and
`tracking` (below) does not.** The bar for that set is "an unattended driver's decision
depends on it" — the same bar `in-progress`, `deps-checked` and `agent-filed` each meet.
The scheduled-drivers model (*Scheduled drivers*, above) needs to exclude epics from what
it starts; nothing unattended yet reads `tracking`, so it stays repo-local and opt-in.
An epic still gets closed and referenced exactly as any other issue does once its
children finish — this label changes nothing about *that*; it only keeps a driver from
mistaking the map for the territory.

### Delivery type — route, not start (#112)

*Epics*, just above, answers "is this a unit of work at all?" A related but distinct
question sits beside it: **when it is a unit of work, does finishing it produce a code
commit?** A tracker mixes issues whose delivery is *not* a code commit — a content push,
an ops/production check, a docs sync outside code review — into a pipeline whose every
stage assumes one: worktree, gate, mergeable, squash, `Closes #N`. Such an issue can
never reach a mergeable state, so it reads as **eternally stuck**, and its real
completion (an evidence comment, an ops verification) is invisible to landed-detection.
The expensive half: it still looks **startable** to triage and a scheduled driver alike,
because nothing in the existing readiness vocabulary says "this is real work, but not a
diff" the way `epic` says "this is not a unit of work at all" — `deps-checked` means "no
blocker", not "this is a commit".

**Four labels — `delivery:code`, `delivery:content`, `delivery:ops`,
`delivery:docs-only`** — name the delivery type explicitly. The classifier they power is
**three-valued, not boolean**, and the third value is load-bearing:

| label state | reads as |
|---|---|
| no `delivery:*` label at all | **not asked** — behaves exactly as before this label set existed |
| `delivery:code` | code — the ordinary pipeline applies |
| `delivery:content` / `delivery:ops` / `delivery:docs-only` | non-code — **route, do not start** |

**"Not asked" must never collapse into "non-code".** Every issue in every tracker is
unlabelled the day this set is adopted; if absence read as non-code, triage and every
scheduled driver would freeze on that day. This is the same failure class *Readiness*
warns about for an empty blocker list: an absent value is not a meaningful value, and
optimism and pessimism both point the wrong way from "nobody said".

**`content` / `ops` / `docs-only` gate exactly like `needs-ruling`, not like a softer
advisory.** A non-code delivery type is not a start candidate for anyone, manual or
scheduled, in the code pipeline — the same posture *Design ruling* takes for an
unapproved surface, and the same reason *Epics* excludes a container: not every open,
unclaimed, human-filed issue is code to write. Route it to wherever its actual delivery
happens (a content calendar, an ops runbook, a docs platform); do not open a worktree for
it, and do not report it as blocked — it was never going to unblock, because there is no
diff on the other side of it. A session that lands on one distills that onto the issue and
ends the session, the same closing move as landing on a design-decision-only issue with no
code product ([`CLAUDE.md`](CLAUDE.md)).

**Who sets the label:** whoever files or triages the issue, deciding what the issue's
*deliverable* is — the identical placement `needs-ruling` gets from the designer producing
the spec. No mechanical rule infers it from a title or a body; a docs-sounding title can
still be `delivery:code` (updating a `.md` this repo reviews and merges as code), and a
code-sounding title can be `delivery:ops` (verifying a deploy, not shipping one).

**This is why `delivery:*` lives in the convention label set ([§9](#9-adopting-this)) and
not in a repo-opt-in list like `tracking`.** The bar is the same one `epic` and
`needs-ruling` meet: an unattended driver's start-or-skip decision depends on being able
to read the three states apart, and a repo that adopted before this set existed cannot
create the label at all — the label is provisioned, not invented on demand the way
`group:<key>` is, because its four values are fixed and every adopting repo needs them
before the first triage pass can classify anything.

### Tracking issues — claimed but referenced, not closed

Most issues are a unit of work: a branch completes them, and the merge closes them with
`Closes #N`. But a repo may keep a **long-lived memory / tracking issue** — external memory
for a whole domain, holding accumulated decisions and gotchas plus a checklist of still-open
items. A session doing a small hygiene fix in that domain legitimately **claims** the tracking
issue (to signal work in the area) and **references** it, but does not complete it: its
checklist still has open items.

Closing such an issue at merge would bury its knowledge and its still-open items behind a
closed-issue lookup. So a tracking issue is **referenced, not closed** — the merge message says
`Refs #N` (which GitHub links but does not auto-close) instead of `Closes #N`. Two ways to say
which issues these are, and they compose:

- **A `tracking` label on the issue** — declarative and durable. Any session that claims a
  labelled issue references it automatically. This is the robust choice: the property lives on
  the long-lived issue, so every session touching the domain honours it without having to know.
- **`colab ship --refs <N[,M]>`** — explicit, per-ship, for an issue not labelled.

**The claim is released unconditionally either way** — exactly as for a closed issue (a stale
claim blocks others; §5 *Rules*). Only the keyword changes: `Refs` instead of `Closes`. The
`tracking` label is deliberately **not** in the convention label set (§9): its absence breaks no
check — every issue simply closes as before — so adoption does not provision it and the audit
does not report it missing. A repo that wants the behaviour creates the label and applies it.

One edge the tool cannot fix by itself: if a commit *body* on the branch literally writes
`Closes #N` for a tracking issue, GitHub closes it on merge regardless — a message keyword
cannot un-close it. `colab ship` detects this after the push (the referenced issue reads
`CLOSED`) and warns you to reopen it by hand. Do not write `Closes #<tracking>` in a commit body.

The reverse direction is **not** the same kind of edge, and `ship` fixes it rather than
warning about it: a commit body may carry `Refs #N` written while N was still open, and by
the time `ship` runs N is one of the issues this branch *closes*. Nothing needs GitHub to
un-do anything here, so the composer drops the stale `Refs #N` and keeps its own `Closes #N`
before the push, instead of shipping a commit that says both (#58).

---

## 6. Releases

Tiers A and C — the two tiers that have production. The sequence differs by exactly one
step, the tag.

**Tier A.** A release is: **merge `dev` → `main`, then tag.**

```sh
git checkout main && git merge --no-ff dev && git push
git tag v1.2.0 && git push origin v1.2.0     # ← this is what deploys
```

Pushing the tag is the deploy trigger. Pushing `main` is **not** — that only runs the full
test suite. This separation lets you promote code and decide to ship it later.

**Single-trunk (tag-gated) Tier A** has no `dev` → `main` promotion — work already lives on
`main`. A release is just: **tag `main`.** The tag is still the whole gate; landing work on
`main` did not deploy it. Where the deploy is an external GitOps poller, tagging is what the
release script keys off — it fast-forwards the watched release branch — so the tag remains the
one deliberate ship-ward act, exactly as above.

**Tier C.** A release is: **merge `dev` → `main`. That is the deploy.**

```sh
git checkout main && git merge --no-ff dev && git push   # ← this is what deploys
```

Same `--no-ff` merge, never squash, for the same reason: the merge commit is the record of
what shipped and when. There is no tag step and no "ship it later" — the promotion is
irreversible in the sense that matters, because users have it the moment you push. Treat
the promotion itself with the seriousness Tier A gives the tag: that is the whole gate.

Tagging on C is optional and harmless — nothing fires from it — but if you find yourself
wanting tags consistently, that is the signal the repo has earned Tier A ([§9](#9-adopting-this)).

On a `deploy: manual` repo the sequence is the same, with the last step performed by a
person: promote, tag, then run the runbook. Nothing about the absence of automation makes
promotion safer to delegate — it makes it *less* safe, because the deploy that follows has
no gate but the operator. Promotion there always requires a human, and `promotion:
main-loop` cannot say otherwise.

That separation is also a permission ladder, one rung per boundary: **ship**
(branch→trunk, gated by `autonomy:`) · **promote** (trunk→main, gated by `deploy:` +
`promotion:` — safe to automate only where deploy is tag-gated) · **release** (the tag —
always a human act, on every repo, with no field that can say otherwise). The
`pre-push-guard` hook enforces the first two rungs mechanically; `COLAB_SHIP` never opens
`main`.

**On Tier C the ladder has two rungs, not three, and the second is the deploy.** Promotion
there always requires a human (`COLAB_HUMAN=1`) for precisely that reason — `promotion:
main-loop` applies only where `deploy: tag` makes promotion verification-only, so it can
never apply to C. Nothing about C widens what an agent may do: `autonomy: auto-trunk` still
only ever merges into `dev`, which does not deploy.

**Versioning** — SemVer. Patch for fixes, minor for features, major for breaking changes.
Pre-1.0 repos use `v0.x.y` and treat minor as "meaningful increment".

**Every tag gets a release summary** — a published GitHub Release whose notes group the
commits since the previous tag by Conventional-Commit type. This is the changelog; we do not
maintain `CHANGELOG.md` by hand. How you generate it is your repo's business —
[`templates/release-tag.yml`](templates/release-tag.yml) automates it on tag push.

When the workflow cannot run (Actions outage, billing lock — it has happened), the summary
is still owed. Manual fallback, same output:

```sh
colab release-notes v1.1.0..v1.2.0 | gh release create v1.2.0 --notes-file - --generate-notes
```

**Merged is not released — measure the gap, don't wait to notice it by eye.** An agent's report is
asked to flag an overdue release (`CLAUDE.md`, *Releases* — "that situation has bitten us in
payroll"), but nothing computed whether one was until `colab release-status [--repo P] [--json]`
(#81): read-only, per tag-gated repo, it reports commits on `dev` not yet promoted, commits on
`main` past the last `v*` tag (plus days since that tag), and flags whichever gap holds a
`fix:`-typed or breaking commit — exactly the class that has bitten before. It also suggests the
next tag's SemVer bump from the Conventional-Commit types since the last tag, advisory only: the
version number stays the human's. Tags live on `main`, not on the trunk — `git describe` run from
a `dev` checkout answers a stale question, so the lag is always measured against `main`.

Do not tag from `dev`. Do not tag a commit that has not passed the full suite on `main`.

---

## 7. CI and toolchain

**Your CI lives in your repo and belongs to you.** This handbook ships copyable starting
points under [`templates/`](templates/), but nothing is called remotely and nothing is
mandatory. Copy, edit, own.

What the handbook does require is an **outcome**: every pull request must run, at minimum, a
**secret scan** and a **build**. A committed credential is the one failure you cannot undo by
reverting — it must be caught before it lands.

A second required outcome: **CI must trigger on pushes to the trunk itself.** A workflow that
gates only branches the trunk isn't on is CI theater — we found three repos whose trunks had
moved to `dev` while CI still fired only on `[main, master]`: every trunk merge ran zero
checks, silently, while the merge gate dutifully "verified" runs that could never exist.
When a repo's trunk moves, updating the CI triggers is part of the move, and the audit
checks it.

### Toolchain versions — strict precedence

Never hardcode a version in CI. Resolve it, in this order:

1. **`.github/project.yml`** toolchain keys, if present — wins. For cases the ecosystem
   cannot express, or a deliberate pin.
2. **The ecosystem's own manifest** — `.nvmrc` or `package.json → engines.node`;
   `composer.json → require.php`; `.python-version` or
   `pyproject.toml → requires-python`. This is the normal answer.
3. **Fail the build.** Never fall back to a default.

That last rule is the point. A silent default is how one repo ended up building on Node 20
while deploying on Node 22 — nobody chose it, it was simply there, and the mismatch survived
for months. Failing loudly on an undeclared toolchain is cheaper than debugging a version
skew in production.

When both sources exist and disagree, that is a finding to report, not something to quietly
resolve.

A trap worth naming: **`requirements.txt` does not declare an interpreter.** It pins
dependencies only, so a Python repo carrying just that file has declared no version at all
and must add `python:` to `project.yml` or a `.python-version`. We learned this the
expensive way — a Python repo adopted the handbook, found no Python template, copied the
**Node** one and grafted a Python job into it with `python-version: "3.13"` hardcoded. The
repo did the reasonable thing with what existed; the rule was right and there was simply
nowhere to declare the value. **A missing template is not a neutral absence** — it does not
stop adoption, it redirects it into a worse form, and leaves behind a file whose header
lies about what it is.

### Test fixtures — neutralise ambient machine state, don't inherit it

**A test asserting a specific message or refusal must neutralise ambient credentials and
configuration rather than inherit them.** A fixture that spins up a real throwaway git repo runs
on the machine's real global git config unless it says otherwise — and this handbook installs a
global `core.hooksPath`, so a fixture that both `git init`s and `git commit`s without locally
overriding it runs the *developer's real pre-commit hook* inside a repo that is not a real
project. On a clean CI runner this is invisible (no global hooks path there), which is exactly
what makes it a trap: the failure is developer-local and shows up as tests going red for reasons
that have nothing to do with the change someone is testing.

This has now happened twice, in the identical shape — a fixture copied from a sibling test file
with one guard dropped: ambient `gh` credentials the first time, ambient `core.hooksPath` the
second (`tools/lib/orphan-worktree.test.js`, fixed alongside a grep-based regression check in
`tools/lib/fixture-hooks-lint.test.js` so the next copy cannot drop the line silently). The pattern,
not just either instance, is the rule: a git fixture helper sets `user.email`, `user.name`, **and**
`core.hooksPath` (pointed at a nonexistent directory, e.g. `path.join(dir, '.nohooks')`) before it
ever commits.

---

## 8. Conformance and reconciliation

Because branch protection is unavailable, conformance is checked **from outside** rather than
by a job inside each repo. The [`audit/`](audit/) tool reads repos across every owner —
including local-only repos with no GitHub presence — and reports drift in one run:

```
example-org/service-api          tier A   ⚠ node: engines=22 but ci.yml pins 20
example-org/mobile-app           tier B   ⚠ missing .github/project.yml
```

Run it on a schedule. It reports; only genuine findings fail the exit code.

### How repos find out when the handbook changes

The handbook is git-tagged `vX.Y.Z` (its current version is
`git describe --tags --abbrev=0`; before the first tag it is treated as `v0` and stamp
checks stay inactive). Templates are **copy-and-own**, never called remotely — so nothing
pushes updates to an adopter. Instead, every copy is **stamped** with the handbook version
it came from, and drift is surfaced by the audit, not by luck:

- Workflow copies carry a first line `# colab-handbook: <template> @ <version>`.
- The CLAUDE conventions block carries `<!-- colab-handbook @ <version> -->`.
- **Copy via `colab template <name>`** — it copies *and* stamps in one act, because a
  manual stamp is exactly the kind of step that gets skipped. It refuses to overwrite an
  existing file without `--force`.

The audit compares each stamp against the handbook's git history: a template that **changed
since the stamped version** is a finding ("review the diff, re-copy"); an unstamped copy, an
unknown template name, or a stamp newer than the handbook are advisories. A flagged repo is
reconciled deliberately: read the diff, take what you want, `colab template <name> --force`,
commit. No remote calls, no silent updates — an honest "you are behind" report.

The other half of that loop is **`colab update`**: an outward sweep from the machine holding
the registry. It classifies every stamped copy and, with `--apply`, refreshes only those still
pristine as of their own stamp. It never commits, and it never rewrites a hand-edited copy — a
repo that edited its CI keeps its edit and gets a report instead. Two consequences worth
stating, because both are deliberate:

- **A stamp older than the current version is not "behind".** Behind means the template
  *actually changed* since that stamp — checked with `git log <stamp>..HEAD` scoped to the
  template's own path. Comparing version strings instead would mark the entire fleet stale on
  every release and train everyone to ignore the report.
- **The frozen CLI copy is measured to the latest tag, not to `HEAD`** — the one place those
  two differ, because the units differ. A template copy is refreshed *from the working tree*,
  so the working tree is what an adopter can actually get; a frozen copy is refreshed from a
  release. Measured to `HEAD` it reported `behind` for every unreleased CLI commit, which is
  the resting state of any machine developing the handbook — and the remedy it advertised
  copies from that same tree, so it advised services to adopt untagged code.
- **An unstamped copy is never rewritten**, by any flag. Unknown lineage means we cannot know
  what replacing it would destroy; it is reported, and a human re-copies deliberately.
- **Provenance is decided by content, never by filename.** A copy is recognised by text only
  these templates contain — the step names they coined — not by the vocabulary of the stack they
  build. A file that merely shares a template's name is reported as `unrelated`, explicitly *not*
  as something to re-copy. This is a data-safety rule, not a tidiness one: the advice attached to
  "looks copied" is `--force`, so misattributing a repo's own workflow means overwriting it.

### Labels reconcile too — not just stamped files

Stamps track *file* drift, but the convention **labels** ([§9](#9-adopting-this) step 3)
drift the same way and leave no file to stamp. A repo that adopted before a label entered
the set never gains it on its own, and the check that label powers then silently cannot
fire — the readiness column that never fills, the provenance that reads every issue as
human-filed, a scheduled driver that cannot tell an epic apart from codeable work. So the
label set is reconciled on the same loop:

- **The audit reports the gap.** An adopted repo (one with a `project.yml`) missing any
  convention label is a finding — provided the audit can read the label set at all. Labels
  live on GitHub, so a remote-less or offline audit stays silent rather than claim a label
  is missing it simply could not see.
- **Sync back-fills it.** Provisioning the full set is idempotent (`|| true`), so it is safe
  to re-run on every sync, not only at first adoption. That is the mechanism by which a
  label added in a later handbook version reaches a repo that adopted earlier.

### The fleet registry is private

The list of repos the audit sweeps lives at `~/.colab/repos.txt` — machine-local, never
committed, because this handbook repo is public and a fleet list names private repos. The
committed [`audit/repos.txt`](audit/repos.txt) is a neutral format example and last-resort
fallback only. Resolution order: `--config` flag > `~/.colab/repos.txt` > bundled example.

---

## 9. Adopting this

An agent that understands the model still needs the bootstrap steps spelled out. They are
here.

### Any repo, first-time adoption

1. **Determine the tier.** Does a deploy target exist *today*? Not "soon" — today. If no,
   Tier B; an imminent launch does not change that. If yes, ask the second question: does
   a **tag** gate production (Tier A), or does the `dev` → `main` promotion itself deploy
   (Tier C)? **Deploying by hand does not make a repo Tier B** — the question is whether
   production exists, not whether shipping is automated ([§2](#2-tiers)).
2. **Write `.github/project.yml`** ([§3](#3-githubprojectyml--the-marker)).
3. **Create the labels — the whole set, not a subset.** They will not exist yet. All
   twelve are required, because each powers a check that silently *cannot fire* while its
   label is absent — and a check that never fires reads exactly like one that always
   passes:
   ```sh
   gh label create in-progress       --color FBCA04 --description "Claimed by an active session"  2>/dev/null || true
   gh label create deps-checked      --color 0E8A16 --description "Dependencies verified — no open blocker"  2>/dev/null || true
   gh label create agent-filed       --color C5DEF5 --description "Filed by an agent on its own initiative — not human-approved"  2>/dev/null || true
   gh label create epic              --color 3E4B9E --description "Container for sub-issues — informative, never a start candidate, never claimed as a unit of work"  2>/dev/null || true
   gh label create needs-ruling      --color B60205 --description "Needs a human design ruling before this can start"  2>/dev/null || true
   gh label create needs-plan        --color 0052CC --description "Triage judged this hard — code-start should run code-plan before coding"  2>/dev/null || true
   gh label create migration-granted --color D93F0B --description "A human granted this issue's branch an exemption from ship's no-new-migrations gate"  2>/dev/null || true
   gh label create ci-granted         --color D73A4A --description "A human granted this branch a one-shot exemption from ship's trunk-CI-green gate"  2>/dev/null || true
   gh label create delivery:code       --color 1D76DB --description "Delivery is a code commit — the ordinary code pipeline applies"  2>/dev/null || true
   gh label create delivery:content    --color FEF2C0 --description "Delivery is a content push, not a code commit — route, do not start in the code pipeline"  2>/dev/null || true
   gh label create delivery:ops        --color D4C5F9 --description "Delivery is an ops/production check, not a code commit — route, do not start in the code pipeline"  2>/dev/null || true
   gh label create delivery:docs-only  --color BFD4F2 --description "Delivery is a docs sync outside code review, not a commit — route, don't start"  2>/dev/null || true
   ```
   The `|| true` makes this **idempotent** — partial adoption is the normal case, so
   re-running must be safe. What each absence costs:
   - **`in-progress`** must exist before the first claim; without it the claim cannot land
     (and `colab claim` keeps a *local* claim while GitHub holds nothing — a collision
     reached from underneath, [§5](#5-claiming-work--how-to-say-im-on-this)).
   - **`deps-checked`** is not optional: without it a readiness check can never tell *free*
     from *nobody looked*, so the column silently never fills — worse than an absent
     feature, because a board keeps advising "run triage to fill it" and triage is a no-op.
   - **`agent-filed`** must exist **before** any agent files an issue — absence means *a
     human filed this*, so a repo lacking it reports every agent-filed issue as
     human-approved ([§5](#5-claiming-work--how-to-say-im-on-this)).
   - **`epic`** must exist before a scheduled driver (§5, *Scheduled drivers*) can tell a
     tracking/umbrella record apart from codeable work — absent, an epic that carries
     `deps-checked` and no claim passes every readiness gate and reads as a normal
     start candidate to an unattended tool ([§5](#5-claiming-work--how-to-say-im-on-this)).
   - **`needs-ruling`** must exist before a designer can mark a surface pending a design
     ruling ([§5](#5-claiming-work--how-to-say-im-on-this), *Design ruling*) — absent, that
     gate cannot be applied at all, and a surface nobody has approved reads as a normal
     start candidate to a human session or a scheduled driver alike.
   - **`needs-plan`** must exist before `code-triage` can flag a hard group
     ([§5](#5-claiming-work--how-to-say-im-on-this), *Planning*) — absent, the flag can
     never be written, so `code-start` always sees "no flag" and every session falls back
     to the cheap rung-1 stub, even on a group triage judged genuinely hard.
   - **`migration-granted`** must exist before a human can grant a migration exemption
     ([§5](#5-claiming-work--how-to-say-im-on-this), *Migration exemption*) — absent, `colab
     migration-grant` refuses outright rather than write a label that does not exist, so an
     issue whose entire deliverable is a schema change has no route past `ship`'s
     no-new-migrations gate at all. Unlike `tracking` or `graph-empty`, this one is NOT
     opt-in: its absence fails malignantly (a wall discovered only at the moment a repo
     hits it), not benignly, so it is provisioned and back-filled like the rest of this set.
   - **`ci-granted`** must exist before a human can grant a red-trunk CI exemption
     ([§5](#5-claiming-work--how-to-say-im-on-this), *Red-trunk exemption*) — absent, `colab
     ci-grant` refuses outright rather than write a label that does not exist, so a
     genuinely red trunk has no route past `ship`'s trunk-CI-green gate at all except by
     hand. Same NOT-opt-in posture as `migration-granted`: absence fails malignantly,
     discovered only the moment a repo's trunk actually goes red with no other way through.
   - **`delivery:*`** must exist before an issue's non-code delivery can be recorded at all
     ([§5](#5-claiming-work--how-to-say-im-on-this), *Delivery type*) — absent, a content
     push or an ops check has no way to say "not a diff", so it reads as a normal code
     start candidate to triage and a scheduled driver, jamming the code pipeline with work
     that can never reach a mergeable state. All four values are provisioned together: the
     set is fixed, and a repo missing even one (most often `delivery:code`, the explicit
     affirmative) cannot classify every issue's delivery type, only some of them.

   This full set is provisioned again on every sync, not only at adoption: a repo that
   adopted at an older handbook version — before a label entered the set — never
   back-filled it on its own, so [§8](#8-conformance-and-reconciliation)'s reconciliation
   creates any convention label the repo is missing, and the audit reports the gap as a
   finding rather than leaving an empty column to be noticed by eye.
4. **Add the tier topic** — `gh repo edit <owner>/<repo> --add-topic tier-b` (or
   `tier-c` / `tier-a`)
5. **Add the handbook pointer to the repo's `CLAUDE.md`** — copy
   [`templates/repo-CLAUDE-block.md`](templates/repo-CLAUDE-block.md). If the repo has no
   `CLAUDE.md` yet, create one with just this block. **Do not skip this.** It is the only
   reason a future agent will ever discover these conventions; agents read `CLAUDE.md`,
   they do not go looking for a handbook they have not heard of.
6. **Make sure CI meets the outcome in [§7](#7-ci-and-toolchain)** — secret scan + build,
   toolchain resolved not hardcoded. Copy a template if useful — via
   `colab template <name>`, which stamps the copy for reconciliation ([§8](#8-conformance-and-reconciliation)).
7. **Register the repo in the machine's fleet registries** — `colab register` (from
   anywhere inside the repo). One command, both registries: the audit fleet list and
   the reserved-ports aggregation. An unregistered repo is invisible to the fleet
   audit, so drift in it accumulates unseen.
8. **Leave existing branches alone.** Grandfathered ([§4](#4-branches-and-commits)).
9. **Do not create `dev`** unless the repo is genuinely Tier A or Tier C.

### Going live: Tier B → Tier C or Tier A

Do this **on the day a deploy target exists** — not before. The steps are shared; only
the mechanism differs, so decide first which tier you are going to ([§2](#2-tiers)):
does a tag gate production (A), or does the promotion itself deploy (C)?

1. **Write down the path to production.** For **C**: the deploy workflow, triggered by a
   push to `main`. For **A**: the deploy workflow triggered by a **tag** — or, if the repo
   ships by hand, the runbook (hosts, commands, order, how to verify). One of these must be
   committed before you go on.
2. `git checkout -b dev main && git push -u origin dev`
3. Set the repo's default branch to `dev`, so PRs target it by default.
4. **Add `dev` to every CI workflow's trigger branches.** The trunk just moved; CI that
   still gates only `main` will run zero checks on your actual work — and nothing will
   look broken ([§7](#7-ci-and-toolchain)).
5. Update `project.yml`:
   - **Tier C** — `tier: C`, `trunk: dev`, real `production:` URL, `deploy: push-main`.
   - **Tier A** — `tier: A`, `trunk: dev`, real `production:` URL, and `deploy: tag`, or
     `deploy: manual` plus `runbook: <path>` for a hand-deployed repo. Not `push-main`:
     a fine mechanism, but it cannot meet A's release-gate contract — that shape is C.
     *Tag-gated single-trunk variant:* if you go `deploy: tag`, you may keep `trunk: main`
     and **skip steps 2–3** (no `dev` branch) — the tag marks the release boundary
     ([§2](#2-tiers)). Add `runbook: <path>` when a poller deploys the tag from outside CI.
6. Swap the topic to `tier-c` / `tier-a`; update the internal project table (ports, prod URL).
7. **Tier A only:** tag the first release. (On a `manual` repo, tags are still worth
   cutting: they name what you deployed. Nothing fires from them.) On C there is nothing
   to tag — the promotion in step 2's new flow is the release.

Step 1 comes first on purpose. `main` only becomes meaningful once something consumes it
— and a human following a runbook is something consuming it, as long as the runbook is
committed. What must not exist is a `main` that nothing and nobody reads.

### Tier C → Tier A — when the site earns a release ritual

Do this when you find yourself *wanting* to name what shipped: hotfixes are getting
confused with feature work, or someone has asked "what version is live?" and there was no
answer. Not before — an unused tag ritual decays exactly like an unused branch.

1. **Retrigger the deploy workflow on a tag** (`on: push: tags: ['v*.*.*']`) instead of a
   `main` push. This is the whole change; until it lands, the tier claim would be false.
2. Update `project.yml`: `tier: A`, `deploy: tag`. `trunk` stays `dev` — the branch shape
   is identical, which is what makes this migration cheap.
3. Swap the topic to `tier-a`.
4. Tag the current `main`, so the first tagged release names what is already live.

The reverse — **A → C** — is the fix the audit points at when a repo declares `tier: A`
with `deploy: push-main`. It is descriptor-only: set `tier: C`, leave the pipeline, the
branches and the workflow exactly as they are, and swap the topic. Nothing about how the
repo ships changes; it simply stops claiming a gate it never had.

---

## 10. Anti-patterns

Each of these is something we have actually done.

**A release branch nobody consumes.** A repo adopted `dev` as default and dutifully wrote
"never push to `main`" in its docs — but nothing ever deployed from `main`. It sat 76 commits
behind, inert for months, while a `staging` branch created alongside it was abandoned after a
week. *A branch with no pipeline hanging off it decays into noise.* This is why Tier B is the
default and why promotion step 1 is "add the deploy workflow".

**The same fix opened four times.** With `dev`, `staging`, and `main` all live, one timezone
fix required four near-identical PRs, one per target branch. *Three tiers without automated
promotion is a tax you pay on every hotfix.* We use two, deliberately.

**A deploy mechanism nobody used.** A repo's deploy workflow triggers on tag push. It has
zero tags. Every deploy in its history was a manual dispatch — the workflow was copy-pasted
from a sibling and the tag ritual never took. *Copy-pasted CI encodes intentions nobody
adopted.* If you copy a template, read it and make it yours.

**A merge that ships itself — while claiming otherwise.** Two live repos deploy on every
push to `main`, and both declare Tier A, whose contract says a release artifact gates
production. Nothing is broken and nothing looks wrong — which is the trouble: there is no
moment at which someone decides "this goes to users now", because the merge already did.
Hotfix and half-finished refactor leave by the same door, at the same speed, with the same
amount of thought. *The mechanism is fine; claiming a gate you do not have is not.* Now a
finding, so the descriptor and the pipeline have to agree.

**Docs describing a repo that doesn't exist.** Our most heavily documented repo prescribes
trunk `main` (its actual default is `master`), "rebase, never squash" (every commit is a
squash), and CI gating on `dev` (its own workflow says dev merges skip CI by design). *An
aspirational doc is worse than no doc — people trust it.* Keep this file describing what is
true; when reality changes, change this file in the same PR.

**Stale branch references in CI.** A repo still gates on `develop`, `master`, and `workos` —
none of which exist. *Config drifts silently when it is copied rather than referenced.* The
audit tool exists to catch exactly this.

**A conclusion that only ever existed in chat.** A session settled a batch of rules and went
straight to implementing them. Three branches, zero Issues — so nothing was claimed and no
parallel session could see the work was taken; the branch names carried no issue numbers; the
merge messages could not say `Closes #N` because there was nothing to close. The code landed
fine. What was lost was the argument behind it: which options were rejected, and why each rule
came out the way it did. *Work that was only agreed to in a room is undocumented the moment
the room closes.* This is why the decision goes on an Issue before any file is touched
([§5](#5-claiming-work--how-to-say-im-on-this)).

**A silent version default.** Covered in [§7](#7-ci-and-toolchain). Worth repeating: the bug
was invisible because nothing looked wrong — CI was green the whole time.

---

## 11. Quick reference

```sh
# starting work
gh issue list --label in-progress                 # what's taken
gh issue list --label agent-filed                 # filed by an agent — no human approved it yet
gh issue list --label epic                        # a container for sub-issues — never a start candidate
gh issue list --label group:<key>                 # must share one branch — start them together
gh issue list --search "label:delivery:content,delivery:ops,delivery:docs-only"  # non-code — route, don't start
gh issue edit N --add-assignee @me --add-label in-progress
git checkout -b feat/<slug>-N origin/<trunk>      # trunk = main (B) or dev (A)

# editing a file that already exists — who else is holding it, by file not by issue
git log --all --not origin/<trunk> --source --format='%S' -- <path> | sort -u

# finishing work
colab landed --worktree <name>                    # landed → teardown, cargo → merge
git checkout <base> && git merge --squash feat/<slug>-N   # base = trunk, or a declared line
gh issue edit N --remove-label in-progress

# releasing — TIER A ONLY
git checkout main && git merge --no-ff dev && git push   # --no-ff, never squash
git tag v1.2.0 && git push origin v1.2.0                 # the tag deploys
```

---

*Changes to this file are changes to how everyone works. Explain the why in the PR body.*
