---
name: code-triage
description: "Decide what to work on next in ONE repo. Takes every open Issue, discards the ones already shipped and the ones someone else holds, groups what must move together (issues touching the same files MUST share a branch), orders what remains by blast radius, and says which groups can be started RIGHT NOW — including whether the repo's trunk CI is alive enough to merge into. Outputs claim + branch commands that feed straight into code-start. Cheap to re-run: a no-change ping short-circuits in three calls. Trigger phrases: 'what should I work on', 'triage the issues', 'what can we start', 'plan the next session', 'group the open issues', 'what is ready to pick up', 'sort the backlog'; and — when this session's last act was a triage — the re-ping forms 'again', 'anything new?', 'check again', 'anything to pick up yet?', or a bare 'go'. Runs before code-start; pairs with code-start and code-wrap."
---

# code-triage — what should we work on next?

Runs **before** [`code-start`](../code-start/SKILL.md), on **one repo**. Its output is
a short ranked list of *groups* you could open a session on today, plus an honest
account of why everything else is not on it.

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

## 0. Has anything changed? — ask before doing anything else

This skill was built to run once, be read, and end. It is now **pinged on a loop**: a
long-lived session per repo, re-run whenever it goes idle. A full pass on a ~30-issue
backlog is roughly 35-60 network calls and ~60 local ones. On a re-run 30 minutes later
with no new commits, issues or claims, **about 4 of those ~50 carry new information** —
the gather, the shipped-verification, the grouping and the ordering are pure functions of
inputs that did not move, and re-derive a byte-identical answer.

So the first thing this skill does is decide whether it needs to run at all.

**The fingerprint — five inputs, three network calls:**

```sh
GITDIR="$(git rev-parse --path-format=absolute --git-common-dir)"
CACHE="$GITDIR/colab-triage.json"
REPO="$(dirname "$GITDIR")"      # the MAIN checkout — see the note on input 4

git fetch origin --quiet && git rev-parse origin/<trunk>          # 1. trunk sha
gh issue list --state open --limit 100 --json number,updatedAt,labels \
  | shasum -a 256 | cut -c1-16                                    # 2. backlog digest
NWO=$(gh repo view --json nameWithOwner -q .nameWithOwner)        # 3. dependency digest
gh api graphql -F owner="${NWO%%/*}" -F name="${NWO##*/}" -f query='
  query($owner:String!,$name:String!){ repository(owner:$owner,name:$name){
    issues(states:OPEN,first:100){ nodes{ number issueDependenciesSummary{ blockedBy } } } } }' \
  -q '.data.repository.issues.nodes[]|"\(.number):\(.issueDependenciesSummary.blockedBy)"' \
  | shasum -a 256 | cut -c1-16
python3 -c 'import json,os,sys                                    # 4. claim digest (local, 0 calls)
r=os.path.realpath(sys.argv[1]); s=json.load(open(os.path.expanduser("~/.colab/state.json")))
print(sorted(k for k,v in s.get("claims",{}).items() if os.path.realpath(v["repo"])==r),
      sorted(n for n,w in s.get("worktrees",{}).items() if os.path.realpath(w["repo"])==r))' "$REPO"
git for-each-ref 'refs/remotes/origin/**' --format='%(refname) %(objectname)' \
  | shasum -a 256 | cut -c1-16                                    # 5. remote heads (local, 0 calls)
```

All five equal to the stored run ⇒ **report `nothing has changed since <ts>`, re-print the
stored conclusion (§0.1), and stop.** Three calls instead of fifty. Input 2 is not an extra
cost on a run that *does* proceed — §1 needs that list anyway.

- **Where the cache lives, and why not `~/.colab/`.** `--git-common-dir` resolves to the
  main checkout's `.git` even from inside a worktree, so every worktree of the repo shares
  one cache and the cache dies with the clone — the correct lifetime for a cache *of* that
  clone. It is deliberately **not** folded into `~/.colab/state.json`: that file is a
  published contract with readers outside this repo (`tools/lib/state.js` says so in its
  header), and a private cache wedged into it becomes a field other tools must parse.
