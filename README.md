# colab-handbook

Conventions and small tools for running many repos — and many parallel coding
sessions, human or AI — without stepping on each other.

**If you are an AI agent, stop here and read [`CLAUDE.md`](CLAUDE.md) instead.**
This file is for people.

## What this is

A handbook, not a framework. It decides **outcomes** — where work lands, what a
release is, how you signal "I'm working on this" — and deliberately leaves
**implementations** (Node versions, test runners, your CI file) to each repo.

Everything in it was extracted from running ~25 real repos, including several
production apps maintained almost entirely by AI coding agents working in
parallel worktrees. The anti-patterns section is not theoretical: every entry is
something that actually happened, with the scar tissue to show for it.

## The model in 30 seconds

One question decides everything: **does the repo deploy to production?**

- **No → Tier B.** One branch, `main`. Ship nothing, tag optionally. Most repos.
- **Yes → Tier A.** Work merges to `dev` (fast CI), promotes to `main` (full test
  suite), and a `v*.*.*` tag — only a tag — deploys.

Every repo declares which it is in `.github/project.yml`, so nobody guesses.
Issues are claimed with an assignee + `in-progress` label before work starts, so
parallel sessions never collide on the same task.

Full rules: [`CONVENTIONS.md`](CONVENTIONS.md). It's a 15-minute read and the
only file that is normative — everything else here supports it.

## Layout

| Path | What it is |
|---|---|
| [`CONVENTIONS.md`](CONVENTIONS.md) | The rules. Normative, single source of truth. |
| [`CLAUDE.md`](CLAUDE.md) | Entry point for AI agents — operational distillation. |
| [`project.schema.md`](project.schema.md) | Field reference for `.github/project.yml`. |
| [`templates/`](templates/) | Copy-and-own starting points: CI, release, the `CLAUDE.md` block for adopting repos. **Nothing is called remotely** — copy, edit, own. |
| [`tools/`](tools/) | `colab` — one small CLI for issue claims, port allocation, and (optional) worktree management. JSON state, no dependencies. |
| [`audit/`](audit/) | External conformance checker. Reads all your repos — across owners, including local-only — and reports drift in one run. Advisory, never blocking. |
| [`skills/`](skills/) | Portable session flows (`code-start`, `code-wrap`) installable as Claude Code skills via `install.sh`. |

## Adopting it in a repo

The short version — the full checklist is
[`CONVENTIONS.md` §9](CONVENTIONS.md#9-adopting-this):

1. Decide the tier honestly (production **today**, not "soon").
2. Add `.github/project.yml`.
3. `gh label create in-progress` — the claim label won't exist yet.
4. Paste [`templates/repo-CLAUDE-block.md`](templates/repo-CLAUDE-block.md) into
   the repo's `CLAUDE.md` — this is how agents discover the conventions at all.
5. Make sure CI covers the two required outcomes: a secret scan and a build,
   with the toolchain version resolved from the repo's own manifest — never
   hardcoded. Copy a template if it helps.

Existing branches are grandfathered. Don't rename anything.

## Why so little is enforced

Our private repos sit on a GitHub plan without branch protection — `main` cannot
be made unpushable. So this handbook doesn't pretend to enforce; it makes
conformance **cheap to follow and cheap to check**. The audit tool reports
drift; the conventions explain *why* each rule exists so you can judge when to
break one. When you do, update the doc in the same PR — a doc that describes a
repo that doesn't exist is the worst artifact in this business.
