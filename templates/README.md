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

1. **Copy** the template into the path in the table (rename it — templates are named
   by purpose; your workflow is named `ci.yml` / `release.yml`).
2. **Walk the `# EDIT:` markers.** Each one is a decision only your repo can make:
   which branches exist, self-hosted runner or not, the build command, working
   directory.
3. **Declare your toolchain.** The CI templates refuse to guess a version. Put it in
   `.github/project.yml` (`node: "22"`, `php: "8.4"`), or rely on `.nvmrc` /
   `package.json engines.node` / `composer.json require.php`. If none of these exists,
   CI fails on purpose with a message telling you to declare it.
4. **Add `.github/project.yml`** if you have not — copy the reference at the handbook's
   own `.github/project.yml`. The audit tool and the CI resolution step both read it.
5. **Paste the CLAUDE block** so the next agent in the repo can find its way back here.
6. **Own it.** From this point the file is yours. Edit freely; nothing overwrites it.

## Keeping honest

`audit/audit.mjs` in this handbook sweeps many repos and reports when a `project.yml`
is missing or incoherent, when a declared toolchain disagrees with what CI actually
pins, and when branch names drift. It is advisory — run it locally or on a schedule.
It is **not** wired into any repo's CI.
