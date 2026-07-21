'use strict';
/**
 * journal.js — OPTIONAL, machine-local record of what colab actually did.
 *
 * Set `journal: true` in ~/.colab/config.json and colab appends one JSON object per line to
 * ~/.colab/journal.jsonl (COLAB_HOME-aware, like every other artifact). Leave it unset — the
 * default — and this module writes nothing, creates nothing, and touches no path at all. That
 * silence is absolute and is the property the test suite scores first.
 *
 * ── Why this exists ───────────────────────────────────────────────────────────────────────────
 * state.json is the CURRENT truth and only that: it is mutated in place, and a record is DELETED
 * rather than retired. So the single number worth having — how long a thing lived — is destroyed at
 * the exact moment it becomes knowable, because the record being deleted is the only thing that
 * still carries `created`. This module reads that number one instruction before it is lost, which
 * is why `livedMs` costs no new bookkeeping anywhere in the CLI.
 *
 * ── Append-only, and unable to corrupt state ──────────────────────────────────────────────────
 * The journal is a separate file opened in append mode. It never reads, writes, locks or parses
 * state.json. The one hook inside the state critical section (see state.mutate) computes a diff and
 * nothing else; the write itself happens AFTER the lock is released, so a slow or failing journal
 * can neither hold the lock nor fail a mutation. Every entry point here is wrapped so that an
 * exception is swallowed: observability that can break what it observes is a bad trade, and that
 * is the same argument that kept this feature out of repo hooks in the first place.
 *
 * ── The kind vocabulary is OURS, and it is not notify.js's ────────────────────────────────────
 * lib/notify.js has ACTION_KIND: a deliberately CLOSED map owned by an external receiver, which
 * answers 400 to anything it does not recognise. It is not widened here. This file needs kinds that
 * receiver never agreed to (port churn, a status transition, an invocation, a truncation), and
 * borrowing its names would either force a change on a contract we do not own or produce two
 * vocabularies quietly sharing strings. They are separate on purpose. Reusing notify's CALL SITES
 * is fine and we do; depending on its DELIVERY is not, and we do not — nothing here goes near a
 * socket, and a journal line is written whether or not any observer is configured.
 *
 * ── Naming ────────────────────────────────────────────────────────────────────────────────────
 * "Journal" is overloaded in this repo's docs: tools/README.md uses it for what a webhook RECEIVER
 * keeps on the other side of `notifyUrl`. That one is remote, someone else's, and may never receive
 * an event at all. This one is local, ours, and never leaves the machine. The docs disambiguate
 * both senses explicitly; do not let them merge.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Resolved independently rather than imported from state.js, which requires THIS module — a cycle
 * would leave one of the two holding a half-built exports object depending on load order. It is one
 * line of duplication against a class of bug that only appears at require time. Must stay identical
 * to state.js's COLAB_DIR, including the COLAB_HOME override.
 */
const COLAB_DIR = process.env.COLAB_HOME || path.join(os.homedir(), '.colab');
const JOURNAL_FILE = path.join(COLAB_DIR, 'journal.jsonl');

/**
 * Size cap, enforced by truncation on first write of a process (see capFile).
 *
 * A full rotation scheme (numbered files, an index, a compactor) is more machinery than an opt-in
 * local file justifies, and every part of it is another thing that can fail inside a command doing
 * real work. A cap that drops the OLDEST lines is the cheapest answer that is still honest: recent
 * history is what gets queried, and the drop is itself recorded (`journal.truncated`) so the file
 * never silently claims to be complete. 5 MiB is ~20k typical lines.
 */
const MAX_BYTES = 5 * 1024 * 1024;
/** Fraction of the cap kept when truncating. Keeping only a sliver would truncate constantly. */
const KEEP_RATIO = 0.5;

/**
 * Our kinds. Frozen for the same reason notify.js freezes its own: a fact with two spellings makes
 * every count that groups by kind quietly half-right, and the whole point of this file is counting.
 */
const KIND = Object.freeze({
  INVOKED: 'colab.invoked',
  WORKTREE_CREATED: 'worktree.created',
  WORKTREE_CHANGED: 'worktree.changed',
  WORKTREE_REMOVED: 'worktree.removed',
  CLAIM_CREATED: 'claim.created',
  CLAIM_CHANGED: 'claim.changed',
  CLAIM_REMOVED: 'claim.removed',
  PORT_ALLOCATED: 'port.allocated',
  PORT_FREED: 'port.freed',
  TRUNCATED: 'journal.truncated',
});

