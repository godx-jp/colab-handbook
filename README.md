***English*** · [Tiếng Việt](README.vi.md)

# colab-handbook

A small set of conventions and tools for running many repos — many coding
sessions in parallel, humans and AI agents alike — without stepping on each
other.

**If you are an AI agent, stop here and read [`CLAUDE.md`](CLAUDE.md).**
This file is for humans.

*(The normative document — [`CONVENTIONS.md`](CONVENTIONS.md) — is written in
English so agents and tooling can read it. This is the English front door; the
Vietnamese one is [`README.vi.md`](README.vi.md). Both are only gateways, not
normative — when the two disagree, **both are wrong** until they agree with
`CONVENTIONS.md` again.)*

## What this is

A **handbook, not a framework**. It decides **outcomes** — where code merges,
what a release is, how you announce "I am working on this" — and deliberately
leaves the **implementation** (your Node version, your test runner, your CI
file) to each repo.

Everything here was distilled from running ~25 real repos, several of them
production apps maintained almost entirely by AI agents working in parallel
across many worktrees. The anti-pattern list is not theory: every entry is
something that actually happened, with the scar to prove it.

## The model in 30 seconds

Two questions decide everything: **does this repo deploy to production — and if
so, what stands between a merge and the users?**

- **No → Tier B.** A single branch: `main`. Nothing ships, tags optional.
  Most repos live here. **0 gates.**
- **Yes, and the promotion itself is the deploy → Tier C.** Code merges into
  `dev` (fast CI), you promote `dev` → `main` — and that push to `main` *is*
  the deploy. No tag. **1 gate.** Right for sites that are genuinely live but
  lightweight, where nobody would keep up a tagging ritual.
- **Yes, and only a tag deploys → Tier A.** Code merges into `dev` (fast CI),
  gets promoted to `main` (full test suite runs), and a `v*.*.*` tag — only the
  tag — deploys. **2 gates.**

**A/B/C are labels, not scores.** Skim too fast and C looks "worse" than B, but
B has no production at all. The letter describes the *shape* of the pipeline,
not how seriously anyone takes it — pick the one that matches your repo's truth.

Every repo declares its tier in `.github/project.yml`, so nobody has to guess.
Issues are **claimed** with an assignee plus the `in-progress` label before work
starts, so parallel sessions never collide on the same task.

The full rules: [`CONVENTIONS.md`](CONVENTIONS.md). It takes ~15 minutes to read
and is the **single normative file** — everything else in the repo serves it.

## Repo layout

| Path | What it is |
|---|---|
| [`CONVENTIONS.md`](CONVENTIONS.md) | The rules. Normative, the single source of truth (EN). |
| [`CLAUDE.md`](CLAUDE.md) | The entry point for AI agents — the operational distillation (EN). |
| [`project.schema.md`](project.schema.md) | Field reference for `.github/project.yml`. |
| [`templates/`](templates/) | **Copy-and-own** starting points: CI, release, the `CLAUDE.md` block for adopting repos. **Nothing is called remotely** — copy it, edit it, own it. |
| [`tools/`](tools/) | `colab` — a small CLI for claiming issues, allocating ports, and managing worktrees (optional). JSON state, zero dependencies. |
| [`audit/`](audit/) | An external conformance checker. Reads all your repos — every owner, including local-only ones — and reports drift in a single run. Advisory only, never blocking. |
| [`skills/`](skills/) | Portable session flow: `code-triage` (pick the next task) → `code-start` (open a session) → `code-wrap` (ship + distill), plus `code-sweep` (clear out everything ALREADY DONE in one repo — or just a named set of issues or one session — running code-wrap on each) and `handbook-sync` (bring ONE repo up to the latest handbook, run from inside it). Installed as Claude Code skills by [`install.sh`](install.sh) — see *Setting up a machine* below. |
| [`install.sh`](install.sh) | Sets up **your machine**: skills, the `colab` CLI, the pre-commit hook, the fleet list. Idempotent, and `--dry` shows you everything first. |

## Setting up a machine

Once per machine, before you adopt anything into a repo.

**You need:** `git`; `node` ≥ 18 (`.nvmrc` pins 22, which is what CI here runs);
`gh` **logged in** (`gh auth login`) — claims, the skills and the audit's remote
targets are all useless without it, and the failure surfaces much later as
something confusing; and `gitleaks` only if you want the pre-commit hook.
`install.sh` checks every one of these and reports what is missing before it
changes anything.

**1. Clone it somewhere permanent** — with the rest of your code, not in a
scratch directory.

```sh
git clone https://github.com/godx-jp/colab-handbook.git ~/code/colab-handbook
cd ~/code/colab-handbook
```

