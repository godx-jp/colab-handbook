---
name: code-triage
description: "Decide what to work on next. Takes every open Issue, discards the ones already shipped and the ones someone else holds, groups what must move together (issues touching the same files MUST share a branch), orders what remains by blast radius, and says which groups can be started RIGHT NOW — including whether the repo's trunk CI is alive enough to merge into. Outputs claim + branch commands that feed straight into code-start. Trigger phrases: 'what should I work on', 'triage the issues', 'what can we start', 'plan the next session', 'group the open issues', 'what is ready to pick up', 'sort the backlog'. Runs before code-start; pairs with code-start and code-wrap."
---

# code-triage — what should we work on next?

Runs **before** [`code-start`](../code-start/SKILL.md). Its output is a short ranked
list of *groups* you could open a session on today, plus an honest account of why
everything else is not on it.

`code-triage` → `code-start` → `code-wrap`.

## Principle — an open Issue is a claim about the world, not a queue

Trackers drift behind trunk, always in the same direction: work gets done and the
Issue stays open. Measured on one fleet: **26 of 30 issues sat open with their code
long since merged** (commits said `(#N)`, which does not auto-close, instead of
`Closes #N`), and **4 of 9 sessions in a single day burned an agent** discovering the
work was already shipped.

So triage that skips verification is worse than no triage: it hands someone a
confident, wrong plan. **Every candidate gets checked against the code before it
reaches your list.**

## 1. Gather

```sh
gh issue list --state open --limit 100                    # this repo
gh issue list --state open --label in-progress            # …of which, taken
```

`--state open` is right here — unlike code-start's lookup, which needs `--state all`
because it is answering a different question (does a memory exist?) rather than this
one (what is left to do?).

**Fleet mode** — across every repo the machine knows:

```sh
colab claims                     # what is held, everywhere, and by whom
# then gh issue list per repo in the registry
```

Say plainly that this reads the *machine-local* registry, so it is "every repo on
this machine", not "every repo that exists".

## 2. Discard what is not really open

Two passes, in this order — the cheap one first.

**Taken** — `in-progress`, or a live claim, is someone else's:

```sh
colab claims                                 # includes host + session + name
```
A claim carries who holds it. If it looks stale, that is a **finding to raise**, not
permission to take the work.

**Already shipped** — the expensive pass, and the one that pays:

```sh
git log --oneline --all --grep="#<N>"                  # merged under this number?
grep -rl "<the thing the issue describes>" <paths>      # or present in the code?
```

Grep for what the Issue *describes* — the column, route, UI string, function — not
for its number. A commit mentioning `#88` proves someone typed `#88`.

- **Fully shipped** → close it with evidence (trunk sha + `file:line`) and take it
  off the list. That is real triage output, not a detour.
- **Partly shipped** → narrow it to what is actually missing before queueing, so
  nobody re-does the finished half.

## 3. Group — this is a correctness constraint, not tidiness

**Issues that touch the same files must become one branch.** Two sessions editing
the same files merge over each other; grouping is how that is prevented, not a
nicety.

Group when:
- the issues touch overlapping files or the same subsystem
- one is a prerequisite of another
- they are children of the same epic and land together naturally

Keep separate when the files are disjoint — parallel sessions are the point.

Name the group per [`CONVENTIONS.md` §4](../../CONVENTIONS.md): every issue number
in one **trailing** run, e.g. `fix/import-fixes-115-114-113`. This is load-bearing —
code-wrap's harvest reads the branch name and the claim registry, so a number in
neither is one the wrap will never find, and it sits open with its code merged. The
failure this whole skill exists to prevent, re-created by sloppy naming.

**Epics: read the checklist table, never the title.** The title states the ambition;
the table states what is done, in progress and untouched — and only the table is
maintained. Verify its `file:line` references before quoting them; engines get
edited and the refs rot.

## 4. Order by blast radius, not by number

Rank the surviving groups:

1. **Blocks other work** — a bug in a shared engine, a broken trunk, a stale claim
   nobody can get past. These unblock people, so they pay twice.
2. **Reaches users** — a defect in a repo with a live production target
   (`project.yml` `production:` non-null). On a Tier C repo the next promotion ships
   it; on Tier A it waits for a tag. That difference changes urgency.
3. **Cheap and unblocking** — small work that lets something bigger start.
4. **Everything else** — by whatever the humans care about.

State the reason next to each rank. "Ordered by priority" with no reasoning is not
triage; it is a re-sorted list.

## 5. The readiness gate — can this start *right now*?

A group is **ready** only if every one of these holds. Anything else is `blocked`,
with the blocker named:

- [ ] **Unclaimed** — no `in-progress`, no live claim.
- [ ] **Verifiably undone** — §2 passed against the code, not the tracker.
- [ ] **Actionable** — the Issue says what "done" looks like. An Issue that is a
      question is blocked on an answer, not ready to code.
- [ ] **No open dependency** — nothing it needs is itself unfinished.
- [ ] **Trunk CI is alive AND green** — `gh run list --branch <trunk> -L 1`. A
      failure that never started (billing lockout, runner outage) counts as dead.
      If you cannot merge when you finish, you are not ready to start
      ([§6](../../CONVENTIONS.md)).
- [ ] **No live worktree owns those files** — `colab worktrees`, and
      `git branch -a --list '*<n>*'` after `git fetch --prune`. A clean label does
      not prove clean ground: claims are released unconditionally at wrap, so an
      abandoned branch can exist with no claim on it at all.

## 6. Report — make it directly actionable

For each **ready** group, give the four things a session needs to begin:

```
READY  fix/import-fixes-115-114-113   #115 #114 #113
       why: blocks the payroll import; trunk CI green 2h ago
       files: app/Import/*, tests/Import/*
       start: colab claim 115 114 113 --worktree import-fixes-115-114-113
```

Then, briefly:

- **blocked** — one line each, naming the blocker and who could clear it.
- **taken** — who holds it, and since when.
- **close these** — already shipped, with the evidence you found.

**Do not let an Issue vanish.** Every open number ends the pass in exactly one
bucket — ready, blocked, taken, or close-it. A number that quietly falls off the
list gets re-triaged from scratch next time, which is how the same work gets
discovered three times.

Hand the top group to **code-start**, which will re-verify the claim before taking it.

## Verify complete

- Every open Issue is accounted for in exactly one bucket.
- Every "ready" group passed all six gates, not just "nobody is assigned".
- Every "already shipped" call carries evidence (sha + `file:line`) — not a hunch.
- Branch names carry all issue numbers in one trailing run.
- Anything surprising — a stale claim, a dead trunk CI, an epic whose table
  contradicts its title — is **reported**, not silently worked around.
