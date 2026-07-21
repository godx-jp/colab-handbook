# audit

An external convention auditor. It sweeps **many repos across multiple owners**
(five in our case — a mix of GitHub orgs and personal accounts) plus local-only repos
with no GitHub presence, and reports where each drifts from the handbook.

This used to be an in-repo CI job (`validate-conventions.yml`). It is not any more: a
guard living inside a repo can only see that one repo, has to be copied everywhere to
be useful, and rots differently in each copy. The failure mode that actually bites is
drift **between** repos — one on Node 20, its sibling on Node 22 — which no single
repo's CI can ever detect. So this is one auditor, run from one place, over all of
them.

It is **advisory**. It gates nothing. Run it by hand, or on a schedule (cron /
LaunchAgent).

## Requirements

- Node (plain, no dependencies).
- `gh`, authenticated — only needed for entries given as `owner/name` slugs. Entries
  given as local paths need nothing but a filesystem.

## Usage

```sh
node audit.mjs                          # audit the resolved repo list (see below)
node audit.mjs --quiet                  # only repos with findings
node audit.mjs --json                   # machine-readable, for a dashboard/cron
node audit.mjs --local ~/code/my-repo   # one local path, ad hoc (repeatable)
node audit.mjs my-org/my-repo           # one remote slug, ad hoc
node audit.mjs --config other-list.txt  # a different repo list
```

Exit code: `0` when every repo passes, `1` when any repo has a finding, `2` on a
usage error. A repo that is missing, broken, or has no `project.yml` produces a
finding — it never crashes the sweep. The header prints which repo list was used and
the handbook's current version, so a scheduled run is self-documenting.

## What it checks, per repo

- `.github/project.yml` present, parses, and has the required keys.
- Tier ↔ trunk coherence: tiers A and C → `dev`, tier B → `main`.
- Tier A must have a `deploy-*.yml` workflow **and** a non-null `production`, and must
  not say `deploy: none`.
- Tier A must not say `deploy: push-main` — a **tier mismatch**, not a bad mechanism. The
  value stays legal and describes those repos truthfully (a `main` push really does deploy
  them); what it cannot do is meet tier A's contract that a deliberate release artifact
  gates production, since every push to `main` reaches users. Options include migrating to
  a tag trigger (`deploy: tag`) or, if it genuinely ships by hand, `deploy: manual` +
  `runbook:` — but the usual fix is **retiering to C**, which is exactly this shape and
  needs no pipeline change at all.
- Tier C rules: `trunk: dev`, non-null `production`, `deploy: push-main`, and a
  `deploy-*.yml` workflow. A wrong `deploy` value on C is redirected to the tier that
  matches its gate count rather than merely rejected — `tag` and `manual` point back to A,
  `none` points to B.
- `deploy: manual` must name a `runbook:` and the file must exist (a local checkout is
  authoritative; over the API a miss is only an advisory).
- Tier B must have `deploy: none`, no `production` URL, and no deploy workflow. (This
  was silently unchecked before — a tier B repo could quietly ship to production with
  none of the tier A gates.)