/** The three state collections, and the record fields worth carrying into the journal. */
const SECTIONS = Object.freeze([
  { key: 'worktrees', created: KIND.WORKTREE_CREATED, changed: KIND.WORKTREE_CHANGED, removed: KIND.WORKTREE_REMOVED,
    fields: ['repo', 'branch', 'base', 'ports', 'host', 'session', 'sessionName', 'status'] },
  { key: 'claims', created: KIND.CLAIM_CREATED, changed: KIND.CLAIM_CHANGED, removed: KIND.CLAIM_REMOVED,
    fields: ['issue', 'repo', 'worktree', 'branch', 'host', 'session', 'sessionName'] },
  { key: 'ports', created: KIND.PORT_ALLOCATED, changed: null, removed: KIND.PORT_FREED,
    fields: ['port', 'owner', 'host'] },
]);

// ─────────────────────────────────────────────────────────────── enablement

/**
 * Enabled ONLY by the boolean true. A string "true", a 1, a truthy object — all off.
 *
 * Strict because this is the switch between "writes nothing, ever" and "grows a file". A config
 * typo must fall on the side that surprises nobody, and `journal: true` is the one documented form.
 */
function enabled(cfg) {
  return !!cfg && cfg.journal === true;
}

/**
 * Per-process config cache. mutate() runs many times per invocation and would otherwise re-read
 * config.json each time. Read lazily: a process that never journals never opens the file.
 */
let _cfg;
let _cfgRead = false;
function config() {
  if (_cfgRead) return _cfg;
  _cfgRead = true;
  try {
    _cfg = JSON.parse(fs.readFileSync(path.join(COLAB_DIR, 'config.json'), 'utf8'));
  } catch (_) {
    _cfg = null; // absent or unparseable config = disabled, exactly like an unset key
  }
  return _cfg;
}

/** True when this process should journal. The single gate every entry point checks first. */
function on() {
  return enabled(config());
}

/** Test seam: forget the cached config (and the once-per-process cap check). */
function _resetForTests() {
  _cfg = undefined;
  _cfgRead = false;
  _capped = false;
  _repo = null;
  _cmd = undefined;
}

// ─────────────────────────────────────────────────────────────── writing

let _capped = false;

/**
 * Enforce MAX_BYTES once per process, before the first append.
 *
 * Reads the whole file only when it is already over the cap — the common path is a single stat.
 * The kept tail is cut at a newline so the first surviving line is never half a JSON object; a
 * reader that hits a truncated line would drop a whole record for no reason.
 */