- **Anchor input 4 on the main checkout, not `$PWD`.** `colab` records every claim and
  worktree against the **main** repo path, so a filter comparing against the current
  directory matches nothing whenever it runs from inside a worktree — and "no claims" is
  indistinguishable from "no claims *found*". `dirname` of the common git dir is that path
  from anywhere in the repo, worktrees included. (`code-sweep` §1 filters the same state
  and needs the same anchor for the same reason.)
- **Input 4 digests this repo's slice, not the file's mtime.** `~/.colab/state.json` is
  machine-global, and `colab` rewrites it atomically on every command — so its mtime moves
  when an unrelated repo allocates a port, and a triage that re-ran fully on that would
  short-circuit almost never. Reading the file is local and free; read it precisely. (Same
  reason it is a *digest* and not a timestamp: an atomic rewrite with identical contents is
  not a change.)
- **Compare for equality, never for recency.** "Newest `updatedAt` is no later than last
  time" is wrong: when the most recently touched issue *closes*, it leaves the open set and
  the maximum moves **backwards** — the busiest issue in the repo changing state reads as
  "nothing happened". Digest the whole `(number, updatedAt)` set and compare digests.
- **`updatedAt` does not see dependency edges — measured on the live API.** Adding a
  `blocked_by` edge and removing it again left `updatedAt` byte-identical across both
  writes, while a label add/remove moved it twice in the same minute. Edges do land in the
  issue timeline (`blocked_by_added` / `blocked_by_removed`), but reading that is a call
  *per issue*; input 3 is the entire graph in one query. Drop it and the fingerprint goes
  blind to precisely the data the §5 readiness gate turns on — a new blocker would be
  reported as `free (checked)` forever.
- **Input 5 exists because §5.1 turned a branch push into a readiness signal.** A blocker
  whose code gets pushed moves a dependent from `blocked` to soft-ready — and moves none of
  inputs 1-4: trunk is untouched, the issues are untouched, the edge is untouched, and the
  claim may live on another machine. Without this the new verdict would almost never be
  discovered under a ping loop, which is the same blindness input 3 was added to fix. It
  reads refs the fetch on input 1 already updated, so it costs no call. The price is honest:
  any push to any branch forces a full pass. That is the right trade — a push is also
  exactly what can hand a live worktree the files a group needs (§5, last gate).
- **What is deliberately NOT in the fingerprint.** Trunk CI, live worktrees and live
  processes are volatile by nature and are never cached. So a matching fingerprint means
  *the backlog has not moved*; it never means *you may merge*. Nothing downstream may skip
  its own CI check on the strength of it.
- **The cache is an optimisation, never an authority.** Missing, unparseable, or written by
  a version you do not recognise ⇒ run the full pass. Never report "nothing changed" from a
  cache you could not read — a silent fall-through to "all quiet" is the one failure mode
  that costs a day rather than a call.

### 0.1 Persist the conclusion, not only the writes

§4 already argues this for dependency edges: *a sequence you worked out and left in a report
is lost the moment the report scrolls away*. The same is true of the report itself. Write
the §6 output into `$CACHE` alongside the fingerprint — the ranked **ready** groups (with
each soft-ready note, §5.1, or the re-print loses the one thing that made it startable),
the **blocked** bucket with its named blockers, **taken**, and **close these**. Without it the
short-circuit is useless: it would announce that nothing changed and have nothing to show.

Record the **scope** of the conclusion with it (see code-sweep's scoped mode; triage's
single-issue mode below is the same shape), and apply the coverage rule:

> **Short-circuit only when the fingerprint matches AND the stored conclusion's scope
> *covers* the current request.** Covers, not equals. A stored repo-wide conclusion can
> serve a re-ping about one issue — filter it. A stored single-issue conclusion cannot
> serve a repo-wide ping, however unchanged the world is: that run never looked at the
> rest, and an unexamined issue is not a clean one.

