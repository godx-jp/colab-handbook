# Templates

Starting points you **copy into your own repo**. That is the entire model.

> **These are NOT called remotely.** There is no `uses: godx-jp/colab-handbook/...`
> anywhere, and there is no reusable `workflow_call` here. An earlier version of this
> handbook told repos to call shared workflows; that was reversed. Every workflow now
> lives, in full, inside the repo that runs it. You copy the file, you edit it, **you
> own it.** Divergence between your copy and this template is expected — a shared
> workflow that silently changes under a hundred repos is the failure mode we are
> avoiding.

## What each template is for

| File | Copy to | For | Notes |
|---|---|---|---|
| `ci-node.yml` | `.github/workflows/ci.yml` | Pure Node repos: Vite SPA, node libs, Astro static, **Capacitor apps** | Resolves Node version from `project.yml` → `.nvmrc`/`engines` → **fails**. Never a default. |
| `ci-laravel.yml` | `.github/workflows/ci.yml` | Laravel + Inertia + Vite fullstack (Omnify) | Same resolution for **both** PHP and Node. Includes the sqlite bootstrap + explicit wayfinder step. |
| `ci-python.yml` | `.github/workflows/ci.yml` | Python: FastAPI/Flask services, CLIs, libraries | Resolves Python from `project.yml` → `.python-version`/`requires-python` → **fails**. `requirements.txt` does not count. **Hybrid** Python+Node repo: copy this, then paste `ci-node.yml`'s `build:` job alongside — see the template header. |
| `release-tag.yml` | `.github/workflows/release.yml` | Any repo cutting `v*.*.*` releases | Triggers on tag push. Publishes a grouped GitHub Release. No toolchain, no deploy. |
| `deploy-xserver.yml` | `.github/workflows/deploy-xserver.yml` | PHP-framework + Vite apps shipped to **shared hosting over SSH** (no root, no Docker): build on a runner, rsync, migrate on the server | Derived from three independently-written copies. Resolves Node the same way the CI templates do — all three hardcoded it, and one shipped on a different major than its CI built on. Migrates **production**; keeps a **mandatory** smoke test. Does **not** change your tier. |
| `repo-CLAUDE-block.md` | *paste into* `CLAUDE.md` | Every adopting repo | The discovery hook — how an agent finds the handbook at all. |

## How to adopt

1. **Copy — use `colab template`.** It copies the template *and* prepends a version
   stamp in one act, so the audit can later tell you when the source moved on:

   ```sh
   colab template                                   # list templates + handbook version
   colab template ci-node   --dest .github/workflows/ci.yml
   colab template release-tag --dest .github/workflows/release.yml
   colab template deploy-xserver --dest .github/workflows/deploy-xserver.yml
   ```

   The stamp is one prepended line — `# colab-handbook: <name> @ <version>`. Do a plain
   `cp` only if you have no `colab` on PATH, and then add that stamp line by hand
   (an unstamped copy is untrackable — the audit will nag you to re-copy).
2. **Walk the `# EDIT:` markers.** Each one is a decision only your repo can make:
   which branches exist, self-hosted runner or not, the build command, working
   directory.
3. **Declare your toolchain.** The CI templates refuse to guess a version. Put it in
   `.github/project.yml` (`node: "22"`, `php: "8.4"`, `python: "3.13"`), or rely on
   `.nvmrc` / `package.json engines.node` / `composer.json require.php` /
   `.python-version` / `pyproject.toml requires-python`. If none of these exists,
   CI fails on purpose with a message telling you to declare it. Note that
   `requirements.txt` is **not** one of these — it pins dependencies, not the interpreter.
4. **Add `.github/project.yml`** if you have not — copy the reference at the handbook's
   own `.github/project.yml`. The audit tool and the CI resolution step both read it.
5. **Paste the CLAUDE block** (`repo-CLAUDE-block.md`) so the next agent in the repo can
   find its way back here. Set its `<!-- colab-handbook @ <version> -->` stamp to the
   handbook version you adopted at.
6. **Own it.** From this point the file is yours. Edit freely; nothing overwrites it.

### Adopting the deploy template — the extra steps

A deploy workflow is the only template that can break something that is already
live, so it carries obligations the CI ones do not:

