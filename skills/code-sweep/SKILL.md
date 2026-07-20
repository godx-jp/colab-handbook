---
name: code-sweep
description: "Clear out everything finished in ONE repo: find every worktree whose work has landed, every issue whose code shipped but is still open, and every claim outliving its session — then put each through code-wrap, one at a time. The end-of-day job after several parallel sessions. Sorts candidates into wrap / teardown-only / claim-only / blocked, because most do not need a full wrap. Trigger phrases: 'sweep the repo', 'wrap everything finished', 'clean up the worktrees', 'close out the session work', 'tidy up finished work', 'wrap all the done branches'. Uses code-wrap per candidate; never batches merges."
---

# code-sweep — clear out everything finished, one at a time

After a few parallel sessions, two things drift apart:

- **worktrees** — merged but never torn down (measured: **8 of 9**, 2.9 GB of orphans)
- **issues** — shipped but still open, or closed but still holding a claim

This sweeps one repo and reconciles both. It does not replace
[`code-wrap`](../code-wrap/SKILL.md) — it finds the candidates and runs it per
candidate.

## Principle — sequential, and most candidates do not need a full wrap

**One at a time.** Every merge moves trunk, so the next candidate must sync against
the *new* trunk (code-wrap B0). Batching merges "to save time" produces exactly the
generated-file conflicts B0 exists to prevent.

**Sort before acting.** A worktree whose branch already landed needs teardown, not a
wrap. Running a full wrap on it re-does distillation nobody needs and risks a second
merge of the same content.

## 1. Enumerate — scoped to THIS repo

```sh
colab worktrees            # scope to this repo — see below
colab claims               # same
gh issue list --state open
gh issue list --label in-progress
```

⚠️ **`colab worktrees` and `colab claims` list the whole machine.** Scope them, or
the sweep will start wrapping another project's work. Filter by repo:

```sh
colab worktrees --json | python3 -c 'import json,sys,os
r=os.path.realpath(sys.argv[1])
for w in json.load(sys.stdin).values():
    if os.path.realpath(w["repo"])==r: print(w["name"], w["branch"], w.get("status",""))' "$PWD"
```

## 2. Decide what "finished" means — by content, not by the merge graph

**`git branch --merged` lies here.** Sessions squash-merge, which leaves no merge
relation — that is why deleting a wrapped branch needs `git branch -D`, not `-d`.
Ask instead whether the *content* landed:

```sh
git fetch origin <trunk>
git log --oneline origin/<trunk>..<branch>     # commits not on trunk (may still be squashed in)
git diff origin/<trunk>..<branch> --stat        # does the branch still differ in its own files?
grep -rl "<a distinctive string the branch added>" <paths>   # is it actually on trunk?
```

An empty diff for the branch's own files means the content is on trunk regardless of
what the graph says. Do not trust `colab`'s `status` field alone either — the
`doctor` merged-flip heuristic ("running → merged once no live claims remain") became
weaker when claims began releasing unconditionally at wrap.

## 3. Sort into four buckets — each gets a different action

| Bucket | What it looks like | Action |
|---|---|---|
| **wrap** | work done, content NOT on trunk | full [`code-wrap`](../code-wrap/SKILL.md) |
| **teardown-only** | content already on trunk, worktree lingering | remove worktree, release claims, close issues with evidence |
| **claim-only** | no worktree; `in-progress` on work already shipped | release the claim, close the issue with evidence |
| **blocked** | uncommitted tracked work, or genuinely unfinished | **report — never force** |

`teardown-only` is the common case and the most skipped. It is also the cheapest, so
do these first — they shrink the list before you start the expensive ones.

```sh
colab worktree rm <name>       # releases its claims and frees its ports
git branch -D <branch>         # -D: squash left no merge relation
```

## 4. Run the wraps — one at a time, re-checking between

For each **wrap** candidate, in order:

1. **Re-check trunk CI.** `gh run list --branch <trunk> -L 1`. Not once at the start
   — trunk CI can die mid-sweep (billing lockout, runner outage), and a failure that
   never started still means stop. A sweep can take an hour.
2. Run **code-wrap** for that candidate: B0 sync against the *current* trunk, harvest,
   merge, evidence, release, teardown.
3. **Then** move to the next. Trunk has moved; the next B0 must see that.

If any wrap stops (CI dead, conflict needing judgment, gate failing for unrelated
reasons), **stop the sweep there** and report. Skipping ahead leaves a half-swept repo
that is harder to reason about than an unswept one.

## 5. Reconcile the tracker

Worktrees are only half of it. Also:

- **Open issues whose code shipped** → close with evidence (trunk sha + `file:line`).
  Verify by grepping the code for what the issue describes, not by trusting a commit
  message that mentions its number.
- **Closed issues still holding a claim** → release. Closing and releasing are
  separate acts and only one is automatic.
- **Claims whose worktree is gone** → `colab doctor --prune` reports and removes them.

## 6. Report

```
swept 4, left 2

wrapped         fix/import-115-114-113   → trunk a1b2c3d, #115 #114 closed, #113 split
teardown-only   feat/console-shell-28    → content already on trunk, worktree removed
claim-only      #26                      → shipped in e4f5g6h, claim released
blocked         feat/session-types-26    → 3 uncommitted tracked files — needs a human
blocked         #58                      → trunk CI dead (billing), cannot merge
```

Say what you left and why. A worktree kept for a stated reason is fine; a worktree
kept silently is the 8-of-9 statistic repeating.

## Verify complete

- Every worktree in this repo is in exactly one bucket — none silently skipped.
- Every merge was preceded by its own CI check, not one check for the whole sweep.
- Every issue closed carries evidence; every claim released, including on issues you
  did not finish.
- `colab worktrees` (scoped) shows only worktrees you deliberately kept, each with a
  reason in the report.
- **The main checkout is on trunk** — `git branch --show-current`. A sweep that ends
  with the checkout parked on a feature branch has left the repo in the state it was
  meant to clear.
- Nothing was forced past uncommitted work.
