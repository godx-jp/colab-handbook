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

## Quick start

```sh
# tell colab which repos to aggregate reserved ports from (once per machine)
colab config add-repo /path/to/repoA
colab config add-repo /path/to/repoB

# claim a group of related issues onto one worktree/branch
colab claim 115 114 113 --worktree import-fixes-115-114-113 --branch fix/import-fixes-115-114-113

# or let `worktree new` do it all: create the worktree, allocate ports, claim the group
colab worktree new fix/import-fixes-115-114-113 --issues 115,114,113 --ports 1

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
  trunk (so a `--keep-worktree` entry survives as `merged`); (2) `colab doctor` auto-detects — for a
  `running` worktree with **no live claims** whose branch is **tree-contained in trunk**, it records
  the flip on `--prune`. Containment is checked with `git merge-tree --write-tree` (merging the branch
  into trunk yields trunk's exact tree), which is correct for **squash merges** — an ancestry/rev-list
  test would miss them — and stays correct when trunk has moved on. When it can't tell, it leaves the
  worktree `running`.
- **Any live claim keeps a worktree `running`**, even if the current branch is already contained — a
  group with an unfinished sibling is not done.
- **merged → killed**: `colab doctor --prune` now **sweeps** merged worktrees still on disk (full
  teardown: pre-remove hook → `git worktree remove` → free ports → drop the entry, all local-only). It
  **refuses** a merged worktree with uncommitted **tracked** changes (reports it instead). `running`
  worktrees are **never** swept. Teardown removes the entry outright — "killed" is the absence of a
  record, not a stored status (per Boss: no need to save it).

## State & config files (machine-local)

Everything lives under `~/.colab/` (override the directory with the `COLAB_HOME` env var).
Writes are atomic (temp file + `rename`) and guarded by a `mkdir`-based lock (`state.lock`) so
concurrent sessions don't lose writes.

### `~/.colab/config.json`

```json
{
  "repos": ["/abs/path/repoA", "/abs/path/repoB"],
  "extraReserved": [8765],
  "reservedFiles": ["~/Future/.claude/ports.reserved"],
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

### `~/.colab/state.json` (version 1)

```jsonc
{
  "version": 1,
  "worktrees": {
    "import-fixes-115-114-113": {
      "name": "...", "repo": "/abs/repo", "branch": "fix/...",
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
- `session`, `sessionName`, and `status` are **backward-compatible**: entries written before they
  existed render as blank identity / `running` status — no migration needed. See *Session identity*
  and *Worktree lifecycle* below.

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
| `claims [--json] [--sync [--prune]]` | list (grouped by worktree); `--sync` **adds** claims found on GitHub (assigned + in-progress); `--prune` also **removes** local claims GitHub no longer shows |
| `port alloc [--count N] [--range A-B \| --at p1,p2,...] [--worktree N \| --claim I \| --label S]` | allocate consecutive free ports, or pin exact ports with `--at` |
| `port free <port> \| --worktree N \| --claim I` | free ports |
| `ports [--json]` | list allocated ports + the reserved set |
| `worktree new <branch> [--issues N,M] [--ports N \| --at p1,..] [--name X] [--trunk T] [--session S] [--session-name S] [--repo P]` | create a worktree (optional) |
| `worktree rm <name> [--force] [--repo P]` | remove a worktree; release its group; free its ports |
| `worktree tag <name> --session S [--session-name S]` | **repair** session identity on an existing worktree **and its claims** (see *Session identity*) |
| `worktrees [--json]` | list worktrees (status + on-disk liveness) |
| `ship [--worktree N \| --branch B] [--message M] [--keep-worktree] [--dry]` | code-wrap **Phase B**: squash-merge a session branch → trunk. Gated by repo autonomy (see *Phase B autonomy ladder*) |
| `promote [--repo P] [--message M] [--dry]` | **promotion** trunk → main (`--no-ff`). Gated by `deploy` + `promotion`; never tags/deploys directly (see *Promotion*) |
| `doctor [--prune] [--ttl H] [--json]` | heal dead worktrees / orphan + stale claims / orphan ports; flip + sweep **merged** worktrees (see *Worktree lifecycle*) |
| `release-notes [<range>] [--repo P] [--out F] [--headline "..."]` | grouped Markdown release summary from git history (see below) |
| `template [<name>] [--dest F] [--repo P] [--force]` | copy a handbook workflow template into a repo, **stamped** with the handbook version (see below) |
| `update [<repo>...] [--apply] [--json] [--quiet]` | sweep the fleet registry for stamped copies that fell behind a changed template; `--apply` refreshes the **pristine** ones. Never commits; never touches a hand-edited copy (see below) |
| `register [<path>] [--remove] [--list]` | add/remove a repo in **both** fleet registries at once; `--list` flags drift (see below) |
| `config [show \| add-repo P \| rm-repo P \| add-reserved-file P \| rm-reserved-file P \| set K V]` | manage config |

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
colab update everyday        # limit to one repo (abs path, or a trailing path segment)
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
| `unstamped` | lineage unknown, so replacing it could destroy edits nobody can see | **never written** |
| `n-a` | not assessable, always with a stated reason (an `owner/name` slug has no working tree here; a stamp from a tag this checkout lacks; an unknown template name) | — |

Getting `diverged` right is the crux, and it is why the tool reads the template **at the old
tag** rather than only the current one. Comparing a copy against today's template would label
every out-of-date copy "hand-edited" and make the safe/unsafe distinction meaningless.

**What it deliberately will not do:**

- **Never commits, stages or pushes.** Every repo has its own tier and trunk rules; committing
  into a Tier A repo's `dev` would have this tool violate the handbook it enforces. It writes
  files into the working tree and stops — review with `git diff`, commit through that repo's flow.
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

Exit code is **1 when anything is `behind`** (so a scheduled run can alert), 0 otherwise.

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
| f. B3 teardown | `colab worktree rm` (releases claims + ports + `✅` comments) unless `--keep-worktree` | — |
| g/h. B4 + summary | verify each issue auto-closed; post `🚢 Shipped to <trunk> by colab ship — <sha>` | non-closing issues are reported, not fatal |

The squash commit message is `--message` (or `"<type>: <branch slug>"`) with a
`— Closes #N, #M, …` trailer built from **every** issue the branch claims in `state.json` (a group
branch closes all its siblings). A **generated** file is one matching `package-lock.json`,
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
