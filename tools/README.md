# colab

A tiny, portable CLI that lets **parallel coding sessions and agents on one machine** avoid
collisions. Three independent capabilities, each usable on its own:

1. **Issue claims** — so two sessions don't grab the same GitHub issue. Written to both local
   state (fast) and GitHub (`gh issue edit --add-assignee @me --add-label in-progress`), because
   GitHub is the cross-machine source of truth.
2. **Ports** — every dev server gets a unique port; a project's reserved trunk port is never handed
   to a worktree, even while that trunk server is down.
3. **Worktrees** — *optional* git worktrees, with machine-specific setup delegated to repo hooks.

Plain Node, **zero npm dependencies**. It shells out to `git` and `gh`. If `gh` is missing or a
repo has no remote, everything degrades to local-only and says so — it never hard-fails on that.

This generalizes three machine-specific scripts (`issues.active`, `ports.reserved`,
`worktree-new.sh`) so anyone, on any machine, in any repo, across any GitHub owner, can use them.

## Install

```sh
# symlink the entry point onto your PATH
ln -s /absolute/path/to/tools/colab ~/.local/bin/colab   # or /usr/local/bin
colab --help
```

Node >= 18. No build step, no `npm install`.

`../install.sh --tools` does this and one more thing: it also writes a **frozen copy** of the CLI
(`colab` + `lib/`) to `~/.colab/bin/`, stamped `# colab-handbook: colab-bin @ <version>`. The two
installs differ on purpose. A symlink resolves through the handbook's **working tree**, so it
follows whatever branch is checked out there — right for a human session, wrong for anything that
outlives one: an always-on service would change behaviour because of an unrelated checkout, keep
running, and report nothing. **Always-on services (launch agents, daemons, headless runners) call
`~/.colab/bin/colab`.** Re-freezing is deliberate — re-run `install.sh`; `colab update` reports the
copy when the CLI has moved on since its stamp, and `colab --version` names which install answered.

## Quick start

```sh
# tell colab which repos to aggregate reserved ports from (once per machine)
colab config add-repo /path/to/repoA
colab config add-repo /path/to/repoB

# claim a group of related issues onto one worktree/branch
colab claim 115 114 113 --worktree import-fixes-115-114-113 --branch fix/import-fixes-115-114-113

# or let `worktree new` do it all: create the worktree, allocate ports, claim the group
colab worktree new fix/import-fixes-115-114-113 --issues 115,114,113 --ports 1

# cut from a long-lived line instead of trunk (only one declared in project.yml `integration:`);
# the base is recorded, and `colab ship` merges back into IT, never into trunk
colab worktree new feat/checkout-rewrite-42 --issues 42 --base v2

# has this work already landed on its base? (correct across squash merges — "commits ahead" is not)
colab landed --all

# finish issues one at a time; siblings and the worktree survive
colab release 114

# tear the whole group down (releases all its claims, frees its ports)
colab worktree rm import-fixes-115-114-113

# heal drift (dead worktrees, orphan/stale claims, orphan ports)
colab doctor            # report
colab doctor --prune    # apply
```

Every command has real `--help`. Exit code is `0` on success, non-zero on failure, so scripts can
branch on it.

## Concepts

- **A worktree owns its ports.** Claims reference a worktree *by name*; they don't carry ports.
  This is why a group of issues shares one set of ports instead of duplicating them.
- **Claims are many-to-one with worktrees.** Multiple issues can be worked on one branch/worktree.
  Releasing one issue leaves the rest (and the worktree) alive. Removing the worktree releases the
  whole group.
- **Claiming and ports work without a worktree.** `colab claim 42` (a trunk claim) and
  `colab port alloc` are standalone.
- **A worktree owns its base, and the base is the merge target.** It is trunk unless
  `--base <line>` named a branch the repo declared in `project.yml` `integration:`. `ship`
  merges into the recorded base rather than resolving trunk afresh — base and target are one
  decision, because a branch cut from a long-lived line and merged into trunk would carry the
  whole line in with it inside a single squash commit. Shipping a declared line itself into
  trunk is refused in every configuration, `autonomy: auto-trunk` included.

## Claim lifecycle (enforced)

Claims are **enforced, not advisory**. `colab claim` and `colab worktree new --issues` go through
three gates; `colab release` and `colab worktree rm` close the loop.

### 1. Refusal — check-then-refuse, two layers

Before a claim is written, colab checks two layers and **refuses with exit 1** if either says the
issue is taken:

- **Local** (always): if the issue already has a live claim in `state.json` attached to a
  *different* worktree (or a trunk claim vs. a worktree claim), refuse and print the holder —
  worktree, branch, host, and the date since. Re-claiming onto the **same** worktree is idempotent
  and succeeds silently-OK (so re-running a command is safe).
- **GitHub** (when `gh` is authed and the repo has an `origin`): `gh issue view <n> --json
  assignees,labels`. If the `in-progress` label is present **and** the assignee set is non-empty
  **and** does not include your `gh api user` login, refuse and name the assignee. A failed/blank
  read is *skipped*, never treated as "free" (same rationale as `claims --sync` being add-only). If
  `gh` is unavailable the check is **local-only** and says so.

`--force` overrides **both** layers and prints exactly what it takes over
(`--force: taking over #7 from worktree "A" …`) — a takeover is always visible, never silent. Every
refusal ends by reminding you that stale claims from dead worktrees are freed by
`colab doctor --prune`, so a crashed session can never block an issue forever.

### 2. Claim comment — metadata on the Issue

On each successful claim (when `gh` is usable) colab posts **one** comment, in this **exact,
stable, machine-greppable** format (the refusal path and future dashboards parse it — do not reword):

```
🔒 Claimed — worktree `<name|->` · branch `<branch>` · host `<hostname>` · <ISO timestamp>
```

On `release` / `worktree rm` it posts `✅ Released` — **unless the issue is already CLOSED**, in
which case it stays silent (a `Closes #N` merge already ended the story). Comments are
**best-effort**: a failed comment warns but never fails the claim itself.

### 3. Tie-break — settling a true simultaneous race

GitHub has no atomic check-and-set on labels/assignees, so two sessions can both pass the refusal
gate in the same instant and both assign themselves. The claim comment is the substrate that breaks
the tie **deterministically**, so both racers independently reach the *same* verdict:

1. After posting our claim comment, re-read the issue's comments.
2. Compute the **live** claims: every `🔒 Claimed` comment **not** followed by a later `✅ Released`
   from the **same author**. Each carries `login`, `host` (parsed from the comment body), and the
   comment's authoritative GitHub `createdAt`.
3. Identify **ours** = the live claim whose `login` is our `gh` login **and** `host` is this machine.
4. If any **other** live claim (different `login` *or* different `host`) has an **earlier**
   `createdAt` than ours, **we lost**. Exact-timestamp ties break on the identity string
   `login@host` — the lexicographically smaller identity wins — so the verdict is fully
   deterministic even at equal timestamps.
