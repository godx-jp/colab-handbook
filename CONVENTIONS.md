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

> This handbook is not documentation. It is the **substitute for shared context between
> parties that cannot accumulate shared context.** Every rule exists because one party
> could not see what the other assumed.

Two corollaries follow from that, and later sections cite them rather than re-arguing:

1. **Humans fail by drift; agents fail by confident speed.** So the same sentence is a
   *reminder* to a human and must be a *rail* for an agent — anything guarding against
   agent failure has to be machine-checked, because an agent will never feel the
   hesitation that saves a human. Every rule this repo promoted from prose into tooling
   was promoted after an agent walked through the prose version at speed.
2. **A new axis is warranted when a class of context one party structurally cannot hold
   is not made visible by an existing axis** — not when a repo merely feels different.
   This test has already refused things: it is why deploy-channel visibility became
   part of an existing axis rather than a fourth one.

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

`main` in Tier A is a **pure release branch** — work is promoted to it, not landed on it.
This buys one thing: the expensive test suite runs at promotion time, not on every session
merge. Sessions stay fast; releases stay safe.

**If your test suite is fast, you do not need Tier A.** The split answers slow CI, not
seriousness. A repo with no meaningful suite gains nothing from it — ceremony with no
benefit, and `main` becomes a branch nobody trusts. Write the suite first, then split.

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
see *tag-gated Tier A* below.

**A, B and C are labels, not grades.** `B` has no production at all — it cannot break
anything for users, because it has none. The letters name *shapes*, not seriousness.
`B`→`C` is not a demotion; `C`→`A` is not a reward; each is a claim about how many gates
your pipeline really has. Claim the one that is true. Never "upgrade" a repo's tier to
be helpful.

**The first question is "is there a production target *today*?", not "is deploying
automated?"** No production → Tier B, and an imminent launch is still B. Production →
A or C, and the second question decides which: does a deliberate release artifact gate
production (A), or does the promotion itself ship (C)?

