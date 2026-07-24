'use strict';
/**
 * Tests for Tier A's tag-gated shape (audit/audit.mjs) — issue #51.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * A legitimate Tier A does not have to follow the canonical dev/main split. When a version TAG
 * gates production, the tag itself marks the release boundary, so a repo may run a single trunk
 * `main`; and when the deploy runs OUTSIDE CI (a GitOps poller fast-forwards a release branch on
 * the tag), there is no in-repo deploy-*.yml by design. Two audit checks used to hard-code the
 * canonical shape and misfired on this one. These tests pin the relaxation AND its scope: `main`
 * is accepted ONLY for `deploy: tag`, and the "path to production must be committed" invariant is
 * preserved — an external tag deploy still owes a `runbook:`.
 *
 * Fixtures are real git repos (the "declared trunk exists" and "checkout on trunk" checks cannot
 * be tested against a mock), kept minimal so any finding is unambiguously the one under test.
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
 * A repo initialised on `main`, plus any extra branches, plus the given project.yml and files.
 * `checkout` leaves the working tree parked on that branch — needed for trunk-`dev` fixtures, or
 * the "main checkout is on trunk at rest" check fires on the fixture rather than the code.
 */
function fixture(projectYml, extraBranches = [], files = {}, checkout = null) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-tier-a-tag-'));
  TMP.push(dir);
  const g = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q', '-b', 'main', '.');
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'audit test');
  g('config', 'core.hooksPath', path.join(dir, '.nohooks'));
  fs.mkdirSync(path.join(dir, '.github'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.github', 'project.yml'), projectYml);
  for (const [f, body] of Object.entries(files)) {
    fs.mkdirSync(path.join(dir, path.dirname(f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), body);
  }
  g('add', '-A');
  g('commit', '-q', '-m', 'chore: fixture');
  for (const b of extraBranches) g('branch', b);
  if (checkout) g('checkout', '-q', checkout);
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
const PROD = 'https://example.invalid';
const RUNBOOK = { 'docs/deploy.md': '# deploy\nthe poller fast-forwards `release` on the tag.\n' };
const DEPLOY_WF = { '.github/workflows/deploy-x.yml': 'on:\n  push:\n    tags: ["v*"]\njobs: {}\n' };

// --- the two shapes #51 is about: single trunk `main`, tag-gated ------------

test('tag-gated single trunk `main` with a runbook (external deploy) is clean', () => {
  const yml = `tier: A\ntrunk: main\nproduction: ${PROD}\ndeploy: tag\nstack: node\nrunbook: docs/deploy.md\n`;
  const r = audit(fixture(yml, [], RUNBOOK));
  assert.ok(!hasText(r.fails, /requires trunk "dev"/), `dev-trunk misfire: ${r.fails.join(' | ')}`);
  assert.ok(!hasText(r.fails, /no \.github\/workflows\/deploy/), `deploy-workflow misfire: ${r.fails.join(' | ')}`);
  assert.ok(r.ok, `expected clean, got: ${r.fails.join(' | ')}`);
});

test('tag-gated single trunk `main` with an in-repo deploy workflow needs no runbook', () => {
  const yml = `tier: A\ntrunk: main\nproduction: ${PROD}\ndeploy: tag\nstack: node\n`;
  const r = audit(fixture(yml, [], DEPLOY_WF));
  assert.ok(!hasText(r.fails, /requires runbook/), `runbook wrongly demanded: ${r.fails.join(' | ')}`);
  assert.ok(r.ok, `expected clean, got: ${r.fails.join(' | ')}`);
});

// --- the invariant is preserved: an out-of-CI deploy still owes a runbook ---

test('tag-gated `main` with no workflow AND no runbook fails for the runbook, not the workflow', () => {
  const yml = `tier: A\ntrunk: main\nproduction: ${PROD}\ndeploy: tag\nstack: node\n`;
  const r = audit(fixture(yml));
  assert.ok(hasText(r.fails, /deploy: tag deployed outside CI.*requires runbook/), r.fails.join(' | '));
  // The old blanket "no deploy-*.yml" finding must NOT also fire — the runbook is the honest ask.
  assert.ok(!hasText(r.fails, /no \.github\/workflows\/deploy/), `both findings fired: ${r.fails.join(' | ')}`);
});

// --- scope: `main` is a Tier A trunk ONLY when a tag gates production -------

test('tier A + deploy: manual on trunk `main` is still a finding — only tag-gating earns single-trunk main', () => {
  const yml = `tier: A\ntrunk: main\nproduction: ${PROD}\ndeploy: manual\nstack: node\nrunbook: docs/deploy.md\n`;
  const r = audit(fixture(yml, [], RUNBOOK));
  assert.ok(hasText(r.fails, /requires trunk "dev"/), r.fails.join(' | '));
  assert.ok(hasText(r.fails, /only a tag-gated A/), r.fails.join(' | '));
});

test('tier A + deploy: push-main on trunk `main` does not sneak in via the tag relaxation', () => {
  const yml = `tier: A\ntrunk: main\nproduction: ${PROD}\ndeploy: push-main\nstack: node\n`;
  const r = audit(fixture(yml));
  assert.ok(hasText(r.fails, /requires trunk "dev"/), r.fails.join(' | '));
});

// --- the canonical dev/main split is untouched -----------------------------

test('canonical Tier A (trunk dev, deploy tag, in-repo deploy workflow) stays clean', () => {
  const yml = `tier: A\ntrunk: dev\nproduction: ${PROD}\ndeploy: tag\nstack: node\n`;
  const r = audit(fixture(yml, ['dev'], DEPLOY_WF, 'dev'));
  assert.ok(r.ok, `canonical A regressed: ${r.fails.join(' | ')}`);
});

test('Tier A tag-gated on trunk dev with an external deploy asks for the runbook exactly as main does', () => {
  const yml = `tier: A\ntrunk: dev\nproduction: ${PROD}\ndeploy: tag\nstack: node\n`;
  const r = audit(fixture(yml, ['dev'], {}, 'dev'));
  assert.ok(hasText(r.fails, /deploy: tag deployed outside CI.*requires runbook/), r.fails.join(' | '));
  assert.ok(!hasText(r.fails, /requires trunk "dev"/), `dev must be fine: ${r.fails.join(' | ')}`);
});
