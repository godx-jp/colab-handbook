---
name: handbook-sync
description: "Bring ONE repo up to the current colab-handbook, from inside that repo — including a repo that has never adopted it at all. Detects 'nothing adopted here yet' as a first-class state and drives first-time adoption to completion (tier, marker, claim label, topic, CLAUDE pointer, CI, and registration in the fleet). Otherwise classifies every copied artifact (CI workflows, the CLAUDE conventions block, guards), shows what upstream actually changed since your stamp, and grafts it in without destroying your local edits — because copy-and-own means the repo owns its copies. Also checks whether the tier model itself moved on. Trigger phrases: 'sync the handbook', 'update this repo to the latest handbook', 'adopt the handbook', 'this repo has no project.yml', 'onboard this repo to the conventions', 'register this repo', 'we are behind the handbook', 'handbook drift', 'reconcile conventions', 'colab update says we are behind'. Wrap it in code-start/code-wrap — this is a code change like any other."
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

**One check before you claim:** if this repo has no `.github/project.yml`, it has no
`in-progress` label either, and the claim will not land the way you think it did —
read §2's ordering note first. This is the one step that cannot wait for §1 to detect
the condition, because it runs before §1.

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
| `behind` | template genuinely changed since your stamp | §3 — refresh or graft |
| `diverged` | you hand-edited it since copying | §4 — graft only |
| `unstamped` | lineage unknown | §5 — establish it first |
| `unrelated` | its name matches a template, its content does not | nothing — it is this repo's own file |
| `n-a` | cannot assess, with a stated reason | **read the reason.** `nothing adopted here yet` → §2, this is adoption. Otherwise often a missing tag |

**Before any of that, check you are in the right skill half.** The first command above
reads the one file an unadopted repo does not have, and every state in the table is
derived from stamps it does not have either — so on such a repo this whole section
degrades to a no-op that looks like a clean bill of health. If `colab update .` says
`n-a` with the reason **"no stamped handbook artifacts — nothing adopted here yet"**,
or the audit says **"no `.github/project.yml` — repo is undescribed"**, go to **§2**
and do not walk the reconciliation states.

**`behind` does not mean "your file is old".** It means the *template* moved. If the
template never changed, a stamp from three releases ago is still current — which is
why this check compares template history, not version strings.

## 2. Nothing adopted here yet — this is adoption, not sync

Adoption is not a niche case. Measured on one fleet: **9 of 23 registered repos have
no `.github/project.yml`** — the largest single cohort in it, and every one invisible
to the conformance checks by construction. A repo missing from the registry entirely
is worse off still: it appears in no sweep, so nothing will ever tell you it needs
this. **It can only be adopted from inside, by someone standing in it.** That is you.

### The checklist is not in this file, on purpose

