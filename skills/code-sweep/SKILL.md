---
name: code-sweep
description: "Clear out everything finished in ONE repo: find every worktree whose work has landed, every issue whose code shipped but is still open, and every claim outliving its session — then put each through code-wrap, one at a time. Run it at end of day, or ping it whenever a session goes idle — a no-change ping short-circuits in three calls. Sorts candidates into wrap / teardown-only / claim-only / blocked, because most do not need a full wrap. Can be scoped to a set of issues or one session/worktree instead of the whole repo. Trigger phrases: 'sweep the repo', 'wrap everything finished', 'clean up the worktrees', 'close out the session work', 'tidy up finished work', 'wrap all the done branches', 'sweep the issues #95 #96', 'sweep the session <name>', 'ship these'; and — when this session's last act was a sweep — the re-ping forms 'again', 'anything new?', 'check again', 'anything to wrap yet?', or a bare 'go'. Uses code-wrap per candidate; never batches merges."
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

**Run it as often as you like.** This used to be described as the end-of-day job after
several parallel sessions, which read as a prohibition on running it more often — and the
cost made that reading fair. §0 removes the cost: a ping with nothing new is three calls
and a sentence. So a long-lived shipping session may re-run this whenever it goes idle.
Frequency was never the hazard; *re-deriving everything* to discover nothing changed was.
Nothing below gets cheaper by being skipped — least of all the per-merge CI re-check.

## 0. Has anything changed, and was a sweep left half-finished?

Same problem and same fingerprint as [`code-triage` §0](../code-triage/SKILL.md) — read it
there; only the differences are repeated here. A full sweep is a fixed floor of 3 network
calls plus a CI re-check and a 499-line `code-wrap` per candidate, so a ping with nothing
new is worth refusing to start.

```sh
CACHE="$(git rev-parse --path-format=absolute --git-common-dir)/colab-sweep.json"
```

Separate file from triage's, because the two answer different questions off the same facts
and a shared file would make one skill's conclusion look like the other's.

**Fingerprint unchanged AND no interrupted sweep recorded** ⇒ report `nothing has changed
since <ts>`, name the candidates that were left standing last time and why, and stop.

- **`colab landed --all` is part of the deterministic 90%,** and its inputs are the trunk
  sha and the branch tips. Cache the classification against both; a new trunk sha discards
  it. Do **not** cache `colab worktrees`, `colab claims` or `gh run list` — live state.
- **A matching fingerprint never authorises a merge.** §4's per-candidate CI re-check
  happens regardless: trunk CI can die mid-sweep, and the fingerprint does not watch it.

### 0.1 Resume an interrupted sweep

§4 stops the whole sweep on the first failure, and that stays — skipping ahead leaves a
half-swept repo. But under ping-when-idle a stopped sweep gets re-pinged within minutes,
and today the re-ping restarts from §1 carrying nothing: it re-derives every bucket, walks
back to the candidate that failed, and fails there again.

So when a sweep stops, record in `$CACHE`: the candidates **completed** (with the trunk sha
each merged at), the candidate it **stopped on**, and the **stop reason**. On the next run:

1. **Re-test the stop reason first, and nothing else.** Dead trunk CI ⇒ one `gh run list`.
   Still dead ⇒ report `still blocked: <reason>, since <ts>` and stop. That is a two-call
   ping for a repo that cannot be swept, instead of a full re-derivation ending in the same
   sentence.
2. **Cleared ⇒ re-derive the buckets, do not replay the old list.** The recorded completions
   are skipped; everything else is classified afresh. Trunk moved during the part that did
   succeed, and §4's invalidation is the whole reason this skill is sequential — a resume
   that trusted a stale bucket list would reintroduce exactly the batching the Principle
   rejects.
3. **A completion record is a shortcut, never evidence.** Before skipping a recorded
   candidate, confirm it: `colab landed` says its content is on its base. Cheap, and it
   keeps a truncated or stale cache from being read as "already shipped" — the single most
   expensive wrong belief in this family (`code-triage`'s opening principle measured it at
   4 of 9 sessions in one day).

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
REPO="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
colab worktrees --json | python3 -c 'import json,sys,os
r=os.path.realpath(sys.argv[1])
for w in json.load(sys.stdin).values():
    if os.path.realpath(w["repo"])==r: print(w["name"], w["branch"], w.get("status",""))' "$REPO"
