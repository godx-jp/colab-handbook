'use strict';
/**
 * Machine-local state + config for colab.
 *
 *   ~/.colab/state.json   — the single source of truth for this machine (worktrees, claims, ports)
 *   ~/.colab/config.json  — configuration (repo roots to scan, extra reserved ports, TTL, port range)
 *   ~/.colab/state.lock   — mkdir-based lock (survives concurrent sessions; same technique as the
 *                           original shell scripts). Held only for the read-modify-write critical section.
 *
 * State is GLOBAL per machine: ports must be unique across ALL repos, not per-repo, so everything
 * lives in one file. Writes are atomic (temp file + rename).
 *
 * THIS SCHEMA HAS CONSUMERS OUTSIDE THIS REPO. At least one internal dashboard reads
 * ~/.colab/state.json directly to join worktrees and claims to the sessions that own them. So the
 * shape below is a published contract, not an implementation detail: adding a field is safe,
 * renaming or removing one is a breaking change for readers you cannot grep for. The authoritative
 * annotated version lives in tools/README.md ("~/.colab/state.json (version 1)") — keep the two in
 * step, and prefer to extend the prose there rather than here.
 *
 * State shape (version 1):
 * {
 *   version: 1,
 *   worktrees: {                         // the port-OWNING entity
 *     "<name>": { name, repo, branch, base, path, ports: [5230,...], host,
 *                 session, sessionName, status, created }
 *   },
 *   claims: {                            // many claims may reference one worktree (group of issues)
 *     "<repoAbs>#<n>": { issue:"#115", repo, worktree:<name>|null, branch, host,
 *                        session, sessionName, created }
 *   },
 *   ports: {                             // flat registry — one entry per allocated port
 *     "5230": { port:5230, owner:{type:"worktree"|"claim"|"manual", ref:"<name|key|label>"}, host, created }
 *   }
 * }
 *
 * Field notes for the two that carry weight beyond storage:
 *   base     the branch the worktree was cut from AND the one `colab ship` merges back into —
 *            trunk normally, a declared `integration:` line by request. Not derived at ship time.
 *   session  the ONLY join key to a live session; `sessionName` is display text and joins nothing.
 *            A name with no URL is a half-identity — the row reads as owned and links nowhere.
 *
 * `session`, `sessionName`, `status` and `base` are backward-compatible: entries written before
 * they existed simply lack them, and readers must tolerate that — no migration is performed.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// Optional local journal. Requires nothing back from this module (it resolves COLAB_DIR itself), so
// there is no require cycle; see the note on COLAB_DIR in lib/journal.js.
const journal = require('./journal');

const HOME = os.homedir();
const COLAB_DIR = process.env.COLAB_HOME || path.join(HOME, '.colab');
const STATE_FILE = path.join(COLAB_DIR, 'state.json');
const CONFIG_FILE = path.join(COLAB_DIR, 'config.json');
const LOCK_DIR = path.join(COLAB_DIR, 'state.lock');

const STATE_VERSION = 1;

const DEFAULT_CONFIG = {
  repos: [],              // absolute repo roots to scan for .github/project.yml `ports:`
  extraReserved: [],      // reserved ports for non-repo services (e.g. a preview server)
  reservedFiles: [],      // machine-local files of reserved ports (lenient: whitespace ints, # comments)
  claimTTLHours: 24,      // worktree-less claims older than this are flagged by `doctor`
  portRange: '5200-5999', // default search window for `port alloc` / `worktree new`
  // Optional observer endpoint. Unset (the default) = colab makes no network call of its own, ever.
  // Set it and state-changing commands POST one best-effort event each; see lib/notify.js for why
  // it is deliberately undependable. Absent rather than '' so `config show` does not advertise it.
  //
  // Optional LOCAL journal (`journal: true`). Unset = colab writes no journal file, ever. Set it and
  // every state transition and every invocation is appended to ~/.colab/journal.jsonl; see
  // lib/journal.js. Absent rather than false, for the same reason as notifyUrl. Unrelated to
  // notifyUrl: one is a local append-only file, the other a push to somebody else's receiver.
};

function ensureDir() {
  fs.mkdirSync(COLAB_DIR, { recursive: true });
}

function emptyState() {
  return { version: STATE_VERSION, worktrees: {}, claims: {}, ports: {} };
}

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch (e) {
    if (e.code === 'ENOENT') return { ...DEFAULT_CONFIG };
    throw new Error(`config.json is not valid JSON (${CONFIG_FILE}): ${e.message}`);
  }
}

function saveConfig(cfg) {
  ensureDir();
  atomicWrite(CONFIG_FILE, JSON.stringify(cfg, null, 2) + '\n');
}

function loadState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const st = JSON.parse(raw);
    return migrate(st);
  } catch (e) {
    if (e.code === 'ENOENT') return emptyState();
    throw new Error(`state.json is not valid JSON (${STATE_FILE}): ${e.message}`);
  }
}

function migrate(st) {
  if (!st || typeof st !== 'object') return emptyState();
  if (!st.version) st.version = STATE_VERSION;
  st.worktrees = st.worktrees || {};
  st.claims = st.claims || {};
  st.ports = st.ports || {};
  // Future migrations key off st.version here.
  return st;
}

function atomicWrite(file, content) {
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

function saveState(st) {
  ensureDir();
  st.version = STATE_VERSION;
  atomicWrite(STATE_FILE, JSON.stringify(st, null, 2) + '\n');
}

function sleep(ms) {
  // Busy-wait sleep; keeps the lock helper synchronous (no async plumbing through the CLI).
  const end = Date.now() + ms;
  while (Date.now() < end) { /* spin */ }
}

