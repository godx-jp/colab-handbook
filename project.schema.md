# `.github/project.yml` — field reference

The per-repo marker file. One flat YAML document, committed, at
`.github/project.yml`. It exists so a human or agent can learn the repo's state
with zero API calls — including in repos that have no GitHub remote at all.

Keep it flat. No nesting, no anchors — the readers (the audit tool, the `colab`
CLI, CI resolution steps) deliberately use a minimal YAML subset.

## Fields

### `tier` — required

`A`, `B` or `C`. The tiers differ in **how many gates stand between a merge and
users**:

| Tier | Production | Gates | Shape |
|---|---|---|---|
| `B` | none | 0 | one branch, `main`. Nothing to deploy. |
| `C` | yes | 1 | promotion `dev` → `main` **is** the deploy. |
| `A` | yes | 2 | promotion verifies; a **tag** deploys. |

- `B` — no production target. The default; an imminent launch is still `B`.
- `C` — live, but the promotion itself ships it. `C` is `A` minus the tag.
- `A` — live, and a deliberate release artifact (the tag) gates production.

**A/B/C are labels, not grades.** Read naively `C` looks like a worse `B`, but
`B` has no production at all — a tier B repo cannot break anything for users,
because there are no users. The letters name *shapes*, not maturity, and moving
from `B` to `C` is not a demotion any more than `C` to `A` is a promotion in
quality. Pick the one that describes your pipeline truthfully; a repo claiming a
gate it does not have is the failure this file exists to prevent.

