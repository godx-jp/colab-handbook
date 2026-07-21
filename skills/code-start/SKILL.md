---
name: code-start
description: "Open a coding session the cheap way: learn the repo's tier/trunk from .github/project.yml, load the feature's context from its GitHub Issue instead of re-reading the codebase, claim the issue so parallel sessions don't collide, then branch off trunk in a worktree — the main checkout stays on trunk at rest, because dev servers, symlinks and LaunchAgents read that working tree and none of them know you branched it. Trigger phrases: 'start coding', 'start a session', 'open a coding session', 'begin work on issue', 'pick up issue', 'claim an issue', 'new worktree', 'set up a session'. Pairs with code-wrap at the end of the session."
---

# code-start — open a session: read marker → load Issue → claim → branch

The goal is to spend as little context as possible. The Issue is the feature's
external memory: one `gh issue view` reloads the plan and hard-won knowledge, so
you never re-read the whole codebase. Claim before you start so two sessions
never grab the same work. Close the session with **code-wrap**.

Notation: `$N` = the feature's Issue number (keep it for the whole session).
`<trunk>` = the branch sessions merge into (from `project.yml`, below).

## 0. Say who you are — the URL, above all

Skip this and every claim and worktree you create is **anonymous**: a dashboard row
with a branch and no owner. Someone finding a stale claim then knows it is stale but
not who to ask.

**The two fields are not equivalent, and the skill used to imply they were.**

| field | what it is | missing it costs |
|---|---|---|
| `--session-name` | **display text.** The column a human scans. | cosmetic — the row falls back to the URL tail: ugly, still reachable |
| `--session` (URL) | **the only join key.** A consumer resolves a worktree to a live session through it: `worktree.session` → its `session_…` tail → the session. | structural — the row can never be linked to anyone |

The name participates in **no join**. So a name with no URL is the worst of the three
states: it *reads* as owned and still traces to nobody. Set the URL first; the name is
a nicety on top of it. `colab` now warns when you supply a name alone.

Nothing infers identity from the name, and nothing should: a worktree once sat next to
a live session with a near-identical name and **was not it**. Absent identity renders
as "unknown" — never as a guess.

### Spawned by a dashboard? Part of your identity arrived with the prompt

A session may be opened by an operator clicking a button rather than by a human
typing. That spawn prompt has a fixed shape:

> Run /code-start for issue(s) #N in `<repo>`. Spawned from `<dashboard>` by
> `<operator>` at `<ts>` (intent `<id>`). Session name: `<name>`.

Read it as questions already answered: `#N` is your issue, and `<name>` is the
`--session-name` to pass through **verbatim** — do not invent a better one, and do
not ask which issue was meant. What the dashboard cannot know is your session URL,
so you still supply `--session` yourself, exactly as below.

The dashboard only spawns: it writes no claim, no label, no merge. Every `colab` and
`gh` call in this skill runs as it would for a human-opened session — one writer, and
it is you.

### Pass them as flags, not exports — if you are an agent

```sh
colab claim $N --worktree <name> \
  --session "https://claude.ai/code/session_…" \
  --session-name "import-fixes"          # short, human, about the WORK
```

- **An `export` does not survive between tool calls.** Each Bash call is its own shell,
  so `export COLAB_SESSION=…` in step 0 has evaporated by the time `colab worktree new`
  runs several steps later — silently producing the exact anonymous rows this step
  exists to prevent. Flags are the only thing that reliably sticks for an agent.
- **A human at one terminal may still export it once** (`export COLAB_SESSION=…`);
  resolution is flag > env > empty, so both paths work. The env route is for people
  with a persistent shell, not for agents.
- **Do this before step 3**, not inside step 4. Sessions that work directly on trunk
  still claim, and they deserve identity just as much as worktree sessions.
- **Name it after the work, not the branch.** The table already shows the branch;
  `import-fixes` or `payroll-hotfix` tells a human something new, `fix-import-115`
  does not.
- **Genuinely no session URL?** Then set the name alone and know what you have: a
  cosmetic label, not a traceable row. It is a degraded state, not an equal choice.
