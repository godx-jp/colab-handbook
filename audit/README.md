# audit

An external convention auditor. It sweeps **many repos across multiple owners**
(godx-jp, vo2vo, tiximax-net, rika-entertainment, betoya-jp) plus local-only repos
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
node audit.mjs                          # audit every entry in repos.txt
node audit.mjs --quiet                  # only repos with findings
node audit.mjs --json                   # machine-readable, for a dashboard/cron
node audit.mjs --local ~/Future/foo     # one local path, ad hoc (repeatable)
node audit.mjs godx-jp/hr-double        # one remote slug, ad hoc
node audit.mjs --config other-list.txt  # a different repo list
```

Exit code: `0` when every repo passes, `1` when any repo has a finding, `2` on a
usage error. A repo that is missing, broken, or has no `project.yml` produces a
finding — it never crashes the sweep.

## What it checks, per repo

- `.github/project.yml` present, parses, and has the required keys.
- Tier ↔ trunk coherence: tier A → `dev`, tier B → `main`.
- Tier A must have a `deploy-*.yml` workflow **and** a non-null `production`, and must
  not say `deploy: none`.
- Tier B must have `deploy: none`, no `production` URL, and no deploy workflow. (This
  was silently unchecked before — a tier B repo could quietly ship to production with
  none of the tier A gates.)
- The declared `trunk` branch actually exists.
- Branch names match `^(feat|fix|docs|chore|refactor|test|perf)/[a-z0-9._-]+$`
  (integration branches `main`/`dev`/`master`/`trunk` exempt).
- **Toolchain agreement** — flags when `project.yml`, the ecosystem manifest
  (`.nvmrc` / `engines.node` / `composer.json require.php`), and the versions the
  workflows actually pin disagree. It **reports**, it does not auto-resolve. Two
  workflows pinning different majors (the ci.yml=20 / deploy=22 bug) is a hard finding.

`stack` is intentionally **not** validated — it is a free-form string now.

## Config: `repos.txt`

One entry per line, `#` for comments. Each entry is either an absolute path (audited
from the working tree, faster, sees local branches) or an `owner/name` slug (audited
through the GitHub API, nothing cloned). Local-only repos with no remote are valid —
just give the path.
