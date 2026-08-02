---
name: code-plan
description: "Draft a full (rung-2) implementation plan for a hard Issue, into the same repo-local scratch file code-start writes its rung-1 stub to. Invoked two ways: by code-start when the Issue carries a needs-plan flag from code-triage, or mid-session when a rung-1 stub turns out to be sitting on ambiguous scope, a novel design with no precedent in the repo, or a dependency chain long enough that context is getting noisy. Drafted by a stronger-model planning subagent, seeded with the Issue plus the triage reason line, against the repo as it actually is right now — not re-derived by the coordinator that flagged it. Trigger phrases: 'plan this properly', 'needs-plan is set', 'draft a full plan', 'this needs a real plan', 'escalate to a full plan', 'the stub isn't enough'. Invoked by code-start (on flag) or mid-session (on self-escalation); read at code-wrap/code-ship. Never runs standalone against a repo with no session open."
---

# code-plan — draft the rung-2 plan a hard Issue needs before code starts

Runs **inside an implementing session**, either right after
[`code-start`](../code-start/SKILL.md) reads a `needs-plan` flag, or mid-session when a
rung-1 stub hits an escalation trigger. It never runs on its own — there is no session to
seed the plan into, and no branch or worktree for it to describe.

Notation: `$N` = the feature's Issue number · plan file = `.claude/plans/issue-$N.md` in
the **main checkout**, outside any worktree (`CONVENTIONS.md` §5, *Planning*).

## Why a subagent, and why a stronger model

The coordinator that decided this issue is hard (`code-triage`, or your own judgement
mid-session) is not the actor best placed to write the plan — it read the backlog, not the
current tree. And the implementer executing the plan may not be the actor best placed to
write it either, on a fleet that tiers its models for cost: the plan is exactly the
thinking that should arrive pre-paid, not re-derived at whatever tier is executing. So
this skill's job is narrow — gather the seed, spawn a planning pass on the fleet's own
stronger-tier agent (this repo's tooling stays model-agnostic; which agent/model that is
is each fleet's own policy, not this skill's to name), write down what it returns —
never to draft the plan itself at the calling session's own tier by default.

```
Agent(subagent_type: <the fleet's planning agent>, prompt: <seed, below>)
```

**No `Agent` tool available in this session, or no stronger-tier agent configured?**
Draft the plan yourself, at whatever tier you are running, and say so plainly in the
file's frontmatter (`model: self, no subagent available`) — a plan that admits it
skipped the escalation is honest; one that pretends is not.

## 1. Build the seed

Everything the subagent needs, and nothing it has to re-fetch:

```sh
gh issue view $N --json title,body,labels,comments
```

- The Issue's own **Goal / Plan / Decisions / Gotchas** sections.
- **The triage reason line**, if this run was flag-triggered — the one sentence
  `code-triage` left on the lead issue when it set `needs-plan`. This is the whole reason
  the flagged path exists: it is a cross-backlog judgement a session working one issue
  cannot reconstruct on its own, so hand it over verbatim, not paraphrased.
  ```sh
  gh issue view $N --comments | grep -A1 '^needs-plan:'
  ```
- **If this run is a mid-session self-escalation instead**, there is no reason line to
  fetch — write your own: what specifically turned out ambiguous or unprecedented, in the
  same one sentence a triage pass would have left. Put it in the seed anyway; the
  subagent should not have to infer why it was called.
- The rung-1 stub already in the plan file, if one exists — the subagent expands it, it
  does not start from nothing.
- Relevant file paths the Issue points at. **Do not sweep the codebase** — the whole
  point of this family is spending as little context as possible; hand the subagent
  the paths you already know from the Issue, and let it read only those plus what its
  own investigation turns up.

## 2. What the plan must contain

Whether drafted by a subagent or by you (no-`Agent` fallback), the plan is not the rung-1
stub's four lines with more words — it earns rung 2 by covering what a stub cannot:

- **Intent**, one or two sentences — same as rung 1, restated so the file is self-contained.
- **Approach** — the actual design: what changes where, in what order, and *why this
  shape* rather than an alternative. This is the part a stub skips and a hard issue needs.
- **Files expected to move**, with enough specificity that a diff wildly outside this list
  is itself a signal (to the implementer, and later to `code-ship`'s grading step) that the
  plan and the work diverged.
- **Risks / open questions** — what could make this the wrong approach, and what would
  have to be true for it to be wrong. Not hedging for its own sake; a hard issue got flagged
  because something about it is genuinely uncertain, and burying that uncertainty produces
  false confidence, not a better plan.
- **Acceptance oracle** — the same non-negotiable rung 1 asks for, stated precisely enough
  that `code-ship` can grade a diff against it later without re-deriving what "done" means.
- **Stop condition** — what closes the session. The gate going green against the stated
  oracle, not polish beyond it.

## 3. Write it into the plan file

Append (or replace the rung-1 stub, keeping it as context) with frontmatter:

```md
---
issue: N
rung: 2
cause: flagged | self-escalated
model: <planning agent/model actually used> | self, no subagent available
drafted: <ISO timestamp>
---

## Intent
…

## Approach
…

## Files
…

## Risks / open questions
…

## Acceptance oracle
…

## Stop condition
…
```

- **`cause` is not decoration.** It is what the usage journal (`code-ship`, teardown)
  reads to answer *flag precision* — was this issue actually hard, or did triage over-flag
  — versus *flag recall* — did a self-escalation catch something triage missed. Get it
  right; a mid-session escalation mislabelled `flagged` (or vice versa) corrupts exactly
  the signal the journal exists to produce.
- **Never overwrite a rung-1 stub silently.** Keep its four lines above the rung-2 content
  (or in a short "started as" note) — the divergence between what was assumed at session
  start and what turned out to be true is itself worth keeping.
- **This file is disposable.** It dies at `code-ship` teardown, same breath as the
  worktree and the claim. Anything from it worth keeping past this session belongs on the
  Issue at `code-wrap` A1 — this skill does not write to the Issue itself.

## 4. Hand back to the calling session

Report the rung (now 2), the cause, and a one-line summary of the approach — the calling
session continues coding from the file, it does not need this skill's own output restated
in the conversation.

## Verify complete

- The plan file exists at `.claude/plans/issue-$N.md`, outside any worktree, with valid
  frontmatter (`issue`, `rung: 2`, `cause`, `model`, `drafted`).
- The acceptance oracle is stated precisely enough to grade a diff against later — if you
  cannot imagine `code-ship` reading it and reaching a verdict, it is not precise enough.
- A flagged run quoted the triage reason line; a self-escalated run wrote its own,
  equally specific, reason for why the stub was not enough.
- Nothing was written to the Issue or the tracker — this skill's only output is the file.
