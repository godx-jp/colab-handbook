'use strict';
/**
 * Tests for `colab ship --dry --json` (#77) — the machine-readable precondition read a scheduled
 * driver needs to tell a self-clearing blocker (retry later, unattended) apart from a human-gated
 * one (park it, a person must act).
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * Real CLI, real repo, real bare `origin` on disk (no network) — same posture as
 * colab-base.test.js, because the property under test is WIRING: the plain `--dry` prose path
 * must stay byte-identical, and `--dry --json` must report the WHOLE table even when one
 * precondition (autonomy) already fails, rather than stopping at the first refusal.
 *
 * `COLAB_HOME` is redirected per test, so the developer's real state.json is never read or written.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const COLAB = path.join(REPO_ROOT, 'tools', 'colab');

const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

/** A clone with a real bare `origin` and a `main` trunk, private COLAB_HOME. */
function fixture(projectYml) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-ship-json-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  fs.mkdirSync(home);
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { encoding: 'utf8' });
  execFileSync('git', ['init', '-q', '-b', 'main', work], { encoding: 'utf8' });
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'colab ship-json test');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  g(work, 'remote', 'add', 'origin', origin);
  fs.mkdirSync(path.join(work, '.github'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), projectYml);
  fs.writeFileSync(path.join(work, 'f.txt'), 'base\n');
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', 'chore: fixture');
  g(work, 'push', '-q', 'origin', 'main');

  return { root, origin, work, home, g };
}

