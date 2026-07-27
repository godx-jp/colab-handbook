'use strict';
/**
 * Write-time validation for the fields of ~/.colab/state.json that other commands later RESOLVE
 * AGAINST GIT: a worktree's `branch` and `path`, and a claim's `branch`.
 *
 * WHY THIS MODULE EXISTS. A worktree/claim pair was once found recorded as
 * `{"branch": "trunk", "path": null}`. The real branch existed and was healthy; only the record was
 * wrong — and it failed silently in three places at once: `landed` could not resolve the ref and
 * answered `unknown`, `doctor` did not classify it as drift (a null path is not a *missing*
 * directory), and `ship` matched claims to the branch BY NAME, found none, and merged with no
 * `Closes #N` — the failure CONVENTIONS.md §4 measured at 26/30 issues, reached by a path nothing
 * checked.
 *
 * THE TRIGGER WAS NOT EXOTIC. `colab claim <N> --worktree <name>` — the first command in code-start —
 * defaulted `--branch` to the literal string `trunk` and stubbed the not-yet-created worktree with
 * `path: null`. `trunk` is a ROLE (the branch sessions merge into: `main` or `dev`), never a branch
 * name; the conventions forbid creating one so named. It was being used as a SENTINEL for "no
 * branch — working on the trunk checkout", stored in the same value space as real branch names, and
 * every consumer read it as a name.
 *
 * So the absence of a branch is now `null`. Null is not a name: nothing can try to resolve it and
 * quietly get a wrong answer, and a `null` branch cannot match a real one in `ship`'s claim lookup.
 *
 * ONLY NEW PROBLEMS ARE REFUSED. Records already on disk in the bad shape must not turn every later
 * `colab` invocation into a crash — that state is precisely what a person runs `colab doctor` to
 * find out about. So this refuses the write that INTRODUCES a problem and passes through one a
 * record already carried, which is what keeps `doctor`'s own writes (flipping a status, repairing a
 * path) working on the very records it exists to fix.
 */

/**
 * Words that name a ROLE rather than a branch. `main` and `dev` are absent on purpose: those are
 * real branch names that a record SHOULD hold. `trunk` never is — it is the word for "whichever of
 * those this repo merges into", and a repo's `project.yml` says which.
 */
const ROLE_WORDS = new Set(['trunk']);

/**
 * The one status a worktree record may carry with no path: a stub written by `colab claim
 * --worktree <name>` for a worktree that does not exist yet. It exists so the claim is not read as
 * an orphan (doctor prunes claims whose worktree is not in state); `colab worktree new` replaces it
 * with the real record. Every other status asserts a directory on disk.
 */
const PENDING = 'pending';

function statusOf(rec) { return (rec && rec.status) || 'running'; }

/** Problem with a branch VALUE, or null. `null`/absent is legitimate and means "no branch". */
function branchProblem(branch) {
  if (branch === null || branch === undefined) return null;
  if (typeof branch !== 'string') return `branch must be a string or null (got ${typeof branch})`;
  const b = branch.trim();
  if (!b) return 'branch is an empty string — write null for "no branch", never ""';
  if (ROLE_WORDS.has(b.toLowerCase())) {
    return `"${branch}" is a ROLE, not a branch name (CONVENTIONS.md §4) — it resolves to no ref, ` +
      'so `landed` cannot classify it and `ship` matches no claims. Use null for "no branch".';
  }
  return null;
}

/** Problem with a worktree record's `path`/`status` pairing, or null. */
function pathProblem(rec) {
  const status = statusOf(rec);
  if (rec.path === null || rec.path === undefined) {
    if (status === PENDING) return null;
    return `path is null while status is "${status}" — only a ${PENDING} claim stub may claim no ` +
      'directory. A record nothing can act on should not be writable.';
  }
  if (typeof rec.path !== 'string' || !rec.path.trim()) {
    return `path must be a non-empty absolute path (got ${JSON.stringify(rec.path)})`;
  }
  return null;
}

/**
 * Every problem a worktree record currently has, as {code, message}. The CODE is what the guard
 * compares across a mutation — message text carries the current status and would read as a fresh
 * problem the moment doctor flipped `running` → `merged` on an already-broken record, which is the
 * one case the guard must stay out of the way for.
 */
function worktreeProblems(rec) {
  const out = [];
  const b = branchProblem(rec && rec.branch);
  if (b) out.push({ code: 'branch', message: b });
  const p = pathProblem(rec || {});
  if (p) out.push({ code: 'path', message: p });
  return out;
}

function claimProblems(rec) {
  const b = branchProblem(rec && rec.branch);
  return b ? [{ code: 'branch', message: b }] : [];
}

/**
 * The problem CODES each record carries right now — the "before" picture the guard compares
 * against. Cheap enough to take on every mutation, and it holds no values, so a mutation is free to
 * rewrite anything as long as it does not make a record worse.
 */
function snapshot(st) {
  const out = { worktrees: {}, claims: {} };
  if (!st) return out;
  for (const [k, w] of Object.entries(st.worktrees || {})) out.worktrees[k] = worktreeProblems(w).map((p) => p.code);
  for (const [k, c] of Object.entries(st.claims || {})) out.claims[k] = claimProblems(c).map((p) => p.code);
  return out;
}

/**
 * Problems this mutation INTRODUCED: a record that is new, or that has acquired a problem it did
 * not have before. Everything a record was already carrying passes through untouched — that is
 * `colab doctor`'s to report, and refusing it here would mean a legacy-bad record makes every later
 * command fail, including the ones trying to repair it. Returns human-readable strings.
 */
function changedProblems(before, afterState) {
  const out = [];
  const prevW = (before && before.worktrees) || {};
  const prevC = (before && before.claims) || {};

  for (const [name, rec] of Object.entries((afterState && afterState.worktrees) || {})) {
    const had = new Set(prevW[name] || []);
    const isNew = !Object.prototype.hasOwnProperty.call(prevW, name);
    for (const p of worktreeProblems(rec)) {
      if (isNew || !had.has(p.code)) out.push(`worktree "${name}": ${p.message}`);
    }
  }
  for (const [key, rec] of Object.entries((afterState && afterState.claims) || {})) {
    const had = new Set(prevC[key] || []);
    const isNew = !Object.prototype.hasOwnProperty.call(prevC, key);
    for (const p of claimProblems(rec)) {
      if (isNew || !had.has(p.code)) out.push(`claim ${key}: ${p.message}`);
    }
  }
  return out;
}

/** The refusal text for a non-empty changedProblems() list. */
function refusalMessage(problems) {
  return ['Refusing to write ~/.colab/state.json — the change would record something nothing can act on:']
    .concat(problems.map((p) => `  • ${p}`))
    .concat(['  (a record that cannot be resolved makes `landed` answer unknown and `ship` merge with no Closes)'])
    .join('\n');
}

module.exports = {
  ROLE_WORDS, PENDING, statusOf, branchProblem, pathProblem,
  worktreeProblems, claimProblems, snapshot, changedProblems, refusalMessage,
};