### 0.2 Running this twice must change nothing

Under ping-when-idle a re-run is the normal case, not the exception, so every write this
skill performs has to be idempotent:

- **Dependency edges: read before writing.** `gh issue view <N> --json blockedBy` and skip
  the POST if the edge is already there. §4 writes edges; a second triage reaching the same
  conclusion must not file it twice.
- **Already-shipped closes:** an issue already closed is not re-closed and not re-evidenced.
- **Group records: the label is idempotent, the comment is not.** Re-applying `group:<key>`
  changes nothing; re-posting its evidence comment stacks a duplicate every idle cycle.
  Grep the existing comments for the key before posting (§3).
- **`deps-checked` has a timestamp — it is just not on the label.** The label is a cache
  with no expiry, so today it never goes stale; but the `labeled` event that set it is in
  the timeline, and so is every edge write. That makes staleness computable rather than a
  matter of trust:

  ```sh
  gh api "repos/{owner}/{repo}/issues/<N>/timeline" \
    -q '.[]|select(.event=="labeled" or .event=="blocked_by_added")|"\(.created_at) \(.event)"'
  ```

  **A `blocked_by_added` later than the newest `deps-checked` `labeled` event means the
  label is stale** — treat the issue as `dependencies unchecked`, re-run the §5 gate, and
  remove the label if a blocker is now open. `CONVENTIONS.md` §5 assigns removal to whoever
  adds the blocker; this is how the next reader finds out when they didn't. Only spend the
  call on issues a `deps-checked` is actually deciding for.

## 1. Gather

```sh
gh issue list --state open --limit 100                    # this repo
gh issue list --state open --label in-progress            # …of which, taken
```

`--state open` is right here — unlike code-start's lookup, which needs `--state all`
because it is answering a different question (does a memory exist?) rather than this
one (what is left to do?).

**Scope: this repo. Not the fleet.** Every `code-*` skill is one repo — that is the
family's whole shape, and a single skill quietly going wide is the kind of
inconsistency people discover by surprise.

Want the machine-wide picture instead? Two tools already give it, mechanically and
in more useful form than prose triage could:

```sh
node "$COLAB_HANDBOOK/audit/audit.mjs"   # conformance across every registered repo
colab update                             # which repos have drifted from the handbook
colab claims                             # what is held, everywhere, and by whom
```

All three read the **machine-local** registry, so "fleet" means every repo on *this*
machine — never every repo that exists. That distinction matters once a second
machine has its own registry.

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

**Memoize this pass against the trunk sha.** Both commands are pure functions of the tree:
with the tree unmoved, they return byte-identical results, and this is the pass that costs
~2 local invocations per issue on top of the network. So cache the verdict per issue in
`$CACHE` (§0) keyed by the **trunk sha it was computed at**, and reuse it while that sha
holds. A new trunk sha invalidates every entry at once — which is right, because a merge is
exactly the event that can ship an issue.

Two conditions on that, both of which have teeth:

- **Only when the working tree is clean.** `grep -rl` reads the *working tree*, not the
  commit; with uncommitted changes the result is not a function of the sha at all. Key on
  `git status --porcelain` being empty, or do not cache.
- **Only the verdict, never the evidence.** Re-quote `file:line` from the current tree
  before putting it in a report — §3 already warns that refs rot, and a cached line number
  is a ref that rots invisibly.

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

**Epics: read the state, never the title.** The title states the ambition; the title is
not evidence. Where the state lives depends on how the epic is built:

- **Native sub-issues** — `gh issue view <epic> --json subIssuesSummary,subIssues`.
  GitHub maintains this; it cannot drift. Prefer it, and prefer converting an epic to it.
- **A hand-written checklist** — read the table, and **treat it as a claim, not a
  fact.** It is maintained by `code-wrap` B2c and `code-sweep` §5, both of which run
  only when someone runs them; a table nobody has swept since the last merge is stale
  by default. Spot-check any line that decides your plan — *especially* one reading
  "in progress on branch `x`", which is the form that most often survives its own
  branch and sends a session to redo shipped work.

