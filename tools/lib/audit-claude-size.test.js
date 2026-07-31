'use strict';
/**
 * Tests for the audit's CLAUDE.md size checks (audit/audit.mjs) — issue #64.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * code-wrap's A2 rule ("CLAUDE.md is a router, not an archive") was prose-only, and its
 * own worst-case citation is framed in LINES. That framing missed the failure that
 * actually occurred in the wild: a repo audited clean at 197 lines carried 112,382 bytes
 * because a single "pointer" line had grown into a full paraphrase of the doc it was
 * meant to point at (68,350 bytes, 60.8% of the file). These tests pin two independent
 * checks — a whole-file byte ceiling, and a per-line ceiling relative to the file's own
 * median line — and confirm both fire as WARN (advisory), never FAIL: the thresholds are
 * explicitly a starting point for calibration, not a settled gate.
 *
 * The fixtures are real git repos with a real CLAUDE.md on disk: byte length and physical
 * line length are exactly the two things a mock cannot stand in for.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const AUDIT = path.join(REPO_ROOT, 'audit', 'audit.mjs');

const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

/**
 * A tier B repo on `main`, with the given CLAUDE.md content. Deliberately minimal
 * project.yml so every other audit rule stays silent and a finding in the result is
 * unambiguously the one under test.
 */
function fixture(claudeMd) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-claude-size-'));
  TMP.push(dir);
  const g = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q', '-b', 'main', '.');
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'audit test');
  fs.mkdirSync(path.join(dir, '.github'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.github', 'project.yml'),
    'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\n',
  );
  if (claudeMd !== null) fs.writeFileSync(path.join(dir, 'CLAUDE.md'), claudeMd);
  g('add', '-A');
  g('commit', '-q', '-m', 'chore: fixture');
  return dir;
}

function audit(dir) {
  let stdout;
  try {
    stdout = execFileSync('node', [AUDIT, '--json', '--local', dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (err) {
    stdout = err.stdout || '';
  }
  const r = JSON.parse(stdout).results[0];
  return {
    ok: r.ok,
    fails: r.findings.filter((f) => f.level === 'fail').map((f) => f.text),
    warns: r.findings.filter((f) => f.level === 'warn').map((f) => f.text),
  };
}

const hasText = (list, rx) => list.some((t) => rx.test(t));

// --- no CLAUDE.md at all: not this check's business -------------------------

test('a repo with no CLAUDE.md gets no size finding', () => {
  const r = audit(fixture(null));
  assert.ok(!hasText(r.fails.concat(r.warns), /CLAUDE\.md/), r.fails.concat(r.warns).join(' | '));
});

// --- the whole-file byte ceiling ---------------------------------------------

test('a small, ordinary CLAUDE.md is clean', () => {
  const body = '# CLAUDE.md\n\nSome router text.\n\n| doc | what |\n|---|---|\n| docs/a.md | thing a |\n| docs/b.md | thing b |\n';
  const r = audit(fixture(body));
  assert.deepStrictEqual(r.fails, []);
  assert.ok(!hasText(r.warns, /CLAUDE\.md is \d+ bytes/), r.warns.join(' | '));
});

test('a CLAUDE.md over the byte ceiling warns, even with modest line lengths', () => {
  // Many short-ish lines, none individually huge, but the FILE clears 40 KB.
  const line = '- `docs/topic.md` — a router line describing where the depth actually lives.\n';
  const body = '# CLAUDE.md\n\n' + line.repeat(700); // ~700 * 79 bytes ≈ 55 KB
  const r = audit(fixture(body));
  assert.ok(hasText(r.warns, /CLAUDE\.md is \d+ bytes.*advisory ceiling \(#64\)/), r.warns.join(' | '));
  assert.ok(r.ok, `byte ceiling must stay advisory (warn), got fails: ${r.fails.join(' | ')}`);
});

test('the byte-ceiling finding names #64 and code-wrap A2', () => {
  const body = 'x'.repeat(CLAUDE_MD_TOO_BIG_BYTES());
  const r = audit(fixture(body));
  assert.ok(hasText(r.warns, /pointer, not a copy/), r.warns.join(' | '));
});

function CLAUDE_MD_TOO_BIG_BYTES() {
  return 41 * 1024; // just over the 40 KB advisory ceiling
}

// --- the per-line ceiling: the actual "pointer became a copy" signature -----

test('one monster line — large relative to the median AND past the absolute floor — warns', () => {
  const short = '- `docs/topic-a.md` — short pointer line.\n';
  // One line far past both the multiple (>6x median) and the absolute floor (>2048 bytes).
  const monster = '| docs/gotchas.md | ' + 'lorem ipsum reproduced inline '.repeat(120) + ' |\n';
  const body = '# CLAUDE.md\n\n' + short.repeat(20) + monster;
  const r = audit(fixture(body));
  assert.ok(hasText(r.warns, /single line of \d+ bytes.*median line/), r.warns.join(' | '));
  assert.ok(hasText(r.warns, /pointer became a copy/), r.warns.join(' | '));
  assert.ok(r.ok, `line ceiling must stay advisory (warn), got fails: ${r.fails.join(' | ')}`);
});

test('a long line that stays under the absolute floor does not warn, even at a big multiple', () => {
  // median ~10 bytes, one line at ~500 bytes is 50x the median but well under the 2048 floor.
  const short = 'ab\n';
  const longish = 'c'.repeat(500) + '\n';
  const body = short.repeat(20) + longish;
  const r = audit(fixture(body));
  assert.ok(!hasText(r.warns, /pointer became a copy/), r.warns.join(' | '));
});

test('a uniformly long file (every line similarly sized) does not trip the line check', () => {
  // All lines close to the same length -> no line clears 6x the median, however big the file gets.
  const line = 'x'.repeat(300) + '\n';
  const body = line.repeat(150); // ~45 KB total, clears the byte ceiling, no single outlier line
  const r = audit(fixture(body));
  assert.ok(!hasText(r.warns, /pointer became a copy/), r.warns.join(' | '));
  // The byte ceiling is independent and legitimately still fires here.
  assert.ok(hasText(r.warns, /CLAUDE\.md is \d+ bytes/), r.warns.join(' | '));
});

test('both findings can fire together and neither is ever a fail', () => {
  const short = '- pointer\n';
  const monster = 'y'.repeat(5000) + '\n';
  const body = short.repeat(20) + monster.repeat(10); // over both ceilings
  const r = audit(fixture(body));
  assert.ok(hasText(r.warns, /CLAUDE\.md is \d+ bytes/), r.warns.join(' | '));
  assert.ok(hasText(r.warns, /pointer became a copy/), r.warns.join(' | '));
  assert.deepStrictEqual(r.fails, []);
  assert.ok(r.ok);
});