**This clone is infrastructure, not a download.** The skills install as symlinks
*into this working tree*: delete the clone and every session on the machine
loses them, and whichever branch it has checked out is the version of the skills
every session gets. So keep it on `main` unless you are actively working on the
handbook itself. `install.sh` warns if it finds itself under `/tmp`,
`~/Downloads` or `~/Desktop`.

**2. Install.**

```sh
./install.sh --all --dry   # see exactly what would happen; changes nothing
./install.sh --all         # skills + colab CLI + pre-commit hook + fleet list
```

`--all` is the recommended first run. Everything it does is a symlink or a copy,
it is idempotent, and it never overwrites anything it did not create — your own
skill, or an existing `~/.colab/repos.txt`, is left alone with a warning. Bare
`./install.sh` installs the skills and nothing else, if that is genuinely all
you want.

| Flag | What it does |
|---|---|
| *(none)* | Symlink `skills/` into `~/.claude/skills/`, so they are available in every repo you open. |
| `--tools` | Two installs of one CLI: a **symlink** at `~/.local/bin/colab` for your sessions (checking that directory is really on your `PATH`, and printing the exact line to add if not), plus a stamped **frozen copy** at `~/.colab/bin/colab` for always-on services — see below. |
| `--hooks` | Point this clone's git at `.githooks/` (gitleaks pre-commit). `core.hooksPath` lives in `.git/config`, so it is per-clone, per-machine, and never travels with the repo. |
| `--fleet` | Seed `~/.colab/repos.txt` from `audit/repos.txt`, only if it is absent. That list stays machine-local on purpose: it names your private repos, and this repo is public. |
| `--all` | `--tools --hooks --fleet`. |
| `--dry` | Print what would happen, change nothing. Combines with all of the above. |

**Always-on services must call `~/.colab/bin/colab`.** The symlinked CLI follows
whatever branch this clone has checked out — deliberate for a human session, and
wrong for anything that outlives one. A daemon, a launch agent or a headless
runner started months ago would silently change behaviour because somebody
checked out an unrelated branch, and nothing would report it: the process keeps
working, differently. So `--tools` also writes a **copy** to `~/.colab/bin/`
(honouring `COLAB_HOME`), stamped with the handbook version it was taken from —
or, when that tree sits ahead of the last tag, with the commit it was taken from
(`v1.7.0-2-gc8436c6`) and a warning, because no released version describes those
bytes. That copy never moves on its own.

Refreshing it is therefore an act, never a side effect: re-run `./install.sh
--tools`. `colab update` tells you when it is due. **`behind` means a released
CLI change exists that this machine lacks** — the comparison runs to the latest
tag, so a release that changed no CLI code does not nag you, and unreleased work
in your own checkout does not either. (That last part is why the bound is the tag
rather than `HEAD`: measuring to `HEAD` marked every machine stale for the whole
window between a CLI commit and the next tag, and the advertised remedy copies
*from* that same working tree — so on a machine developing the handbook it
advised services to adopt untagged code.) It never rewrites the copy, not even
with `--apply`: that is the toolchain your running services are executing.
`colab --version` says which of the two you are talking to.

**3. Verify, and point the audit at your repos.**

```sh
colab --help                 # not found? fix your PATH — step 2 prints the exact line
colab --version              # which colab is this: the working tree, or the frozen copy?
$EDITOR ~/.colab/repos.txt   # replace the examples with your own repos
node audit/audit.mjs         # a conformance report across the whole fleet
colab update                 # stamped copies that fell behind — the frozen CLI included
```

Then read [`CONVENTIONS.md`](CONVENTIONS.md): ~15 minutes, and the only
normative file here.

## Adopting it into a repo

The short version — the full checklist is
[`CONVENTIONS.md` §9](CONVENTIONS.md#9-adopting-this):

1. Determine the tier honestly (is there production **today**, not "soon").
2. Add `.github/project.yml`.
3. `gh label create in-progress` — the claim label does not exist by default.
4. Paste [`templates/repo-CLAUDE-block.md`](templates/repo-CLAUDE-block.md)
   into the repo's `CLAUDE.md` — this is the only way agents discover these
   conventions.
5. Make sure CI produces the two required outcomes: a secret scan and a build,
   with toolchain versions **resolved from the repo's own manifest** — never
   hardcoded. Copy a template if it helps.

Pre-existing branches are **grandfathered**. Do not rename anything.

## Why so little enforcement

Our private repos sit on a GitHub plan without branch protection — pushes to
`main` cannot be forbidden. So this handbook does not pretend to enforce; it
makes **compliance cheap and checking cheap**. The audit tool reports drift; the
conventions explain *why* each rule exists, so you can judge for yourself when
breaking one is worth it. When you do break one, fix the documentation in the
same PR — a document describing a repo that does not exist is the worst thing in
this business.