Verify `file:line` references before quoting them; engines get edited and refs rot.

### Then persist the group — it is a judgement no tool can re-derive

A group printed to a terminal dies with the terminal, and the next session claiming one
member never learns the other exists — the exact collision this section computes in order
to prevent. "Which files does this issue touch" is a judgement, so nothing downstream can
recover it; **triage is the only writer** (`CONVENTIONS.md` §5, *Grouping*).

Two writes per group, and both are needed: the label makes it *queryable*, the comment
carries the *evidence*.

```sh
KEY=import-fixes            # the branch slug WITHOUT the trailing numbers
gh label create "group:$KEY" --color 5319E7 \
  --description "Must share one branch — these issues touch the same files" 2>/dev/null || true
for N in 115 114 113; do gh issue edit "$N" --add-label "group:$KEY"; done

# then, once per member — the why, ending in the machine-readable pair
gh issue comment 115 --body 'Group: import-fixes — #115 #114 #113
Because: app/Import/Parser.php:88 — #115 and #114 both rewrite the delimiter branch'
```

- **Re-running must not duplicate the comment.** §0.2 is binding here and the two writes
  are not equally safe: `--add-label` is idempotent by nature, `gh issue comment` is not —
  a skill pinged on a loop would otherwise stack an identical justification on the issue
  every idle cycle. Read first, and post only if no comment already carries this key:
  ```sh
  gh issue view 115 --json comments -q '.comments[].body' | grep -q "^Group: $KEY" || gh issue comment 115 --body "…"
  ```
  Re-post only when the membership or the evidence actually changed — and then say what
  changed, rather than repeating the original.
- **Remove what you contradicted.** If this pass concludes a previously grouped issue no
  longer belongs — its collision landed, or the group was wrong — take the label off that
  issue (`gh issue edit <N> --remove-label "group:$KEY"`). Nothing else removes it, and a
  stale group label reads exactly like a fresh one.
- **A one-member group is not a group.** After removals, a `group:` label left on a single
  open issue is spent: remove it too.
- **Quote the evidence from the current tree, not from `$CACHE`.** §2 caches verdicts and
  never evidence, for this reason: a cached line number is a ref that rots invisibly.
- **Record only collisions you actually checked.** A group inferred from titles is a guess;
  leave it unwritten and say so in the report. Writing it makes the guess look verified to
  every reader afterwards.

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

### Then write the ordering down — as relationships, not just as report prose

Triage is not only a *reader* of the dependency graph; it is the main thing that
**writes** it. A sequence you worked out and left in a report is lost the moment the
report scrolls away, and the next triage re-derives it from scratch — or doesn't.

So when this pass concludes that one issue must wait for another, record it where a
machine can read it back:

```sh
DB=$(gh api repos/{owner}/{repo}/issues/<blocker> -q .id)   # database id, not the number
gh api -X POST repos/{owner}/{repo}/issues/<blocked>/dependencies/blocked_by -F issue_id=$DB
gh issue view <blocked> --json blockedBy      # ← and confirm it names the blocker you meant
```

The report still explains the reasoning — that is what prose is good for. The
relationship is the part the readiness gate above (and any other tool) reads.

- **Read before you write.** The edge may already exist — this triage may be the second
  one to reach the same conclusion (§0.2). Check `blockedBy` first; do not file a duplicate.
- **Read it back after you write it, too.** A wrong `$DB` — an empty variable, a failed
  subshell, the issue *number* pasted where the database id goes — does not error. The POST
  returns 200 and attaches whichever issue holds that id anywhere on GitHub, in repos neither
  you nor this org has heard of (`CONVENTIONS.md` §5, *Readiness*). The check is not about
  the API being flaky: at the moment of the write, a wrong id is **indistinguishable from
  success**, and the only later symptom is a blocker nobody recognises.