- **Got the URL later, or already created the worktree anonymous?**
  `colab worktree tag <name> --session <url> [--session-name <s>]` repairs the worktree
  *and* the claims hanging off it. No hand-editing of `~/.colab/state.json`.
- **No `colab` installed?** Nothing breaks — the fields simply do not exist, and
  claiming still works through `gh`.

## 1. Read the repo marker

```sh
cat .github/project.yml        # tier, trunk, production, deploy, stack, ports
```

- Note `trunk` — it is `main` (Tier B) or `dev` (Tier A). Branch off it in step 4.
- **File missing?** Treat the repo as **Tier B, trunk `main`**, say so in your
  report, and propose adding the file (`CONVENTIONS.md` §3). Do not invent a tier.
- Never create a branch literally named `trunk`; never create `dev` in a Tier B repo.
- **Note `integration:` if it is there.** It lists long-lived lines the team keeps
  (work for a release weeks out). Your base is still **trunk** unless the task says
  otherwise — but if the work belongs to such a line, that is a decision to take
  now, at step 4, because the base is what the session ships back into. Never cut
  from a branch that is not trunk and not declared there.

## 2. Load context from the feature's Issue — don't re-read the code

```sh
gh issue list --search "<slug>" --state all     # find the feature's Issue — all, not open
gh issue view $N                                 # goal + plan + knowledge
gh issue view $N --comments                      # prior-session log
```

- **`--state all`, never `--state open`** (`gh` defaults to open — you must pass
  it). code-wrap closes the Issue at merge via `Closes #N`, correctly. So the
  moment a feature ships its Issue goes invisible to an open-only lookup, this
  step falls through to "No Issue" below, and you open a **duplicate** while every
  decision and gotcha sits unread on the closed one — the precise loss the
  Issue-as-memory model exists to prevent, arriving from the other direction.
- **Match is CLOSED and the work continues** → read it *first*
  (`gh issue view <N> --comments`), then reopen it: `gh issue reopen <N>`.
  Never open a parallel Issue for a feature that already has one; two half-memories
  are worse than one, because neither reader knows the other exists.
- **Issue exists** → this is your whole context. Read only the paths it points
  to, plus the repo's `CLAUDE.md` if present. Do not sweep the codebase.
- **No Issue** → create one and put the plan in it (this is the memory the next
  session reloads):
  ```sh
  gh label create in-progress --color FBCA04 --description "Claimed by an active session" 2>/dev/null || true
  gh issue create --title "<type>: <feature>" --body-file <tmpfile>
  ```
  Body template:
  ```md
  ## Goal

  ## Plan (checklist)
  - [ ] …

  ## Decisions / Knowledge

  ## Gotchas
  ```
  Record the returned number as `$N`.
- **No GitHub remote?** Keep the same structure in a tracked file
  (`docs/sessions/<slug>.md`); code-wrap promotes it to an Issue if the repo goes
  to GitHub later. Everything below that says "Issue" means this file instead.

> **Open ≠ untouched.** An open Issue does not prove the work is undone — trackers
> drift behind trunk. Before you build, verify:
> ```sh
> git log --oneline --all --grep="#$N"          # already merged?
> grep -rl "<thing the issue describes>" <paths>  # already in the code?
> ```
> Already shipped → close it with evidence (sha + `file:line`), pick other work.
> Partly shipped → narrow the task to what's actually missing before starting.

### Two tiers of memory — know which one you're reading

Closing an Issue at wrap is only safe because the durable knowledge was never
supposed to live there alone:

- **Task / session Issue** — the log of *one unit of work*: this plan, this
  session's decisions, this branch's gotchas. code-wrap closes it at merge. It
  stays readable forever (hence `--state all`), but nobody browses closed issues.
  Knowledge left only here is not deleted; it is **buried**, which costs the same.
- **Epic / umbrella Issue, and the repo's `docs/`** — the durable tier. A domain
  map, an architecture decision, a gotcha that will bite again next quarter,
  anything true after this feature ships: it belongs here. This is what code-wrap's
  docs step exists to feed.