function colab(fx, args) {
  const r = spawnSync('node', [COLAB, ...args], {
    encoding: 'utf8',
    env: { ...process.env, COLAB_HOME: fx.home, COLAB_SESSION: '', COLAB_SESSION_NAME: '' },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

const PROJECT_YML_NO_AUTONOMY = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\n';
const PROJECT_YML_AUTO_TRUNK = `${PROJECT_YML_NO_AUTONOMY}autonomy: auto-trunk\n`;

// --- usage guard ------------------------------------------------------------

test('--json without --dry is refused, not silently ignored', () => {
  const fx = fixture(PROJECT_YML_AUTO_TRUNK);
  fx.g(fx.work, 'checkout', '-q', '-b', 'feat/x-1');
  fs.writeFileSync(path.join(fx.work, 'g.txt'), 'x\n');
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', 'feat: x');
  fx.g(fx.work, 'checkout', '-q', 'main');

  const r = colab(fx, ['ship', '--branch', 'feat/x-1', '--repo', fx.work, '--json']);
  assert.notStrictEqual(r.code, 0);
  assert.match(r.err, /--json currently only applies together with --dry/);
});

// --- the plain --dry prose path is untouched --------------------------------

test('plain --dry (no --json) keeps the ORIGINAL hard-refusal prose on a missing autonomy grant', () => {
  const fx = fixture(PROJECT_YML_NO_AUTONOMY); // no autonomy: auto-trunk
  fx.g(fx.work, 'checkout', '-q', '-b', 'feat/x-2');
  fs.writeFileSync(path.join(fx.work, 'g.txt'), 'x\n');
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', 'feat: x');
  fx.g(fx.work, 'checkout', '-q', 'main');

  const r = colab(fx, ['ship', '--branch', 'feat/x-2', '--repo', fx.work, '--dry']);
  assert.notStrictEqual(r.code, 0);
  assert.match(r.err, /does not grant auto-trunk/);
  assert.doesNotMatch(r.out, /^\{/); // never JSON on the plain path
});

// --- --dry --json: the whole table, not just the first refusal -------------

test('--dry --json reports EVERY precondition even when autonomy already fails (no short-circuit)', () => {
  const fx = fixture(PROJECT_YML_NO_AUTONOMY);
  fx.g(fx.work, 'checkout', '-q', '-b', 'feat/x-3');
  fs.writeFileSync(path.join(fx.work, 'g.txt'), 'x\n');
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', 'feat: x');
  fx.g(fx.work, 'checkout', '-q', 'main');

  const r = colab(fx, ['ship', '--branch', 'feat/x-3', '--repo', fx.work, '--dry', '--json']);
  assert.strictEqual(r.code, 1, r.out + r.err);
  const body = JSON.parse(r.out);
  assert.strictEqual(body.ok, false);
  const names = body.checks.map((c) => c.name);
  // Every documented precondition is present, not just the one that failed first.
  for (const n of ['branch resolves', 'not an integration line', 'declared base', 'autonomy granted',
    'no new migrations', 'trunk checkout ready', 'no hand-merge conflict']) {
    assert.ok(names.includes(n), `missing check "${n}" in ${JSON.stringify(names)}`);
  }
  const autonomy = body.checks.find((c) => c.name === 'autonomy granted');
  assert.strictEqual(autonomy.ok, false);
  assert.strictEqual(autonomy.class, 'human-gated');
  // A clean merge into main with no conflicting content — this check must still pass.
  const conflict = body.checks.find((c) => c.name === 'no hand-merge conflict');
  assert.strictEqual(conflict.ok, true, JSON.stringify(conflict));
});

test('--dry --json: a real non-generated conflict is reported human-gated, and fails the merge check', () => {
  const fx = fixture(PROJECT_YML_AUTO_TRUNK);
  fx.g(fx.work, 'checkout', '-q', '-b', 'feat/conflict-4');
  fs.writeFileSync(path.join(fx.work, 'f.txt'), 'branch change\n');
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', 'feat: branch change');
  fx.g(fx.work, 'checkout', '-q', 'main');
  fs.writeFileSync(path.join(fx.work, 'f.txt'), 'trunk change\n');
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', 'chore: trunk moved on');
  fx.g(fx.work, 'push', '-q', 'origin', 'main');

  const r = colab(fx, ['ship', '--branch', 'feat/conflict-4', '--repo', fx.work, '--dry', '--json']);
  assert.strictEqual(r.code, 1, r.out + r.err);
  const body = JSON.parse(r.out);
  assert.strictEqual(body.ok, false);
  const conflict = body.checks.find((c) => c.name === 'no hand-merge conflict');
  assert.strictEqual(conflict.ok, false);
  assert.strictEqual(conflict.class, 'human-gated');
  assert.match(conflict.detail, /f\.txt/);
  // The preview must not leave a stray worktree or move the main checkout off trunk.
  assert.strictEqual(fx.g(fx.work, 'rev-parse', '--abbrev-ref', 'HEAD').trim(), 'main');
  assert.doesNotMatch(fx.g(fx.work, 'worktree', 'list'), /conflict-4/);
});

test('--dry --json: a branch with no commits of its own to ship is a clean, all-green table', () => {
  const fx = fixture(PROJECT_YML_AUTO_TRUNK);
  fx.g(fx.work, 'checkout', '-q', '-b', 'feat/clean-5');
  fs.writeFileSync(path.join(fx.work, 'g.txt'), 'new file\n');
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', 'feat: add g');
  fx.g(fx.work, 'checkout', '-q', 'main');

  const r = colab(fx, ['ship', '--branch', 'feat/clean-5', '--repo', fx.work, '--dry', '--json']);
  const body = JSON.parse(r.out);
  // CI can't be confirmed against a bare non-GitHub origin — that is the ONLY expected failure,
  // and it must read self-clearing (a caller may retry once gh/CI becomes reachable).
  const notOk = body.checks.filter((c) => !c.ok);
  assert.strictEqual(notOk.length, 1, JSON.stringify(notOk));
  assert.match(notOk[0].name, /CI green/);
  assert.strictEqual(notOk[0].class, 'self-clearing');
});

// --- #87 / #90: the two preconditions the machine-facing path was missing -----

/**
 * Writes claims straight into the test's private state.json. `colab claim` would need gh, which a
 * bare on-disk origin does not provide — and the property under test is what ship DOES with a
 * claim, not how the claim got written. Shape mirrors tools/colab's own writer exactly.
 */
function seedClaims(fx, repoAbs, entries) {
  const file = path.join(fx.home, 'state.json');
  const st = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { version: 1, worktrees: {}, claims: {}, ports: {} };
  st.claims = st.claims || {};
  for (const e of entries) {
    st.claims[`${repoAbs}#${e.issue}`] = {
      issue: `#${e.issue}`, repo: repoAbs, worktree: e.worktree || null, branch: e.branch,
      host: 'test', created: new Date().toISOString(),
    };
  }
  fs.mkdirSync(fx.home, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(st, null, 2));
}

test('--dry --json: a claim git does not corroborate fails the table (#87, the co-tenant case)', () => {
  const fx = fixture(PROJECT_YML_AUTO_TRUNK);
  fx.g(fx.work, 'checkout', '-q', '-b', 'fix/thing-71-76');
  fs.writeFileSync(path.join(fx.work, 'g.txt'), 'work\n');
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', 'fix: the thing\n\nCloses #71');
  fx.g(fx.work, 'checkout', '-q', 'main');
  // #74 is claimed on this branch but named NOWHERE in git — the exact shape #87 measured.
  seedClaims(fx, fs.realpathSync(fx.work), [
    { issue: 71, branch: 'fix/thing-71-76' },
    { issue: 74, branch: 'fix/thing-71-76' },
    { issue: 76, branch: 'fix/thing-71-76' },
  ]);

  const r = colab(fx, ['ship', '--branch', 'fix/thing-71-76', '--repo', fx.work, '--dry', '--json']);
  const body = JSON.parse(r.out);
  const check = body.checks.find((c) => c.name === 'claims corroborated by git');
  assert.ok(check, 'the corroboration check is missing from checks[]');
  assert.strictEqual(check.ok, false);
  assert.strictEqual(check.class, 'human-gated');
  assert.match(check.detail, /#74/);
  assert.doesNotMatch(check.detail, /#71|#76/); // both ARE corroborated — only 74 is the finding
  assert.strictEqual(body.ok, false);
});

test('--dry --json: a zero-commit landed branch reports mode evidence-close, not a false ok (#90)', () => {
  const fx = fixture(PROJECT_YML_AUTO_TRUNK);
  // Branched off main and never committed: the design-consult / "no change needed" shape.
  fx.g(fx.work, 'branch', 'docs/decision-90');

  const r = colab(fx, ['ship', '--branch', 'docs/decision-90', '--repo', fx.work, '--dry', '--json']);
  const body = JSON.parse(r.out);
  assert.strictEqual(body.mode, 'evidence-close');
  const check = body.checks.find((c) => c.name === 'branch has commits');
  assert.ok(check, 'the branch-has-commits precondition is missing from checks[]');
  assert.strictEqual(check.ok, true);
  assert.match(check.detail, /evidence-close/);
});

test('--dry --json: an ordinary branch with commits stays mode squash', () => {
  const fx = fixture(PROJECT_YML_AUTO_TRUNK);
  fx.g(fx.work, 'checkout', '-q', '-b', 'feat/ordinary-9');
  fs.writeFileSync(path.join(fx.work, 'h.txt'), 'x\n');
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', 'feat: ordinary');
  fx.g(fx.work, 'checkout', '-q', 'main');

  const body = JSON.parse(colab(fx, ['ship', '--branch', 'feat/ordinary-9', '--repo', fx.work, '--dry', '--json']).out);
  assert.strictEqual(body.mode, 'squash');
  const check = body.checks.find((c) => c.name === 'branch has commits');
  assert.strictEqual(check.ok, true);
  assert.match(check.detail, /1 vs main/);
});