- **Record only what you actually determined.** A sequence you inferred from titles is
  a guess; leave it unwritten and say so in the report.
- **Remove an edge only when the edge is false — not because the blocker moved.** Delete
  (`-X DELETE …/dependencies/blocked_by/<db-id>`) when the dependency never existed, or
  stopped existing because the work was descoped or redesigned. **Do not delete it because
  the blocker's code landed**: the two issues really are related, the readiness gate reads
  the blocker's state for itself (§5.1), and an edge deleted for a display's convenience
  does not come back if the blocker is reverted. Editing a fact to change what a report
  prints is how the graph stops being trustworthy.
- **Triage still never claims and never touches trunk.** Its writes are exactly three, all
  of them recordings of its own judgement about issues: `blocked_by` edges, the
  `deps-checked` label, and the `group:` label plus its evidence comment (§3).

### Single-issue mode

Given one specific issue rather than a backlog, do the same work scoped to it: is *this*
ready? Run §2 and the §5 gate against it alone, then leave the answer **where a machine
reads it** — either a `blocked_by` edge naming the blocker, or the `deps-checked` label:

```sh
gh issue edit <N> --add-label deps-checked      # verified: no open blocker
```

That converts *unchecked* into *checked-and-free*, which is the one distinction the gate
cannot make for itself — an empty `blockedBy` is identical whether someone checked or
nobody did. A prose comment saying "no blockers" does not do this; it is unreadable to
the gate, which is the whole reason this convention exists.

**Set it only after looking, and check it has not gone stale before trusting it** — the
label carries no expiry of its own, so §0.2 derives one from the timeline.

Single-issue mode is also a **scope**, and §0.1's coverage rule applies to it: a conclusion
reached about one issue answers for that issue and no other, no matter how still the repo
has been since.

## 5. The readiness gate — can this start *right now*?

A group is **ready** only if every one of these holds. Anything else is `blocked`,
with the blocker named:

- [ ] **Unclaimed** — no `in-progress`, no live claim.
- [ ] **Verifiably undone** — §2 passed against the code, not the tracker.
- [ ] **Actionable** — the Issue says what "done" looks like. An Issue that is a
      question is blocked on an answer, not ready to code.
- [ ] **Nothing it depends on is still missing** — read the **relationship**, never
      the prose: `gh issue view <N> --json blockedBy` (`CONVENTIONS.md` §5,
      *Readiness*). Prose saying "depends on the other one" is an explanation, not a
      record; it blocks nothing and no tool can act on it.
      **An open blocker is not automatically a blocker** — judge its state, per §5.1.
      **And empty is not "free" — it is "nobody looked".**
- [ ] **Trunk CI is alive AND green** — `gh run list --branch <trunk> -L 1`. A
      failure that never started (billing lockout, runner outage) counts as dead.
      If you cannot merge when you finish, you are not ready to start
      ([§6](../../CONVENTIONS.md)).
- [ ] **No live worktree owns those files** — `colab worktrees`, and
      `git branch -a --list '*<n>*'` after `git fetch --prune`. A clean label does
      not prove clean ground: claims are released unconditionally at wrap, so an
      abandoned branch can exist with no claim on it at all.

### 5.1 An open blocker is not one verdict — look at what state it is in

`blockedBy` returning an open node used to end the question. It hides two situations
that behave nothing alike: a blocker **nobody has started**, and a blocker **whose code
is written and pushed**, its session over and stopped at the human merge gate. In the
second the dependency already exists — reporting it as `blocked` parks a session for
nothing (`CONVENTIONS.md` §5, *Readiness*).

So for each open blocker, ask what evidence exists that its work is real:

```sh
gh issue view <B> --json state,number                      # closed → clears, full stop
git fetch --prune --quiet
git branch -r --list "*-<B>"                               # its branch, by trailing number (§3)
colab landed --branch origin/<that-branch>                 # landed · cargo · unknown
```

Ask about the **remote** ref, not a local one: a local branch may be ahead of what was
pushed, and what was not pushed is not evidence. `--branch` takes any ref, so the blocker's
branch need not be a worktree on this machine — which it usually is not.

