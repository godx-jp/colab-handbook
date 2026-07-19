# Engineering Conventions

How we manage branches, releases, and in-flight work across every repo we own — in
`godx-jp` and in personal or other orgs alike.

Written for **both humans and AI coding agents**. If you are an agent starting a session,
read this file and the repo's `.github/project.yml` before touching anything.

**This handbook decides outcomes, not implementations.** It tells you what must be true —
which branch work lands on, what a release is, how to claim an issue. It never tells you
which Node version to build with, which test runner to use, or what your CI file looks like.
Those belong to each repo. Where you see a command here, it illustrates a rule; it is not a
tool you must adopt.

> **Why enforcement is weak by design:** GitHub branch protection is unavailable on our
> private repos (`403 Upgrade to GitHub Pro`). We cannot make `main` unpushable. Nothing here
> is enforced by GitHub settings. Conformance is checked *from outside* by the audit tool
> ([§8](#8-conformance)), and otherwise rests on habit.

---

## 1. The model in one picture

Which model a repo uses depends on **one question: does it deploy to production?**

```
TIER B — no production yet
  feat/<slug>-<issue> ──▶ main
                           │
                        your CI

TIER A — has production
  feat/<slug>-<issue> ──▶ dev ──▶ main ──▶ tag v1.2.0
                           │       │        │
                        fast CI  full CI  deploy
```

**Tier B is the default.** A repo starts here and stays here until something actually
consumes a release. Do not create `dev` "to be ready" — see [§10](#10-anti-patterns).

### Why the split exists at all

`main` in Tier A is a **pure release branch**. It is not where work lands; it is where work
is *promoted* to. This buys one specific thing: the expensive test suite runs at promotion
time, not on every session merge. Sessions stay fast; releases stay safe.

**If your test suite is fast, you do not need Tier A.** The split is a response to slow CI,
not a badge of seriousness. A repo with no meaningful test suite gains nothing from it — it
gets the ceremony without the benefit, and `main` becomes a branch nobody has a reason to
trust. Write the suite first, then split.

---

## 2. Tiers

| | **Tier B** | **Tier A** |
|---|---|---|
| Has production | no | yes |
| Trunk (where sessions merge) | `main` | `dev` |
| Release branch | — | `main` |
| CI on trunk | fast | fast |
| CI on `main` | — | full suite |
| Tags | optional | required, `v*.*.*` |
| Deploy trigger | none | tag push |

**"Trunk" is a role, not a branch name.** It means *the branch sessions merge into* — `main`
in Tier B, `dev` in Tier A. When our internal docs say "merge về trunk" or "trunk luôn sống",
they mean the role. Read `project.yml` to learn which branch that is in a given repo. Never
create a branch literally named `trunk`.

---

## 3. `.github/project.yml` — the marker

Every repo commits this file. It is how a human or an agent learns the repo's state without
guessing, without an API call, and even when the repo has no GitHub remote at all.

```yaml
tier: B                  # A = has production · B = none yet
trunk: main              # dev (tier A) · main (tier B)
production: null         # url, or null for tier B
deploy: none             # tag (tier A) · none (tier B)
stack: capacitor-vite    # free-form; describe the repo honestly
```

`stack` is a **free-form string**, not a fixed list. Describe what the repo actually is. A
closed enum was tried and immediately failed on a Capacitor app that was neither a plain SPA
nor a mobile-native project.

Optional toolchain keys (`node:`, `php:`, …) may be added — see [§7](#7-ci-and-toolchain).

Mirror the tier as a GitHub **topic** (`tier-a` / `tier-b`) so `gh repo list --topic tier-a`
gives a fleet-wide view. The file is the source of truth; the topic is for discovery.

Full field reference: [`project.schema.md`](project.schema.md).

---

## 4. Branches and commits

**Branch names:**

```
^(feat|fix|docs|chore|refactor|test|perf)/[a-z0-9._-]+$
```

Convention is `feat/<slug>-<issue-number>`, e.g. `feat/onboard-redesign-23`. Putting the
issue number in the name means the claim registry, the worktree, and the Issue line up
without a lookup table.

**A branch may carry a group of related issues** — suffix them all:
`fix/import-fixes-115-114-113`. Claim every issue in the group before starting; release
each as it completes. The branch (and its worktree, if any) stays alive until the last
one is done.

**Branches that predate adoption are grandfathered.** Do not rename them — several may be
checked out in live worktrees, and renaming breaks active sessions for no benefit. Apply the
convention to new branches only.

**Never** branch off another feature branch. Always branch off the current trunk.

**Commits** — Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`,
`perf:`). This is not decoration: [§6](#6-releases) builds the release summary by grouping on
these prefixes. A commit with no prefix is invisible in release notes.

**Merging:**

- Feature branch → trunk: **squash**, so trunk history is one commit per unit of work.
- `dev` → `main` promotion (Tier A only): **`--no-ff` merge commit**, never squash. The merge
  commit *is* the release boundary; squashing it destroys the record of what shipped together.
- **The merge message closes its issues: write `Closes #N`** (one per issue in the group),
  not a bare `(#N)` reference. GitHub auto-closes on the keyword and ignores the reference —
  we measured a repo where 26 of 30 issues sat open with their code long since merged,
  purely because merges said `(#22)` instead of `Closes #22`.
- **Before merging to trunk, check that trunk's last CI run is green — and that it ran at
  all.** `gh run list --branch <trunk> -L 1` costs one command. Branch protection cannot do
  this for us; the habit must. We once merged for 12 straight hours into repos whose CI was
  silently dead (org billing lockout) — every run "failed" without starting, and nothing
  noticed.

---

## 5. Claiming work — how to say "I'm on this"

Parallel sessions and parallel agents must not collide on the same Issue. Two layers:

### Source of truth — GitHub

```sh
gh issue list --label in-progress                               # check, before taking work
gh issue edit <N> --add-assignee @me --add-label in-progress    # claim, at session start
gh issue edit <N> --remove-label in-progress                    # release, at session end
```

Assignee plus the `in-progress` label is authoritative because it is **visible from any
machine and to any person** — another programmer, an agent on a different host, or you on
your phone.

The label does not exist in a fresh repo. Creating it is part of adoption ([§9](#9-adopting-this)).

### Fast path — local cache

`~/Future/.claude/issues.active` remains a zero-latency local read for parallel sessions on
the same machine, written automatically when a worktree is created.

**It is a cache, not the truth.** It is machine-local and uncommitted, so it cannot see other
people's work — and manual trunk claims are never auto-healed, so they accumulate. When the
cache and GitHub disagree, **GitHub wins**.

### Rules

- Claim **before** you start, not when you open the PR. An unclaimed issue is fair game.
- Release the claim even if you did not finish. A stale claim is worse than no claim, because
  it silently blocks other people.
- For long-running work, comment on the Issue with progress. The Issue is the feature's
  external memory — anyone resuming should get full context from `gh issue view N` without
  re-reading the codebase.

---

## 6. Releases

Tier A only. A release is: **merge `dev` → `main`, then tag.**

```sh
git checkout main && git merge --no-ff dev && git push
git tag v1.2.0 && git push origin v1.2.0     # ← this is what deploys
```

Pushing the tag is the deploy trigger. Pushing `main` is **not** — that only runs the full
test suite. This separation lets you promote code and decide to ship it later.

**Versioning** — SemVer. Patch for fixes, minor for features, major for breaking changes.
Pre-1.0 repos use `v0.x.y` and treat minor as "meaningful increment".

**Every tag gets a release summary** — a published GitHub Release whose notes group the
commits since the previous tag by Conventional-Commit type. This is the changelog; we do not
maintain `CHANGELOG.md` by hand. How you generate it is your repo's business —
[`templates/release-tag.yml`](templates/release-tag.yml) automates it on tag push.

When the workflow cannot run (Actions outage, billing lock — it has happened), the summary
is still owed. Manual fallback, same output:

```sh
colab release-notes v1.1.0..v1.2.0 | gh release create v1.2.0 --notes-file - --generate-notes
```

Do not tag from `dev`. Do not tag a commit that has not passed the full suite on `main`.

---

## 7. CI and toolchain

**Your CI lives in your repo and belongs to you.** This handbook ships copyable starting
points under [`templates/`](templates/), but nothing is called remotely and nothing is
mandatory. Copy, edit, own.

What the handbook does require is an **outcome**: every pull request must run, at minimum, a
**secret scan** and a **build**. A committed credential is the one failure you cannot undo by
reverting — it must be caught before it lands.

### Toolchain versions — strict precedence

Never hardcode a version in CI. Resolve it, in this order:

1. **`.github/project.yml`** toolchain keys, if present — wins. For cases the ecosystem
   cannot express, or a deliberate pin.
2. **The ecosystem's own manifest** — `.nvmrc` or `package.json → engines.node`;
   `composer.json → require.php`. This is the normal answer.
3. **Fail the build.** Never fall back to a default.

That last rule is the point. A silent default is how one repo ended up building on Node 20
while deploying on Node 22 — nobody chose it, it was simply there, and the mismatch survived
for months. Failing loudly on an undeclared toolchain is cheaper than debugging a version
skew in production.

When both sources exist and disagree, that is a finding to report, not something to quietly
resolve.

---

## 8. Conformance

Because branch protection is unavailable, conformance is checked **from outside** rather than
by a job inside each repo. The [`audit/`](audit/) tool reads repos across every owner —
including local-only repos with no GitHub presence — and reports drift in one run:

```
futurelastic/shoots-automation   tier A   ⚠ node: engines=22 but ci.yml pins 20
futurelastic/everyday            tier B   ⚠ missing .github/project.yml
```

Run it on a schedule. It is advisory: it reports, it does not block. That is a deliberate
trade — an external auditor covers repos that never adopted anything, which an in-repo job
by definition cannot.

---

## 9. Adopting this

An agent that understands the model still needs the bootstrap steps spelled out. They are
here.

### Any repo, first-time adoption

1. **Determine the tier.** Does a deploy target exist *today*? Not "soon" — today. If no,
   Tier B. An imminent launch does not make a repo Tier A.
2. **Write `.github/project.yml`** ([§3](#3-githubprojectyml--the-marker)).
3. **Create the claim label** — it will not exist yet:
   `gh label create in-progress --color FBCA04 --description "Claimed by an active session"`
4. **Add the tier topic** — `gh repo edit <owner>/<repo> --add-topic tier-b`
5. **Add the handbook pointer to the repo's `CLAUDE.md`** — copy
   [`templates/repo-CLAUDE-block.md`](templates/repo-CLAUDE-block.md). If the repo has no
   `CLAUDE.md` yet, create one with just this block. **Do not skip this.** It is the only
   reason a future agent will ever discover these conventions; agents read `CLAUDE.md`,
   they do not go looking for a handbook they have not heard of.
6. **Make sure CI meets the outcome in [§7](#7-ci-and-toolchain)** — secret scan + build,
   toolchain resolved not hardcoded. Copy a template if useful.
7. **Leave existing branches alone.** Grandfathered ([§4](#4-branches-and-commits)).
8. **Do not create `dev`** unless the repo is genuinely Tier A.

### Promoting Tier B → Tier A

Do this **on the day a deploy target exists** — not before. Order matters:

1. Add the deploy workflow, pointed at the real production host.
2. `git checkout -b dev main && git push -u origin dev`
3. Set the repo's default branch to `dev`, so PRs target it by default.
4. Update `project.yml`: `tier: A`, `trunk: dev`, `deploy: tag`, real `production:` URL.
5. Swap the topic to `tier-a`; update the internal project table (ports, prod URL).
6. Tag the first release.

Step 1 comes first on purpose. `main` only becomes meaningful once something consumes it.

---

## 10. Anti-patterns

Each of these is something we have actually done.

**A release branch nobody consumes.** A repo adopted `dev` as default and dutifully wrote
"never push to `main`" in its docs — but nothing ever deployed from `main`. It sat 76 commits
behind, inert for months, while a `staging` branch created alongside it was abandoned after a
week. *A branch with no pipeline hanging off it decays into noise.* This is why Tier B is the
default and why promotion step 1 is "add the deploy workflow".

**The same fix opened four times.** With `dev`, `staging`, and `main` all live, one timezone
fix required four near-identical PRs, one per target branch. *Three tiers without automated
promotion is a tax you pay on every hotfix.* We use two, deliberately.

**A deploy mechanism nobody used.** A repo's deploy workflow triggers on tag push. It has
zero tags. Every deploy in its history was a manual dispatch — the workflow was copy-pasted
from a sibling and the tag ritual never took. *Copy-pasted CI encodes intentions nobody
adopted.* If you copy a template, read it and make it yours.

**Docs describing a repo that doesn't exist.** Our most heavily documented repo prescribes
trunk `main` (its actual default is `master`), "rebase, never squash" (every commit is a
squash), and CI gating on `dev` (its own workflow says dev merges skip CI by design). *An
aspirational doc is worse than no doc — people trust it.* Keep this file describing what is
true; when reality changes, change this file in the same PR.

**Stale branch references in CI.** A repo still gates on `develop`, `master`, and `workos` —
none of which exist. *Config drifts silently when it is copied rather than referenced.* The
audit tool exists to catch exactly this.

**A silent version default.** Covered in [§7](#7-ci-and-toolchain). Worth repeating: the bug
was invisible because nothing looked wrong — CI was green the whole time.

---

## 11. Quick reference

```sh
# starting work
gh issue list --label in-progress                 # what's taken
gh issue edit N --add-assignee @me --add-label in-progress
git checkout -b feat/<slug>-N origin/<trunk>      # trunk = main (B) or dev (A)

# finishing work
git checkout <trunk> && git merge --squash feat/<slug>-N
gh issue edit N --remove-label in-progress

# releasing — TIER A ONLY
git checkout main && git merge --no-ff dev && git push   # --no-ff, never squash
git tag v1.2.0 && git push origin v1.2.0                 # the tag deploys
```

---

*Changes to this file are changes to how everyone works. Explain the why in the PR body.*
