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

## State & config files (machine-local)

Everything lives under `~/.colab/` (override the directory with the `COLAB_HOME` env var).
Writes are atomic (temp file + `rename`) and guarded by a `mkdir`-based lock (`state.lock`) so
concurrent sessions don't lose writes.

### `~/.colab/config.json`

```json
{
  "repos": ["/abs/path/repoA", "/abs/path/repoB"],
  "extraReserved": [8765],
  "claimTTLHours": 24,
  "portRange": "5200-5999",
  "worktreeSubdir": ".worktrees"
}
```

| key | meaning |
|---|---|
| `repos` | repo roots to scan for reserved ports (`.github/project.yml` → `ports:`). The current repo is always included automatically. |
| `extraReserved` | reserved ports for **non-repo** services (a preview server, etc.). |
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
      "host": "machine", "created": "<iso>"
    }
  },
  "claims": {
    "/abs/repo#115": {
      "issue": "#115", "repo": "/abs/repo",
      "worktree": "import-fixes-115-114-113",   // or null for a trunk claim
      "branch": "fix/...", "host": "machine", "created": "<iso>"
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

## Reserved ports — the design change

Previously reserved ports lived in one hand-maintained central file, and adding a project meant
editing **two** places (that file *and* a docs table) — a duplication that already drifted out of
sync. Instead, **each repo declares its own** reserved ports in `.github/project.yml`:

```yaml
trunk: main
ports: [5220]          # this project's trunk dev server port(s)
```

`colab` aggregates the reserved set across every repo it knows (`config.repos` + the current repo)
plus `config.extraReserved`. One source of truth per project, no central duplication. See it with
`colab ports` or `colab config show`.

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
| `claim <issue>... [--worktree N] [--branch B] [--repo P]` | claim one or many issues (atomic; onto one worktree) |
| `release <issue> [--repo P]` | release a single issue; siblings + worktree survive |
| `claims [--json] [--sync [--prune]]` | list (grouped by worktree); `--sync` **adds** claims found on GitHub (assigned + in-progress); `--prune` also **removes** local claims GitHub no longer shows |
| `port alloc [--count N] [--range A-B] [--worktree N \| --claim I \| --label S]` | allocate consecutive free ports |
| `port free <port> \| --worktree N \| --claim I` | free ports |
| `ports [--json]` | list allocated ports + the reserved set |
| `worktree new <branch> [--issues N,M] [--ports N] [--name X] [--trunk T] [--repo P]` | create a worktree (optional) |
| `worktree rm <name> [--force] [--repo P]` | remove a worktree; release its group; free its ports |
| `worktrees [--json]` | list worktrees (with on-disk liveness) |
| `doctor [--prune] [--ttl H] [--json]` | heal dead worktrees / orphan + stale claims / orphan ports |
| `config [show \| add-repo P \| rm-repo P \| set K V]` | manage config |

## Safety

- `worktree rm` refuses if the worktree has uncommitted **tracked** changes, unless `--force`.
  (Untracked files like a copied `.env` are expected and don't block.)
- `claims --sync` is **add-only by default**: it adds claims for issues GitHub shows as assigned +
  in-progress, and never deletes local claims unless you pass `--prune` (which prints exactly what
  it removes and why). Removal is opt-in because a successful-but-partial GitHub response (rate
  limit, paging) is indistinguishable from a complete one, so a destructive reconcile must be
  deliberate. Repos gh can't reach are skipped, never treated as "GitHub shows no claims".
- `doctor` without `--prune` never changes anything — it only reports.
- Worktree-less ("trunk") claims are never auto-removed; `doctor` only *flags* stale ones. You
  remove them with `--prune`. This is deliberate — a trunk claim may be a long-running deliberate one.
