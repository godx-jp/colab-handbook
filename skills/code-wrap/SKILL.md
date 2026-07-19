---
name: code-wrap
description: "Close a coding session in two phases. Phase A (an agent may do it): distill what you learned back onto the feature's GitHub Issue, update any repo docs the work made stale, run the repo's own quality gate, commit only the deliverable paths, push the session branch as backup — then STOP. Phase B (a human triggers it): verify trunk CI is alive and green, squash-merge with Closes #N, release the claim, optionally tear the worktree down. A Tier A release is a separate ritual, never bundled in. Trigger phrases: 'wrap up the session', 'finish coding', 'ship it', 'close the session', 'merge to trunk', 'merge it', 'done coding', 'update the issue and merge'. Pairs with code-start. Agents prepare releases; humans perform them."
---

# code-wrap — close a session: distill → docs → gate → commit → (stop) → merge

Two phases. **Phase A runs now** and ends with the branch pushed as a backup.
**Phase B runs only when a human says go** — merging to trunk is a human decision.

Notation: `$N` = the feature's Issue number · `<trunk>` = the branch sessions
merge into (from `.github/project.yml`; `main` for Tier B, `dev` for Tier A).

## Principle

**Agents prepare releases; humans perform them.** Your job ends with the trunk
merge prepared and the Issue updated. Do not open a PR, push trunk, promote to
`main`, or tag on your own.

---

## Phase A — do this now

### A1. Distill knowledge onto the Issue

The Issue is the feature's external memory — write so the next session gets full
context from `gh issue view $N` without re-reading the codebase.

```sh
gh issue view $N                         # then edit the body:
gh issue edit $N --body-file <tmpfile>   # tick the checklist, add Decisions/Gotchas
gh issue comment $N -b "**<YYYY-MM-DD>** — did X, decided Y, left Z open."
```

- Record **reusable knowledge** — a decision and *why*, a gotcha, a dead end —
  not a copy of the diff. The code is already in git.
- No GitHub remote? Write the same into the session notes file from code-start.

### A2. Update repo docs the work made stale

The Issue is the feature's log; **docs in the repo are the living knowledge** the
next person reads without digging through Issues. If this session changed any of
these, update the doc **in the same session** (don't leave "will update later" in
a comment while the file stays wrong):

- Domain model changed (new entity/table, renamed concept, new flow) → the
  architecture doc.
- Infra/ops changed (deploy, env, DNS, service account, runbook) → the deploy doc.
- A long-lived gotcha (bites again, not tied to one feature) → the contributing/gotchas doc.

Never write a secret into docs — only *where it lives* (a GitHub Secret, `.env`
on the server, a password manager). Docs are deliverable paths; commit them in A3.

### A3. Run the repo's own quality gate

Run whatever this repo's CI runs — resolve it from the repo, don't assume:

```sh
# Node:    npm run lint / types:check / test   (whichever scripts exist)
# Laravel: vendor/bin/pint --dirty ; php artisan test --compact
# else:    read .github/project.yml `stack` and .github/workflows/ to find the gate
```

Gate red because of your change → fix it. Never make it green by loosening the
test. If it's red for a reason unrelated to your work, that's a finding — report
it, don't paper over it (`CONVENTIONS.md` §8).

### A4. Commit only the deliverable paths

```sh
git add <specific deliverable paths>   # NOT git add -A
git status                             # confirm no local/preview/config files sneak in
git commit                             # Conventional Commits: type(scope): summary
```

Conventional-Commit prefix is mandatory — release notes group on it, so an
unprefixed commit is invisible in the changelog (`CONVENTIONS.md` §4).

### A5. Push the session branch as backup — then STOP

```sh
git push -u origin <branch>    # a backup/record, NOT a PR, NOT trunk
```

**Stop here.** Wait for an explicit human go-ahead ("OK, merge it") before Phase B.

---

## Phase B — only after a human says go

### B0. Sync trunk into the branch, regen generated files (before merging)

Merge conflicts here are almost always **generated files** (codegen locks,
duplicate-timestamp migrations, generated route/type files) — they happen when a
branch regenerated on an old base while trunk moved ahead. Cure it in the branch,
before touching trunk. Skip if trunk hasn't moved since you branched
(`git rev-list --count <branch>..origin/<trunk>` = 0):

```sh
git fetch origin <trunk>
git merge origin/<trunk>       # conflicts in generated files → the regen below overwrites them
# then re-run the repo's codegen on the merged base, e.g. npm run build / codegen
git add -A && git commit -m "chore(sync): merge <trunk> + regen generated files"
```

Re-run the gate (A3) — a fresh-migrate test must pass, proving both branches'
migrations run clean together. *(Machine-specific reconcile — e.g. deduping a
migration against one already on trunk — hooks in here; the universal rule is
"regen on the merged base, never hand-merge generated files".)*

### B1. Verify trunk CI is alive AND green

```sh
gh run list --branch <trunk> -L 1
```

A "failure" that never started (billing lockout, runner outage) still means
**stop** — we once merged for 12 hours into repos whose CI was silently dead
(`CONVENTIONS.md` §4). Branch protection can't check this for us; this command must.

### B2. Squash-merge with `Closes #N`

```sh
git checkout <trunk> && git pull
git merge --squash <branch>
git commit    # subject: type(scope): …  · body: Closes #N   (one line per issue in the group)
git push origin <trunk>
```

- **`Closes #N`, not a bare `(#N)`** — GitHub only auto-closes on the keyword. We
  measured 26/30 issues left open with their code long merged because commits
  said `(#N)` (`CONVENTIONS.md` §4).
- One `Closes #N` per issue the branch carried — sweep them all, don't close only
  the "main" one.
- *(Machine-specific automation — migrate the trunk DB, restart the trunk dev
  server — hooks in here: `.colab/hooks/`. It is the one moment trunk may go down;
  keep the window short.)*

### B3. Release the claim(s)

```sh
colab release $N        # if colab is installed …
gh issue edit $N --remove-label in-progress    # … else raw, one per issue
```

Release **every** issue in the group, even ones you didn't finish — a stale claim
silently blocks others (`CONVENTIONS.md` §5).

### B4. Tear down the worktree (optional)

Finished-but-not-removed worktrees are the single most-skipped step we measured.
If you made one:

```sh
colab worktree rm <name>    # if colab is installed (releases its claims, frees its ports) …
git worktree remove <path>  # … else raw git
```

`colab worktree rm` runs the repo's `.colab/hooks/pre-remove` (e.g. dropping a
cloned DB) and refuses if there's uncommitted tracked work. Can't remove it
(uncommitted, unsure)? Say so in your report — don't silently leave it.

### B5. Tier A release — a SEPARATE ritual, and not yours

Merging to trunk is **not** a release. A Tier A release is promotion `dev` →
`main` (`--no-ff`, never squash) plus a `v*.*.*` tag — performed by the human
operator, per `CONVENTIONS.md` §6. If you believe a release is overdue (a
production fix is merged but unreleased), say so explicitly in your report; do
not perform it.

---

## Verify complete

- `gh issue view $N`: checklist ticked, Decisions/Gotchas updated, session comment added.
- Every issue the branch carried is either closed with evidence, split into a new
  issue for the leftover, or left open with a written reason. No number left dangling.
- If Phase A only: trunk is unchanged (no session commit in `git log <trunk>`).
- After Phase B: `git log --oneline -5 <trunk>` shows the squash-merge; claims released;
  worktree removed or explicitly kept.