5. On a loss we **yield automatically**: remove our local claim, post
   `✅ Released (yielded — earlier claim by <who> wins)`, and exit 1 telling the caller to pick
   another issue. We remove our GitHub `in-progress` label + `@me` assignee **only when the winner
   is a different GitHub user** — if the winner shares our login (another machine of ours), the
   label/assignee is a single shared marker the winner still needs, so we leave it and let the
   comment layer record the handover. (This is a deliberate refinement of "remove our label only if
   we added them": on GitHub the label/assignee is keyed by login, not by host, so it cannot be
   split between two machines of the same user.)

In `worktree new`, a lost issue is yielded the same way but the **worktree is kept** (its files may
already be set up) — reuse it for another issue or `colab worktree rm <name>`; the command exits 1.

### 4. What `doctor` does NOT do

`colab doctor --prune` heals **machine-local** drift only (dead worktrees, orphan/stale claims,
orphan ports, and merged-worktree sweeps). It deliberately **never posts GitHub comments** and never
edits GitHub — a cleanup cron may be pruning another person's dead session on a shared machine, and
it must not speak on their behalf on the Issue. A stale GitHub `in-progress` label is instead healed
by the `claims --sync --prune` reconcile path (which acts on *your own* assigned issues).

It also **never kills a process.** `doctor` reports **ghost ports** — something is LISTENING on a
port inside the allocation window that the registry considers free — and stops at reporting, by the
same rule `worktree rm` follows: only a cwd inside a known worktree proves ownership, and a ghost
port by definition has no registry entry to prove anything. Killing by port would, in exactly the
case the check exists for (a stale registry), kill an unrelated process legitimately holding it. So
it joins the two books, names the disagreement, and leaves the verdict to you.

A long-running service that legitimately lives in the window (an emulator, a local database) is not
drift; declare it in `extraReserved` and it stops reporting *and* stops being allocatable. A ghost
whose `cwd` no longer exists is the real orphan — that one wants killing.

It also **never deletes a git ref**. `doctor` lists branches whose content is already in trunk —
`git branch --merged` cannot find them after a squash — and stops there, even under `--prune`,
printing the commands instead. Declared `integration:` lines are excluded from that list: a
long-lived line contains nothing new until work is merged into it, which is exactly when
suggesting its deletion would be most destructive. Every other prune touches only colab's own state file; deleting refs
across every repo a shared machine happens to know about is categorically different.

Because `ship` **keeps** branches by default, that list is the primary cleanup path and is *expected
to be non-empty*: one branch lands on it per shipped session. It therefore prints **after** the
health verdict and is **not** counted as drift — `All healthy — nothing to prune.` and a list of
shipped branches together is the normal steady state, not a contradiction. Work through it when
convenient.

Two exclusions, both deliberate. Branches checked out in a worktree are skipped: a live session's
branch is not spent, and a freshly-cut empty branch is "contained" by construction. And a branch
whose work trunk has since **rewritten** will *conflict* against trunk rather than match it, so it
is omitted rather than reported — being wrong in that direction would mean telling someone unmerged
work was finished. **The list is honest, not exhaustive**; a periodic human sweep is still worth
doing. Issue #17's own cleanup hit exactly this case.

## Session identity (which conversation)

Every claim and worktree can record a **two-part Claude session identity**:

| field | source (precedence) | typical value |
|---|---|---|
| `session` (URL) | `--session <url>` **>** `COLAB_SESSION` env **>** absent | `https://claude.ai/code/session_…` |
| `sessionName` (label) | `--session-name <s>` **>** `COLAB_SESSION_NAME` env **>** absent | `colab-handbook`, `pilot-issue-30` |

Either, both, or neither may be set — never an error.

- Both fields are stored on worktree **and** claim entries; a claim made via `worktree new --issues`
  **inherits both** from the worktree. Standalone `colab claim` reads the same flags/envs.
- **Display precedence** (tables, refusal / takeover / tie-break / doctor holder lines): the friendly
  `sessionName` wins; else the URL compacted to its `session_…` tail; else `-`. `--json` always
  carries **both** fields raw.
- In the `worktrees` / `claims` tables a name with **no URL** behind it is suffixed `(!)`, with a
  legend under the table. Without that marker a half-identity row renders identically to a fully
  identified one — which is exactly how the state went unnoticed.
- **GitHub comments** (`🔒 Claimed`, `🚢 Shipped`) render the session tail by shape:
  - both → a markdown link ` · session [<name>](<url>)`
  - URL only → ` · session <url>` (the original form)
  - name only → ` · session <name>`
  - neither → **nothing** — the comment stays **byte-identical** to the no-identity format (parsers
    depend on this).
- The comment **parser** (tie-break / `liveClaimComments`) decodes all three shapes **plus** the
  legacy plain-URL form written before `sessionName` existed, so old comments keep parsing; the
  tie-break yield message shows the friendly form.

Why: `host` says which *machine* holds a claim; the session says which *conversation* — and a short
`sessionName` makes a table row readable at a glance while the URL stays one click away. When a claim
looks stale, that's the difference between "which laptop is this?" and jumping straight to the chat.

### The two fields are not equivalent

`sessionName` is **display text**. `session` is **the only join key**: a consumer resolves a worktree
to a live session through `worktree.session` → its `session_…` tail → the session. The name
participates in no join at all. So the failure is asymmetric:

| state | consequence |
|---|---|
| URL, no name | **cosmetic** — renders as `session_01Lz5rfq…`: ugly, still reachable |
| name, no URL | **structural** — reads as owned, traces to nobody. Worse than anonymous |
| neither | honestly anonymous |

Therefore `claim` and `worktree new` **warn** (never fail — some agents genuinely have no URL) when a
`sessionName` resolves non-empty while `session` resolves empty. The gap used to be silent at exactly
the moment it was cheapest to close.

**Identity is never inferred from the name.** A consumer tried by-name matching and reverted it: a
worktree named `console-views-30-31-32` sat beside a live session with a nearly identical name and
*was not it*. Absent identity renders as "unknown", never as a guess.

### Repairing an existing worktree — `worktree tag`

```sh
colab worktree tag import-fixes-115-114-113 --session "https://claude.ai/code/session_…"
colab worktree tag import-fixes-115-114-113 --session "<url>" --session-name "import-fixes"
```

- Writes the worktree record **and every claim attached to it**. Claims carry their own copies of
  both fields, and claims are what `colab doctor` reports on — a worktree-only repair would leave
  doctor still printing anonymous rows, looking like the fix failed. One command, both records.
- Only the fields you pass are overwritten; the other is left as-is.
- **No env fallback** (unlike `claim` / `worktree new`): a repair writes exactly what you type.
  Inheriting `COLAB_SESSION_NAME` from a shell that never had `COLAB_SESSION` is how the
  half-identity gets created in the first place.