function capFile() {
  if (_capped) return;
  _capped = true;
  let size;
  try {
    size = fs.statSync(JOURNAL_FILE).size;
  } catch (_) {
    return; // no file yet — nothing to cap
  }
  if (size <= MAX_BYTES) return;
  const keep = Math.floor(MAX_BYTES * KEEP_RATIO);
  const buf = fs.readFileSync(JOURNAL_FILE);
  let cut = buf.length - keep;
  const nl = buf.indexOf(0x0a, cut);
  cut = nl === -1 ? buf.length : nl + 1;
  const dropped = cut;
  const tmp = `${JOURNAL_FILE}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, buf.subarray(cut));
  fs.renameSync(tmp, JOURNAL_FILE);
  // Record the loss in the file itself, so a count taken from it can never mistake a truncated
  // history for a complete one.
  fs.appendFileSync(JOURNAL_FILE, JSON.stringify({
    kind: KIND.TRUNCATED, ts: new Date().toISOString(), droppedBytes: dropped, capBytes: MAX_BYTES,
  }) + '\n');
}

/**
 * Append records. No-op — and no filesystem call whatsoever — when disabled.
 *
 * Never throws: a full disk, a read-only COLAB_HOME or a vanished directory must not turn a command
 * that already did its work into a failure.
 *
 * @param {object[]} records
 * @returns {number} how many lines were written (0 when off; for tests)
 */
function append(records) {
  if (!records || records.length === 0) return 0;
  if (!on()) return 0;
  try {
    fs.mkdirSync(COLAB_DIR, { recursive: true });
    capFile();
    let out = '';
    for (const r of records) out += JSON.stringify(r) + '\n';
    fs.appendFileSync(JOURNAL_FILE, out);
    return records.length;
  } catch (_) {
    return 0;
  }
}

// ─────────────────────────────────────────────────────────────── state diff

/**
 * Copy the fields we journal out of a live state object.
 *
 * Called INSIDE the state lock, twice per mutation, so it stays shallow and allocation-light: a
 * deep clone of state on every claim would be a real cost paid for nothing. Shallow is sufficient
 * because every field read afterwards is a scalar or an array we only stringify.
 *
 * Returns null when journalling is off, which is what makes the disabled path free — state.mutate
 * skips the whole diff on a null.
 */
function snapshot(st) {
  if (!on() || !st) return null;
  const snap = {};
  for (const s of SECTIONS) {
    const src = st[s.key] || {};
    const dst = {};
    for (const k of Object.keys(src)) {
      const rec = src[k] || {};
      const kept = { created: rec.created };
      for (const f of s.fields) if (rec[f] !== undefined) kept[f] = rec[f];
      dst[k] = kept;
    }
    snap[s.key] = dst;
  }
  return snap;
}

/** Elapsed ms between an ISO `created` and `now`, or undefined when unusable. */
function lifespan(created, now) {
  if (!created) return undefined;
  const t = Date.parse(created);
  if (!Number.isFinite(t)) return undefined;
  const ms = now - t;
  // A negative lifespan means a clock moved, not that the record lived backwards. Drop it rather
  // than emit a number an aggregate would happily average in.
  return ms >= 0 ? ms : undefined;
}

/** Fields that changed between two snapshots of one record, as {field: [before, after]}. */
function changedFields(before, after) {
  const out = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    if (k === 'created') continue;
    const a = before[k], b = after[k];
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    out[k] = [a === undefined ? null : a, b === undefined ? null : b];
  }
  return out;
}

/**
 * Diff two snapshots into journal records. PURE — no I/O, no clock of its own — so every shape
 * below is testable without a filesystem, which is how the acceptance queries are scored.
 *
 * `livedMs` on a removal is the reason this function exists. `created` is on the record being
 * destroyed, so the subtraction is available exactly once: here, or never.
 *
 * @param {object|null} before  snapshot()
 * @param {object|null} after   snapshot()
 * @param {number} now          Date.now() (injected so tests are deterministic)
 * @param {object} [ctx]        extra fields stamped on every record (e.g. {cmd:'worktree rm'})
 */
function diff(before, after, now, ctx) {
  if (!before || !after) return [];
  const ts = new Date(now).toISOString();
  const out = [];
  const base = ctx || {};
  for (const s of SECTIONS) {
    const b = before[s.key] || {};
    const a = after[s.key] || {};
    for (const k of Object.keys(a)) {
      if (k in b) {
        if (!s.changed) continue;
        const ch = changedFields(b[k], a[k]);
        if (Object.keys(ch).length === 0) continue;
        out.push({ kind: s.changed, ts, ...base, name: k, repo: a[k].repo, changed: ch,
          ageMs: lifespan(a[k].created, now) });
      } else {
        out.push({ kind: s.created, ts, ...base, name: k, ...strip(a[k]) });
      }
    }
    for (const k of Object.keys(b)) {
      if (k in a) continue;
      out.push({ kind: s.removed, ts, ...base, name: k, ...strip(b[k]),
        livedMs: lifespan(b[k].created, now) });
    }
  }
  return out;
}

/** Record fields for a line, minus `created` (an ISO string the ts/livedMs pair already covers). */
function strip(rec) {
  const out = {};
  for (const k of Object.keys(rec)) {
    if (k === 'created' || rec[k] === undefined) continue;
    out[k] = rec[k];
  }
  return out;
}

// ─────────────────────────────────────────────────────────────── invocation

/**
 * Repo attribution for the invocation record. Set from a state diff when one is available (that
 * path knows the canonical MAIN repo root), otherwise guessed from cwd.
 */
let _repo = null;
function noteRepo(repo) {
  if (!_repo && repo) _repo = String(repo);
}

/**
 * The command each state record is attributed to. Set once by the CLI; absent when this module is
 * used as a library. Without it a `worktree.removed` line cannot say whether it came from
 * `worktree rm`, `ship` or `doctor --prune` — three very different facts that state cannot tell
 * apart afterwards, because the record is gone either way.
 */
let _cmd;

/**
 * Commands that are containers for a sub-command. For these the sub-command is the fact worth
 * having: `worktree new` and `worktree rm` are opposites, and recording both as "worktree" makes
 * the creation/teardown split — the whole lifespan story — unrecoverable from the file.
 *
 * The list is explicit rather than "take argv[1] when it isn't a flag", because for `claim 115`
 * argv[1] is an issue number and every claim would then be its own distinct command name.
 */
const SUBCOMMANDED = Object.freeze(['worktree', 'port', 'config']);

/** Derive the command label from argv. Exported for the test that pins the two cases apart. */
function cmdOf(argv) {
  const a = (argv || []).map(String);
  if (!a.length) return undefined;
  if (SUBCOMMANDED.includes(a[0]) && a[1] && !a[1].startsWith('-')) return `${a[0]} ${a[1]}`;
  return a[0];
}

function setCmd(argv) { _cmd = cmdOf(argv); }

/**
 * diff() with the clock and the per-process context supplied — the form state.mutate calls, and
 * the only one that reads a wall clock. Kept separate so diff() itself stays pure and testable.
 */
function recordDiff(before, after) {
  const recs = diff(before, after, Date.now(), _cmd ? { cmd: _cmd } : {});
  // A state record names the canonical MAIN repo root; the cwd guess used by invoked() does not
  // always. Prefer this one when the invocation touched state at all.
  for (const r of recs) if (r.repo) { noteRepo(r.repo); break; }
  return recs;
}

/**
 * Nearest repo root above `dir`, resolved with plain fs and NO subprocess.
 *
 * `git rev-parse` would be authoritative but costs a process spawn on every invocation, which is
 * precisely the kind of tax an optional feature must not levy. Walking up for `.git` is a few
 * stats. A LINKED WORKTREE's `.git` is a FILE (`gitdir: <main>/.git/worktrees/<n>`), so it is read
 * and followed — a worktree that reported itself as its own repo would split one repo's totals in
 * two, which is exactly the count the acceptance criteria ask for.
 */
function repoRootOf(dir) {
  try {
    let cur = path.resolve(dir);
    for (let i = 0; i < 64; i++) {
      const dot = path.join(cur, '.git');
      let stat;
      try { stat = fs.statSync(dot); } catch (_) { stat = null; }
      if (stat && stat.isDirectory()) return cur;
      if (stat && stat.isFile()) {
        const m = /gitdir:\s*(.+)/.exec(fs.readFileSync(dot, 'utf8'));
        if (!m) return cur;
        const gitdir = path.resolve(cur, m[1].trim());
        const marker = `${path.sep}.git${path.sep}worktrees${path.sep}`;
        const at = gitdir.indexOf(marker);
        return at === -1 ? cur : gitdir.slice(0, at);
      }
      const up = path.dirname(cur);
      if (up === cur) break;
      cur = up;
    }
  } catch (_) { /* fall through */ }
  return null;
}

/**
 * argv as recorded. One value is dropped: `config set <key> <value>`.
 *
 * The value can be a URL with a token in it (`notifyUrl`), and a local file that quietly accumulates
 * credentials is a worse problem than the one this feature solves. The KEY is kept, so "who changed
 * config and when" still answers; only the secret-shaped half goes.
 */
function safeArgv(argv) {
  const a = (argv || []).map(String);
  if (a[0] === 'config' && a[1] === 'set' && a.length > 3) return [...a.slice(0, 3), '<redacted>'];
  return a;
}

/**
 * One record per CLI invocation: what was run, how it ended, how long it took.
 *
 * `durationMs` is wall clock for the whole process as seen from main(), which is the number that
 * answers "where does time go" at the granularity v1 offers. Per-STEP timing inside ship is
 * deliberately not here: it is the only part of this feature that is not free, since it means
 * editing the ship path itself, and putting new code on the path that merges work is a poor trade
 * for a first version. Invocation totals plus lifespans answer every acceptance question without it.
 */
function invoked({ argv, exit, durationMs, cwd, error } = {}) {
  if (!on()) return 0;
  const a = safeArgv(argv);
  const rec = {
    kind: KIND.INVOKED,
    ts: new Date().toISOString(),
    cmd: cmdOf(a) || '(none)',
    argv: a,
    exit: Number.isInteger(exit) ? exit : 0,
    durationMs: Number.isFinite(durationMs) ? durationMs : undefined,
    repo: _repo || repoRootOf(cwd || process.cwd()) || undefined,
    cwd: cwd || process.cwd(),
    pid: process.pid,
  };
  if (error) rec.error = String(error).split('\n')[0].slice(0, 300);
  for (const k of Object.keys(rec)) if (rec[k] === undefined) delete rec[k];
  return append([rec]);
}

module.exports = {
  COLAB_DIR, JOURNAL_FILE, MAX_BYTES, KIND, SECTIONS,
  enabled, on, snapshot, diff, recordDiff, append, invoked, noteRepo, setCmd, cmdOf, repoRootOf, safeArgv,
  lifespan, changedFields, _resetForTests,
};