1. **Do the one-time server preparation first.** It is a checklist in the
   template header — subdomain, certificate, database, the server-side `.env`, the
   deploy key in `authorized_keys`. None of it is automated and the first deploy
   fails without it. Copy that checklist into the repo's runbook rather than
   leaving it in a workflow comment.
2. **Fill the `env:` block, and nothing below it.** Every per-repo value — host,
   user, paths, the server's PHP binary, the smoke URL — lives in that one block
   precisely so your diff against this template stays readable. Editing step
   bodies instead is how the three ancestors of this file drifted ~120 lines apart.
3. **Add the secret, one per repo.** `DEPLOY_SSH_KEY`, never shared between repos
   even when they deploy into the same hosting account: a shared key cannot be
   rotated for one of them, and a leak from any reaches all.
4. **Make `project.yml` true.** A tag deploys only where `deploy: tag` is
   declared. **This does not change your tier** — tier says whether production
   exists and how many gates guard it, and it moves only by the §9 checklist. If
   the repo was `deploy: manual`, switching it now is a deliberate edit (and drop
   the `runbook:` that is no longer the mechanism). Adopting this into a Tier B
   repo is not an adoption at all: it is giving the repo a production, which is a
   different decision.
5. **Keep the smoke test.** It is the only step that distinguishes "the workflow
   went green" from "the site answers", and a deploy can do the first while
   failing the second.
6. **Retro-fitting an existing hand-written deploy workflow is a per-repo job, by
   hand.** Those files have local edits — extra artisan commands, app-specific
   backfills — that a blind overwrite destroys. `colab update` will classify such
   a file as `unrelated` (its name matches this template, its content never came
   from here) and refuse to touch it. That is correct: diff the two yourself and
   move across only what you mean to.

## Reconciliation — how you find out when a template changes

Because you own your copy, nothing pushes updates to you. Instead the copy is
**stamped** with the handbook version it came from, and `audit/audit.mjs` compares that
stamp against the handbook's git history. When a template you copied has changed since
your stamp, the audit flags it: review the diff, take what you want, and re-run
`colab template … --force` to re-stamp. That is the whole loop — no remote calls, no
silent updates, just an honest report that you are behind.

## Keeping honest

`audit/audit.mjs` in this handbook sweeps many repos and reports when a `project.yml`
is missing or incoherent, when a declared toolchain disagrees with what CI actually
pins, when branch names drift, and when a stamped copy has fallen behind its template.
It is advisory — run it locally or on a schedule. It is **not** wired into any repo's CI.

## Runner policy

Decided 2026-07-19, after a GitHub Actions billing lock stopped every
`ubuntu-latest` job org-wide while self-hosted runners kept working:

| Repo class | `runs-on` | Why |
|---|---|---|
| **Public** repo | `ubuntu-latest` | Free minutes, unaffected by billing — and **never** self-hosted: a fork PR would execute arbitrary code on your runner. |
| **Private** CI | the org's `[self-hosted, ...]` runner **where one exists**; `ubuntu-latest` otherwise | Immune to billing, persistent tool caches, local network. Runners are registered per-org — one org's runner serves nothing in another org. Register a runner for an org when its billing or scale makes it worth it, not preemptively. |
| **Private** deploy | its own runner label | Deploys must never queue behind CI jobs. |

Self-hosted job hygiene: no `sudo`, install tools into `$RUNNER_TEMP`, never
write outside the workspace, prefer the runner's native toolchains. A shared
runner is infrastructure, not a throwaway VM.

### Self-hosted patterns that earn their place

- **Split a test matrix by purpose.** The leg matching production is the release
  gate → self-hosted (immune to billing/outage). Forward-compat legs (next PHP,
  next Node) are reconnaissance → keep them on hosted runners with
  `continue-on-error: true`. Losing an advisory signal during an outage is fine;
  losing the gate is not.
- **Service containers on a shared runner: never fix the host port.** The runner
  machine likely runs its own database on the default port. Publish the container
  port unmapped (`- 3306`) and read the randomly assigned host port from the job's
  service context (`job.services.mysql.ports['3306']`), threading it through your
  env. A fixed `3306:3306` works exactly until the first job lands on a runner
  that already listens there.