- Already-posted `🔒 Claimed` comments are **not** rewritten — a comment is dated history, not
  current state. `~/.colab/state.json` is what tables and `doctor` read.

**Agents: pass `--session` / `--session-name` as flags, not exports.** Shell state does not persist
between tool calls, so an `export` made once evaporates before the later `worktree new` runs — which
silently produces the anonymous rows the export was meant to prevent. The env route is for a human
with a persistent shell.

## Worktree lifecycle (`status`)

A worktree entry carries a `status`, backfilled-on-read (older/absent → `running`):

```
  running ───────────────► merged ───────────────► (killed)
  created by              branch landed on trunk    teardown removes the
  worktree new / claim    AND no live claims        entry entirely — no
                          · ship sets it after B1   "killed" status is stored
                          · doctor auto-detects      (worktree rm, or doctor
                            & records on --prune       --prune sweeping a merged one)
```

- **running → merged** has two writers: (1) `colab ship` sets it right after B1 lands the squash on
  the target (so a `--keep-worktree` entry survives as `merged`); (2) `colab doctor` auto-detects — for
  a `running` worktree with **no live claims** whose branch has **landed on its base**, it records the
  flip on `--prune`. That question is one shared rule (`lib/landed.js`, also behind `colab landed`):
  merging the branch into its base yields the base's exact tree. It is correct for **squash merges** —
  an ancestry/rev-list test would miss every one of them — and stays correct when the base has moved
  on since. It is asked against the worktree's **recorded base**, so a session on a declared line is
  not judged against trunk. When it cannot tell — a base that rewrote the branch's work leaves a
  conflict and no content answer — the verdict is `unknown` and the worktree stays `running`.
- **Any live claim keeps a worktree `running`**, even if the current branch is already contained — a
  group with an unfinished sibling is not done.
- **merged → killed**: `colab doctor --prune` now **sweeps** merged worktrees still on disk (full
  teardown: pre-remove hook → `git worktree remove` → free ports → drop the entry, all local-only). It
  **refuses** a merged worktree with uncommitted **tracked** changes (reports it instead). `running`
  worktrees are **never** swept. Teardown removes the entry outright — "killed" is the absence of a
  record, not a stored status (per Boss: no need to save it). That absence is exactly what the
  optional local journal recovers, without adding a status to the schema: teardown emits a
  `worktree.removed` line carrying `livedMs` and the last `status`, so how long the worktree lived
  and whether it ever reached `merged` survive the record that is being deleted.

## Readiness (`lib/readiness.js`) — a pure classifier, plus one command that owns the marker

"Can this issue start right now?" has three answers, not two — `blocked`, `ready-with-a-note`,
`ready` — because an open blocker whose code is already written and pushed is not blocking in
practice; only the human merge gate stands between it and trunk. `CONVENTIONS.md` §5 (*Readiness*)
is the rule; `lib/readiness.js` is the executable form of it, and `code-triage` §5.1 is the manual
procedure that reaches the same verdicts by hand.

It is **pure** — blocker facts in, verdict out, no git and no network — so a consumer computing
"startable now" (a dashboard, a vendored copy) can feed it facts it gathered its own way. It takes
the "written but unmerged?" half from `lib/landed.js` rather than counting commits a second time,
and it fails toward `blocked` in the same way `landed` fails toward `cargo`: neither will give the
optimistic answer from facts it could not measure. The **classifier** deliberately has no command —
computing the verdict needs facts gathered by `gh` reads this CLI does not otherwise make. But the
one input a human supplies, the `deps-checked` marker meaning "I looked, no open blocker", **is**
now owned by a command: `colab readiness <N>` (and `--clear`). Owning the write in colab makes it
journaled like every other action, gives the label name a single source (`lib/labels.js`, shared
with the audit), and is the site the observer event will emit from once its kind is agreed with the
receiver. The marker lives on GitHub, so the command refuses when `gh` is unusable rather than write
a mark no other machine can see; there is no local-only fallback.

Evidence is a **pushed branch with real commits**. An active session on the blocker is not evidence
(intent, not code — one measured session was already dead ten minutes in, having never claimed its
issue), nor is an unpushed branch, nor an empty one.

## State & config files (machine-local)

Everything lives under `~/.colab/` (override the directory with the `COLAB_HOME` env var):
`state.json` (current truth), `config.json`, `state.lock`, and — only if you opt in — `journal.jsonl`
(history; see `journal` below). Writes to the first are atomic (temp file + `rename`) and guarded by
a `mkdir`-based lock (`state.lock`) so concurrent sessions don't lose writes; the journal is
append-only and never participates in that lock.

### `~/.colab/config.json`

```json
{
  "repos": ["/abs/path/repoA", "/abs/path/repoB"],
  "extraReserved": [8765],
  "reservedFiles": ["~/code/.claude/ports.reserved"],
  "claimTTLHours": 24,
  "portRange": "5200-5999",
  "worktreeSubdir": ".worktrees"
}
```

| key | meaning |
|---|---|
| `repos` | repo roots to scan for reserved ports (`.github/project.yml` → `ports:`). The current repo is always included automatically. |
| `extraReserved` | reserved ports for **non-repo** services (a preview server, etc.). |
| `reservedFiles` | machine-local files of reserved ports to aggregate — for ports of repos **not** registered with colab (e.g. a pre-handbook global `ports.reserved`). Each file is parsed leniently: whitespace-separated port numbers per line, `#` starts a comment, non-numeric tokens ignored. `~` is expanded. Manage with `colab config add-reserved-file <path>` / `rm-reserved-file <path>`. |
| `claimTTLHours` | `doctor` flags worktree-less claims older than this (default 24). |
| `portRange` | default search window for `port alloc` / `worktree new` (default `5200-5999`). |
| `worktreeSubdir` | where worktrees are created inside a repo (default `.worktrees` — gitignore it). |
| `notifyUrl` | **absent by default** — optional observer endpoint, see below. Unset means colab makes no network call of its own, ever. |
| `journal` | **absent by default** — set to `true` for a local append-only record of every state transition and invocation in `~/.colab/journal.jsonl`, see below. Unset means colab writes no journal file, ever. Unrelated to `notifyUrl`: local file vs. remote push. |

### `notifyUrl` — optional event push (off by default)

Set it and the five state-changing commands POST one small JSON event each, as they succeed:

```sh
colab config set notifyUrl http://127.0.0.1:9000/api/events
colab config set notifyUrl ""      # unset — same state on disk as never having set it
```

| command | event `kind` |
|---|---|
| `claim` | `claim.appeared` (one per issue actually kept — an issue lost to the tie-break was never yours) |
| `release`, and each claim released by `worktree rm` | `claim.released` |
| `worktree new` | `worktree.appeared` |
| `worktree rm` | `worktree.removed` |
| `ship` (after the push succeeds) | `worktree.state-changed` |

