# `.github/project.yml` — field reference

The per-repo marker file. One flat YAML document, committed, at
`.github/project.yml`. It exists so a human or agent can learn the repo's state
with zero API calls — including in repos that have no GitHub remote at all.

Keep it flat. No nesting, no anchors — the readers (the audit tool, the `colab`
CLI, CI resolution steps) deliberately use a minimal YAML subset.

## Fields

### `tier` — required

`A` or `B`.

- `A` — the repo deploys to a production target **that exists today**.
- `B` — everything else. The default; an imminent launch is still `B`.

### `trunk` — required

The branch sessions merge into. Must be `dev` when `tier: A`, `main` when
`tier: B`. Any other value is a finding.

### `production` — required

The production URL as a string, or `null`. Must be non-null when `tier: A`,
`null` when `tier: B`.

### `deploy` — required

What triggers a deploy.

- `tag` — pushing a `v*.*.*` tag deploys. Required value for `tier: A`.
- `none` — nothing deploys. Required value for `tier: B`.
- `push-main` — legacy; tolerated for repos not yet migrated, reported by the
  audit tool as advisory. New repos must not use it.

### `stack` — required

**Free-form string.** Describe the repo honestly: `laravel-inertia`,
`capacitor-vite`, `astro-static`, `go-cli`, … There is no fixed list — a closed
enum was tried and immediately failed on a repo that fit no bucket. Used by
humans and agents for orientation, never for machine dispatch.

### `ports` — optional

```yaml
ports: [5220]
```

TCP ports reserved for this repo's **trunk dev server(s)**. The `colab` CLI
aggregates `ports:` across all registered repos into the machine-wide reserved
set and will never allocate these to a worktree — even when the trunk server is
currently down. One declaration here replaces any hand-maintained central list.

Omit if the repo has no dev server (CLI tools, libraries).

### `worktreePorts` — optional

```yaml
worktreePorts: [47150, 47199]
```

A two-element `[lo, hi]` range naming the window that **worktrees of this repo**
allocate ports from. Distinct from `ports:` — those are the repo's *reserved trunk*
ports (never handed out); `worktreePorts` is where `colab worktree new` /
`colab port alloc` *search* for free ones when working on this repo.

Precedence when allocating: explicit `--range`/`--at` flag > this field > the
machine-global `config.portRange`. Malformed values fall through to the default.
Keep the window disjoint from every repo's reserved `ports:` — the allocator
refuses reserved ports anyway, but a disjoint window avoids churn. Parity/pairing
schemes are not expressed here; use `--at` or a `post-create` hook.

### `autonomy` — optional

```yaml
autonomy: auto-trunk     # manual (default) · auto-trunk
```

How much of a session's Phase B (merge to **trunk**) an agent may perform alone.

- `manual` (or absent) — an agent stops after Phase A; a human triggers the merge.
- `auto-trunk` — an agent may complete the trunk merge itself **through `colab ship`
  only**, and only when every precondition passes: trunk CI alive and green, no new
  DB migrations in the branch, no hand-code conflicts after sync-regen. Any ✗ falls
  back to asking a human.

This grants **trunk** autonomy only. Promotion `dev` → `main`, tags, and anything
that deploys remain human acts on every repo, always — the field cannot express
otherwise. The grant lives in the repo file (not the caller's flags) so autonomy is
a property of the repo's risk profile, reviewed in a commit like any other change.

### `promotion` — optional

```yaml
promotion: main-loop     # human (default) · main-loop
```

Who may run the **promotion** (`trunk → main`, via `colab promote`) without a
per-instance human word. Distinct from **release** (the tag), which is always human.

- `human` (or absent) — promotion needs `COLAB_HUMAN=1`.
- `main-loop` — the main loop may promote unattended, **but only on a
  `deploy: tag` repo**, where promotion is verification-only (main runs the heavy
  suite; nothing deploys).

Unknown values fail closed to `human`. This field **cannot** lower the bar set by
`deploy:` — on a `deploy: push-main` repo promotion *is* the production deploy and
always requires `COLAB_HUMAN=1`. Nothing here ever authorizes tagging.

The full permission ladder, one rung per boundary:
**ship** (branch→trunk, gated by `autonomy`) · **promote** (trunk→main, gated by
`deploy`+`promotion`) · **release** (tag, always human).

### `generated` — optional

```yaml
generated: ["resources/js/routes/**", "schemas/lock.json"]
```

Path globs that are **regenerated, not authored** (codegen output, lockfiles).
`colab ship` treats a sync-merge conflict confined to these as resolvable by the
repo's `.colab/hooks/pre-ship` regen step instead of forcing a human. Extends the
built-in default set (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`,
`composer.lock`, `Cargo.lock`, `go.sum`, `dist/`, `build/`, `public/build/`, `.astro/`).

### `node`, `php` — optional toolchain pins

```yaml
node: 22
php: 8.4
```

Explicit toolchain versions. These **win** over the ecosystem manifest
(`.nvmrc`, `package.json → engines`, `composer.json → require.php`) per the
precedence in [CONVENTIONS.md §7](CONVENTIONS.md#7-ci-and-toolchain). Use only
when the manifest cannot express the truth, or for a deliberate pin — the
manifest is the normal answer. If neither source declares a version, CI must
fail, not guess.

When a pin here contradicts the manifest, the audit tool reports it. That is
intentional: a disagreement is a finding to surface, not to auto-resolve.

## Examples

Tier B (no production yet):

```yaml
tier: B
trunk: main
production: null
deploy: none
stack: capacitor-vite
ports: [5220]
```

Tier A (live product):

```yaml
tier: A
trunk: dev
production: https://shoots.tempofast.com
deploy: tag
stack: laravel-inertia
ports: [7468, 7469]
php: 8.4
```

## Validity rules (what the audit tool checks)

| Rule | Failure it prevents |
|---|---|
| file present and parseable | undescribed repo — agents guess |
| `tier` ∈ {A, B} | — |
| `tier: A` → `trunk: dev`, `deploy: tag`, `production` non-null, a deploy workflow exists | a release branch nothing consumes |
| `tier: B` → `trunk: main`, `deploy: none`, `production: null` | ceremony without benefit |
| declared `trunk` branch actually exists | docs describing a repo that doesn't exist |
| toolchain pin vs manifest agreement | building on one version, deploying on another |