```

⚠️ **The anchor is the main checkout, not `$PWD`.** `colab` records every worktree and
claim against the **main** repo path, so this filter run from inside a worktree matches
nothing — and the sweep reports a clean repo because it enumerated an empty list. That is
the worst possible failure here: "found nothing" wearing the face of "nothing to find"
(§1.1 rule 3 exists for the same confusion arriving by a different road). `dirname` of the
common git dir yields the main checkout from anywhere in the repo.

### 1.1 Scoped mode — sweep a subset, and say that you did

`code-triage` has single-issue mode; this had nothing between "the whole repo" and calling
`code-wrap` by hand — and calling `code-wrap` directly skips the bucketing that decides
wrap vs teardown-only vs claim-only, which is the judgement this skill exists to add. A
shipping session handed three issue numbers deserves neither of those options.

    sweep the issues #95 #96          → candidates whose claims or branch name carry 95 or 96
    sweep the session <name>          → the worktree of that name, its claims, its issues

Both selectors are natural because §1 already enumerates claims (issue-keyed) and worktrees
(session-keyed) side by side; scoping picks rows out of lists that were built anyway.

**Enumerate everything first, then narrow.** Never filter at the source. The full list is
what makes the next three rules possible, and it costs nothing extra — §1's commands do not
take a selector anyway.

Everything downstream is unchanged: the four buckets, the sequential wraps, the per-merge
CI re-check, the refusal to batch. Scoping narrows *which* candidates are considered; it
must never weaken what happens to each one.

**Three things do not follow from filtering, and a scoped mode without them is worse than
none:**

1. **§5 reconcile is repo-wide by nature — so a scoped run does not do it silently.**
   Closing shipped-but-open issues and releasing stale claims are not scoped to the
   candidates, and `colab doctor --prune` is **machine-wide** — it would reach past the
   scope, past the repo, to other projects entirely. In a scoped run: restrict §5 to the
   selected issues, **never run `doctor --prune`**, and say both in the report. Someone who
   asked to ship three issues did not ask you to reconcile the machine.
2. **Report what you did not look at.** This is the real trap: *a scoped sweep that finds
   nothing looks identical to a full sweep that finds nothing.* The skill already holds the
   matching principle for kept worktrees — a worktree kept for a stated reason is fine, one
   kept silently is the 8-of-9 statistic repeating. A scoped run owes the same honesty about
   its own boundary: `scoped to N of M candidates`, and name the M−N.
3. **A selector that matches nothing is not a clean sweep.** An issue with no worktree, no
   claim and no branch is not "swept"; it was never there. Report
   `selector matched nothing` and name where you looked, distinct from `nothing to do`. The
   two differ in what the human should do next — one means the repo is clear, the other
   means the number was wrong or the work is somewhere else.

**A scoped run's fingerprint is not the repo-wide one.** The §0 inputs are repo-wide facts,
so *detection* is shared — but the stored conclusion is per-scope, and `code-triage` §0.1's
coverage rule governs which stored run may answer a ping: a repo-wide conclusion can serve a
scoped re-ping by filtering, a scoped one can never serve a broader ping. Key the cache entry
by its normalised selector, and treat unscoped as its own key. Getting this backwards would
let "I swept #95, nothing to do" answer "sweep the repo" — a clean bill of health for
candidates nobody examined.

**Unscoped behaviour is exactly what it was.** No selector ⇒ every rule above is inert:
`M = N`, §5 runs in full, and no scope line appears in the report.

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
that is harder to reason about than an unswept one. **Record the stop** — completed
candidates, the one it stopped on, and why — so the next ping resumes instead of
re-deriving its way back to the same wall (§0.1).

## 5. Reconcile the tracker

⚠️ **Scoped run? Read §1.1 first.** This whole section is repo-wide, and the `doctor
--prune` below is machine-wide. Restrict it to the selected issues, skip the prune, and say
so — reconciliation nobody asked for is the one way scoping can do harm rather than less.

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
  work that already shipped — the failure measured at 4 of 9 sessions in a day in
  `code-triage`'s opening principle. The epic is the source triage is *instructed* to trust, so a wrong line
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

A **scoped** run says so on the first line and names its boundary — the M−N by name, not
just by count, because a count cannot be checked against what the human had in mind:

```
scoped to 2 of 7 candidates   (issues #95 #96)
not looked at   feat/console-shell-28, fix/import-115-114-113, #26, #58, chore/deps-31
§5 reconcile    restricted to #95 #96; doctor --prune skipped (machine-wide)
```

The other two endings are distinct sentences, and must not be collapsed into each other or
into the clean-sweep line above:

```
selector matched nothing   #99 — no claim, no worktree, no branch carrying that number
nothing has changed since 2026-07-21T14:02Z   (3 calls; 2 candidates still standing, see below)
still blocked: trunk CI dead (billing), since 2026-07-21T11:40Z
```

## Verify complete

- Every worktree in this repo is in exactly one bucket — none silently skipped. In a
  scoped run, every worktree is either in a bucket or named as out of scope; "not
  selected" is a stated outcome, never an omission.
- A scoped run reported `N of M`, restricted §5 to the selection, and did not run
  `doctor --prune`.
- A selector that matched nothing said so — not "swept 0".
- A run that short-circuited named the timestamp it compared against; a run that stopped
  recorded enough for the next ping to resume rather than restart.
- Every merge was preceded by its own CI check, not one check for the whole sweep.
- Every issue closed carries evidence; every claim released, including on issues you
  did not finish.
- `colab worktrees` (scoped) shows only worktrees you deliberately kept, each with a
  reason in the report.
- **The main checkout is on trunk** — `git branch --show-current`. A sweep that ends
  with the checkout parked on a feature branch has left the repo in the state it was
  meant to clear.
- Nothing was forced past uncommitted work.