A repo that is live but ships by hand — rsync, `docker compose up -d --build`, an upload
— is Tier A with `deploy: manual`, naming its procedure in `runbook:`: the promotion does
not itself deploy, a human running the runbook does — still two acts. Forcing a live repo
to Tier B would make it declare `production: null`, a lie about a live product (the
failure [§10](#10-anti-patterns) is about).

Hand-deployed Tier A keeps the two branches because they earn their keep: `main` is
**what is currently running on the host**, `dev` is where sessions land, and the
promotion is the deliberate "about to deploy" act — the only record of what shipped and
when.

**A tag-gated Tier A may instead run a single trunk `main`.** When `deploy: tag`, the tag
itself marks the release boundary — the last `v*.*.*` is "what shipped and when", the
same job the split does on a hand-deployed repo — so a second branch marking the same
boundary is redundant. Day-to-day work lands on `main`; releases are cut by tag. Common
in tag-gated GitOps: a release script cuts `vX.Y.Z` and fast-forwards a long-lived
**release branch** an external poller watches and redeploys, so the deploy runs
**outside** CI with **no in-repo deploy workflow** by design. The tier is set by the
promotion **gate** (a version tag), never by the trunk name or where the deploy job runs.
Specific to `deploy: tag` — `manual`/`push-main` have no tag to mark the boundary and
keep the split. Wherever the deploy runs outside CI, the path to production must be
committed as [`runbook:`](project.schema.md#runbook--required-when-an-out-of-ci-deploy-has-no-workflow).
Name the release branch in [`releaseBranch:`](project.schema.md#releasebranch--optional)
— between releases it is, by construction, an ancestor of trunk, indistinguishable by
ancestry alone from a spent session branch; undeclared, `colab doctor` misreads it as
safe to delete (#63).

**Tier C exists because a tag ritual nobody honours is worse than no tag ritual.** A live
but low-stakes site gains nothing from cutting versions; C describes that shape honestly:
`deploy: push-main`, `main` is what is live, the promotion is the one moment someone
decides to ship. Not a lesser A — a different, honest gate count.

**Deploying straight off a `main` push meets Tier C's contract, not Tier A's.**
`deploy: push-main` is a legal, reasonable mechanism; the mismatch is with the *tier*
claim — A's contract is a deliberate release artifact gating production
([§6](#6-releases)), and push-main has none. So `tier: A` + `push-main` is a finding, and
the usual fix is **retiering to C** — no pipeline change, the descriptor stops claiming
a gate it never had. Migrating to `deploy: tag`, or declaring `deploy: manual` +
`runbook:`, remain valid alternatives when the site has genuinely earned them.

**"Trunk" is a role, not a branch name** — the branch sessions merge into: `main` in Tier
B, `dev` in Tier C, `dev` or (tag-gated) `main` in Tier A. Read `project.yml` to learn
which. Never create a branch literally named `trunk` — and never *record* the word
either. Measured: a session's record read `branch: "trunk"`; the merge tool matched
claims **by branch name**, found none, and squashed anyway — no `Closes #N`, the same
26-of-30 failure below reached by a different path. **The absence of a branch is null,
not a word.** A tool storing this should refuse the word on write, and treat "this
branch has no claimed issues" as suspicious rather than routine.

**Trunk is the primary integration point, not always the only one.** A repo may declare
additional long-lived lines in `project.yml`
[`integration:`](project.schema.md#integration--optional). Sessions may cut from a
declared line and ship back into it, guarded exactly as trunk is. It never gets a path to
production — nothing in promote/tag/deploy reads that field, so the only way work on a
line reaches users is a human merging it into trunk and promoting; tooling refuses to
perform that merge. This is a second *development* axis, not a second trunk — `trunk:`
stays tier-locked because on A/C it is literally the production spine.

**`trunk:` answers one question only, deliberately.** Consumers split into Group A —
correctness (worktree classification, landed/delete-safety, cut-from base) — which must
keep reading one shared value; and Group B — "which line does *this checkout* serve",
a per-host deployment fact. **Group B gets no descriptor field, on any tier.** A
`deploys: { <host>: <branch> }` entry would drift the moment a machine is renamed or
retired, with nothing able to tell a stale entry from a live one. Its answer lives in a
per-host mechanism the repo owns (env var, machine-local config) — the same shape as
`colab`'s own cache, uncommitted and VCS-fenced. Whatever mechanism is chosen must
**name** a branch, unset-by-default, never widen or disable the gate it overrides (e.g.
an `HEAD == trunk` safety check for an unattended rebuild-and-restart). A repo on N hosts
with N lines stays one repo, one descriptor — never N repos, N descriptors, or a second
entry in `trunk:`/`integration:`.

**Memory ceremony is a fourth axis, and tier cannot carry it.** Tier counts gates to
production; it says nothing about whether anyone will ever comb through a repo's audit
trail. [`ceremony: light`](project.schema.md#ceremony--optional) lets a repo opt into
thinner Issue narration and skip Phase B evidence comments — never the rails that
protect other sessions and the fleet (claim discipline, worktree isolation, reserved
ports, squash + `Closes #N`, CI secret scan). Two backstops: a `light` repo must have
`production: null` (a live repo cannot skip its own audit trail), and it may not combine
with `autonomy: auto-trunk` (an unattended merge with no evidence trail is unauditable).

### Solo flow — trunk-direct, issue-on-demand, entry-gated (`ceremony: light` only)

`ceremony: light` relaxed the record-keeping *end* of a session; the *start* — pre-filed
issue, claim, branch, worktree — stayed full weight even there. Solo flow is for a repo
one person codes directly, in one conversation-driven session, with no other session to
protect against — the start-side invariants exist to protect *other* sessions.

1. **Entry gate, not honor system.** `colab solo` checks fresh on every invocation, never
   a cached answer: no live solo session already open, no worktree, no claim, checkout on
   trunk with no unpushed branch anywhere, and a clean (tracked + untracked) tree.
   Anything held refuses outright — full ceremony, no partial credit. *(On a file-synced
   checkout the residual sync-window race in cross-machine visibility is accepted
   deliberately — solo flow means a human is personally driving one checkout, not a fleet
   of unattended sessions.)*
2. **Trunk-direct commits are allowed.** Small Conventional Commits go straight to trunk;
   CI validates after the push. Branching remains available whenever a squash unit is
   wanted — solo flow stops requiring it, not forbidding it.
3. **An Issue is filed on demand**, not on entry — recording a decision, or work spanning
   more than one sitting.
4. **Exit check, not teardown.** `colab solo --done` re-derives fresh: tree clean,
   everything pushed. Nothing to tear down — solo flow made no worktree and holds no
   claim.
5. **Never relaxed, even solo:** CI secret scan · reserved ports · Conventional Commits ·
   `production: null` · not `autonomy: auto-trunk` · no scheduled driver (doubly
   incompatible — a driver planning against a repo reads its Issues, and a solo repo may
   have none open at all).

**The boundary is concurrency reality, not a discipline preference.** A repo more than
one session touches can never legally run solo flow — the entry gate's own checks are
false by construction the moment a second session exists. `ceremony: light` is necessary
but not sufficient: a light repo currently hosting someone else's worktree still fails
`colab solo`'s check, correctly.

**Consumers inferring activity purely from worktrees/claims will under-report a solo
session** — fixing that is each such consumer's own call, not mandated here.

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
`manual` means a human runs a documented procedure; it requires `runbook: <path>` naming
that document, and the audit checks the file is really there.

`stack` is a **free-form string**, not a fixed list — a closed enum was tried and
immediately failed on a Capacitor app fitting no bucket.

Optional toolchain keys (`node:`, `php:`, …) may be added — see [§7](#7-ci-and-toolchain).
A repo keeping a long-lived line declares it in `integration:` — a development-side axis
with no path to production ([§2](#2-tiers)). A beta/throwaway repo may declare
[`ceremony: light`](project.schema.md#ceremony--optional); omitted, a repo behaves exactly
as before.

Mirror the tier as a GitHub **topic** (`tier-a` / `tier-b` / `tier-c`) so `gh repo list
--topic tier-a` gives a fleet-wide view. The file is the source of truth; the topic is
for discovery.

Full field reference: [`project.schema.md`](project.schema.md).

### Boot recipe — an entry point the repo owns, not a table a consumer keeps

`ports:` declares **where** a repo's trunk dev server listens; nothing declares **how**
it starts, so every consumer wanting to start one has kept its own external table of
start commands, unvalidated against the repo, forcing a default onto any repo it has no
entry for.

**So the entry point is conventional, not a marker field:** if `<repo>/.colab/dev` exists
and is executable, that starts the trunk dev server — no arguments, foreground, exits
when the server stops. Absent it, a caller falls back to its own ecosystem default. A
boot recipe changes with the code, so it belongs beside the code, not in a shared schema.

Measured cost of the status quo: a repo silently inherited an external table's default
ecosystem; the session's command died on the spot, and the caller was told the start had
**succeeded** while the port stayed dead indefinitely, with nothing to flag it.

**A start is verified by the declared port accepting a connection, never by the process
manager's exit code** — a supervisor exits 0 the moment a session is created, not when
the command inside it is still alive a second later.

---

## 4. Branches and commits

**Branch names:**

```
^(feat|fix|docs|chore|refactor|test|perf)/[a-z0-9._-]+$
```

Convention is `feat/<slug>-<issue-number>`, e.g. `feat/onboard-redesign-23` — the issue
number in the name means the claim registry, the worktree, and the Issue line up without
a lookup table.

**A branch may carry a group of related issues** — suffix them all:
`fix/import-fixes-115-114-113`. Claim every issue in the group before starting, and
**release every claim in the group together at wrap** — unconditionally, including
issues that did not get finished; an unfinished issue that stays claimed silently blocks
whoever picks it up next.

**A group is not a chain.** A *group* is issues that touch the same code and must move
together on one branch, spelled with trailing numbers in the branch name. A *chain* is
issues that must happen in order, across separate branches — recorded as a dependency
([§5](#5-claiming-work--how-to-say-im-on-this)), never by a branch name. Mixing them
produces a branch carrying work that is not ready, or a sequence nothing enforces.

**Branches that predate adoption are grandfathered** — do not rename them; several may be
live worktrees. Apply the convention to new branches only.

**Never** branch off another feature branch — that couples two unfinished things, neither
of which can land alone. Always branch off trunk, or a **declared integration line**
([`integration:`](project.schema.md#integration--optional)) — a stable, published
integration point the team maintains, cut and merged like trunk. "Declared" is a commit
in the repo, not a habit.

The base is a **session fact**, recorded when the worktree is created, and the branch
ships back into it:

```sh
colab worktree new feat/<slug>-N --issues N              # base = trunk
colab worktree new feat/<slug>-N --issues N --base v2    # base = the declared line v2
```

Base and merge target are **one decision, not two** — say which branch you merged into
whenever you report a session done. A branch cut from a line and merged into trunk
carries the entire line in with it, inside one squash commit that reads like a small
change.

**The main checkout stays on trunk at rest — a worktree is the default, not a
preference.** A dev server, a symlink, a scheduled job may read that working tree, and
none of them learn that you branched it. Measured: a session branched a repo's main
checkout for a chore; that repo ran always-on from the tree, so the live app served
unmerged feature-branch code until a human noticed by eye. Leaving the tree merely
*dirty* is the same fault with wider blast radius — an uncommitted file there blocks
every other session's trunk merge in that repo. A plain branch is still allowed on a
repo nothing reads from; taking it means **you** own returning the checkout to trunk
before you wrap.

**`git stash` is repo-scoped, not worktree-scoped — never reach for a bare stash inside a
worktree session.** `refs/stash` is one ref per repository; two concurrent sessions
stashing around the same time can push/pop over each other with no error. Measured: on a
repo running 10+ concurrent worktree sessions, one session's `git stash pop` restored a
*different* session's uncommitted changes, with a third, unrelated, much older stash
sitting in the same shared stack the whole time.

Prefer, in order: `git diff`/`git status` to read without moving; targeted
`git checkout -- <path>` plus manual re-apply; comparing directly against
`origin/<trunk>` — never touching `refs/stash`. If unavoidable, label the message
(`git stash push -m "<issue> wip"`) and **re-run `git stash list` immediately before
touching any `stash@{N}` index** — a concurrent push renumbers every existing entry, so
a captured index may already point at someone else's work.

**Commits** — Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`,
`test:`, `perf:`). Not decoration: [§6](#6-releases) builds the release summary by
grouping on these prefixes. A commit with no prefix is invisible in release notes.

**Merging:**

- Feature branch → trunk: **squash**, one commit per unit of work.
- `dev` → `main` promotion (Tiers A and C): **`--no-ff` merge commit**, never squash —
  the merge commit *is* the release boundary.
- **The merge message closes its issues: write `Closes #N`** (one per issue), not a bare
  `(#N)` — GitHub auto-closes only on the keyword. Measured: 26 of 30 issues sat open with
  their code long since merged, purely because merges said `(#22)` instead of `Closes #22`.
- **`Closes #N` requires the issue's own scope fully accounted for — a mechanical gate,
  not an honour system (#74).** An issue's `## Plan` is a real GitHub checklist — one
  `- [ ]` line per deliverable, load-bearing. A prose-only `## Plan` cannot be verified
  mechanically (reported, not blocking; cannot bind an issue opened before this
  convention). `colab ship` parses the checklist before composing the squash body: any
  claimed issue with an unticked box and no declared `Remainder: #M` gets `Refs #N`
  instead of `Closes #N` — stays open, redirect reported, never silent. A hand-merge runs
  the identical check by reading the same two fields
  (`gh issue view N --json body,comments`). Motivating incident: an issue closed by
  squash-merge with a third of its three-section scope unimplemented — the sections were
  prose, so nothing could have caught it.
- **Every closed issue must be corroborated by git, not the claim registry alone (#87).**
  Measured: a branch carrying #71 and #76 resolved to `[71, 74, 76]` because a co-tenant
  claimed #74 onto the same worktree minutes after merge authorisation, with nothing on
  the branch implementing it. Corroboration reads two git-side sources: the branch name's
  **trailing** number group, and `#N` references in **commit bodies**. An issue named by
  neither is a finding — `colab ship` refuses; a hand merge must perform the same check.
  Do not resolve it by quietly writing `Refs #N` — that hides the collision; `--refs`
  exists for when an operator actually means it.
- **A deliverable with no diff still has to close (#90).** A decision recorded, an
  investigation concluding "no change needed", an artifact stored outside the repo —
  there is nothing to squash. `colab ship` detects `landed ∧ zero own commits` (both
  measured from git, never declared by the session) and switches to **evidence-close**:
  post evidence, close each issue, tear down — no merge, no push, no `--allow-empty`
  marker commit. Gated on the issue **already carrying a comment the tool did not write**.
- **Before merging to trunk, check that trunk's last CI run is green — and that it ran at
  all.** We once merged for 12 straight hours into repos whose CI was silently dead (org
  billing lockout) — every run "failed" without starting. **Ask by commit, not by recency
  (#92):** `gh run list --branch <trunk> -L 1` reads whatever ran *last*, and under
  `cancel-in-progress` a cancelled straggler can outrank a passing run on the same commit.
  The right question: does a completed, successful run exist for this branch's current
  head sha? `colab ship` asks it that way.
- **That resolves a FALSE red — a real one has a different, human-only door (#105).** A
  **genuinely** red trunk (the sha really failed) is a true deadlock when the candidate
  branch's entire content IS the fix — see *Red-trunk exemption* below.

### Has it landed? — the one rule, because the obvious one is wrong

```sh
colab landed --worktree <name>     # landed · cargo · unknown
colab landed --all                 # every worktree of this repo
```

**Never decide it by counting commits** — a squash mints a new commit with a new sha, so
a shipped branch's own commits are never ancestors of its base; a count-only test reports
every branch ever shipped as unfinished. Comparing diffs alone also fails: zero commits
ahead but a non-empty diff, because the base moved underneath. Both measured on live
worktrees in a single sweep. Requiring both still leaves a gap — a squash *followed by*
base movement satisfies both (five of seven shipped branches in one repo were in this
state). **The rule asks directly: does merging this branch into its base change the
base's tree at all?**

- **Asked against the branch's base**, trunk only by default — a branch cut from a
  declared line, measured against trunk, looks like enormous unshipped cargo.
- **`unknown` is a real answer and means cargo.** Verdicts never round up to `landed`.

**Git state and claim state are two signals, and neither replaces the other.** The
`in-progress` label answers *does someone believe they hold this*; git answers *what
state is this actually in*. Do not collapse them.

---

## 5. Claiming work — how to say "I'm on this"

Parallel sessions and parallel agents must not collide on the same Issue. Two layers:

### Who holds this

#### Source of truth — GitHub

```sh
gh issue list --label in-progress                               # check, before taking work
gh issue edit <N> --add-assignee @me --add-label in-progress    # claim, at session start
gh issue edit <N> --remove-label in-progress                    # release, at session end
```

Assignee plus `in-progress` is authoritative because it is **visible from any machine
and to any person**. The label does not exist in a fresh repo — creating it is part of
adoption ([§9](#9-adopting-this)).

#### Fast path — local cache

`colab` keeps a machine-local cache at `~/.colab/state.json` (override with
`COLAB_HOME`), written automatically on claim/worktree-create — a zero-latency read for
same-machine parallel sessions. **It is a cache, not the truth**: uncommitted,
machine-local, cannot see work claimed elsewhere. **When cache and GitHub disagree,
GitHub wins.**

```sh
colab claims --sync      # reconcile local cache against GitHub
colab doctor --prune     # free claims whose worktrees no longer exist
```

#### Rules

- Claim **before** you start, not when you open the PR — an unclaimed issue is fair game.
- **A live claim is enforced, not advisory.** `colab claim`/`colab worktree new` *refuse*
  an issue with a live claim, naming the holder; `--force` takes over loudly. This
  protects an issue only while the claim is *live* — a session releases its whole group
  at wrap, so an unfinished issue is immediately reclaimable; say so on the Issue if you
  intend to return.
- **A claim carries its details as a structured Issue comment**:
  `🔒 Claimed — worktree … · branch … · host … · <timestamp>` on claim, `✅ Released` on
  release. `code-ship`'s evidence comment (B2b, `ceremony: standard` only) uses the same
  pattern: an invisible marker line, `<!-- colab:evidence sha=<trunk-sha> -->`, prepended
  to free prose. **Degrade, never gate** — a comment missing the marker still counts as
  evidence; no consumer may treat its absence as "no evidence exists".
- **Simultaneous claims break ties deterministically**: re-read after claiming, the
  earliest live claim comment (by `createdAt`) wins, the loser posts
  `✅ Released (yielded — …)`.
- Release the claim even if you did not finish — a stale claim silently blocks others.
  `colab doctor --prune` frees claims whose worktrees died.
- For long-running work, comment progress onto the Issue — the feature's external memory.

#### Tracking issues — claimed but referenced, not closed

A long-lived tracking issue may be **claimed** (to signal work in the domain) and
**referenced**, without closing — its checklist still has open items, and closing it
would bury its knowledge. The merge message says `Refs #N` (links, does not auto-close)
instead of `Closes #N`.

- **A `tracking` label** — declarative and durable; any session claiming a labelled
  issue references it automatically.
- **`colab ship --refs <N[,M]>`** — explicit, per-ship, for an unlabelled issue.

The claim is released unconditionally either way. `tracking` is deliberately **not** in
the convention label set (§9) — its absence breaks no check, so adoption does not
provision it and the audit does not report it missing.

Do not write `Closes #<tracking>` in a commit body — GitHub closes on the keyword
regardless of intent, and it cannot be un-closed by another keyword. `colab ship` detects
this after the push and warns to reopen by hand. The reverse is not the same kind of
edge: a stray `Refs #N` written while N was open, now one of the branch's own
`Closes #N` — `ship` drops the stale `Refs` before the push rather than shipping a commit
that says both (#58).

### Who decided it should exist

#### Provenance — who decided the work should exist

Issues arrive from three directions: a person, an agent that hit something while coding,
an agent filing a follow-up as it wraps. Nothing else in the model answers whether a
human decided the work should happen at all — an agent-filed issue is open, unclaimed,
unblocked, indistinguishable from human-requested work.

**So an agent filing on its own initiative labels the issue `agent-filed` and ends the
body with:**

```
Filed-by: agent (during code-wrap of #48, session <name>)
Filed-by: boss (via discussion session <name>)
```

- **No label means a human filed it** — the default; existing issues need no backfill.
- **Provenance is whose *intent* it was, not whose keyboard.** An agent transcribing a
  person's decision writes `Filed-by: boss`, **no** label. An agent noticing a problem
  itself is `agent-filed`, even if a human was in the room.
- The `Filed-by:` line is the durable record; the label makes it **queryable**. Write
  both.

**Why:** anything that starts work in bulk (a start button, batch triage, a scheduled
sweep) must be able to exclude work no human approved — the label is what lets the
default be *excluded, started only when a person clicks*.

##### Ask — the filer declares the ask class (#89)

`agent-filed` says a human did not decide the work exists; it does not say what kind of
decision it is waiting on. Measured on a live 34-item approve queue (2026-08-01): six
ask-classes, detected only heuristically from labels and title phrasing.

```
Ask: permission | backlog | ruling | deferred(<trigger>)
```

- **`permission`** — asking to touch machine or production state before proceeding.
- **`backlog`** — a work proposal to accept and schedule, not a decision itself; also the
  default when the line is absent.
- **`ruling`** — resolves to human judgment, never startable as code — same class as
  `needs-ruling`.
- **`deferred(<trigger>)`** — no action needed now; the issue carries its own wake
  condition.
- **Absent line means `backlog`** — every pre-existing `agent-filed` issue reads as the
  common case, no backfill required.
- Written at filing time, by whoever files — never reconstructed after the fact.
- Appears only on `agent-filed` issues — a human filing for a human audience needs no
  machine-readable ask class.

### What may start

#### Readiness — open and unclaimed is not enough

An issue is **ready to start** only when open, unclaimed, **and nothing it depends on is
still missing**. Prose dependencies ("blocked by the other one") do not block a parallel
session and no tool can read them — measured: an epic tracking ~14 children by
hand-edited checklist reported `subIssues.totalCount = 0`.

**So dependencies are recorded in GitHub's own relationship model:** parent/child as
sub-issues, sequence as blocked-by.

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

`removeSubIssue` requires **both** ids — a child cannot be detached by naming only
itself.

**The two halves do not share an API, and that is the trap.** Sub-issues are GraphQL,
keyed by **node** id; dependencies are REST, keyed by **database** id — no dependency
mutation exists in GraphQL. Three mistakes fail loud (wrong type, `NOT_FOUND`); one is
silent and is the one to fear: the REST endpoint accepts an **issue number** as a valid
integer database id and **succeeds**, attaching a blocker from whichever issue happens to
hold that id *anywhere on GitHub*. Measured: `issue_id=34` silently attached a blocker
from a stranger's unrelated repo. **Read `blockedBy` back after every write.**

**Read that confirmation from the `blockedBy`/`blocking` connections, never
`issueDependenciesSummary` — the summary lags the graph.** Measured, within a single
response: seconds after a `blocked_by` POST, `blockedBy.totalCount` read `1` while
`issueDependenciesSummary.blockedBy` in the same payload still read `0`.

**"No blockers" and "nobody checked" are the same empty list** — the second needs its
own marker:

```sh
gh label create deps-checked --color 0E8A16 --description "Dependencies verified — no open blocker"
colab readiness <N>           # set only after actually looking (raw: gh issue edit <N> --add-label deps-checked)
colab readiness <N> --clear   # on any new blocker, or on reopening
```

The label is *derived* state, only as fresh as its last check — whoever adds a blocker
removes it; prefer leaving it off to leaving it wrong. A prose note saying "checked, no
blockers" does not count.

##### Readiness is not a boolean — read the blocker's state, not just its existence

An open blocker used to end the question. That hides two different situations: nobody
has started it, versus its code is written and pushed, waiting only on a merge. So the
verdict has **three values**, plus the *unchecked* state above, which is not a kind of
ready:

| blocker state | verdict |
|---|---|
| no relationship data at all | **unchecked** — not ready |
| open, nobody has started it | **blocked** — name the blocker |
| open, code pushed and unmerged | **ready, with a note** |
| closed, or its work is already on trunk | **ready** |

**The middle value is computed at read time, never recorded as a second label** —
rejected: a second label (stale the moment the blocker moves, doubling `deps-checked`'s
own hazard); deleting the edge once code is written (destroys a true fact, doesn't
survive a revert).

**An active session on the blocker is not evidence — a pushed branch with real commits
is.** Measured: a session open ten minutes was already dead, having never claimed its
issue. An unpushed branch does not count either — invisible from other machines. **The
judgement fails toward `blocked`, never toward `ready`** — the mirror of the landed rule
([§4](#4-branches-and-commits)).

Reference implementation: `tools/lib/readiness.js` (`classify`, `isStartable`), pure —
facts in, verdict out — deriving "blocker's code written but unmerged" from
`tools/lib/landed.js` rather than re-counting commits.

##### Mechanical readiness — a weaker, honest claim for the empty case (#69)

`deps-checked` asserts *somebody looked* — stronger than "the encoded graph, read via
the API, has zero edges", because a prose-only blocker is invisible to a mechanical read
and visible to a reader. **A mechanical check must never write `deps-checked` itself** —
that launders a weaker guarantee into a stronger one.

```sh
gh label create graph-empty --color BFDADC --description "Mechanical check: the recorded dependency graph reads empty — NOT a substitute for deps-checked"
colab readiness <N> --mechanical           # reads blockedBy; if empty, applies graph-empty + posts a receipt
colab readiness <N> --mechanical --clear
```

- **Re-derives its own evidence** on every run, rather than trusting a caller-supplied
  flag.
- **Posts a receipt** naming what was read and when.
- **`blockedBy` only** — says nothing about parent/child relations (*Epics*, below).
- `readiness.classify()` keeps `graphEmpty`/`depsChecked` as distinct type-level inputs;
  empty-but-unchecked reads a fourth verdict, `unchecked-mechanical` — `isStartable()`
  still says no by default.
- Not in the convention label set (§9), same reasoning as `tracking`.
- **No `readiness.marked` event fires for `--mechanical`** — that event kind's payload
  means `deps-checked` specifically (#45, #46); emitting it here would be
  indistinguishable from the stronger claim.

#### Design ruling — a human must approve the design first

A designer producing a spec decides, while producing it, whether a surface needs human
pre-approval before code starts, and marks the issue `needs-ruling` if so — the call
belongs to whoever is producing the spec, never inferred mechanically from title or
labels.

**`needs-ruling` blocks starting the issue** — a readiness gate exactly like an open hard
blocker or a live claim — until a human reviews the artifact and removes the label. No
session, manual or scheduled, starts an issue that still carries it.

**A session discovering a significant design decision mid-work continues on the
designer's spec** rather than stopping to request a ruling, and records
`design-not-preapproved` in its ship evidence — so the closure itself is what a human
reviews, after the fact.

#### Migration exemption — a narrow, human-created door through no-new-migrations (#98)

`colab ship` refuses, by default with no flag/env/field to lower the bar, any branch
touching `database/migrations/` or `prisma/migrations/`.

**A migration grant is a narrow, per-issue, branch-bound, human-only, expiring
exemption** — deliberately not a repo- or tier-level switch.

- **Human-only to create.** `colab migration-grant` refuses (exit 1) unless
  `COLAB_HUMAN=1`, checked before any network call — no agent may create or infer one.
- **Two required parts**: a `migration-granted` label (requires write/triage permission)
  and a comment naming the exact branch (labels cap at 50 chars, cannot carry a branch
  name). Never authorises a migration arriving on a different branch later.
- **Expires the instant its issue closes** — `ship` reads the issue's live open/closed
  state, never a separate expiry.
- Visible from any machine — no local-only fallback.
- **Covers the whole ship set**, never narrowed by `--refs`.
- `--revoke` removes the label first (gate restored immediately), then posts a receipt.
  `colab migration-grant --list` names every live grant.
- **Never weakens any other precondition** — CI green, claim corroboration, trunk-checkout
  check, and hand-merge conflict check all still run in full on a granted branch.

#### Red-trunk exemption — the one-shot door through trunk-CI-green (#105)

Same shape as a migration grant, strictly **more dangerous** — a bad migration grant
merges one reviewed schema change; a bad CI grant merges into a repo whose own test suite
is known-failing.

- **Human-only, identical bar** (`COLAB_HUMAN=1`).
- **Bound to one issue, the branch, AND the exact red trunk sha reviewed against** — it
  expires the instant trunk's head moves, for any reason.
- **Evidence is measured, never asserted** — creating one requires a completed,
  successful CI run for the branch's own current head sha; `--evidence-run` is
  recording-only and never substitutes for the measured run.
- **Never stacks** — refuses against a green trunk, and refuses again if a prior grant
  already merged something and trunk has been red continuously since.
- A grant-authorised merge carries a `CI-Grant:` trailer in the squash commit itself, in
  addition to the tracker comment.
- **Scoped to exactly one precondition** (trunk-CI-green) — never exempts no-new-
  migrations, claim corroboration, the trunk-checkout check, the hand-merge conflict
  preview, or `colab promote`. **Trunk-only** — an integration line's red already
  borrows trunk's advisory verdict when the line has no runs of its own; widening the
  exemption to lines is a deliberately unmade decision.

#### Scheduled drivers — provenance and autonomy meet a caller that is not a person

A **scheduled driver** — a per-repo autopilot waking on a cadence, shipping finished
branches, triaging the backlog, starting sessions for ready groups — breaks the
assumption that the caller is a person or an agent a person is watching. Nothing above
stops applying; this is what a scheduler must additionally honour.

**It inherits the provenance gate, re-applied on every tick, not filtered once:**

- `agent-filed` issues are excluded from what a scheduler starts, every run.
- `epic`-labelled issues are excluded — an epic can pass provenance cleanly and still not
  be a pick-up-and-code task.
- `needs-ruling` issues are excluded, for a third distinct reason: no human has approved
  the design, even if the work item itself is human-filed, unblocked, and a genuine leaf
  task.
- **The only admission is a human act on the issue itself, removing the label** — a
  scheduler may never infer approval from content, age, or repeat proposal.
- An `agent-filed` issue whose `Ask:` reads `ruling` or `permission` is excluded, for the
  same reason `needs-ruling` is.

**A scheduler starts work only by spawning ordinary sessions** (`code-triage` →
`code-start` → work → `code-wrap` → where granted, `code-ship`) — it may not claim,
label, comment, or merge directly.

**It may complete a trunk merge only where the repo has granted `autonomy: auto-trunk`,
and only through `colab ship`**, subject to the identical gates as any other caller (CI
green or valid CI grant, no new migrations or valid migration grant, no hand-merge
conflict, no `--force`). Without the grant, `ship` refuses and a human runs Phase B.

**A genuinely red trunk with no valid CI grant is human-gated, not self-clearing** — a
scheduler must not queue and wait on it; it parks, states it once, and stops.

**Never promotes and never tags, on any repo, on any tier**, with no field able to say
otherwise.

A scheduler must tell a **self-clearing** blocker (temporarily red CI, a billing outage,
a regenerable merge conflict) apart from a **human-gated** one (no `auto-trunk` grant, an
unresolved new migration, an `agent-filed` label still on, a claim held by someone else).
For a human-gated blocker it states it once and parks — never re-announcing the same
unmet gate every cycle. A migration grant is the one human-gated blocker a driver may
watch for clearing without a person acting again mid-cycle — the grant itself is still
only ever created by a human.

#### Grouping — issues that must share one branch

**Issues that touch the same files must move on one branch** — the group is a
collision-prevention mechanism, not a tidiness preference. Measured: a real triage run
concluded two issues MUST share a branch, printed the `file:line` collision, and had
nowhere to record it outside the terminal.

**Neither existing mechanism has the right shape:** sub-issues are hierarchical (asserts
a false parent); mutual blocked-by would mean the readiness gate never reports either
member ready. A group needs a symmetric, flat relationship.

```sh
KEY=import-fixes    # the branch slug WITHOUT the numbers: fix/import-fixes-115-114-113
gh label create "group:$KEY" --color 5319E7 \
  --description "Must share one branch — these issues touch the same files"
for N in 115 114 113; do gh issue edit "$N" --add-label "group:$KEY"; done
gh issue list --label "group:$KEY"                 # the members, from any machine
```

The key is the branch slug minus its trailing numbers. Each member also gets a comment
with machine-readable lines — re-quoted from the current tree, since refs rot:

```
Group: import-fixes — #115 #114 #113
Because: app/Import/Parser.php:88 — #115 and #114 both rewrite the delimiter branch
```

**Three states:** on two-or-more open issues = **grouped** (start together or not at
all); on exactly one open issue = **spent** (remove it); absent = **ungrouped or nobody
triaged** — never evidence the ground is clear. Whoever breaks a group removes the label
from the members it no longer covers.

`code-triage` writes the label; `code-start` reads it before branching. **`colab ship`'s
B4 tears down the label OBJECT (not just an issue's use of it) once every member is
closed** (#82) — one fleet repo accumulated ~12 stale `group:*` labels before this
existed. Deletion removes it from future queries only — never touches closed issues'
own timelines or the durable `Because:` comment. Only `group:*` labels are ever in scope
— never the operational set (`in-progress`, `deps-checked`, `agent-filed`, `epic`).

#### Scope — diagnosing across repos is not license to act in them

**Reading and diagnosing across repos to find a root cause is expected.** **Acting in
another repo** (branching, committing, pushing, rebasing/force-pushing an existing
branch, merging) **requires that repo's own claim and its own explicit go-ahead**, scoped
to that repo — even when the diagnosing session is confident it found the real fix.
Measured: a session traced a downstream issue to an existing branch in an upstream tool
repo, then rebased and force-pushed it with no claim and no go-ahead scoped to that repo
— caught and reverted before merging. The correct move: report the finding and stop.

#### Epics — a container is not a start candidate

**The `epic` label marks a container for sub-issues — informative, never a start
candidate, never claimed as a unit of work** — even when it passes readiness and
provenance cleanly. Secondary signals (`epic(` title prefix, `subIssuesSummary.total > 0`)
corroborate but never substitute for the label. `epic` lives in the provisioned
convention label set (unlike `tracking`) because an unattended driver's decision depends
on it. An epic still gets closed and referenced exactly as any other issue once its
children finish — the label only prevents a driver from mistaking the map for the
territory.

#### Delivery type — route, not start (#112)

**Four labels — `delivery:code`, `delivery:content`, `delivery:ops`,
`delivery:docs-only`** — name whether finishing an issue produces a code commit at all.
**Three-valued, not boolean:** no label = not asked (behaves as before); `delivery:code`
= ordinary pipeline; the other three = non-code, route, do not start. **"Not asked" must
never collapse into "non-code"** — every issue is unlabelled the day this set is adopted,
and reading absence as non-code would freeze every scheduled driver on day one.

`content`/`ops`/`docs-only` gate exactly like `needs-ruling` — not a start candidate for
anyone. A session landing on one distills the finding onto the issue and ends the
session. Whoever files or triages sets the label — no mechanical rule infers it from a
title or body. `delivery:*` is in the provisioned label set because every adopting repo
needs all four values before the first triage pass can classify anything.

### How a decision is recorded

#### Planning — a plan file that outlives one command, and who drafts it (#94)

Coordinator (triage/grading) and implementer (coding) sessions often run at different
model tiers, and until #94 nothing carried the coordinator's read of the work across
that seam.

**The plan is a repo-local scratch file, not an Issue comment** —
`.claude/plans/issue-<N>.md`, in the **main checkout, outside any worktree** (exists
before the worktree, survives its teardown). Git-excluded, **never committed**. Anything
worth keeping past the session moves to the Issue at wrap.

**Resolved via an absolute path, never bare relative (#113)** — a bare path from inside
a worktree silently resolves to the worktree's own copy:

```sh
MAIN_REPO="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
PLAN="$MAIN_REPO/.claude/plans/issue-<N>.md"
```

**Three rungs, the middle the default:**

| Rung | When | Content |
|---|---|---|
| 0 — none | trivial/mechanical, oracle self-evident | nothing |
| **1 — plan-lite (DEFAULT)** | every other session | 3-5 lines at session start: intent · files · oracle · stop condition |
| 2 — full plan | `needs-plan` set, or a mid-session trigger (ambiguous ask, no repo precedent, long dependency chain) | drafted by [`code-plan`](skills/code-plan/SKILL.md) into the same file |

**Failing to state rung 1's oracle in one line is itself the signal to stop and ask on the
Issue** — never guess, never silently drop to rung 0.

`code-triage` may flag a hard group `needs-plan` with a one-line reason — a
**cross-backlog judgement**, never a plan of its own (authoring at triage time produced
stale artifacts for groups not started soon). **The full plan is drafted at code-session
start**, inside the implementing session, by a stronger-model subagent seeded with the
Issue plus the reason line, against the repo as it is at coding time. A rung-1 stub may
still upgrade to rung 2 mid-session — the flag decides only the default.

**Read the `needs-plan` flag by direct issue fetch, never the Search API**, which can lag
by minutes. A plan is a sketch the code may overrule, not a contract — note deviation
where the plan lives. `needs-plan` is provisioned on adoption and back-filled on sync,
like every other fixed convention label.

#### Writing a conclusion down — the decision and the document are two units

A session can produce nothing but a conclusion — prose, and the natural next move is to
write it into the docs tree, where other sessions are also merging. **It reaches trunk as
two units, in order.**

**Step 1 — the conclusion goes on an Issue immediately, before any file is touched.** No
branch, worktree, or clean tree needed; it collides with nobody and is readable the
instant it is posted — and it is the part that must survive.

**Step 2 — the write is its own coding unit**: own Issue, claim, branch off trunk in a
worktree, wrapped normally. A conclusion worth documenting is the *most* consequential
kind of doc change, not a typo exempt from ceremony.

**The collision unit is the file (the hunk), never the folder** — two sessions each
adding a new file under one tree cannot conflict:

```sh
colab holders <path>          # fetches first; refuses to say "clean" if it could not
```

Empty output (or a nonexistent path) is clean ground; non-empty is a file-level group —
same branch, or sequence after theirs lands. `colab holders` filters every ref that ever
touched `<path>` through the same content classification `colab landed` uses, so a
branch whose edit already shipped (squash-merged, or landed with the base moved on
since) does not read as live contention — the raw `git log --all --not origin/<trunk>
--source` sweep it replaces cannot tell the two apart, and a busy repo pays for that
with false positives on every file. `unknown` still means *look*, never *assume clear*.

**It fetches before it enumerates, and that is part of the check, not a convenience.**
The enumeration reads *local* refs, so a branch another session pushed and this clone
never fetched is invisible — and "clean ground" off that is a confident verdict built on
missing data, which is the one wrong answer that sends a second session onto a held file.
`--no-fetch` (offline, or a pinned view) therefore still reports holders it *can* see —
refs you have not fetched cannot un-hold a file — but **refuses** the clean verdict with
exit 2 instead of printing it.

No `colab` installed: `git fetch --prune origin` **first**, then `git log --all --not
origin/<trunk> --source --format='%S' -- <path> | sort -u` — the fetch is not optional
there either, and every ref it lists is a candidate, not a verdict; check each by hand.

**Never write the final artifact in the main checkout** — a throwaway draft in a
git-ignored scratch directory is fine; the committed version belongs on a branch, in a
worktree. **Two doc branches landing in
the same window are wrapped one at a time**, each re-checked against the trunk the other
just moved. **A branch that never touched a given line still carries that line as diff
context** — taking its side of a prose conflict wholesale can silently revert the other
session's edit while looking clean; read the region and resolve as a union when the
edits are non-contradictory. Measured: on two adjacent edits to one paragraph, the
correct resolution was their union, not either side.

##### Design conclusions are three units, not two

A design ruling needs one more part: an **immutable visual record**.

1. **The ruling** — on the Issue immediately, exactly as Step 1: chosen option, why, what
   was rejected. This is what clears `needs-ruling`.
2. **The artifact** — a repo file under `docs/design/`, named `<slug>-<N>-mockup.html` or
   `<slug>-<N>-spec.md`, landing via a claimed docs branch. **Superseded artifacts are
   marked, never deleted** — trunk carries the design lineage.
3. **The frozen evidence** — a screenshot of the approved option attached to the ruling
   comment, immutable where the repo file is not. Rejected alternatives need never land
   on trunk — their screenshot on the Issue is the whole record.

The index of what lives under `docs/design/` belongs in that directory itself — never
accreted into `CLAUDE.md`, which gets one pointer row.

##### Design exploration files its Issue first — before the first mockup, not after

**The Issue number must exist before the first mockup is drawn**, not retrofitted once
one is approved — filing is cheaper than a single mockup iteration, and it is what makes
`<slug>-<N>-mockup.html` naming possible at all.

A small feature continues on the same design Issue through implementation; a large one
turns the design Issue into the `epic` parent, with implementation sub-issues arriving
with their own sessions.

`ceremony: light` repos are exempt from the file ceremony — a mockup lives as a preview
link in conversation, and units 1 and 3 collapse into one screenshot-bearing Issue
comment.

---

## 6. Releases

Tiers A and C — the two tiers that have production. The sequence differs by exactly one
step, the tag.

**Tier A.** A release is: **merge `dev` → `main`, then tag.**

```sh
git checkout main && git merge --no-ff dev && git push
git tag v1.2.0 && git push origin v1.2.0     # ← this is what deploys
```

Pushing the tag is the deploy trigger; pushing `main` only runs the full test suite.

**Single-trunk (tag-gated) Tier A** has no promotion — work already lives on `main`. A
release is just: **tag `main`.** Where the deploy is an external GitOps poller, tagging
is what the release script keys off — it fast-forwards the watched release branch.

**Tier C.** A release is: **merge `dev` → `main`. That is the deploy.**

```sh
git checkout main && git merge --no-ff dev && git push   # ← this is what deploys
```

Same `--no-ff`, never squash, for the same reason: the merge commit records what shipped
and when. No tag step, no "ship it later" — treat the promotion with the seriousness
Tier A gives the tag. Tagging on C is optional and harmless; wanting tags consistently is
the signal the repo has earned Tier A.

On a `deploy: manual` repo the sequence is the same, the last step performed by a person:
promote, tag, then run the runbook — promotion there always requires a human, and
`promotion: main-loop` cannot say otherwise.

**The permission ladder, one rung per boundary:** **ship** (branch→trunk, gated by
`autonomy:`) · **promote** (trunk→main, gated by `deploy:`+`promotion:` — safe to
automate only where deploy is tag-gated) · **release** (the tag — always a human act, on
every repo, with no field able to say otherwise). The `pre-push-guard` hook enforces the
first two mechanically; `COLAB_SHIP` never opens `main`.

**On Tier C the ladder has two rungs, not three, and the second is the deploy** —
promotion there always requires `COLAB_HUMAN=1`; `promotion: main-loop` applies only
where `deploy: tag` makes promotion verification-only, so it can never apply to C.

**Versioning** — SemVer. Patch for fixes, minor for features, major for breaking changes.
Pre-1.0 repos use `v0.x.y`, treating minor as "meaningful increment".

**Every tag gets a release summary** — a published GitHub Release grouping commits since
the previous tag by Conventional-Commit type; `CHANGELOG.md` is not maintained by hand.
[`templates/release-tag.yml`](templates/release-tag.yml) automates it. Manual fallback
when the workflow cannot run:

```sh
colab release-notes v1.1.0..v1.2.0 | gh release create v1.2.0 --notes-file - --generate-notes
```

**Merged is not released — measure the gap, don't wait to notice it by eye.**
`colab release-status [--repo P] [--json]` (#81) reports commits on `dev` not yet
promoted, commits on `main` past the last `v*` tag (plus days since), and flags whichever
gap holds a `fix:`-typed or breaking commit. Its suggested SemVer bump is advisory only.
Measured against `main`, never `dev` — `git describe` from a `dev` checkout answers a
stale question.

Do not tag from `dev`. Do not tag a commit that has not passed the full suite on `main`.

---

## 7. CI and toolchain

**Your CI lives in your repo and belongs to you.** [`templates/`](templates/) ships
copyable starting points — nothing is called remotely, nothing is mandatory.

The required **outcome**: every pull request must run, at minimum, a **secret scan** and
a **build** — a committed credential is the one failure that cannot be undone by
reverting.

**CI must trigger on pushes to the trunk itself**, not only on branches the trunk no
longer is. Measured: three repos whose trunks had moved to `dev` while CI still fired
only on `[main, master]` — every trunk merge ran zero checks, silently. When a repo's
trunk moves, updating the CI triggers is part of the move, and the audit checks it.

### Toolchain versions — strict precedence

**Never hardcode a version in CI.** Resolve it, in this order:

1. **`.github/project.yml`** toolchain keys, if present — wins.
2. **The ecosystem's own manifest** (`.nvmrc`/`engines.node`; `composer.json`;
   `.python-version`/`requires-python`) — the normal answer.
3. **Fail the build.** Never fall back to a default.

Measured: a silent default is how one repo built on Node 20 while deploying on Node 22,
undetected for months. When project.yml's pin and the manifest disagree, that is a
finding to report, not resolve quietly.

**`requirements.txt` does not declare an interpreter** — pins dependencies only; a Python
repo carrying only that file must add `python:` to `project.yml` or a `.python-version`.
Measured: a Python repo adopted the handbook, found no Python template, and copied the
Node one with `python-version: "3.13"` hardcoded in.

### Test fixtures — neutralise ambient machine state, don't inherit it

**A test asserting a specific message or refusal must neutralise ambient credentials and
configuration rather than inherit them.** This handbook installs a global
`core.hooksPath`; a fixture that `git init`s and `git commit`s without overriding it runs
the developer's real pre-commit hook inside a fake repo. Measured twice, in the identical
shape (ambient `gh` credentials, then `core.hooksPath`). A git fixture helper sets
`user.email`, `user.name`, **and** `core.hooksPath` (pointed at a nonexistent directory)
before it ever commits.

---

## 8. Conformance and reconciliation

Because branch protection is unavailable, conformance is checked **from outside** by the
[`audit/`](audit/) tool, across every owner including local-only repos:

```
example-org/service-api          tier A   ⚠ node: engines=22 but ci.yml pins 20
example-org/mobile-app           tier B   ⚠ missing .github/project.yml
```

Run it on a schedule; only genuine findings fail the exit code.

### How repos find out when the handbook changes

The handbook is git-tagged `vX.Y.Z` (its current version is
`git describe --tags --abbrev=0`; before the first tag it is treated as `v0` and stamp
checks stay inactive). Templates are **copy-and-own**, never called remotely. Every copy
is **stamped** with the handbook version it came from:

- Workflow copies: `# colab-handbook: <template> @ <version>`.
- The CLAUDE conventions block: `<!-- colab-handbook @ <version> -->`.
- **`colab template <name>`** copies and stamps in one act, refusing to overwrite without
  `--force`.

The audit compares each stamp against the handbook's git history: a template **changed
since the stamped version** is a finding; an unstamped copy, unknown template, or a
stamp newer than the handbook is advisory. Reconcile deliberately: read the diff,
`colab template <name> --force`, commit.

`colab update` classifies every stamped copy and, with `--apply`, refreshes only those
still pristine as of their own stamp — never commits, never rewrites a hand-edited copy.

- **A stamp older than current is not "behind"** — behind means the template *actually
  changed* since that stamp (`git log <stamp>..HEAD` scoped to the template's path).
- **The frozen CLI copy is measured against the latest tag, not `HEAD`** — measured
  against `HEAD` it reported "behind" for every unreleased CLI commit and advised
  adopting untagged code.
- **An unstamped copy is never rewritten** by any flag — unknown lineage, human re-copies
  deliberately.
- **Provenance is decided by content, never filename** — a file merely sharing a
  template's name is reported `unrelated`, explicitly not something to re-copy.

### Labels reconcile too — not just stamped files

An adopted repo missing any convention label is a finding — provided the audit can read
the label set at all; a remote-less or offline audit stays silent rather than claim a
label is missing it simply could not see. Label-set provisioning is idempotent
(`|| true`) and safe to re-run on every sync — the mechanism by which a label added in a
later handbook version reaches an earlier-adopted repo.

### The fleet registry is private

The list of repos the audit sweeps lives at `~/.colab/repos.txt`, machine-local, never
committed, because this handbook repo is public. The committed
[`audit/repos.txt`](audit/repos.txt) is a neutral format example and last-resort fallback
only. Resolution order: `--config` flag > `~/.colab/repos.txt` > bundled example.

---

## 9. Adopting this

### Any repo, first-time adoption

1. **Determine the tier** — does a deploy target exist *today* ([§2](#2-tiers))? No →
   Tier B. Yes → does a tag gate production (A), or does the promotion itself deploy (C)?
2. **Write `.github/project.yml`** ([§3](#3-githubprojectyml--the-marker)).
3. **Create the whole label set — twelve names, not a subset** (`in-progress`,
   `deps-checked`, `agent-filed`, `epic`, `needs-ruling`, `needs-plan`,
   `migration-granted`, `ci-granted`, and the four `delivery:*`), each idempotent
   (`|| true`) because partial adoption is normal:
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
   What each absence costs, briefly: `in-progress` — the first claim cannot land.
   `deps-checked` — a readiness check can never tell *free* from *nobody looked*.
   `agent-filed` — every agent-filed issue reports as human-approved. `epic` — an epic
   passes every readiness gate and reads as a normal start candidate. `needs-ruling` — the
   design-approval gate cannot be applied at all. `needs-plan` — `code-start` always sees
   "no flag", every session falls back to rung 1. `migration-granted`/`ci-granted` are
   **not opt-in** (unlike `tracking`) — absence fails malignantly, discovered only when a
   repo hits the wall with no route past `ship`'s gate at all. `delivery:*` — a content
   push or ops check has no way to say "not a diff" and jams the code pipeline. This full
   set is provisioned again on every sync, not only at adoption.
4. **Add the tier topic** — `gh repo edit <owner>/<repo> --add-topic tier-b` (or
   `tier-c`/`tier-a`).
5. **Add the handbook pointer to `CLAUDE.md`** — copy
   [`templates/repo-CLAUDE-block.md`](templates/repo-CLAUDE-block.md); create the file if
   none exists. **Do not skip this** — it is the only reason a future agent discovers
   these conventions.
6. **Make sure CI meets [§7](#7-ci-and-toolchain)'s outcome** — copy a template via
   `colab template <name>`, which stamps for reconciliation.
7. **Register the repo** — `colab register`, updating both the audit fleet list and the
   reserved-ports aggregation. Unregistered = invisible to the fleet audit.
8. **Leave existing branches alone** — grandfathered.
9. **Do not create `dev`** unless the repo is genuinely Tier A or Tier C.

### Going live: Tier B → Tier C or Tier A

Do this **on the day a deploy target exists** — not before.

1. **Write down the path to production** — for C, the deploy workflow triggered by a push
   to `main`; for A, the workflow triggered by a tag, or the runbook for a hand-deployed
   repo. One of these must be committed before proceeding.
2. `git checkout -b dev main && git push -u origin dev`
3. Set the repo's default branch to `dev`.
4. **Add `dev` to every CI workflow's trigger branches** — CI that still gates only
   `main` runs zero checks on your actual work.
5. Update `project.yml`: **C** — `tier: C`, `trunk: dev`, real `production:`,
   `deploy: push-main`. **A** — `tier: A`, `trunk: dev`, real `production:`, and
   `deploy: tag` or `deploy: manual` + `runbook:` — never `push-main`. *Tag-gated
   single-trunk variant:* keep `trunk: main` and skip steps 2–3 entirely.
6. Swap the topic to `tier-c`/`tier-a`; update the internal project table.
7. **Tier A only:** tag the first release (on `manual`, tags are still worth cutting).
   Tier C has nothing to tag — the promotion itself is the release.

Step 1 comes first because `main` only becomes meaningful once something consumes it —
what must not exist is a `main` that nothing and nobody reads.

### Tier C → Tier A — when the site earns a release ritual

Do this when you find yourself *wanting* to name what shipped — not before, since an
unused tag ritual decays exactly like an unused branch.

1. **Retrigger the deploy workflow on a tag** instead of a `main` push — the whole
   change; until it lands, the tier claim would be false.
2. Update `project.yml`: `tier: A`, `deploy: tag`. `trunk` stays `dev`.
3. Swap the topic to `tier-a`.
4. Tag the current `main`, so the first tagged release names what is already live.

The reverse — **A → C**, the fix when a repo declares `tier: A` with `deploy: push-main`
— is descriptor-only: set `tier: C`, leave the pipeline exactly as it is, swap the topic.

---

## 10. Anti-patterns

Each of these is something we have actually done.

**A release branch nobody consumes.** A repo adopted `dev` as default but nothing ever
deployed from `main` — it sat 76 commits behind for months, while a sibling `staging`
branch was abandoned after a week. *A branch with no pipeline hanging off it decays into
noise.* Why Tier B is the default, and going-live step 1 is "add the deploy workflow".

**The same fix opened four times.** With `dev`, `staging`, and `main` all live, one
timezone fix required four near-identical PRs. *Three tiers without automated promotion
is a tax on every hotfix.* We use two, deliberately.

**A deploy mechanism nobody used.** A workflow triggers on tag push; it has zero tags —
every deploy was manual dispatch. *Copy-pasted CI encodes intentions nobody adopted.*

**A merge that ships itself — while claiming otherwise.** Two live repos deploy on every
`main` push and declare Tier A, whose contract says a release artifact gates production.
*The mechanism is fine; claiming a gate you do not have is not.* Now a finding.

**Docs describing a repo that doesn't exist.** Our most heavily documented repo
prescribed trunk `main` (actual default `master`), "rebase, never squash" (every commit a
squash), CI gating on `dev` (workflow skips CI there by design). *An aspirational doc is
worse than no doc — people trust it.*

**Stale branch references in CI.** A repo still gated on `develop`, `master`, and
`workos` — none of which exist. *Config drifts silently when copied rather than
referenced.*

**A conclusion that only ever existed in chat.** A session settled a batch of rules and
went straight to implementing them — three branches, zero Issues, no issue numbers in
branch names, no `Closes #N` possible. The code landed; the argument behind it was lost.
*Work only agreed to in a room is undocumented the moment the room closes.* Why the
decision goes on an Issue before any file is touched ([§5](#5-claiming-work--how-to-say-im-on-this)).

**A silent version default.** Covered in [§7](#7-ci-and-toolchain) — worth repeating: the
bug was invisible because CI was green the whole time.

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
# fetches first, filters spent branches out via `landed`, and REFUSES (exit 2) to answer
# "clean ground" if it could not fetch — an empty result off stale refs is a wrong answer
colab holders <path>

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