Whether production exists is the tier question. *How* it deploys — a tag, a
`main` push, a human following a runbook — is [`deploy`](#deploy--required)'s
job, and the two must agree.

### `trunk` — required

The branch sessions merge into. Must be `dev` when `tier: A` **or** `tier: C`,
`main` when `tier: B`. Any other value is a finding.

This holds for hand-deployed Tier A repos too (`deploy: manual`), and the shape
earns its keep there rather than being ceremony: `main` is **what is currently
running on the host**, `dev` is where sessions land, and the `dev` → `main`
promotion is the deliberate "I am about to deploy" act. Without automation,
that merge is the only record of what shipped and when — collapsing the two
branches would erase it.

Tier C keeps the identical split for the identical reason. There `main` is
literally what is live — the promotion deploys it — so collapsing the branches
would remove the only moment at which anyone decides to ship.

### `production` — required

The production URL as a string, or `null`. Must be non-null when `tier: A` or
`tier: C`, `null` when `tier: B`.

### `deploy` — required

**How** the repo reaches production — never **whether** it is Tier A. The tier
test is "does a deploy target exist today?" ([CONVENTIONS.md §9](CONVENTIONS.md#9-adopting-this));
`deploy` only describes the mechanism a Tier A repo uses.

- `tag` — pushing a `v*.*.*` tag deploys. A deploy workflow must exist.
- `manual` — production exists, but shipping is a **human running a documented
  procedure** (rsync + `docker compose up -d --build`, an upload, a console
  action) with no workflow and no tag trigger. Requires [`runbook:`](#runbook--required-when-deploy-manual).
- `none` — nothing deploys. Required value for `tier: B`.
- `push-main` — a push to `main` **is** the deploy. The required value for
  [`tier: C`](#tier--required), and a finding on `tier: A` — see below.

`push-main` describes a real mechanism truthfully: for the repos using it,
pushing `main` really does deploy. It has a home — **tier C is exactly this
shape** — and the finding is on the **combination** `tier: A` + `push-main`,
never on the value itself.

**It is a tier mismatch, not a bad way to deploy.** Deploying on a `main` push
is a reasonable choice for plenty of software. What it cannot do is meet Tier
A's contract, which is that a **deliberate release artifact gates production**
— promote code now, decide to ship it later ([§6](CONVENTIONS.md#6-releases)).
Where every push to `main` reaches users, there is no such artifact and no such
gate, so a repo claiming Tier A is claiming a guarantee its pipeline does not
provide. Options:

1. **Retier to `C`** — usually the right answer. Tier C *is* this shape, so
   nothing about the pipeline changes; the descriptor simply stops claiming a
   gate that was never there. This is the option that did not exist when the
   finding was first written.
2. **Migrate the pipeline to a tag trigger** → `deploy: tag`, staying tier A.
   Choose this when the site has earned a release ritual someone will actually
   honour.
3. **If shipping really is run by hand**, say so → `deploy: manual` plus
   [`runbook:`](#runbook--required-when-deploy-manual). Not a downgrade — an
   accurate description, which is always worth more than a flattering one.

A tag ritual nobody honours is worse than no tag ritual: it puts a gate in the
docs and not in the pipeline, and then people trust the docs.

`manual` exists because the alternatives were both false. A hand-deployed live
repo declaring `deploy: tag` fails the deploy-workflow rule; declaring `tier: B`
forces `production: null`, which states that a live product does not exist. A
repo whose documentation lies is the outcome this handbook exists to prevent
([§8](CONVENTIONS.md#8-conformance-and-reconciliation)), so the vocabulary has
to cover the case honestly.

**`manual` grants no automation.** It is strictly *less* automated than `tag`,
and the permission ladder treats it that way: `colab promote` allows an
unattended promotion only on a `deploy: tag` repo, where promotion is
verification-only. On a `manual` repo, promotion is the deliberate "I am about
to deploy" act, so it needs `COLAB_HUMAN=1` — exactly like `push-main`, and
`promotion: main-loop` cannot lower it. See [`promotion`](#promotion--optional).

### `runbook` — required when `deploy: manual`

```yaml
runbook: docs/deploy.md
```

Repo-relative path to the committed document describing the hand-deploy: the
hosts, the commands, the order, and how to verify it worked. The audit checks
that the path actually exists.

It is required because an unwritten hand-deploy is how a repo ends up with
exactly one person who can ship it. Automated deploys document themselves in
the workflow file; a manual one has to be written down or it is not knowledge,
it is folklore. Omit the key on any other `deploy` value.

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
`deploy:` — on a `deploy: push-main` repo promotion *is* the production deploy, and
on a `deploy: manual` repo promotion is the human's signal to run the deploy; both
always require `COLAB_HUMAN=1`. Only `deploy: tag` makes promotion
verification-only, so only there can `main-loop` apply. Nothing here ever
authorizes tagging.

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

Tier C (live, and the promotion is the deploy — no tag ritual):

```yaml
tier: C
trunk: dev
production: https://site.example.com
deploy: push-main
stack: astro-static
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

Tier A, deployed by hand (live, but no workflow and no tag trigger):

```yaml
tier: A
trunk: dev
production: https://app.example.com
deploy: manual
runbook: docs/deploy.md
stack: fastapi + vite spa
```

## Validity rules (what the audit tool checks)

| Rule | Failure it prevents |
|---|---|
| file present and parseable | undescribed repo — agents guess |
| `tier` ∈ {A, B, C} | — |
| `tier: A` → `trunk: dev`, `production` non-null, `deploy` ∈ {`tag`, `manual`} | a release branch nothing consumes |
| `tier: A` + `deploy: push-main` → **finding**, pointing at tier C | claiming a release gate the pipeline does not have |
| `tier: C` → `trunk: dev`, `production` non-null, `deploy: push-main`, a deploy workflow exists | a tier whose shape does not match its mechanism |
| `deploy: tag` (or `push-main`) → a deploy workflow exists | a tier claimed but never wired up |
| `deploy: manual` → `runbook:` set, and the path exists in the repo | a hand-deploy only one person knows how to run |
| `tier: B` → `trunk: main`, `deploy: none`, `production: null` | ceremony without benefit |
| declared `trunk` branch actually exists | docs describing a repo that doesn't exist |
| toolchain pin vs manifest agreement | building on one version, deploying on another |

`push-main` on a Tier A repo **is a finding** — a mismatch between the
mechanism and the tier's contract, not a judgement on the mechanism, and the
usual fix is `tier: C` rather than any pipeline change. (The wording here
previously promised an advisory that no code ever emitted, so what looked like
tolerance was in fact total silence — a doc describing behaviour the tool did
not have.) On Tier B the value is caught by the `deploy: none` rule instead: a
Tier B repo that deploys is mistiered, whatever mechanism it names.

On Tier C the wrong `deploy` value is likewise redirected rather than merely
rejected, because each one names a different gate count and therefore a
different tier: `tag` and `manual` both point back to A (two gates, and a
promotion that does not itself deploy), `none` points to B.

The runbook path is verified against a **local working tree**. When a repo is
audited through the GitHub API (an `owner/name` entry) there is no tree to
stat, and a failed read cannot be told apart from a missing file, so a miss is
reported as an advisory instead of a violation.
