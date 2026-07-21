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
| [`skills/`](skills/) | Portable session flow: `code-triage` (pick the next task) → `code-start` (open a session) → `code-wrap` (ship + distill), plus `code-sweep` (clear out everything ALREADY DONE in one repo, running code-wrap on each) and `handbook-sync` (bring ONE repo up to the latest handbook, run from inside it). Install them as Claude Code skills via `install.sh`. |

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