Body: `{kind, ts, repo?, issue?, worktree?, session?, payload?}`.

**This is a secondary signal and is designed to be undependable.** The observers it exists for
already discover every one of these facts by polling `state.json` on a timer; the push only sharpens
the timestamp from *within a tick* to *the second it happened*, and records which host acted. So:

- **No retry, no queue, no response read, no error surfaced.** A dropped event costs an observer one
  tick of latency and nothing else. Never build something that needs the event to arrive.
- **It cannot fail or slow the command.** Each event rides a detached child process, so the CLI's
  own exit does not wait on it — a receiver that hangs is invisible to you (the child gives up after
  200 ms). Every push happens *after* the command's real work has already succeeded.
- **`kind` comes from a fixed map, because receivers keep a closed vocabulary** and answer 400 to
  anything else. That refusal is correct: a record counted by kind gets quietly half-right answers
  the moment one fact has two names. Adding an action means agreeing a kind with the receiver first.
- **Order is carried by `ts`, not by arrival.** Events are emitted in a deliberate order (claims
  before the worktree that held them), but each child races the others; inverted arrival has been
  observed. Sort by `ts`.

Unset, none of this exists: `notify()` returns before it can resolve a host, and the test suite
asserts that no process is spawned for any action.

**Two senses of the word "journal", and they are not the same thing.** Whatever a `notifyUrl`
receiver keeps on its own side is *its* record: remote, someone else's, and possibly empty, since
delivery here is undependable by design. The `journal` key below is *local*: a file on this machine,
written directly, never sent anywhere, and complete whether or not any observer exists. When both
appear in one sentence, say **receiver-side** or **local journal**. They share no code, no
vocabulary of kinds, and no configuration.

### `journal` — optional local record (off by default)

`state.json` answers *what is true now* and only that: records are **deleted**, not retired. So the
one number worth having — how long something lived — is destroyed at the moment it becomes knowable,
because the record being deleted is the only thing still carrying `created`. Set `journal: true` and
colab appends one JSON object per line to `~/.colab/journal.jsonl` (`COLAB_HOME`-aware):

```sh
colab config set journal true
colab config set journal false     # removes the key; the existing file is left alone
```

| kind | when | notable fields |
|---|---|---|
| `colab.invoked` | every invocation, success or failure | `cmd`, `argv`, `exit`, `durationMs`, `repo`, `cwd`, `pid`, `error?` |
| `worktree.created` / `claim.created` / `port.allocated` | a record enters state | the record's own fields |
| `worktree.changed` / `claim.changed` | a field changes in place (e.g. `status` → `merged`, which is what dates a merge) | `changed: {field: [before, after]}`, `ageMs` |
| `worktree.removed` / `claim.removed` / `port.freed` | a record leaves state | **`livedMs`**, plus the record as it was |
| `journal.truncated` | the file hit its size cap | `droppedBytes` |

What it is for — each of these is a query over the file alone, and none is answerable without it:

```sh
# how long did each worktree live, and was anything merged first?
jq -r 'select(.kind=="worktree.removed") | "\(.repo) \(.name) \(.livedMs/1000)s \(.status)"' ~/.colab/journal.jsonl
# worktrees torn down with nothing landed
jq -r 'select(.kind=="worktree.removed" and .status!="merged") | .name' ~/.colab/journal.jsonl
# which invocations failed
jq -r 'select(.kind=="colab.invoked" and .exit!=0) | "\(.exit) \(.argv|join(" "))"' ~/.colab/journal.jsonl
# where the wall clock goes, per command
jq -r 'select(.kind=="colab.invoked") | "\(.cmd) \(.durationMs)"' ~/.colab/journal.jsonl
```

Design notes, in case a future change is tempted to relax one:

- **Off is absolute.** Unset, nothing here runs: the snapshot returns `null` on its first line, no
  path is touched and no directory created. A test spies on every `fs` write entry point and asserts
  that not one targets a journal path, because a grep cannot see a write it did not think to look for.
- **It cannot corrupt state, structurally.** The journal is a separate append-only file. It never
  reads, writes or locks `state.json`. Only the *diff* is computed inside the state lock; the append
  happens after the lock is released, so a slow disk blocks no other session, and every journal call
  is wrapped so that a failure to record can never fail the mutation being recorded.
- **The kinds above are ours, and are deliberately not `notifyUrl`'s.** That vocabulary is closed and
  owned by an external receiver; widening it for local use would force a change on a contract we do
  not own. Nothing here touches a socket.
- **`livedMs` costs no bookkeeping anywhere.** It is `now − created`, read one instruction before
  the record is destroyed. That is the whole trick, and it is why the hook is in `mutate()`.
- **Size-capped, oldest-first.** Past 5 MiB the file is truncated to its newest half on the next
  write, cut at a line boundary — and the truncation writes a `journal.truncated` line, so a count
  taken from the file can never mistake a trimmed history for a complete one. This is deliberately
  not a rotation scheme: numbered files and a compactor are more machinery than an opt-in local file
  earns, and each part is another thing that can fail inside a command doing real work.
- **`config set <key> <value>` is recorded without its value.** The key survives, so "who changed
  what, when" still answers; the value does not, because `notifyUrl` can carry a token and a local
  file that quietly accumulates credentials is a worse problem than the one this solves.
- **No per-step timing inside `ship`.** Invocation totals are free; per-step numbers mean editing the
  ship path itself, and new code on the path that merges work is a poor trade for a first version.

### `~/.colab/state.json` (version 1)

```jsonc
{
  "version": 1,
  "worktrees": {
    "import-fixes-115-114-113": {
      "name": "...", "repo": "/abs/repo", "branch": "fix/...",
      "base": "main",                   // cut from this, and `ship` merges back into it
      "path": "/abs/repo/.worktrees/...", "ports": [5230],
      "host": "machine", "session": "https://claude.ai/code/session_…",
      "sessionName": "colab-handbook",  // short human label (either/both/neither)
      "status": "running",              // running → merged (killed = entry removed)
      "created": "<iso>"
    }
  },
  "claims": {
    "/abs/repo#115": {
      "issue": "#115", "repo": "/abs/repo",
      "worktree": "import-fixes-115-114-113",   // or null for a trunk claim
      "branch": "fix/...", "host": "machine",
      "session": "https://claude.ai/code/session_…",   // both inherited from the worktree
      "sessionName": "colab-handbook",
      "created": "<iso>"
    }
  },
  "ports": {
    "5230": { "port": 5230, "owner": { "type": "worktree", "ref": "import-fixes-115-114-113" },
              "host": "machine", "created": "<iso>" }
  }
}
```

- **Global per machine**: ports are unique across *all* repos, so it's one file, not per-repo.
- Port `owner.type` is `worktree` | `claim` | `manual`; `ref` is the worktree name, claim key, or
  a manual label.
