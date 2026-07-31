'use strict';
/**
 * Tests for the audit's `releaseBranch:` validation (audit/audit.mjs) — issue #63.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * `releaseBranch:` names the branch an external GitOps poller fast-forwards on release, in the
 * single-trunk tag-gated shape (`trunk: main`, `deploy: tag`). It is the OPPOSITE axis from
 * `integration:` — a production ref rather than a development one — so its validity rules mirror
 * `integration:`'s (never trunk, never `main`, must exist) but its exemptions still land the same
 * way: the branch is protected from the naming regex and the ghost-branch advisory, exactly like a
 * declared integration line. Modelled on audit-integration.test.js.
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
 * A repo initialised on `main`, plus any extra branches, plus the given project.yml body.
 * Deliberately minimal: every other audit rule must stay silent so a finding in the result is
 * unambiguously the one under test. `checkout` leaves the working tree parked on that branch —
 * needed for trunk-`dev` fixtures, or the "main checkout is on trunk at rest" check fires on the
 * fixture rather than the code under test.
 */
function fixture(projectYml, extraBranches = [], files = {}, checkout = null) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-release-branch-'));
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
const TAG_A_MAIN = (extra = '') =>
  `tier: A\ntrunk: main\nproduction: ${PROD}\ndeploy: tag\nstack: node\nrunbook: docs/deploy.md\n${extra}`;
const RUNBOOK = { 'docs/deploy.md': '# deploy\nthe poller fast-forwards `release` on the tag.\n' };
const TIER_B = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\n';

// --- the happy path: a declared branch exists, is exempt from the naming regex ---

test('a declared release branch that exists is clean, and exempt from the branch-name regex', () => {
  const r = audit(fixture(TAG_A_MAIN('releaseBranch: release\n'), ['release'], RUNBOOK));
  assert.deepStrictEqual(r.fails, []);
  // `release` matches neither `<type>/<slug>` nor the built-in alias set; without the
  // exemption it would be reported as an off-convention branch name.
  assert.ok(!hasText(r.warns, /off-convention/), `unexpected naming advisory: ${r.warns.join(' | ')}`);
});

test('an ordinary repo with no releaseBranch key is unaffected', () => {
  const r = audit(fixture(TIER_B));
  assert.deepStrictEqual(r.fails, []);
});

test('a workflow naming the declared release branch is not a ghost reference', () => {
  const ci = 'name: CI\non:\n  push:\n    branches: [main, release]\njobs:\n  build:\n    runs-on: ubuntu-latest\n';
  const files = { ...RUNBOOK, '.github/workflows/checks.yml': ci };
  const r = audit(fixture(TAG_A_MAIN('releaseBranch: release\n'), ['release'], files));
  assert.ok(!hasText(r.warns, /nonexistent branch/), r.warns.join(' | '));
});

// --- the rules that keep the axis production-only and well-formed -----------

test('naming the trunk itself is a finding', () => {
  const r = audit(fixture(TAG_A_MAIN('releaseBranch: main\n'), [], RUNBOOK));
  assert.ok(!r.ok);
  // trunk IS "main" in the single-trunk tag-gated shape, so the trunk check fires first —
  // still the axis-boundary failure this rule exists to produce, just the trunk-worded one.
  assert.ok(hasText(r.fails, /releaseBranch names the trunk/), r.fails.join(' | '));
});

test('naming "main" on a repo whose trunk is dev is a finding — that is the release branch', () => {
  const yml = 'tier: C\ntrunk: dev\nproduction: https://example.invalid\ndeploy: push-main\nstack: node\nreleaseBranch: main\n';
  const r = audit(fixture(yml, ['dev'], { '.github/workflows/deploy-x.yml': 'on:\n  push:\n    branches: [main]\njobs: {}\n' }, 'dev'));
  assert.ok(hasText(r.fails, /releaseBranch is "main"/), r.fails.join(' | '));
});

test('a branch that does not exist is a finding', () => {
  const r = audit(fixture(TAG_A_MAIN('releaseBranch: release\n'), [], RUNBOOK));
  assert.ok(!r.ok);
  assert.ok(hasText(r.fails, /releaseBranch "release" does not exist/), r.fails.join(' | '));
});

test('a branch literally named trunk is refused here as everywhere', () => {
  const r = audit(fixture(TAG_A_MAIN('releaseBranch: trunk\n'), ['trunk'], RUNBOOK));
  assert.ok(hasText(r.fails, /"trunk" is a role/), r.fails.join(' | '));
});

test('a list instead of a scalar is a finding — a repo has at most one release branch', () => {
  const r = audit(fixture(TAG_A_MAIN('releaseBranch:\n  - release\n  - r2\n'), ['release', 'r2'], RUNBOOK));
  assert.ok(hasText(r.fails, /must be a single branch name/), r.fails.join(' | '));
});

// --- the field only means something for deploy: tag -------------------------

test('declaring it on a non-tag deploy is an advisory, not a failure', () => {
  const yml = 'tier: C\ntrunk: dev\nproduction: https://example.invalid\ndeploy: push-main\nstack: node\nreleaseBranch: release\n';
  const files = { '.github/workflows/deploy-x.yml': 'on:\n  push:\n    branches: [main]\njobs: {}\n' };
  const r = audit(fixture(yml, ['dev', 'release'], files, 'dev'));
  assert.ok(hasText(r.warns, /only means something for deploy: tag/), r.warns.join(' | '));
  assert.ok(r.ok, `advisory must not fail the repo: ${r.fails.join(' | ')}`);
});

test('declaring it on deploy: tag produces no such advisory', () => {
  const r = audit(fixture(TAG_A_MAIN('releaseBranch: release\n'), ['release'], RUNBOOK));
  assert.ok(!hasText(r.warns, /only means something for deploy: tag/), r.warns.join(' | '));
});
