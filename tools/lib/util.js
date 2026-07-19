'use strict';
const os = require('os');
const path = require('path');

const HOST = os.hostname();

function normIssueNum(x) {
  const n = parseInt(String(x).replace(/^#/, ''), 10);
  if (!Number.isInteger(n) || n <= 0) throw new UserError(`Bad issue "${x}" (expected a number like 115 or #115)`);
  return n;
}
function issueTag(n) { return `#${n}`; }
function claimKey(repoAbs, num) { return `${repoAbs}#${num}`; }

/** A user-facing error → printed without a stack trace, exit 1. */
class UserError extends Error {}

function today() { return new Date().toISOString().slice(0, 10); }
function nowISO() { return new Date().toISOString(); }

function hoursSince(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return Infinity;
  return (Date.now() - t) / 3_600_000;
}

/**
 * Tiny arg parser.
 *   spec.flags   : { '--json': 'json', '--force': 'force' }   boolean flags
 *   spec.values  : { '--repo': 'repo', '--count': 'count' }   flags that take a value
 *   spec.aliases : { '--issue': '--issues' }                  map an alias to its canonical flag
 * Positionals collected into result._ .
 */
function parseArgs(argv, spec = {}) {
  const flags = spec.flags || {};
  const values = spec.values || {};
  const aliases = spec.aliases || {};
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i];
    if (aliases[a]) a = aliases[a];
    // support --key=value
    let inlineVal = null;
    const eq = a.indexOf('=');
    if (a.startsWith('--') && eq !== -1) { inlineVal = a.slice(eq + 1); a = a.slice(0, eq); }
    if (flags[a]) { out[flags[a]] = true; }
    else if (values[a]) {
      const v = inlineVal !== null ? inlineVal : argv[++i];
      if (v === undefined) throw new UserError(`Option ${a} needs a value`);
      out[values[a]] = v;
    } else if (a.startsWith('-') && a !== '-') {
      throw new UserError(`Unknown option: ${a}`);
    } else {
      out._.push(a);
    }
  }
  return out;
}

// ---- pretty printing ----
function table(rows, headers) {
  const cols = headers.length;
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => String(r[i] ?? '').length)));
  const fmt = (r) => r.map((c, i) => String(c ?? '').padEnd(widths[i])).join('  ');
  const out = [fmt(headers), fmt(widths.map((w) => '-'.repeat(w)))];
  for (const r of rows) out.push(fmt(r));
  return out.join('\n');
}

function shortRepo(repoAbs) { return path.basename(repoAbs); }

module.exports = {
  HOST, UserError, normIssueNum, issueTag, claimKey, today, nowISO, hoursSince,
  parseArgs, table, shortRepo,
};
