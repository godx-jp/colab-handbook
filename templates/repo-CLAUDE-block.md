<!-- Paste this into your repo's own CLAUDE.md. It is how an agent working in the repo
     discovers the handbook — nothing else points here. Fill the <placeholders>.
     Set the stamp below to the handbook version you copied at (`colab template` prints
     the current version, or run `git describe --tags` in the handbook). The audit reads
     this stamp to tell you when the conventions have moved on since — keep it, don't
     delete it. When you re-sync to a newer handbook, bump the version here. -->

## Conventions

<!-- colab-handbook @ <version> -->

This repo follows the [colab-handbook](https://github.com/godx-jp/colab-handbook/blob/main/CONVENTIONS.md) conventions.

- **Tier:** `<A|B>` — <A = deploys to production · B = no production target>
- **Trunk:** `<dev|main>` (feature branches `feat|fix|docs|chore|refactor|test|perf/<slug>`)
- **Descriptor:** see `.github/project.yml`. CI workflows are copy-and-own from the handbook's `templates/` — this repo owns its copies, they are not called remotely.
