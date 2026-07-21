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
> ([§8](#8-conformance)), and otherwise rests on habit.

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
| Trunk (where sessions merge) | `main` | `dev` | `dev` |
| Release branch | — | `main` (= what is live) | `main` |
| CI on trunk | fast | fast | fast |
| CI on `main` | — | full suite | full suite |
| Tags | optional | optional | required, `v*.*.*` |
| Deploy trigger | none | the `dev` → `main` promotion | tag push — or a human running the repo's runbook |

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
in Tier B, `dev` in Tiers A and C. When our internal docs say "merge về trunk" or "trunk
luôn sống", they mean the role. Read `project.yml` to learn which branch that is in a given
repo. Never create a branch literally named `trunk`.

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

---

## 3. `.github/project.yml` — the marker

Every repo commits this file. It is how a human or an agent learns the repo's state without
guessing, without an API call, and even when the repo has no GitHub remote at all.

```yaml
tier: B                  # A = live, tag deploys · C = live, promotion deploys · B = no production
trunk: main              # dev (tiers A, C) · main (tier B)
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

Mirror the tier as a GitHub **topic** (`tier-a` / `tier-b` / `tier-c`) so `gh repo list --topic tier-a`
gives a fleet-wide view. The file is the source of truth; the topic is for discovery.

Full field reference: [`project.schema.md`](project.schema.md).

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
- **Before merging to trunk, check that trunk's last CI run is green — and that it ran at
  all.** `gh run list --branch <trunk> -L 1` costs one command. Branch protection cannot do
  this for us; the habit must. We once merged for 12 straight hours into repos whose CI was
  silently dead (org billing lockout) — every run "failed" without starting, and nothing
  noticed.

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
```

**The two halves of this model do not share an API, and that is the trap.** Sub-issues are
GraphQL mutations keyed by **node** id (`I_kwDO…`); dependencies are REST endpoints keyed by
**database** id (an integer). There is no dependency mutation in GraphQL — the schema
exposes `blockedBy`, `blocking` and `issueDependenciesSummary` for *reading* only. Passing
a node id to the REST call, or an issue number to either, fails in ways that read like a
permissions problem. Verified against the live API, both directions, add and remove.

**"No blockers" and "nobody checked for blockers" are the same empty list**, so the second
needs a marker of its own. Absent relationship data means nobody has looked — it must never
be read as "ready":

```sh
gh label create deps-checked --color 0E8A16 --description "Dependencies verified — no open blocker"
gh issue edit <N> --add-label deps-checked        # set it only after actually looking
gh issue edit <N> --remove-label deps-checked     # on any new blocker, or on reopening
```

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
3. **Create the labels** — they will not exist yet:
   ```sh
   gh label create in-progress  --color FBCA04 --description "Claimed by an active session"
   gh label create deps-checked --color 0E8A16 --description "Dependencies verified — no open blocker"
   gh label create agent-filed  --color C5DEF5 --description "Filed by an agent on its own initiative — not human-approved"
   ```
   The second is optional-but-cheap: without it a readiness check can never tell *free*
   from *nobody looked*. The third must exist **before** any agent files an issue here,
   not after — absence of the label means *a human filed this*, so a repo where the label
   does not exist reports every agent-filed issue as human-approved
   ([§5](#5-claiming-work--how-to-say-im-on-this)).
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

**A silent version default.** Covered in [§7](#7-ci-and-toolchain). Worth repeating: the bug
was invisible because nothing looked wrong — CI was green the whole time.

---

## 11. Quick reference

```sh
# starting work
gh issue list --label in-progress                 # what's taken
gh issue list --label agent-filed                 # filed by an agent — no human approved it yet
gh issue edit N --add-assignee @me --add-label in-progress
git checkout -b feat/<slug>-N origin/<trunk>      # trunk = main (B) or dev (A)

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
