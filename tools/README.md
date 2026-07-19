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
| `release-notes [<range>] [--repo P] [--out F] [--headline "..."]` | grouped Markdown release summary from git history (see below) |
| `template [<name>] [--dest F] [--repo P] [--force]` | copy a handbook workflow template into a repo, **stamped** with the handbook version (see below) |
| `register [<path>] [--remove] [--list]` | add/remove a repo in **both** fleet registries at once; `--list` flags drift (see below) |
| `config [show \| add-repo P \| rm-repo P \| set K V]` | manage config |

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