- `session`, `sessionName`, `status` and `base` are **backward-compatible**: entries written before
  they existed render as blank identity / `running` status, and a missing `base` falls back to the
  repo's trunk — no migration needed. See *Session identity* and *Worktree lifecycle* below.
- **This file has readers outside this repo** — an internal dashboard joins worktrees and claims to
  live sessions straight from it. Treat the shape as a published contract: adding a field is safe,
  renaming or removing one breaks consumers you cannot grep for.

## Reserved ports — the design change

Previously reserved ports lived in one hand-maintained central file, and adding a project meant
editing **two** places (that file *and* a docs table) — a duplication that already drifted out of
sync. Instead, **each repo declares its own** reserved ports in `.github/project.yml`:

```yaml
trunk: main
ports: [5220]                 # this project's trunk dev server port(s) — never allocated
worktreePorts: [47150, 47199] # OPTIONAL: window this repo's worktrees allocate from
```

`colab` aggregates the reserved set across every repo it knows (`config.repos` + the current repo)
plus `config.extraReserved` **plus every `config.reservedFiles` entry**. One source of truth per
project, no central duplication. See it with `colab ports` or `colab config show`.

### Worktree port window (`worktreePorts`)

`ports:` is a repo's **reserved trunk** ports. `worktreePorts: [lo, hi]` is the separate, optional
window that **worktrees of this repo** allocate from. When allocating for a worktree of repo *R*,
the search range resolves in precedence order:

1. an explicit `--range A-B` (or `--at`) flag,
2. *R*'s `.github/project.yml` `worktreePorts`,
3. the global `config.portRange`.

So a repo can keep its worktree servers in a dedicated band (e.g. `47150–47199`) without touching
the global default. Pairing (even/odd, etc.) is **not** built into the CLI — it's too repo-specific;
use `--at` for exact ports (below) or let the repo's `post-create` hook adjust.

### Exact port pinning (`--at`)

`colab port alloc --at p1,p2,...` and `colab worktree new --at p1,p2,...` pin **exactly** those
ports instead of first-fit within a range. Any port that is reserved or already allocated is
**refused (exit 1)** — the same refusal semantics as reserved ports. `--at` is mutually exclusive
with `--count`/`--range`/`--ports`. It's the way to get a specific parity, e.g. an even base for a
pair: `--at 47150,47151`.

## Worktree hooks contract

The portable core does only universal steps: fetch origin, create the worktree from
`origin/<trunk>` (trunk read from `.github/project.yml`, else `origin/HEAD`), copy `.env*` if
present, allocate ports, record state. **Machine-specific setup** (DB cloning, dependency
symlinking, dev-server restarts) is *not* hardcoded — the adopting repo provides optional hooks:

| hook | when | non-zero exit |
|---|---|---|
| `<repo>/.colab/hooks/post-create` | after a worktree is created | **warning** (worktree already exists) |
| `<repo>/.colab/hooks/pre-remove`  | before a worktree is removed | **aborts** removal (unless `--force`) |

Each hook is run only if it exists **and is executable**. It receives:

- **argv:** `<worktree-path> <port> <port> ...`
- **env:** `COLAB_WORKTREE_PATH`, `COLAB_WORKTREE_NAME`, `COLAB_BRANCH`, `COLAB_PORTS` (csv),
  `COLAB_REPO`, `COLAB_TRUNK`, `COLAB_ISSUES` (csv)

Example `post-create` that clones a MySQL DB and symlinks `node_modules` (the kind of logic that
used to be baked into the machine-specific script):

```sh
#!/bin/bash
set -euo pipefail
WT="$1"; shift
[ -f "$WT/package.json" ] && ln -snf "$COLAB_REPO/node_modules" "$WT/node_modules"
# ... clone DB into <db>_wt_<name>, rewrite $WT/.env, etc.
```

## Command reference

Run `colab <cmd> --help` for full detail.

| command | purpose |
|---|---|
| `claim <issue>... [--worktree N] [--branch B] [--session S] [--session-name S] [--force] [--repo P]` | claim one or many issues (atomic; onto one worktree). **Enforced** — see *Claim lifecycle* below |
| `release <issue> [--repo P]` | release a single issue; siblings + worktree survive |
| `readiness <issue> [--clear] [--repo P]` | own the `deps-checked` marker (§5): add it after verifying no open blocker, `--clear` on a new blocker or reopen. Journaled; refuses when `gh` is unusable (the marker has no local-only form) |
| `claims [--json] [--sync [--prune]]` | list (grouped by worktree); `--sync` **adds** claims found on GitHub (assigned + in-progress); `--prune` also **removes** local claims GitHub no longer shows |
| `port alloc [--count N] [--range A-B \| --at p1,p2,...] [--worktree N \| --claim I \| --label S]` | allocate consecutive free ports, or pin exact ports with `--at` |
| `port free <port> \| --worktree N \| --claim I` | free ports |
| `ports [--json]` | list allocated ports + the reserved set |
| `worktree new <branch> [--issues N,M] [--ports N \| --at p1,..] [--name X] [--trunk T] [--session S] [--session-name S] [--repo P]` | create a worktree (optional) |
| `worktree rm <name> [--force] [--repo P]` | remove a worktree; release its group; free its ports. Refuses on uncommitted tracked work **or** processes the worktree owns (cwd inside it); `--force` overrides both, terminating the owned processes. Ports still bound afterwards are reported as such, never as freed |
| `worktree tag <name> --session S [--session-name S]` | **repair** session identity on an existing worktree **and its claims** (see *Session identity*) |
| `worktrees [--json]` | list worktrees (status + on-disk liveness) |
| `ship [--worktree N \| --branch B] [--message M] [--keep-worktree] [--delete-branch] [--dry]` | code-wrap **Phase B**: squash-merge a session branch → trunk. The branch is **kept** unless `--delete-branch`. Gated by repo autonomy (see *Phase B autonomy ladder*) |
| `promote [--repo P] [--message M] [--dry]` | **promotion** trunk → main (`--no-ff`). Gated by `deploy` + `promotion`; never tags/deploys directly (see *Promotion*) |
| `doctor [--prune] [--ttl H] [--json]` | heal dead worktrees / orphan + stale claims / orphan ports; flip + sweep **merged** worktrees (see *Worktree lifecycle*); **list** shipped branches awaiting deletion (never deletes them) |
| `release-notes [<range>] [--repo P] [--out F] [--headline "..."]` | grouped Markdown release summary from git history (see below) |
| `template [<name>] [--dest F] [--repo P] [--force]` | copy a handbook workflow template into a repo, **stamped** with the handbook version (see below) |
| `update [<repo>...] [--apply] [--json] [--quiet]` | sweep the fleet registry for stamped copies that fell behind a changed template; `--apply` refreshes the **pristine** ones. Never commits; never touches a hand-edited copy (see below) |
| `register [<path>] [--remove] [--list]` | add/remove a repo in **both** fleet registries at once; `--list` flags drift (see below) |
| `config [show \| add-repo P \| rm-repo P \| add-reserved-file P \| rm-reserved-file P \| set K V]` | manage config (`set` keys: `claimTTLHours`, `portRange`, `worktreeSubdir`, `notifyUrl`, `journal`) |