- The declared `trunk` branch actually exists.
- **Trunk is CI-gated** — at least one CI workflow triggers on **push to the declared
  trunk**. Merges land on the trunk as pushes; if the CI workflows' `on.push.branches`
  still name the *old* trunk after a `main → dev` move, every merge runs zero CI while
  the B1 gate ("check trunk CI is green") checks runs that can never exist (this bit
  three of our Tier A repos for real). **⚠ finding** when no CI-type workflow gates
  push to the trunk — the message lists what the workflows *do* gate
  (`trunk "dev" is not CI-gated … (ci.yml gates: main, master)`).
  - Deploy/release workflows are **not** CI gates and are excluded — by filename
    (`deploy*`/`release*`) and by trigger shape (a **tags-only** or
    **`workflow_dispatch`-only** workflow does no branch gating). So a `deploy-*.yml`
    firing on a push to `main` is never *counted as CI* here; only CI-type gating of the
    **trunk** is what this check is about. That exclusion is scoping: whether such a repo
    should be tier A is a separate check (see the `project.yml` rules above).
  - A repo with **no CI-type workflow at all** is out of scope (that is "should this
    repo have CI?", a different question) — the check only catches CI that *exists but
    points at the wrong branch*.
  - **Advisory (·)** when a workflow's branch list names a branch that **does not
    exist** in the repo — the stale-reference anti-pattern (`ci.yml triggers on
    nonexistent branch(es): develop, workos`). Standard integration aliases
    (`main`/`master`/`dev`/`trunk`) are exempt, since teams list them defensively;
    glob patterns like `release/*` are skipped too.
  - The `on:` block is read by a small indentation-aware parser (not the flat
    project.yml reader): it handles flow lists (`branches: [main, dev]`), block lists,
    inline `on: push` / `on: [push, pull_request]`, and `branches-ignore`.
- Branch names match `^(feat|fix|docs|chore|refactor|test|perf)/[a-z0-9._-]+$`
  (integration branches `main`/`dev`/`master`/`trunk` exempt).
- **Toolchain agreement** — flags when `project.yml`, the ecosystem manifest
  (`.nvmrc` / `engines.node` / `composer.json require.php`), and the versions the
  workflows actually pin disagree. It **reports**, it does not auto-resolve. Two
  workflows pinning different majors (the ci.yml=20 / deploy=22 bug) is a hard finding.
- **Handbook reconciliation (stamps)** — copied templates carry a stamp naming the
  template and the handbook version they were copied at (`colab template` writes it;
  see `templates/`). The audit compares each stamp against the handbook's own git
  history:
  - Template **changed** since the stamped version → **⚠ finding** ("copied @ vX —
    template changed since (vY): review, re-copy via colab template").
  - A workflow that **looks** like a handbook copy (matching filename or a content
    fingerprint) but carries **no stamp** → advisory (can't track drift).
  - Stamp naming an **unknown** template, or a version **newer** than the handbook, or
    a version **not in this checkout** → advisory.
  - The same comparison runs for a `CLAUDE.md` conventions block against
    `templates/repo-CLAUDE-block.md`.

  Reconciliation needs the handbook's version = `git describe --tags --abbrev=0` in
  this checkout (override the handbook location with `COLAB_HANDBOOK`). **Before any
  tag exists** the version is treated as `v0` and stamp comparisons are **inactive**
  (the header says so) rather than failing.

  This stamp reading is **shared code**, not a copy: it lives in `tools/lib/stamp.js` and
  is used both here and by `colab update`, which refreshes what this tool reports. Two
  implementations that disagreed about what "behind" means would be the exact
  two-places-drift disease this handbook exists to kill. The module is CommonJS (the CLI
  is); this ESM file pulls it in through `createRequire`.

  The audit **reports** drift; `colab update` is the other half of the loop — it can
  rewrite a copy that is provably pristine, and refuses to touch a hand-edited one. See
  `tools/README.md`.

`stack` is intentionally **not** validated — it is a free-form string now.

## The repo list — resolution order

The list of repos to audit is resolved highest-precedence first:

1. `--config <path>` — explicit; errors if the path is missing.
2. `~/.colab/repos.txt` — the **machine-local, private** fleet registry (override the
   directory with `COLAB_HOME`, matching the `colab` CLI). Used automatically when it
   exists. **This is where your real repo list lives** — it is not committed anywhere.
3. `audit/repos.txt` — the committed **neutral example** in this repo. Fallback only;
   it contains format docs and placeholder entries, no real repo names (this handbook
   repo may be public, so a list of private paths/slugs must not live in it).

To build your real list: `mkdir -p ~/.colab && cp audit/repos.txt ~/.colab/repos.txt`,
then replace the examples. Format: one entry per line, `#` for comments; each entry is
an absolute path (audited from the working tree, faster, sees local branches) or an
`owner/name` slug (audited through the GitHub API, nothing cloned). Local-only repos
with no remote are valid — just give the path.
