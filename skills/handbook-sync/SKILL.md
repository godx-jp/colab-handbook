---
name: handbook-sync
description: "Bring ONE repo up to the current colab-handbook, from inside that repo. Classifies every copied artifact (CI workflows, the CLAUDE conventions block, guards), shows what upstream actually changed since your stamp, and grafts it in without destroying your local edits — because copy-and-own means the repo owns its copies. Also checks whether the tier model itself moved on. Trigger phrases: 'sync the handbook', 'update this repo to the latest handbook', 'we are behind the handbook', 'handbook drift', 'reconcile conventions', 'colab update says we are behind'. Wrap it in code-start/code-wrap — this is a code change like any other."
---

# handbook-sync — bring this repo up to the current handbook

`colab update` sweeps a machine and classifies; it refuses to write anything that
needs judgment. That refusal is correct — and it leaves you with a verdict and no
procedure. This is the procedure, run from inside the repo.

It also reaches what the sweep cannot: the registry is machine-local and private,
so a colleague's clone is invisible to `colab update`. This works on any checkout.

## Principle — this is a graft, not a refresh

Templates are **copy-and-own** ([`CONVENTIONS.md` §7](../../CONVENTIONS.md)). The
handbook never pushes; the moment you copied a file it became yours. So the job is
to take what upstream changed *and keep what you added*. A tool can do the provably
pristine cases. The rest is judgment, and pretending otherwise destroys work.

**Assume your copies are authored, not filled in.** Measured across one fleet: of 7
adopted repos, **6 had grown their CLAUDE conventions block** from the template's 3
bullets to 5–8 — merge rules, claim reminders, toolchain resolution, guardrails.
Regenerating any of them would have deleted real content. Sampled CI copies carried
a self-hosted runner, a whole extra Python job, and edited branch triggers.

`colab template <name> --force` overwrites wholesale. It is the last step of a
reconciliation, never the first.

## 0. Open a session first

This changes committed files, so it is a code change: run **code-start** — find or
create the Issue, claim it, branch off trunk. Do not edit trunk directly. Close with
**code-wrap**.

## 1. Establish where this repo stands

```sh
cat .github/project.yml                       # tier, trunk, deploy, toolchain pins
colab update .                                # classify this repo's stamped copies
node "$COLAB_HANDBOOK/audit/audit.mjs" --local .   # conformance beyond stamps
```

`colab update .` gives each copied artifact one of five states:

| State | Meaning | What you do |
|---|---|---|
| `current` | template unchanged since your stamp | nothing |
| `behind` | template genuinely changed since your stamp | §2 — refresh or graft |
| `diverged` | you hand-edited it since copying | §3 — graft only |
| `unstamped` | lineage unknown | §4 — establish it first |
| `n-a` | cannot assess, with a stated reason | read the reason; often a missing tag |

**`behind` does not mean "your file is old".** It means the *template* moved. If the
template never changed, a stamp from three releases ago is still current — which is
why this check compares template history, not version strings.

## 2. `behind` — let the tool write only what is provably pristine

```sh
colab update . --apply
```

This writes **only** copies still byte-identical to the template as of their own
stamp. It never commits, never stages, never touches a `diverged` or `unstamped`
file. If it reports "nothing was refreshable", that is a real answer, not a failure —
go to §3.

Then read what it wrote (`git diff`) before committing. A refreshed file may reintroduce
an `# EDIT:` marker your repo had already resolved.

## 3. `diverged` — graft the upstream change, keep yours

Do **not** re-copy. Get the delta you are actually missing:

```sh
git -C "$COLAB_HANDBOOK" diff <your-stamp>..<current-version> -- templates/<name>
```

That is usually small — a few lines — while your local edits may be dozens. Apply
those few lines by hand into your copy, keep everything of yours, then bump your
stamp line to the current version so the next check measures from here.

If the upstream change conflicts with why you edited the file, that is a **finding**:
say so on the Issue rather than silently choosing. Someone made both decisions for a
reason and they now disagree.

## 4. `unstamped` — establish lineage before touching anything

An unstamped copy cannot be safely rewritten: nobody knows what replacing it would
destroy. Work out which template it came from and how far it has drifted:

```sh
diff <(git -C "$COLAB_HANDBOOK" show <some-tag>:templates/<name>) <your-file>
```

Then either graft as in §3 and **hand-add the stamp line**, or — only if the copy
turns out to be genuinely untouched — `colab template <name> --force` and let it
stamp. Adding a stamp asserts provenance; do not assert one you have not checked.

## 5. The CLAUDE conventions block — always a graft

**Never regenerate this block.** It sits inside a hand-written `CLAUDE.md`, and the
template ships placeholders (`<A|B|C>`, `<dev|main>`) that an adopter fills in. Two
independent reasons not to automate it:

- Regenerating would replace your repo's real tier and trunk with angle brackets.
- Most repos have *extended* the block well past the template (measured: 6 of 7).

So diff the template between your stamp and now, and graft:

```sh
git -C "$COLAB_HANDBOOK" diff <your-stamp>..<current-version> -- templates/repo-CLAUDE-block.md
```

Add what upstream gained into your own wording, keep your extensions, bump the
`<!-- colab-handbook @ ... -->` line.

## 6. Beyond stamps — has the model itself moved?

Stamps track *file* drift. The conventions can move without any template changing,
and the audit is what catches it:

- A new tier may now describe this repo better than the one it declares. If the
  audit reports a tier mismatch, fixing `project.yml` is part of this work.
- Toolchain pins must still agree between `project.yml` and the manifest.
- A workflow may trigger on branches that no longer exist — CI passing on nothing.

Fix what is genuinely wrong; **report what you are unsure about** rather than
guessing. A `project.yml` that contradicts reality is worse than one that admits it.

## 7. Commit safely — two habits, both learned the hard way

```sh
git commit -o <paths> -m "chore(handbook): sync to <version>"   # ONLY these paths
git show --stat                                                 # verify the file list
```

- **`git commit` writes the index, not your intention.** If anything resets the index
  underneath you — a syncing filesystem, a concurrent process — a plain commit
  silently reverts unrelated files. Measured: a commit that staged only `templates/`
  deleted 13 lines from a documentation file edited an hour earlier. `-o <paths>`
  commits only what you name.
- **Check `git show --stat` every time.** If a file you did not touch appears, stop
  and look before pushing. It is far cheaper here than after a merge.

## Verify complete

- `colab update .` reports no `behind` for this repo.
- Every `diverged` item is either grafted and re-stamped, or left with a written
  reason on the Issue — never silently skipped.
- Every `unstamped` item is either stamped after checking lineage, or reported.
- `audit.mjs --local .` is clean, or each remaining finding is explained.
- `git show --stat` on your commits lists only files you meant to change.