### Release notes

`colab release-notes` builds a grouped Markdown release summary from git history — the same
grouping the release workflow (`templates/release-tag.yml`) produces, but runnable locally. It
exists because when org GitHub Actions was billing-locked the workflow couldn't run and the
summary had to be hand-built; this makes that path first-class and non-drifting. The subcommand
and the workflow's summary step are **deliberate copies** of each other (the workflow must stay
self-contained git+shell, so they can't share code) — a comment in both says to edit them together.

Non-merge commit subjects in the range are grouped by Conventional Commit type
(`feat, fix, perf, refactor, docs, chore, test`) with per-group counts, plus an `Other` bucket for
unprefixed subjects. The range defaults to `<most recent tag reachable from HEAD>..HEAD`; with no
tags and no explicit range it errors rather than guessing. `--headline "..."` inserts one sentence
after the commit-count line; `--out <file>` writes to a file instead of stdout.

Composable — pipe straight into `gh`:

```sh
colab release-notes v0.3.0..v0.4.0 | gh release create v0.4.0 --notes-file - --generate-notes
```

### Templates

`colab template` copies a handbook workflow template (`../templates/*.yml`) into a repo
and **prepends a version stamp** — `# colab-handbook: <name> @ <version>`, where the
version is `git describe --tags` in the handbook checkout (`v0` before any tag). With no
name it lists the available templates; it refuses to overwrite an existing destination
unless `--force` (and prints a `diff` hint instead). The stamp exists so
`../audit/audit.mjs` can later tell an adopter that the source template has changed since
they copied it — copy-and-own with a reconciliation trail, never a remote call. Making
copy+stamp one command matters because a manual stamp is the step people skip.

### Update (the outward sweep)

`colab template` is how a repo *adopts* a template; `colab update` is how the machine finds out
which adoptions have gone stale, and refreshes the ones it can prove are safe.

It is an **outward sweep**, not a broadcast. The handbook cannot push to consumers — the fleet
registry is machine-local and deliberately uncommitted (this repo is public; a list of private
repo paths is not something to publish). So the sweep runs *from* the machine holding the list.

```sh
colab update                 # report on every registered repo (read-only)
colab update my-repo         # limit to one repo (abs path, or a trailing path segment)
colab update --apply         # write the refreshable copies
colab update --quiet --json  # for a scheduled run
```

Each stamped artifact is classified. The two git reads that matter are performed against the
handbook's own history — **the classification never compares version strings alone**:

| state | meaning | `--apply` |
|---|---|---|
| `current` | the stamp is the handbook's version, **or** `git log <stamp>..HEAD -- templates/<name>` is empty — the template genuinely has not moved | — |
| `behind` | the stamp is older, the template really changed, **and** the copy still matches `git show <stamp>:templates/<name>` — i.e. pristine | **rewritten** |
| `diverged` | the copy does *not* match the template as of **its own stamp**: hand-edited | **never written** |
| `unstamped` | its **content** carries text only our templates contain, but there is no stamp: lineage unknown, so replacing it could destroy edits nobody can see. The row names the template the evidence points to | **never written** |
| `unrelated` | its **name** matches a template but its content carries none of it — the repo's own file, reported only so nobody re-copies over it | **never written** |
| `n-a` | not assessable, always with a stated reason (an `owner/name` slug has no working tree here; a stamp from a tag this checkout lacks; an unknown template name) | — |

Getting `diverged` right is the crux, and it is why the tool reads the template **at the old
tag** rather than only the current one. Comparing a copy against today's template would label
every out-of-date copy "hand-edited" and make the safe/unsafe distinction meaningless.

**What it deliberately will not do:**

- **Never commits, stages or pushes.** Every repo has its own tier and trunk rules; committing
  into a Tier A repo's `dev` would have this tool violate the handbook it enforces. It writes
  files into the working tree and stops — review with `git diff`, commit through that repo's flow.
