---
name: code-start
description: "Open a coding session the cheap way: learn the repo's tier/trunk from .github/project.yml, load the feature's context from its GitHub Issue instead of re-reading the codebase, claim the issue so parallel sessions don't collide, then branch off trunk (worktree optional). Trigger phrases: 'start coding', 'start a session', 'open a coding session', 'begin work on issue', 'pick up issue', 'claim an issue', 'new worktree', 'set up a session'. Pairs with code-wrap at the end of the session."
---

# code-start — open a session: read marker → load Issue → claim → branch

The goal is to spend as little context as possible. The Issue is the feature's
external memory: one `gh issue view` reloads the plan and hard-won knowledge, so
you never re-read the whole codebase. Claim before you start so two sessions
never grab the same work. Close the session with **code-wrap**.

Notation: `$N` = the feature's Issue number (keep it for the whole session).
`<trunk>` = the branch sessions merge into (from `project.yml`, below).

## 1. Read the repo marker

```sh
cat .github/project.yml        # tier, trunk, production, deploy, stack, ports
```

- Note `trunk` — it is `main` (Tier B) or `dev` (Tier A). Branch off it in step 4.
- **File missing?** Treat the repo as **Tier B, trunk `main`**, say so in your
  report, and propose adding the file (`CONVENTIONS.md` §3). Do not invent a tier.
- Never create a branch literally named `trunk`; never create `dev` in a Tier B repo.

## 2. Load context from the feature's Issue — don't re-read the code

```sh
gh issue list --search "<slug>" --state open    # find the feature's Issue
gh issue view $N                                 # goal + plan + knowledge
gh issue view $N --comments                      # prior-session log
```

- **Issue exists** → this is your whole context. Read only the paths it points
  to, plus the repo's `CLAUDE.md` if present. Do not sweep the codebase.
- **No Issue** → create one and put the plan in it (this is the memory the next
  session reloads):
  ```sh
  gh label create in-progress --color FBCA04 --description "Claimed by an active session" 2>/dev/null || true
  gh issue create --title "<type>: <feature>" --body-file <tmpfile>
  ```
  Body template:
  ```md
  ## Goal

  ## Plan (checklist)
  - [ ] …

  ## Decisions / Knowledge

  ## Gotchas
  ```
  Record the returned number as `$N`.
- **No GitHub remote?** Keep the same structure in a tracked file
  (`docs/sessions/<slug>.md`); code-wrap promotes it to an Issue if the repo goes
  to GitHub later. Everything below that says "Issue" means this file instead.

> **Open ≠ untouched.** An open Issue does not prove the work is undone — trackers
> drift behind trunk. Before you build, verify:
> ```sh
> git log --oneline --all --grep="#$N"          # already merged?
> grep -rl "<thing the issue describes>" <paths>  # already in the code?
> ```
> Already shipped → close it with evidence (sha + `file:line`), pick other work.
> Partly shipped → narrow the task to what's actually missing before starting.

## 3. Check claims, then claim before you start

**Source of truth is GitHub** (visible from any machine, to any person):

```sh
# check what's taken
colab claims          # if colab is installed …
gh issue list --label in-progress    # … else the raw command

# claim it (before starting, not when you open the PR)
colab claim $N        # if colab is installed …
gh issue edit $N --add-assignee @me --add-label in-progress    # … else raw
```

- An unclaimed issue is fair game — someone may take it out from under you.
  Claim first.
- A branch may carry a group of issues; claim **every** issue in the group now
  (`colab claim 115 114 113`, or one `gh issue edit` each).

## 4. Branch off trunk — worktree optional

Name: `^(feat|fix|docs|chore|refactor|test|perf)/[a-z0-9._-]+$`, ending in the
issue number(s): `feat/onboard-redesign-23`, or a group `fix/import-fixes-115-114-113`.
**Always branch off `<trunk>`, never off another feature branch.**

**Plain branch** (the default — claiming and branching work fine without a worktree):

```sh
git fetch origin <trunk>
git checkout -b <type>/<slug>-$N origin/<trunk>
```

**Worktree** (optional — only if the machine wants isolation, e.g. many parallel
sessions or a live trunk dev server you must not disturb):

```sh
colab worktree new <type>/<slug>-$N --issues $N --ports 1    # if colab is installed …
# … else fall back to plain git:
git worktree add -b <type>/<slug>-$N ../<slug>-$N origin/<trunk>
```

- Ports listed in any repo's `project.yml` `ports:` are **reserved** for that
  repo's trunk dev server — never reuse them for a worktree, even while the trunk
  server is down. `colab` enforces this; without it, pick a port by hand and check
  the reserved list first.
- **Machine-specific setup — DB clones, dependency symlinks, dev-server wiring —
  is NOT improvised here.** It belongs in the repo's `.colab/hooks/post-create`,
  which `colab worktree new` runs automatically. If the repo has no such hook,
  the worktree starts bare; set up only what you personally need and do not bake
  it into this flow. *(Machine-specific automation hooks in here: `.colab/hooks/`.)*

## 5. Report

- Issue URL (`gh issue view $N --json url -q .url`) or the notes-file path.
- Branch name, and the worktree path if you made one.
- What you loaded from the Issue and your plan (checklist groups, file split if
  fanning out to sub-agents).
- Remind: close the session with **code-wrap** to ship and distill knowledge back
  onto the Issue.