So when you land on an epic, **read its body and its checklist table — do not trust
its title.** An epic's title describes the ambition; its table describes what is
actually done, in progress, and untouched. They diverge, and the table is the one
that was maintained.

If this session learns something that outlives the feature, plan to put it in the
durable tier at wrap — not just in the session comment that closes with the issue.

## 3. Check claims, then claim before you start

**Source of truth is GitHub** (visible from any machine, to any person):

```sh
# check what's taken
colab claims          # if colab is installed …
gh issue list --label in-progress    # … else the raw command

# claim it (before starting, not when you open the PR)
colab claim $N        # if colab is installed …
gh issue edit $N --add-assignee @me --add-label in-progress    # … else raw
```

> **On the default path, do not run `colab claim` here.** `colab worktree new
> --issues $N` in step 4 claims as it creates, so claiming twice is a wasted step —
> and for a long time it was worse than wasted: the second command refused your own
> claim from the first. That is fixed, but one command is still the right shape.
> Run the bare `colab claim $N` above **only** when you are taking the plain-branch
> path, or when you want the issue held before you are ready to build anything.

- An unclaimed issue is fair game — someone may take it out from under you.
  Claim first.
- A branch may carry a group of issues; claim **every** issue in the group now
  (`colab claim 115 114 113`, or one `gh issue edit` each). Claiming the whole
  group is load-bearing at wrap, not bookkeeping — see step 4.

### A clean label does not mean clean ground

**No `in-progress` label no longer proves nobody has touched this issue.**
code-wrap's B3 releases the claim **unconditionally** — every issue the branch
carried, finished or not, worktree torn down or kept. That is deliberate: a
conditional release is one agents skip, a claim outlives the session it names, and
a kept-but-forgotten worktree would otherwise hold its issues forever with **no
health check able to flag it** (the worktree is alive, so the claim looks healthy).

The tradeoff is that the label stopped being a lock, so **this step carries the
compensating check.** Before you create a branch or a worktree, look for work that
already exists on that issue:

```sh
git fetch --prune origin                   # ← without this the check is blind (see below)
git branch -a --list '*<issue-number>*'    # a previous session's branch may still exist
colab worktrees                            # if colab is installed — is a worktree holding it?
```

- **`git fetch` first, always.** A stale clone cannot see a branch pushed from
  another machine, and the check then reports clean ground with total confidence —
  the one failure mode it exists to prevent. Verified: an unfetched clone lists
  nothing for a branch that demonstrably exists upstream.
- The glob is a substring match, so it **over-matches** — `'*23*'` also returns
  `feat/thing-230`. That is the right direction to be wrong in: you are eyeballing
  a short list, and a false positive costs a glance while a false negative costs a
  duplicate branch.
- Use `colab worktrees`, not `colab claims`, for this: B3 already released the
  claims, so a kept worktree shows up in the worktree list and **nowhere else**.
- **Found one → continue it, or ask.** Do not open a second branch on an issue
  that already has one; you will each merge over the other's work.

This check is the deliberate price of unconditional release, not an oversight in it.

## 4. Branch off the base — worktree by default

Name it per `CONVENTIONS.md` §4 — pattern, and the issue number(s) at the end.
**Always branch off `<trunk>`, never off another feature branch.**

**The base is a session fact — record it, do not leave it implied.** It is `<trunk>`
in the ordinary case, and a **declared** `integration:` line when the work belongs to
one (step 1). Nothing else is ever a base: a feature branch is one session's work in
flight, while a declared line is a published integration point the team maintains.

The base is also the branch's **merge target** — `colab ship` merges into what the
worktree records, never into trunk-by-default. That is one decision, not two: a branch
cut from a line and merged into trunk would carry the whole line in behind it, as a
single squash commit that reads like a small change. So state your base in the report,
and code-wrap will state which branch it merged into.