| what you find on the blocker | verdict for the dependent |
|---|---|
| closed, or its branch reports `landed` | **clears** — its work is on trunk; open is tracker lag |
| a pushed branch reporting `cargo` | **soft** — the code exists, unmerged |
| no branch, or `unknown`, or unpushed, or a branch with no commits | **blocked** |

- **Any hard blocker outranks every soft one.** A group waiting on one unstarted issue
  and one merge-ready issue is `blocked`, not `ready with a note`.
- **An active session on the blocker is not evidence.** Nor is a claim, an assignee, or
  someone saying they are on it. Measured: a session open ten minutes was already dead,
  having never claimed the issue it was opened for — a dependent started on that would
  be waiting for something that never arrives. An open session is intent; a **pushed
  branch with real commits** is evidence. Unpushed does not count either: nobody waiting
  on it can see, review or merge it.
- **When you cannot tell, say `blocked`.** This gate fails toward blocked exactly as
  `colab landed` fails toward cargo — each refuses the optimistic answer, because that
  is the one that costs a session.
- **Do not record the soft verdict anywhere.** It is computed fresh each run, from the
  edge plus the blocker's state, and it is stale the moment the blocker moves. §4 says
  why: a relationship is a fact, readiness is a judgement, and the graph holds facts.
  The executable form of this table is `tools/lib/readiness.js` if a tool needs it.

Report the four states apart — `blocked by #N` · `soft: waiting on #N (code pushed,
unmerged)` · `free (checked)` · `dependencies unchecked`. Collapsing any of them into
another is how a group gets started into a wall, or left in a queue it could have left.

## 6. Report — make it directly actionable

For each **ready** group, give the four things a session needs to begin:

```
READY  fix/import-fixes-115-114-113   #115 #114 #113
       why: blocks the payroll import; trunk CI green 2h ago
       files: app/Import/*, tests/Import/*
       start: colab claim 115 114 113 --worktree import-fixes-115-114-113
```

A **soft-ready** group is startable, so it belongs in the ready list — but it carries a
line the plain ones do not, because a session picking it up needs to know both *what it
is waiting on* and *that the code already exists*:

```
READY* fix/import-fixes-115-114-113   #115 #114 #113
       note: waits on #98 — its code is written and pushed (origin/feat/parser-98,
             cargo), unmerged at the human gate. Start now; do not re-write it.
       why: blocks the payroll import; trunk CI green 2h ago
       files: app/Import/*, tests/Import/*
       start: colab claim 115 114 113 --worktree import-fixes-115-114-113
```

Name the branch in the note. Without it the operator cannot check the claim, and "the
code exists somewhere" is the kind of reassurance that sends someone to write it twice.

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

- A run that short-circuited said so, named the timestamp it compared against, and
  re-printed a stored conclusion whose scope covers what was asked.
- A run that proceeded wrote its fingerprint **and** its conclusion to `$CACHE`, so the
  next ping can be the cheap one.
- Re-running changed nothing that was already true: no duplicate `blocked_by` edge, no
  re-closed issue, no second copy of a group's evidence comment.
- Every multi-issue group survives this run: `group:<key>` on **every** member, one
  evidence comment naming the collision, and the label removed anywhere it stopped being
  true. A group that exists only in this report is the failure §3 describes.
- Every open Issue is accounted for in exactly one bucket.
- Every "ready" group passed all six gates, not just "nobody is assigned".
- Every open blocker was judged on its **state** (§5.1), not on being open — and every
  soft-ready group says what it waits on and names the branch the code is already on.
- No `blocked_by` edge was deleted merely because its blocker's code landed.
- Every "already shipped" call carries evidence (sha + `file:line`) — not a hunch.
- Branch names carry all issue numbers in one trailing run.
- Anything surprising — a stale claim, a dead trunk CI, an epic whose table
  contradicts its title — is **reported**, not silently worked around.
