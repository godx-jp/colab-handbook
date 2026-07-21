'use strict';
/**
 * Finding the processes a directory owns, and the ports they hold.
 *
 * Worktree teardown used to treat port release as pure bookkeeping: it deleted the registry entry
 * and never asked whether anything was still bound. A dev server started from inside a worktree
 * therefore survived `worktree rm`, kept listening, and kept serving out of a checkout that no
 * longer existed — so what it returned was a stale or broken app on a URL that still looked
 * legitimate. Every obvious diagnostic passes in that state: the build is fine, the registry says
 * the port is free, and `git worktree list` shows nothing.
 *
 * OWNERSHIP IS DECIDED BY cwd, NEVER BY PORT. "Kill whatever is listening on the port I am about
 * to free" is unsafe in precisely the case that matters: if the registry is stale, that kills an
 * unrelated process legitimately holding the port. A process whose cwd is inside the directory
 * being removed is positive proof the directory owns it. Ports cannot prove ownership; cwd can.
 *
 * No dependencies. Everything degrades to "found nothing" when lsof is missing or unusable, so a
 * machine without it loses the check but never breaks teardown.
 */

const path = require('path');
const { run } = require('./git');

/** True when `child` is `dir` itself or lives underneath it. */
function isInside(dir, child) {
  if (!dir || !child) return false;
  const d = path.resolve(dir);
  const c = path.resolve(child);
  return c === d || c.startsWith(d + path.sep);
}

/**
 * Parse `lsof -a -d cwd -F pn` output into [{pid, cwd}] for processes whose cwd is inside `dir`.
 *
 * lsof's field format is a stream of prefixed lines, NOT one record per line: a `p<pid>` line
 * applies to every following field line until the next `p`. Split on lines and you get pids with
 * no paths. Exported separately from the lsof call so the parsing is testable without spawning
 * anything or depending on what happens to be running on the machine.
 */
function parseLsofCwd(stdout, dir) {
  const out = [];
  let pid = null;
  for (const line of String(stdout || '').split('\n')) {
    if (!line) continue;
    const tag = line[0];
    const val = line.slice(1).trim();
    if (tag === 'p') pid = val;
    else if (tag === 'n' && pid && isInside(dir, val)) out.push({ pid, cwd: val });
  }
  return out;
}

/** TCP ports a pid is LISTENING on (numbers, deduped). */
function listeningPorts(pid) {
  const r = run('lsof', ['-p', String(pid), '-a', '-iTCP', '-sTCP:LISTEN', '-P', '-F', 'n']);
  if (!r.ok) return [];
  const set = new Set();
  for (const line of r.stdout.split('\n')) {
    if (line[0] !== 'n') continue;
    const m = line.slice(1).trim().match(/:(\d+)$/);
    if (m) set.add(Number(m[1]));
  }
  return [...set].sort((a, b) => a - b);
}

/** A pid's cwd, or '' when lsof cannot say. A cwd that no longer exists is the orphan's signature. */
function cwdOf(pid) {
  const r = run('lsof', ['-p', String(pid), '-a', '-d', 'cwd', '-F', 'n']);
  if (!r.stdout) return '';
  for (const line of r.stdout.split('\n')) if (line[0] === 'n') return line.slice(1).trim();
  return '';
}

/** Best-effort command line for a pid, trimmed for display. */
function commandOf(pid) {
  const r = run('ps', ['-p', String(pid), '-o', 'command=']);
  if (!r.ok || !r.stdout) return '(unknown)';
  const cmd = r.stdout.split('\n')[0].trim();
  return cmd.length > 70 ? cmd.slice(0, 69) + '…' : cmd;
}

/**
 * Processes whose cwd is inside `dir`, enriched with command and listening ports.
 * Returns [] on any platform or environment where lsof cannot answer — never throws.
 */
function processesInDir(dir) {
  if (!dir || process.platform === 'win32') return [];
  const r = run('lsof', ['-a', '-d', 'cwd', '-F', 'pn']);
  // lsof exits non-zero when *some* descriptors are unreadable, which is normal for an
  // unprivileged sweep — so trust the output whenever there is any, not the exit code.
  if (!r.stdout) return [];
  const self = String(process.pid);
  return parseLsofCwd(r.stdout, dir)
    .filter((p) => p.pid !== self)
    .map((p) => ({ ...p, ports: listeningPorts(p.pid), command: commandOf(p.pid) }));
}

/**
 * Every TCP listener on the machine as [{pid, port}], from ONE lsof call.
 *
 * Deliberately not per-port: the allocation window is ~800 ports wide, and probing each one
 * separately turns a diagnostic into a minute of spawning. Same field-format parsing rule as
 * `parseLsofCwd` — `p<pid>` applies until the next `p`.
 */
function listeners() {
  const r = run('lsof', ['-iTCP', '-sTCP:LISTEN', '-P', '-F', 'pn']);
  if (!r.stdout) return [];
  const out = [];
  let pid = null;
  for (const line of r.stdout.split('\n')) {
    if (!line) continue;
    if (line[0] === 'p') pid = line.slice(1).trim();
    else if (line[0] === 'n' && pid) {
      const m = line.slice(1).trim().match(/:(\d+)$/);
      if (m) out.push({ pid, port: Number(m[1]) });
    }
  }
  return out;
}

/** Is anything LISTENING on this TCP port right now? Used to verify a port really got freed. */
function portIsBound(port) {
  const r = run('lsof', ['-iTCP:' + port, '-sTCP:LISTEN', '-P', '-F', 'p']);
  return !!(r.stdout && /^p\d+/m.test(r.stdout));
}

/**
 * Terminate a pid politely, then forcibly. Returns true if it is gone afterwards.
 * SIGTERM first so a dev server can close its listeners; SIGKILL only for what ignores it.
 */
function terminate(pid, waitMs = 2000) {
  const alive = () => { try { process.kill(Number(pid), 0); return true; } catch (_) { return false; } };
  try { process.kill(Number(pid), 'SIGTERM'); } catch (_) { return true; } // already gone
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    if (!alive()) return true;
    // Busy-wait in 50ms slices: this runs at most a couple of seconds during teardown, and a
    // sync sleep keeps the whole command synchronous like the rest of the CLI.
    run('sleep', ['0.05']);
  }
  try { process.kill(Number(pid), 'SIGKILL'); } catch (_) { /* raced to exit */ }
  return !alive();
}

module.exports = { isInside, parseLsofCwd, listeningPorts, commandOf, cwdOf, processesInDir, listeners, portIsBound, terminate };
