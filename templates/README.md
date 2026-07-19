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
| `release-tag.yml` | `.github/workflows/release.yml` | Any repo cutting `v*.*.*` releases | Triggers on tag push. Publishes a grouped GitHub Release. No toolchain, no deploy. |
| `repo-CLAUDE-block.md` | *paste into* `CLAUDE.md` | Every adopting repo | The discovery hook — how an agent finds the handbook at all. |

## How to adopt

1. **Copy — use `colab template`.** It copies the template *and* prepends a version
   stamp in one act, so the audit can later tell you when the source moved on:

   ```sh
   colab template                                   # list templates + handbook version
   colab template ci-node   --dest .github/workflows/ci.yml
   colab template release-tag --dest .github/workflows/release.yml
   ```

   The stamp is one prepended line — `# colab-handbook: <name> @ <version>`. Do a plain
   `cp` only if you have no `colab` on PATH, and then add that stamp line by hand
   (an unstamped copy is untrackable — the audit will nag you to re-copy).
2. **Walk the `# EDIT:` markers.** Each one is a decision only your repo can make:
   which branches exist, self-hosted runner or not, the build command, working
   directory.
3. **Declare your toolchain.** The CI templates refuse to guess a version. Put it in
   `.github/project.yml` (`node: "22"`, `php: "8.4"`), or rely on `.nvmrc` /
   `package.json engines.node` / `composer.json require.php`. If none of these exists,
   CI fails on purpose with a message telling you to declare it.
4. **Add `.github/project.yml`** if you have not — copy the reference at the handbook's
   own `.github/project.yml`. The audit tool and the CI resolution step both read it.
5. **Paste the CLAUDE block** (`repo-CLAUDE-block.md`) so the next agent in the repo can
   find its way back here. Set its `<!-- colab-handbook @ <version> -->` stamp to the
   handbook version you adopted at.
6. **Own it.** From this point the file is yours. Edit freely; nothing overwrites it.

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
| **Private** CI | `[self-hosted, ...]` org runner | Immune to billing, persistent tool caches, local network. |
| **Private** deploy | its own runner label | Deploys must never queue behind CI jobs. |

Self-hosted job hygiene: no `sudo`, install tools into `$RUNNER_TEMP`, never
write outside the workspace, prefer the runner's native toolchains. A shared
runner is infrastructure, not a throwaway VM.
