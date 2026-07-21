'use strict';
/**
 * Tests for the audit's `integration:` validation (audit/audit.mjs).
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * The field's whole guarantee is that a declared line stays on the DEVELOPMENT side of the fence,
 * so the rules that keep it there (never trunk, never `main`, must exist) are the ones worth
 * gating. They are also the rules a future edit is most likely to relax by accident, since the
 * tempting simplification — "just let a repo declare any branch" — reads as harmless and is not.
 *
 * The fixtures are real git repos with real branches: the existence rule cannot be tested against a
 * mock, and a `project.yml` carrying a LIST is the first thing the audit's deliberately-narrow YAML
 * reader has ever had to parse, so it is exercised through the real tool rather than a unit call.
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
 * A tier B repo on `main`, plus any extra branches, plus the given project.yml body.
 * Deliberately minimal: every other audit rule must stay silent so a finding in the result is
 * unambiguously the one under test.
 */
function fixture(projectYml, extraBranches = [], files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-integration-'));
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

const TIER_B = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\n';
const hasText = (list, rx) => list.some((t) => rx.test(t));

// --- the happy path: a list parses, and the line is not judged as a feature branch ---

test('a declared line that exists is clean, and is exempt from the branch-name regex', () => {
  const r = audit(fixture(TIER_B + 'integration:\n  - v2\n', ['v2']));
  assert.deepStrictEqual(r.fails, []);
  // `v2` matches neither `<type>/<slug>` nor the built-in alias set; without the exemption it
  // would be reported as an off-convention branch name.
  assert.ok(!hasText(r.warns, /off-convention/), `unexpected naming advisory: ${r.warns.join(' | ')}`);
});

test('the inline list form parses too', () => {
  const r = audit(fixture(TIER_B + 'integration: [v2, v3]\n', ['v2', 'v3']));
  assert.deepStrictEqual(r.fails, []);
});

test('a list does not trip the "no nested YAML" parse guard', () => {
  const r = audit(fixture(TIER_B + 'integration:\n  - v2\n', ['v2']));
  assert.ok(!hasText(r.fails.concat(r.warns), /nested\/indented YAML/), 'the list was read as illegal nesting');
});

test('an ordinary repo with no integration key is unaffected', () => {
  const r = audit(fixture(TIER_B));
  assert.deepStrictEqual(r.fails, []);
});

// --- the rules that keep the axis on the development side -------------------

test('listing the trunk is a finding', () => {
  const r = audit(fixture(TIER_B + 'integration:\n  - main\n'));
  assert.ok(!r.ok);
  assert.ok(hasText(r.fails, /integration lists the trunk/), r.fails.join(' | '));
});

test('listing "main" on a repo whose trunk is dev is a finding — it is the release branch', () => {
  const yml = 'tier: C\ntrunk: dev\nproduction: https://example.invalid\ndeploy: push-main\nstack: node\nintegration:\n  - main\n';
  const r = audit(fixture(yml, ['dev'], { '.github/workflows/deploy-x.yml': 'on:\n  push:\n    branches: [main]\njobs: {}\n' }));
  assert.ok(hasText(r.fails, /integration lists "main"/), r.fails.join(' | '));
});

test('a line that does not exist as a branch is a finding', () => {
  const r = audit(fixture(TIER_B + 'integration:\n  - v2\n'));
  assert.ok(!r.ok);
  assert.ok(hasText(r.fails, /integration line "v2" does not exist/), r.fails.join(' | '));
});

test('a branch literally named trunk is refused here as everywhere', () => {
  const r = audit(fixture(TIER_B + 'integration:\n  - trunk\n', ['trunk']));
  assert.ok(hasText(r.fails, /"trunk" is a role/), r.fails.join(' | '));
});

test('a scalar instead of a list is a finding, not a silently-ignored string', () => {
  const r = audit(fixture(TIER_B + 'integration: v2\n', ['v2']));
  assert.ok(hasText(r.fails, /must be a list of branch names/), r.fails.join(' | '));
});

// --- the CI question: advisory, never a failure -----------------------------

test('an ungated line warns but does not fail the repo', () => {
  const ci = 'name: CI\non:\n  push:\n    branches: [main]\njobs:\n  build:\n    runs-on: ubuntu-latest\n';
  const r = audit(fixture(TIER_B + 'integration:\n  - v2\n', ['v2'], { '.github/workflows/checks.yml': ci }));
  assert.ok(hasText(r.warns, /integration line "v2" is not CI-gated/), r.warns.join(' | '));
  assert.ok(r.ok, `an ungated line must stay advisory, got fails: ${r.fails.join(' | ')}`);
});

test('a line the CI does gate produces no advisory', () => {
  const ci = 'name: CI\non:\n  push:\n    branches: [main, v2]\njobs:\n  build:\n    runs-on: ubuntu-latest\n';
  const r = audit(fixture(TIER_B + 'integration:\n  - v2\n', ['v2'], { '.github/workflows/checks.yml': ci }));
  assert.ok(!hasText(r.warns, /not CI-gated/), r.warns.join(' | '));
});

test('a workflow naming a declared line is not a ghost reference', () => {
  const ci = 'name: CI\non:\n  push:\n    branches: [main, v2]\njobs:\n  build:\n    runs-on: ubuntu-latest\n';
  const r = audit(fixture(TIER_B + 'integration:\n  - v2\n', ['v2'], { '.github/workflows/checks.yml': ci }));
  assert.ok(!hasText(r.warns, /nonexistent branch/), r.warns.join(' | '));
});