- **Never treats a filename as provenance.** "Copied from us" is decided by content that only our
  templates contain — step names we coined, not the vocabulary of the stack. A file that merely
  shares a template's *name* is `unrelated`, and the report says so instead of suggesting a
  re-copy: advising `--force` on a file we cannot attribute would overwrite work that never came
  from here. (Both misfires we shipped were stack vocabulary — a framework's codegen command and a
  third-party tool's download URL.)
- **Never rewrites a `diverged` copy**, even with `--apply`. Copy-and-own (§7) makes local edits
  legitimate; a tool that silently overwrote them would destroy the principle it serves.
- **Never rewrites the CLAUDE conventions block.** That block is a *fragment* pasted into a
  larger hand-written file, and the template ships placeholders the adopter fills in (`<A|B>`,
  `<dev|main>`). A correctly adopted block therefore never matches byte-for-byte — divergence is
  undecidable — and regenerating it would replace a repo's real tier and trunk with angle
  brackets. It is classified (`current`/`behind`) and handed to a human to re-paste.
- **Skips the handbook itself**, which is a guaranteed false positive: a stamp means "copied from
  version X", and this repo *is* X.

A refreshed file is byte-identical to what `colab template <name> --force` would have written —
`update` is that command applied only where it can prove the copy was untouched.

**The frozen CLI is reported alongside the fleet**, as one line before the table. Same question
(is a stamped copy behind?), same git read (`git log <stamp>..HEAD -- tools/colab tools/lib`) — so
a release that changed no CLI code does not mark the machine stale. It is the one stamped artifact
that lives in no repo, and the one whose staleness nothing else would ever surface: a service goes
on running the old CLI quite happily, which is what freezing it was for. States are `current`,
`behind`, `n-a` and `absent` (no frozen copy installed at all). There is no `diverged`: a template
copy is copy-and-own and its edits must be protected, while the frozen copy is a cache of this
repo's own tool that `install.sh` overwrites wholesale.

It is **reported, never written** — not even with `--apply`. Re-freezing swaps the toolchain a
live service is executing, so it stays a human act (`./install.sh --tools`). Run `colab update`
*from* the frozen copy and it refuses: that copy has no handbook history to compare against, and
an "untagged handbook" report would have been technically true and completely misleading.

Exit code is **1 when anything is `behind`** — the frozen copy included — so a scheduled run
alerts on a stale CLI exactly as it does on a stale workflow. 0 otherwise.

### Register (fleet registries)

There are two machine-local registries under `~/.colab/` (honoring `COLAB_HOME`):

- `repos.txt` — the audit fleet list, read by `../audit/audit.mjs`.
- `config.json` `repos[]` — the reserved-ports aggregation source used by this CLI.

They serve different tools, so they used to be hand-edited separately — the exact
two-places-drift disease this handbook exists to kill. `colab register` writes **both** in one
act (dedup, atomic, under the same lock):

```sh
colab register                 # register the current repo (its git toplevel) into both
colab register /path/to/repo   # register an explicit repo (must be a git repo; non-git refused)
colab register /path/to/repo --remove   # remove from both
colab register --list          # show every registered repo and which registry knows it
```

`--list` marks each repo `T` (in `repos.txt`) and `C` (in `config.json`). A **local path in only
one** registry is drift and is flagged with a fix hint; `--list` exits non-zero when any drift
exists (scriptable). Owner/name **slugs** are audit-only (they can't be a local port-scan root),
so they show `n/a` in the `CFG` column and are never counted as drift. Registering a
one-registry-only repo re-syncs both ("drift healed").

## Releasing the handbook itself

The handbook ships **no** `release-tag.yml` workflow of its own (that file is a *template* it
hands to other repos). Its release path is `scripts/release.sh`:

```sh
sh scripts/release.sh vX.Y.Z ["optional headline sentence"]
sh scripts/release.sh vX.Y.Z --dry    # run every guard + print the plan, change nothing
```

It guards (version shape, tag not already present, clean tracked tree, on `main`, `main` ==
`origin/main`), then tags, pushes the tag, publishes a GitHub Release whose body comes from
`colab release-notes`, and finally runs `../audit/audit.mjs` as a **fleet reconciliation report**
under a `── Reconciliation @ vX.Y.Z ──` banner. Audit findings are advisory — the release still
succeeds and the script exits 0 when the release steps themselves succeeded.

## Phase B autonomy ladder (`colab ship` + `pre-push-guard`)

`colab ship` is the **one sanctioned door** for code-wrap **Phase B** — squash-merging a finished
session branch into the repo's trunk. It exists so an agent can close the loop *only where a human
has granted it*, and so a rogue agent can never raw-push trunk.

### Autonomy is granted by the repo, not the caller

The repo's `.github/project.yml` carries an `autonomy:` field:

```yaml
autonomy: auto-trunk   # colab ship may squash-merge session branches into trunk
# autonomy: manual     # (or absent) — ship refuses; a human runs Phase B
```

`auto-trunk` is the *only* value that enables `ship`. Anything else (or absent) → ship refuses. This
gate has **no override** — `--force` does not exist on `ship`. Autonomy is a property of the repo a
human configured, never a flag the caller can pass. `ship` **never** touches `main` when `trunk ≠
main`, **never** tags, and **never** promotes — those remain human/`scripts/release.sh` territory.

### The gated sequence

Each step is checked; any failure aborts **before the push**, so trunk is never left half-shipped:

| step | what | abort condition |
|---|---|---|
| a. autonomy | repo grants `auto-trunk` | not granted → refuse (no override) |
| b. preconditions | reported as a ✓/✗ table | any ✗ → abort |
| | · trunk CI alive **and** green (`gh run list --branch <trunk> -L 1`) | not `completed`+`success` (billing fail-to-start counts as ✗) |
| | · **no new migration files** on the branch (`database/migrations/`, `prisma/migrations/`) | any present → human must run Phase B (no override) |
| | · trunk checkout is on trunk and clean | wrong branch / dirty tracked tree |
| c. B0 sync | merge trunk **into** the branch | conflict in a **non-generated** file → abort (hand-merge); generated-only conflict → the repo's `.colab/hooks/pre-ship` regenerates, else abort |
| d. B1 squash | re-verify CI green, then squash-merge branch → trunk | CI no longer green / squash fails |
| e. B2 push | push trunk with `COLAB_SHIP=1` in the env | push rejected (commit stays local, unpushed) |
| f. B3 teardown | `colab worktree rm` (releases claims + ports + `✅` comments) unless `--keep-worktree`. The **branch is kept**; `--delete-branch` removes it local + remote | branch deletion is best-effort — a failure warns, it never fails a ship that already pushed |
| g/h. B4 + summary | verify each issue auto-closed; post `🚢 Shipped to <trunk> by colab ship — <sha>` | non-closing issues are reported, not fatal |

#### The squash commit message

With `--message`, the subject is yours and a `— Closes #N, …` trailer is appended. Without it, the
message is composed (`tools/lib/squash.js`, unit-tested):

- **Subject** — the branch's **highest-weight** commit: breaking > `feat` > `fix` > `perf` >
  `refactor` > `docs` > `test` > `chore`, ties going to the **oldest** (the commit that established
  what the branch is for). Not the newest commit. That was the old rule, and it was wrong in exactly
  the common case: on a well-run branch the newest commit is the docs pass, so features shipped
  titled `docs:` and — because release notes group on the prefix (§4) — vanished from the changelog
  without anything failing. If no commit carries a recognised prefix there is nothing to weigh, and
  it falls back to the newest.
- **Body** — `Closes #N` for **every** issue the branch claims in `state.json` (a group branch
  closes all its siblings), then the other commit subjects as bullets with `chore(sync)` merge-noise
  dropped, then the chosen commit's body, then `Co-Authored-By:` / `Claude-Session:` trailers
  harvested from **every** commit on the branch and de-duplicated.

`--dry` prints the subject it would use — the last moment a wrong one can be caught, since a bad
subject fails silently and cannot be corrected once it is inside a published tag.

#### Why B3 keeps the branch

**The branch survives a ship. `--delete-branch` opts into removing it.**

An agent deleting refs from a **shared remote** is the wrong default however well-verified the
deletion is: reporting is safe and reversible, deleting is neither. Nobody is harmed by a branch
that outlives its merge; someone can be harmed by a ref that vanishes from under them. So `ship`
keeps it and `colab doctor` lists what has accumulated.

The cost is accepted deliberately, and it is real: **shipped branches pile up, one per session.**
A squash merge leaves **no ancestry**, so `git branch --merged <trunk>` will never list them — the
standard cleanup check is structurally blind, not merely unrun. That is exactly why `doctor`'s list
is the *primary* mechanism here rather than a safety net, and why it prints below the health verdict
as routine maintenance instead of as drift.

`--delete-branch` does it when you want it: local and remote, **after** B2 has pushed trunk (the
content is durable before the ref goes), with `branch -D` since `-d` refuses a squashed branch for
the same missing-ancestry reason. Best-effort — a failure warns rather than failing a ship that
already succeeded. Passing it with `--keep-worktree` is refused with a warning, because git will not
delete a branch that is still checked out.

This premise has been wrong twice, in opposite directions — first a comment claiming a deletion that
never happened, then a deletion the operator did not want. It is now a decision with a flag and a
docstring behind it rather than an assumption. [`code-wrap`](../skills/code-wrap/SKILL.md) B3 and
[`code-sweep`](../skills/code-sweep/SKILL.md) §3 tell humans to delete these by hand; under this
default that guidance is **load-bearing**, not redundant.

A **generated** file is one matching `package-lock.json`,
`pnpm-lock.yaml`, `yarn.lock`, `composer.lock`, `Cargo.lock`, `go.sum`, `dist/`, `build/`,
`public/build/`, `.astro/`, **plus** the repo's `.github/project.yml` `generated: [...]` globs.

`--dry` prints the plan + the precondition table and changes nothing (exit 0 if READY, 1 if not).

### Promotion (`colab promote`) — trunk → main, split from release

The ladder has three rungs with **separate permissions**: `ship` (branch → trunk) · `promote`
(trunk → main, a `--no-ff` merge) · **release** (the tag — *always* human). `colab promote` is the
checked door for the middle rung. It **never tags and never deploys directly**; there is no
`--tag`/`--release` flag.

Two gates, **both** must pass:

- **Hard safety** — derived from the repo's `deploy:` semantics, and **no field or flag can lower
  it**:
  - `deploy: push-main` → promoting main *is* a production deploy → requires `COLAB_HUMAN=1`.
  - `deploy: manual` → promoting main is the human's own "about to deploy" step, and the deploy
    that follows has no gate but the operator → requires `COLAB_HUMAN=1`.
  - `deploy: tag` → promotion is **verification-only** (heavy CI runs on main, nothing deploys).
  - anything else / absent → treated as production-risk → `COLAB_HUMAN=1` (fail-closed).
- **`promotion:` field** (`project.yml`, `human` | `main-loop`, default `human`, fail-closed on
  unknown): on a `deploy: tag` repo, `promotion: main-loop` lets the main-loop promote with no human
  word; otherwise a human (`COLAB_HUMAN=1`) is required.

Tier B (`trunk == main`) has **no promotion** — `ship` goes straight to main; `promote` refuses.
Tiers A and C both promote; the CLI keys on `trunk`/`deploy`, never on the tier letter.
Preconditions (✓/✗ table): trunk CI green · `trunk == origin/trunk` · `main == origin/main` · main
checkout usable (the repo checkout if it's on `main` and clean — **never** a dirty switch — else a
temporary worktree). The merge message is `--message` (full override) or
`release: <trunk> → main — <date> (promotion via colab promote)`; the push carries `COLAB_PROMOTE=1`.
After a successful promotion on a `deploy: tag` repo it prints the release reminder:
`git tag vX.Y.Z && git push origin vX.Y.Z`. `--dry` shows the table + plan and changes nothing.

On a **`deploy: manual`** repo a *successful* promotion prints a block, not a line, because it is
the one case where finishing the command does not finish the job: `main` moved, **production did
not**, and no workflow will ever fire. The block says production is not updated and names the
repo's `runbook:` as the required next step. If `runbook:` is absent it prints `NEXT STEP —
UNKNOWN` rather than an empty path — silence there would read as "nothing further required",
which is precisely the misreading (a promoted `main` everyone believes is live) this exists to
prevent.

### `pre-push-guard` — trunk (and main) are push-protected locally

`templates/pre-push-guard` is a POSIX-sh git `pre-push` hook that **refuses raw pushes to protected
branches** (read from `.github/project.yml`):

- **trunk** — unless `COLAB_SHIP=1` (set by `colab ship`) or `COLAB_HUMAN=1`.
- **main**, only where `trunk != main` (tiers A and C) — unless `COLAB_PROMOTE=1` (set by `colab promote`)
  or `COLAB_HUMAN=1`. `COLAB_SHIP` does **not** open main — `ship` is trunk-only by design.

On tier B (`trunk == main`) the trunk rule already covers main. Non-protected pushes always pass; a
missing `project.yml` degrades to *allow* with a warning (never blocks work). Install copy-and-own,
per repo:

```sh
cp templates/pre-push-guard .git/hooks/pre-push && chmod +x .git/hooks/pre-push
# or into a shared hooks dir:
cp templates/pre-push-guard "$(git config core.hooksPath)/pre-push"
```

Together they form the ladder: an agent may `ship` **only** where the repo granted `auto-trunk`,
`promote` **only** where `deploy`/`promotion` allow, and even a mis-behaving agent can't route around
either with a bare `git push` — the guard blocks trunk and main.

## Safety

- **Claims are enforced.** `claim` / `worktree new --issues` refuse (exit 1) an issue already held
  by another worktree (local) or another GitHub user (`in-progress` + assigned to someone else),
  naming the holder; `--force` takes over visibly. A simultaneous-claim race is settled
  deterministically by the tie-break, and the loser auto-yields. See *Claim lifecycle* above.
- **Phase B is gated + push-protected.** `colab ship` merges to trunk only where the repo's
  `project.yml` grants `autonomy: auto-trunk` (no flag override), and aborts before any push if CI
  isn't green, the branch adds migrations, or a non-generated merge conflict appears. The
  `pre-push-guard` hook blocks raw pushes to trunk without `COLAB_SHIP=1`/`COLAB_HUMAN=1`. See
  *Phase B autonomy ladder* above.
- **Promotion is split from release.** `colab promote` (trunk → main) requires `COLAB_HUMAN=1` on a
  `deploy: push-main` repo (promotion *is* the production deploy) and allows an unattended main-loop
  run only on `deploy: tag` + `promotion: main-loop` (verification-only); unknown `deploy`/`promotion`
  values fail closed to human. It never tags — release stays a human `git tag`. The guard also blocks
  raw pushes to `main` on tier-A repos without `COLAB_PROMOTE=1`/`COLAB_HUMAN=1` (`COLAB_SHIP` does not
  open main). See *Promotion* above.
- `worktree rm` refuses if the worktree has uncommitted **tracked** changes, unless `--force`.
  (Untracked files like a copied `.env` are expected and don't block.)
- `claims --sync` is **add-only by default**: it adds claims for issues GitHub shows as assigned +
  in-progress, and never deletes local claims unless you pass `--prune` (which prints exactly what
  it removes and why). Removal is opt-in because a successful-but-partial GitHub response (rate
  limit, paging) is indistinguishable from a complete one, so a destructive reconcile must be
  deliberate. Repos gh can't reach are skipped, never treated as "GitHub shows no claims".
- `doctor` without `--prune` never changes anything — it only reports (including would-be `running →
  merged` flips and merged-worktree sweep candidates).
- Worktree-less ("trunk") claims are never auto-removed; `doctor` only *flags* stale ones. You
  remove them with `--prune`. This is deliberate — a trunk claim may be a long-running deliberate one.
- `doctor --prune` sweeps only **merged** worktrees, and only when their tracked tree is clean;
  `running` worktrees (and any worktree with a live claim) are never swept. The sweep is local-only —
  `doctor` never touches GitHub.