**[`CONVENTIONS.md` §9 "Adopting this"](../../CONVENTIONS.md#9-adopting-this) is the
procedure** — nine steps, already written, already correct. Open it and work it in
order. This section adds only what §9 cannot know: how to interleave it with your
session, which step blocks, and which steps get skipped.

Do **not** copy §9's steps into this skill, or into the Issue as a restated list. Two
copies of one checklist drift, and the disagreement is then found by whoever followed
the wrong one. This handbook has paid for that twice in a single day — a duplicated
detection predicate that broke invisibly, and a list that quietly conflated two
different things. Link to §9, summarise its outcomes, never fork it.

### The ordering trap — you cannot claim before the label exists

§9's step 3 creates the `in-progress` label, because on an unadopted repo it does not
exist. But **code-start claims the Issue in its own step 3, before any of §9 runs** —
so the claim depends on machinery adoption has not built yet.

On the path most sessions take, the failure is quiet:

- Raw `gh issue edit $N --add-label in-progress` **fails loudly.** Recoverable.
- `colab claim $N` **does not fail.** It warns that the `gh` edit failed and keeps the
  **local** claim. So the machine-local cache reads as claimed while GitHub — the
  source of truth, and the only thing a colleague on another machine can see — holds
  nothing. That is precisely the collision `CONVENTIONS.md` §5 exists to prevent,
  reached from underneath.

So **pull §9's step 3 forward, ahead of the claim**:

```sh
gh label create in-progress --color FBCA04 \
  --description "Claimed by an active session" 2>/dev/null || true
```

Then claim, then work §9 from its step 1. The `|| true` keeps it safe on a repo that
already has the label — which matters, because partial adoption is the normal case.

**No GitHub remote at all?** There is no label and no claim to be made. Take
code-start's notes-file path; §9's steps 3 and 4 and the GitHub half of 7 do not
apply. Say so in your report rather than leaving them looking undone.

### The tier question blocks — ask it, never infer it

§9's step 1 is a **judgement, and it is not yours to make.** `CLAUDE.md` is explicit:
a missing marker means treat the repo as Tier B and *propose* the file. Proposing is
the agent's job; deciding is not.

Stop and put the question to the human in the form §9 asks it:

1. Does a deploy target exist **today** — not soon, today? No → **Tier B**.
2. If yes: does a **tag** gate production (**A**), or does the `dev` → `main`
   promotion itself deploy (**C**)?

Do not read a tier off a `Dockerfile`, a URL in a README, or a deploy workflow that
may be dormant. The cost of guessing is silent and delayed — a wrong tier misroutes
deploys, and nothing complains at the time it is written. A repo that describes
nothing is more honest than one that describes itself wrongly.

Two things not to do while you wait: do not create `dev` "to be ready" (§9 step 9),
and if the answer is B, `production: null` and `deploy: none` are the finished values,
not placeholders to revisit.

### Partial adoption is the normal case — resume, don't restart

A marker but no label; CI but no registration; everything but the CLAUDE pointer.
Treat §9 as a checklist to **complete**, and probe each step rather than assume it:

```sh
cat .github/project.yml                 # step 2 — present? does its tier match reality?
gh label list --search in-progress      # step 3
gh repo view --json repositoryTopics    # step 4 — tier-a / tier-b / tier-c
grep -c "colab-handbook @" CLAUDE.md    # step 5 — the pointer block and its stamp
ls .github/workflows/                   # step 6
colab register --list                   # step 7 — is this repo in BOTH registries?
```

Every step of §9 is safe to re-run, and `colab register` documents it in its own help
("Idempotent: registering an already-registered repo reports it and exits 0"). Record
the *outcomes* in the Issue as a checklist; leave the *steps* in §9.

**Leave existing branches alone** (§9 step 8) — §4 grandfathers them, and a first sync
is exactly when someone is tempted to tidy. Renaming one can break a live worktree.

### Registration is the step that gets skipped

**`colab register` (§9 step 7) is last on the list and first to be forgotten**, because
nothing local breaks without it. The repo builds, CI passes, the session wraps — and
the repo simply never appears in a sweep, accumulating drift nobody can see. It is the
mechanism by which a cohort that size goes unnoticed. Run it, do not defer it.

### Finish by proving the repo is visible

Adoption ends with the classification that could not run at the start — not with the
claim that it now would:

```sh
colab update .                                     # no longer "nothing adopted here yet"
node "$COLAB_HANDBOOK/audit/audit.mjs" --local .   # no longer "repo is undescribed"
colab register --list                              # this repo, in BOTH registries
```

`colab register --list` marks each registry it found the repo in (`T` = the audit
fleet list, `C` = the ports config); a path in only one is drift, and the command
exits non-zero when it finds any. Paste that output onto the Issue. A repo is adopted
when the fleet can see it, and this is the evidence for it.

Then return to §1. Anything you copied in §9's step 6 is now a stamped artifact, and
the rest of this skill applies to it in the ordinary way.

## 3. `behind` — let the tool write only what is provably pristine

```sh
colab update . --apply
```

This writes **only** copies still byte-identical to the template as of their own
stamp. It never commits, never stages, never touches a `diverged` or `unstamped`
file. If it reports "nothing was refreshable", that is a real answer, not a failure —
go to §4.

Then read what it wrote (`git diff`) before committing. A refreshed file may reintroduce
an `# EDIT:` marker your repo had already resolved.

## 4. `diverged` — graft the upstream change, keep yours

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

## 5. `unstamped` — establish lineage before touching anything

An unstamped copy cannot be safely rewritten: nobody knows what replacing it would
destroy. Work out which template it came from and how far it has drifted:

```sh
diff <(git -C "$COLAB_HANDBOOK" show <some-tag>:templates/<name>) <your-file>
```

Then either graft as in §4 and **hand-add the stamp line**, or — only if the copy
turns out to be genuinely untouched — `colab template <name> --force` and let it
stamp. Adding a stamp asserts provenance; do not assert one you have not checked.

The row tells you which `<name>` the evidence points to. If it names none, the tool
proved the file is *a* copy but not *of what* — find that out before stamping
anything. And if the state is `unrelated`, stop: the file only shares a template's
name. Re-copying over it destroys work that never came from the handbook.

## 6. The CLAUDE conventions block — always a graft

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

## 7. Beyond stamps — has the model itself moved?

Stamps track *file* drift. The conventions can move without any template changing,
and the audit is what catches it:

- A new tier may now describe this repo better than the one it declares. If the
  audit reports a tier mismatch, fixing `project.yml` is part of this work.
- Toolchain pins must still agree between `project.yml` and the manifest.
- A workflow may trigger on branches that no longer exist — CI passing on nothing.

Fix what is genuinely wrong; **report what you are unsure about** rather than
guessing. A `project.yml` that contradicts reality is worse than one that admits it.

## 8. Commit safely — two habits, both learned the hard way

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

**If this was an adoption (§2), additionally:**

- The tier was **answered by a human**, not inferred — and the report says who and
  which of §9's two questions decided it.
- `colab update .` no longer reports "nothing adopted here yet", and the audit no
  longer reports "repo is undescribed" — pasted onto the Issue as output, not
  summarised as a claim.
- `colab register --list` shows this repo in **both** registries and exits 0.
- Every step of §9 is either done or explicitly recorded as not applicable (a repo
  with no GitHub remote skips several) — none left ambiguous.
- Pre-existing branches are untouched.
