'use strict';
/**
 * Port helpers: reserved-set aggregation, liveness check, allocation.
 *
 * DESIGN: reserved ports (a project's trunk dev server) are NOT kept in one hand-maintained central
 * file any more. Each repo declares its own in `.github/project.yml` as `ports: [5220]`. `colab`
 * aggregates the reserved set across every repo it knows about (config.repos) plus the current repo,
 * plus config.extraReserved for non-repo services. A reserved port is NEVER handed to a worktree,
 * even when that trunk server is currently down.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const yaml = require('./yaml');

/** Expand a leading ~ (or ~/) to the home directory. Leaves other paths untouched. */
function expandHome(p) {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

/** Read `ports:` from a repo's .github/project.yml. Returns [] if absent/unparseable. */
function repoReservedPorts(repoRoot) {
  const file = path.join(repoRoot, '.github', 'project.yml');
  let text;
  try { text = fs.readFileSync(file, 'utf8'); }
  catch (_) { return []; }
  let doc;
  try { doc = yaml.parse(text); }
  catch (_) { return []; }
  const p = doc && doc.ports;
  if (Array.isArray(p)) return p.map(Number).filter((n) => Number.isInteger(n));
  if (Number.isInteger(p)) return [p];
  return [];
}

/**
 * Read `worktreePorts: [lo, hi]` from a repo's .github/project.yml — the window worktrees of THIS
 * repo allocate from. Returns [lo, hi] or null (absent / malformed / hi < lo). Distinct from
 * `ports:` (reserved trunk ports).
 */
function repoWorktreePorts(repoRoot) {
  const file = path.join(repoRoot, '.github', 'project.yml');
  let text;
  try { text = fs.readFileSync(file, 'utf8'); }
  catch (_) { return null; }
  let doc;
  try { doc = yaml.parse(text); }
  catch (_) { return null; }
  const w = doc && doc.worktreePorts;
  if (Array.isArray(w) && w.length === 2) {
    const lo = Number(w[0]), hi = Number(w[1]);
    if (Number.isInteger(lo) && Number.isInteger(hi) && hi >= lo) return [lo, hi];
  }
  return null;
}

/**
 * Parse a lenient reserved-ports file: whitespace-separated port numbers per line, `#` starts a
 * comment, any non-numeric token is ignored. A missing/unreadable file yields []. This is the
 * pre-handbook `~/code/.claude/ports.reserved` shape — machine-local, referenced via
 * config.reservedFiles, so the handbook itself stays generic.
 */
function parseReservedFile(filePath) {
  let text;
  try { text = fs.readFileSync(expandHome(filePath), 'utf8'); }
  catch (_) { return []; }
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    for (const tok of line.replace(/#.*$/, '').split(/\s+/)) {
      if (/^\d+$/.test(tok)) out.push(parseInt(tok, 10));
    }
  }
  return out;
}

/**
 * Aggregate the reserved set across all known repos + extras.
 * Returns a Map port -> source label (for good error messages).
 */
function reservedSet(config, extraRepos = []) {
  const map = new Map();
  const roots = new Set([...(config.repos || []), ...extraRepos].filter(Boolean));
  for (const root of roots) {
    for (const port of repoReservedPorts(root)) {
      if (!map.has(port)) map.set(port, path.basename(root));
    }
  }
  for (const port of config.extraReserved || []) {
    if (!map.has(Number(port))) map.set(Number(port), 'config.extraReserved');
  }
  // Machine-local reserved-port files (e.g. a pre-handbook ~/code/.claude/ports.reserved) —
  // ports of repos NOT registered with colab, aggregated so they can't be handed to a worktree.
  for (const f of config.reservedFiles || []) {
    for (const port of parseReservedFile(f)) {
      if (!map.has(port)) map.set(port, `file:${path.basename(expandHome(f))}`);
    }
  }
  return map;
}

/**
 * Exact-pin availability check for `--at`. Returns the list of conflicts [{port, reason}] — a port
 * is refused when it is reserved or already allocated in state (same refusal semantics as reserved
 * ports). Listening is NOT a hard block here: the caller asked for these exact ports on purpose.
 */
function checkExact(portList, state, reserved) {
  const allocated = allocatedSet(state);
  const conflicts = [];
  for (const p of portList) {
    if (reserved.has(p)) conflicts.push({ port: p, reason: `reserved (${reserved.get(p)})` });
    else if (allocated.has(p)) conflicts.push({ port: p, reason: 'already allocated in state' });
  }
  return conflicts;
}

/** True if a TCP port is currently being LISTENed on (uses lsof; falls back to "not listening"). */
function isListening(port) {
  const r = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
  if (r.error) return false; // lsof missing → can't tell, assume free (state/reserved still guard)
  return r.status === 0 && !!(r.stdout || '').trim();
}

/** Ports currently recorded as allocated in state. */
function allocatedSet(state) {
  return new Set(Object.keys(state.ports || {}).map(Number));
}

/**
 * A port is available iff: not reserved, not already allocated in state, not currently LISTENing.
 * `reserved` is a Set/Map of reserved ports.
 */
function isAvailable(port, state, reserved) {
  if (reserved.has ? reserved.has(port) : false) return false;
  if (allocatedSet(state).has(port)) return false;
  if (isListening(port)) return false;
  return true;
}

function parseRange(rangeStr) {
  const m = String(rangeStr).match(/^(\d+)\s*-\s*(\d+)$/);
  if (!m) throw new Error(`Bad --range "${rangeStr}" (expected A-B, e.g. 5200-5999)`);
  const lo = parseInt(m[1], 10), hi = parseInt(m[2], 10);
  if (hi < lo) throw new Error(`Bad --range "${rangeStr}" (A must be <= B)`);
  return [lo, hi];
}

/** Find `count` consecutive available ports within [lo,hi]. Returns array or null. */
function findConsecutive(count, rangeStr, state, reserved) {
  const [lo, hi] = parseRange(rangeStr);
  for (let p = lo; p <= hi - count + 1; p++) {
    let ok = true;
    for (let i = 0; i < count; i++) {
      if (!isAvailable(p + i, state, reserved)) { ok = false; break; }
    }
    if (ok) return Array.from({ length: count }, (_, i) => p + i);
  }
  return null;
}

module.exports = {
  repoReservedPorts, repoWorktreePorts, parseReservedFile, expandHome,
  reservedSet, isListening, isAvailable, parseRange, findConsecutive, allocatedSet, checkExact,
};
