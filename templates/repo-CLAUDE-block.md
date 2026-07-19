<!-- Paste this into your repo's own CLAUDE.md. It is how an agent working in the repo
     discovers the handbook — nothing else points here. Fill the <placeholders>. -->

## Conventions

This repo follows the [colab-handbook](https://github.com/godx-jp/colab-handbook/blob/main/CONVENTIONS.md) conventions.

- **Tier:** `<A|B>` — <A = deploys to production · B = no production target>
- **Trunk:** `<dev|main>` (feature branches `feat|fix|docs|chore|refactor|test|perf/<slug>`)
- **Descriptor:** see `.github/project.yml`. CI workflows are copy-and-own from the handbook's `templates/` — this repo owns its copies, they are not called remotely.