/** Acquire the mkdir lock, run fn, always release. Returns fn's result. */
function withLock(fn, { tries = 100, waitMs = 100 } = {}) {
  ensureDir();
  let acquired = false;
  for (let i = 0; i < tries; i++) {
    try {
      fs.mkdirSync(LOCK_DIR);
      acquired = true;
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      sleep(waitMs);
    }
  }
  if (!acquired) {
    throw new Error(`Lock stuck: ${LOCK_DIR} (remove it by hand if you are sure no session holds it)`);
  }
  try {
    return fn();
  } finally {
    try { fs.rmdirSync(LOCK_DIR); } catch (_) { /* already gone */ }
  }
}

/**
 * Load → mutate under lock → save, in one atomic critical section.
 *
 * Also the ONE place every fact enters or leaves state, which is why the optional journal
 * (lib/journal.js) hooks here and nowhere else: a before/after diff taken around `fn` captures all
 * 13 delete sites and every write, with no per-command plumbing and no chance of a caller
 * forgetting to report. It is off unless `journal: true` is configured, and when off `snapshot()`
 * returns null on its first line, so the disabled path costs one boolean and allocates nothing.
 *
 * Two properties the journal must never cost us, both structural rather than promised:
 *   - It cannot fail a mutation. Everything journal-related is inside try/catch, and the catch is
 *     empty on purpose — a full disk must not roll back a claim that succeeded.
 *   - It cannot hold the lock. Only the diff is computed inside the critical section; the append
 *     happens after withLock has returned, so a slow filesystem blocks no other session.
 */
function mutate(fn) {
  let records = null;
  const result = withLock(() => {
    const st = loadState();
    let before = null;
    try { before = journal.snapshot(st); } catch (_) { before = null; }
    const r = fn(st);
    saveState(st);
    if (before) {
      try { records = journal.recordDiff(before, journal.snapshot(st)); } catch (_) { records = null; }
    }
    return r;
  });
  if (records && records.length) {
    try { journal.append(records); } catch (_) { /* never at the expense of the mutation */ }
  }
  return result;
}

module.exports = {
  COLAB_DIR, STATE_FILE, CONFIG_FILE, LOCK_DIR, STATE_VERSION, DEFAULT_CONFIG,
  loadConfig, saveConfig, loadState, saveState, withLock, mutate, emptyState, atomicWrite,
};
