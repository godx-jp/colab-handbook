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

## 2. Decide what "finished" means — one rule, not per-candidate judgement

```sh
git fetch origin                    # the rule reads local refs; a stale base misjudges
colab landed --all                  # every worktree of this repo: landed · cargo · unknown
```

That is the whole decision, and it is the same rule code-wrap Phase B uses
(`CONVENTIONS.md` §4, "Has it landed?"). It is asked against each branch's **base** —
trunk, or the declared `integration:` line it was cut from — because a line-based
branch measured against trunk reads as enormous unshipped cargo.

**Do not count commits, and do not trust the merge graph.** `git branch --merged`
lies here: sessions squash-merge, which leaves no merge relation (the same reason
deleting a wrapped branch needs `git branch -D`, not `-d`). Counting commits ahead is
worse than useless — a squash mints a new sha, so it calls *every branch ever shipped*
unfinished. Comparing diffs fails the mirror case, where the base moved on underneath.
Requiring both still misses a squash followed by base movement, which is common. The
rule above asks the content question instead: does merging this branch change the
base's tree at all?

Without `colab`, ask it directly per branch:

```sh
git merge-tree --write-tree origin/<base> <branch> | head -1   # equal to …
git rev-parse origin/<base>^{tree}                              # … this ⇒ landed
```

**`unknown` means cargo.** If the base rewrote the branch's work the merge conflicts
and no content answer exists — so it never gets torn down on a guess.

Do not trust `colab`'s `status` field alone either — the `doctor` merged-flip
heuristic ("running → merged once no live claims remain") became weaker when claims
began releasing unconditionally at wrap.

**Git state and claim state are two signals; keep them apart.** `colab landed` says
what state the work is *in*; `in-progress` says someone *believes they hold it*. They
disagree in both directions — claims outliving finished work, finished work never
claimed — and the label remains the veto before any teardown.

## 3. Sort into four buckets — each gets a different action

| Bucket | What it looks like | Action |
|---|---|---|
| **wrap** | `cargo` (or `unknown`) — content NOT on its base | full [`code-wrap`](../code-wrap/SKILL.md) |
| **teardown-only** | `landed` — content already on its base, worktree lingering | remove worktree, release claims, close issues with evidence |
| **claim-only** | no worktree; `in-progress` on work already shipped | release the claim, close the issue with evidence |
| **blocked** | uncommitted tracked work, or genuinely unfinished | **report — never force** |

`teardown-only` is the common case and the most skipped. It is also the cheapest, so
do these first — they shrink the list before you start the expensive ones.

```sh
colab worktree rm <name>       # releases its claims and frees its ports
git branch -D <branch>         # -D: squash left no merge relation
```

A sweep is exactly when a session's dev server is still running, so expect
`worktree rm` to refuse with a list of processes the worktree owns. Stop them and
re-run, or `--force` to have it terminate them — it kills only what the worktree
owns by cwd. Do **not** reclassify such a candidate as `blocked`: it is a live
process, not unfinished work.

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
- **Epic checklist lines that contradict reality** → fix the line, and say why you did.
  This is the cheapest possible place to catch them: the sweep has already read every
  issue's true state, so this compares what is already in hand and scans nothing new.

  Only **hand-written** checklists — an epic using native sub-issues is maintained by
  GitHub and needs nothing (`gh issue view <epic> --json subIssuesSummary`). The three
  forms seen in the wild, all in one repo on one day:

  | line says | reality | fix |
  |---|---|---|
  | "in progress, branch `x`" | branch gone, issue closed, code on trunk | tick it, cite the trunk sha |
  | ticked, noted "held open for review" | issue already closed | drop the stale note |
  | unticked | issue closed with evidence | tick it, cite the sha |

  The first form is the expensive one: it is how a session gets spent rediscovering
  work that already shipped — the failure `code-triage` §0 measured at 4 of 9 sessions
  in a day. The epic is the source triage is *instructed* to trust, so a wrong line
  there does not merely annoy; it throws away a session.

  Same four limits as `code-wrap` B2c: never close the epic on a full table, never
  rewrite its prose, never build a table that does not exist, never infer parentage
  from a title.

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