**Why the naming rule is load-bearing downstream** (what §4 doesn't say): code-wrap's
B1b harvests the issue set for the squash message from exactly two places — the
**branch name** and the **commit bodies** — cross-checked against the claim registry.
An issue that appears in neither the branch name nor your claims is one code-wrap
will never find. It gets no `Closes #N`, so it sits open indefinitely with its code
already merged — the failure §4 cites at 26/30 issues, reached by a different route.
Naming the branch correctly *now* is what makes the wrap correct later.

Mechanical detail for group branches: **the numbers must be at the end.** B1b anchors
extraction to the **trailing** digit group precisely because a naive sweep is wrong —
it reads `feat/oauth2-login-88` as issues 2 and 88. Put every number in one trailing
run (`fix/import-fixes-115-114-113`) and claim all of them in step 3; those are the
same set, and B1b treats a number in one but not the other as a finding to chase.

### The invariant: the main checkout is on trunk at rest

**Always. No exceptions.** Other things read that working tree — a dev server, a
symlink, a LaunchAgent — and none of them know you branched it.

Measured: a session branched a repo's main checkout to do a chore. That repo ran
always-on from it, so **the live app served unmerged feature-branch code** until a
human noticed by eye. The condition was documented here as "only if … a live trunk
dev server you must not disturb", and the agent still took the default — because a
conditional rule is one agents skip.

**Worktree — the default.** It honours the invariant by construction:

```sh
colab worktree new <type>/<slug>-$N --issues $N --ports 1 \
  --session "$SESSION_URL" --session-name "<label>"     # claims AND creates — one command
#   … add --base <line> ONLY for a line declared in project.yml `integration:`;
#   the base is recorded on the worktree and is what `colab ship` merges into.
# … else fall back to plain git (then claim by hand, step 3):
git worktree add -b <type>/<slug>-$N ../<slug>-$N origin/<trunk>
```

`--issues` does the claiming, which is why step 3 tells you not to claim separately on
this path. Pass **every** issue the branch will carry (`--issues 115,114,113`) — that
set and the branch name are the two places code-wrap's harvest reads.

**Repeat the identity flags here** (step 0): as an agent you cannot rely on an export
made in an earlier tool call, and this is the command whose row a dashboard shows.

**Plain branch — allowed, but only with a commitment.** Fine on a repo nothing reads
from and where a worktree is more setup than the work deserves. If you take it, you
own returning the checkout to trunk before you wrap; code-wrap verifies it.

```sh
git fetch origin <trunk>
git checkout -b <type>/<slug>-$N origin/<trunk>
```

**Verify before you start working**, whichever path you took:

```sh
git -C <repo-root> branch --show-current    # must print <trunk>
```

If that prints a feature branch, you are in the failure this rule exists to prevent —
stop and move the work to a worktree.

- Ports listed in any repo's `project.yml` `ports:` are **reserved** for that
  repo's trunk dev server — never reuse them for a worktree, even while the trunk
  server is down. `colab` enforces this; without it, pick a port by hand and check
  the reserved list first.
- **Machine-specific setup — DB clones, dependency symlinks, dev-server wiring —
  is NOT improvised here.** It belongs in the repo's `.colab/hooks/post-create`,
  which `colab worktree new` runs automatically. If the repo has no such hook,
  the worktree starts bare; set up only what you personally need and do not bake
  it into this flow. *(Machine-specific automation hooks in here: `.colab/hooks/`.)*

## 5. Report

- Issue URL (`gh issue view $N --json url -q .url`) or the notes-file path, and
  whether you **reopened** a closed Issue rather than creating one.
- The session name you set in step 0 — it is how a human matches your report to the
  row holding this work. Confirm it stuck: `colab worktrees` (or `colab claims`)
  should show it, not a `—`. A name showing with **no URL behind it** is a half-fix,
  not a pass: repair it with `colab worktree tag <name> --session <url>` and say so.
- Branch name, **the base it was cut from**, and the worktree path if you made one. Say
  the base even when it is trunk — "cut from trunk" and "nobody recorded a base" read
  identically otherwise, and only the first is a fact. If the step-3 check found an
  existing branch or worktree for this issue, say so and say what you did about it.
- What you loaded from the Issue and your plan (checklist groups, file split if
  fanning out to sub-agents).
- Remind: close the session with **code-wrap** to ship and distill knowledge back
  onto the Issue.
