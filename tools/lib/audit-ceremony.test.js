'use strict';
/**
 * Tests for the audit's `ceremony:` validation (audit/audit.mjs) — issue #79.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * `ceremony` scales memory/record-keeping DEPTH (evidence comments, readiness labeling,
 * severity of memory-ceremony gaps) — never the safety rails every repo shares regardless
 * of this field (claim discipline, worktree isolation, reserved ports, squash + Closes #N,
 * CI secret scan + build). Three things are pinned here: omission behaves exactly like
 * `standard` (no existing repo's behaviour changes because the field now exists), an unknown
 * value is a finding, and the two coherence rules that keep `light` from drifting onto a repo
 * where the relaxation is no longer safe — a live repo (rule 1) or an unattended-merge repo
 * (rule 2) cannot opt out of its own audit trail.
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

function fixture(projectYml) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-ceremony-'));
  TMP.push(dir);
  const g = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q', '-b', 'main', '.');
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'audit test');
  g('config', 'core.hooksPath', path.join(dir, '.nohooks'));
  fs.mkdirSync(path.join(dir, '.github'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.github', 'project.yml'), projectYml);
  g('add', '-A');
  g('commit', '-q', '-m', 'chore: fixture');
  return dir;
}

// --- fixtures for the stamp-drift severity downgrade (ceremony §schema item 3) --------
//
// A fake "handbook" checkout with two tagged versions of a CI template AND a non-CI one
// (the CLAUDE conventions block), plus a target repo stamped at the OLD tag for both. This
// is the one item of the three the ceremony schema section names ("stamp drift on non-CI
// templates") that maps onto a real, already-`fail`-producing audit mechanism — the other
// two (an empty readiness column, a missing evidence comment) are process steps `code-triage`
// / `code-ship` own, not something `audit/audit.mjs` scans mechanically.

function fakeHandbook() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-ceremony-hb-'));
  TMP.push(dir);
  const g = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q', '-b', 'main', '.');
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'audit test');
  fs.mkdirSync(path.join(dir, 'templates'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'templates', 'ci-node.yml'), 'name: ci-node v1\n');
  fs.writeFileSync(path.join(dir, 'templates', 'repo-CLAUDE-block.md'), 'block v1\n');
  g('add', '-A');
  g('commit', '-q', '-m', 'chore: v1');
  g('tag', 'v1.0.0');
  fs.writeFileSync(path.join(dir, 'templates', 'ci-node.yml'), 'name: ci-node v2 CHANGED\n');
  fs.writeFileSync(path.join(dir, 'templates', 'repo-CLAUDE-block.md'), 'block v2 CHANGED\n');
  g('add', '-A');
  g('commit', '-q', '-m', 'chore: v2');
  g('tag', 'v2.0.0');
  return dir;
}

function fixtureStampedAtV1(ceremonyLine) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-ceremony-target-'));
  TMP.push(dir);
  const g = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q', '-b', 'main', '.');
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'audit test');
  g('config', 'core.hooksPath', path.join(dir, '.nohooks'));
  fs.mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.github', 'project.yml'),
    `tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\n${ceremonyLine}`,
  );
  fs.writeFileSync(path.join(dir, '.github', 'workflows', 'ci.yml'), '# colab-handbook: ci-node @ v1.0.0\nname: CI\n');
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# hi\n<!-- colab-handbook @ v1.0.0 -->\n');
  g('add', '-A');
  g('commit', '-q', '-m', 'chore: fixture');
  return dir;
}

function auditWithHandbook(hbDir, targetDir) {
  let stdout;
  try {
    stdout = execFileSync('node', [AUDIT, '--json', '--local', targetDir], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, COLAB_HANDBOOK: hbDir },
    });
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

// --- omission and the plain value are both quiet ----------------------------

test('a Tier B repo with no ceremony key at all is unaffected — omission = standard', () => {
  const yml = `tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\n`;
  const r = audit(fixture(yml));
  assert.ok(!hasText(r.fails, /ceremony/), r.fails.join(' | '));
  assert.ok(!hasText(r.warns, /ceremony/), r.warns.join(' | '));
});

test('ceremony: standard on a Tier B repo is clean', () => {
  const yml = `tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nceremony: standard\n`;
  const r = audit(fixture(yml));
  assert.ok(!hasText(r.fails, /ceremony/), r.fails.join(' | '));
});

test('ceremony: light on a Tier B repo with no production and no auto-trunk is clean', () => {
  const yml = `tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nceremony: light\n`;
  const r = audit(fixture(yml));
  assert.ok(!hasText(r.fails, /ceremony/), r.fails.join(' | '));
});

// --- unknown value -----------------------------------------------------------

test('an unrecognised ceremony value is a finding, not a silent pass', () => {
  const yml = `tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nceremony: heavy\n`;
  const r = audit(fixture(yml));
  assert.ok(hasText(r.fails, /ceremony is "heavy".*expected "standard" or "light"/), r.fails.join(' | '));
});

// --- coherence rule 1: light + a live production is a finding --------------

test('ceremony: light + a real production URL is a finding — a live repo cannot skip its own audit trail', () => {
  const yml = `tier: C\ntrunk: dev\nproduction: https://example.invalid\ndeploy: push-main\nstack: node\nceremony: light\n`;
  const r = audit(fixture(yml));
  assert.ok(hasText(r.fails, /ceremony: light requires production: null/), r.fails.join(' | '));
});

// --- coherence rule 2: light + auto-trunk is a finding ----------------------

test('ceremony: light + autonomy: auto-trunk is a finding — unattended merge with no evidence trail', () => {
  const yml = `tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nceremony: light\nautonomy: auto-trunk\n`;
  const r = audit(fixture(yml));
  assert.ok(hasText(r.fails, /ceremony: light is incompatible with autonomy: auto-trunk/), r.fails.join(' | '));
});

// --- standard ceremony is never gated by either coherence rule --------------

test('ceremony: standard is compatible with auto-trunk and a live production — the rules are light-only', () => {
  const yml = `tier: C\ntrunk: dev\nproduction: https://example.invalid\ndeploy: push-main\nstack: node\nceremony: standard\nautonomy: auto-trunk\n`;
  const r = audit(fixture(yml));
  assert.ok(!hasText(r.fails, /ceremony/), r.fails.join(' | '));
});

test('a Tier B repo with autonomy: auto-trunk and no ceremony key is unaffected — omission never triggers the light-only rules', () => {
  const yml = `tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nautonomy: auto-trunk\n`;
  const r = audit(fixture(yml));
  assert.ok(!hasText(r.fails, /ceremony/), r.fails.join(' | '));
});

// --- item 3: stamp-drift severity downgrade, non-CI templates only ---------

test('ceremony: standard — stamp drift on BOTH a CI workflow and the CLAUDE block is a fail', () => {
  const hb = fakeHandbook();
  const r = auditWithHandbook(hb, fixtureStampedAtV1(''));
  assert.ok(hasText(r.fails, /ci\.yml copied @ v1\.0\.0 — template changed since/), r.fails.join(' | '));
  assert.ok(hasText(r.fails, /CLAUDE block copied @ v1\.0\.0 — template changed since/), r.fails.join(' | '));
});

test('ceremony: light — CI workflow drift STAYS a fail; CLAUDE-block (non-CI) drift downgrades to a warn', () => {
  const hb = fakeHandbook();
  const r = auditWithHandbook(hb, fixtureStampedAtV1('ceremony: light\n'));
  assert.ok(hasText(r.fails, /ci\.yml copied @ v1\.0\.0 — template changed since/), `CI drift must stay a fail even under light: ${r.fails.join(' | ')}`);
  assert.ok(!hasText(r.fails, /CLAUDE block copied/), `CLAUDE-block drift must NOT be a fail under light: ${r.fails.join(' | ')}`);
  assert.ok(hasText(r.warns, /CLAUDE block copied @ v1\.0\.0 — template changed since.*ceremony: light/), r.warns.join(' | '));
});
