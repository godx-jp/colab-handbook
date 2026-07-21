'use strict';
/**
 * Tests for the worktree BASE: `colab worktree new --base`, what gets recorded, and the two
 * refusals that keep a declared line off the path to production.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * These drive the real CLI against a real repo with a real `origin` (a bare repo on disk, so
 * nothing here touches the network), because the property under test is a WIRING property: base
 * validated at creation, base recorded in state, base honoured as the merge target. A unit test of
 * the resolver would have passed while `ship` still resolved trunk on its own — which is precisely
 * the step the design says must not be skipped.
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

const PROJECT_YML = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nintegration:\n  - v2\n';

/** A clone with a real bare `origin`, a `main` trunk, a declared line `v2`, and a private COLAB_HOME. */
function fixture(projectYml = PROJECT_YML) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-base-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  fs.mkdirSync(home);
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { encoding: 'utf8' });
  execFileSync('git', ['init', '-q', '-b', 'main', work], { encoding: 'utf8' });
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'colab base test');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  g(work, 'remote', 'add', 'origin', origin);
  fs.mkdirSync(path.join(work, '.github'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), projectYml);
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', 'chore: fixture');
  g(work, 'push', '-q', 'origin', 'main');
  // The line diverges from trunk, as a long-lived line does.
  g(work, 'checkout', '-q', '-b', 'v2');
  fs.writeFileSync(path.join(work, 'line.txt'), 'work parked for a later release\n');
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', 'feat: line groundwork');
  g(work, 'push', '-q', 'origin', 'v2');
  g(work, 'checkout', '-q', 'main'); // the main checkout is on trunk at rest, always

  return { root, origin, work, home, g };
}

function colab(fx, args) {
  const r = spawnSync('node', [COLAB, ...args], {
    encoding: 'utf8',
    env: { ...process.env, COLAB_HOME: fx.home, COLAB_SESSION: '', COLAB_SESSION_NAME: '' },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

const readState = (fx) => JSON.parse(fs.readFileSync(path.join(fx.home, 'state.json'), 'utf8'));

// --- creation ---------------------------------------------------------------

test('an undeclared base is refused — "some other branch" stays improvisation', () => {
  const fx = fixture();
  fx.g(fx.work, 'branch', 'v3'); // exists, but is not declared
  const r = colab(fx, ['worktree', 'new', 'feat/thing-1', '--base', 'v3', '--repo', fx.work]);
  assert.notStrictEqual(r.code, 0);
  assert.match(r.err + r.out, /not a declared base/);
  assert.ok(!fs.existsSync(path.join(fx.home, 'state.json')) || !Object.keys(readState(fx).worktrees).length,
    'a refused base must not leave a worktree behind');
});

test('a declared line is accepted, cut from it, and recorded on the worktree', () => {
  const fx = fixture();
  const r = colab(fx, ['worktree', 'new', 'feat/on-line-2', '--base', 'v2', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.err);

  const wt = readState(fx).worktrees['on-line-2'];
  assert.ok(wt, 'worktree not recorded');
  assert.strictEqual(wt.base, 'v2');

  // Cut from the line, not from trunk: the line's file is present in the new tree.
  assert.ok(fs.existsSync(path.join(wt.path, 'line.txt')), 'worktree was not created from the line');
});

test('the ordinary case records trunk as the base, rather than leaving it unsaid', () => {
  const fx = fixture();
  assert.strictEqual(colab(fx, ['worktree', 'new', 'feat/ordinary-3', '--repo', fx.work]).code, 0);
  assert.strictEqual(readState(fx).worktrees['ordinary-3'].base, 'main');
});

// --- the target follows the base -------------------------------------------

test('ship targets the recorded base, not trunk', () => {
  // `autonomy: auto-trunk` only so the dry run gets past the autonomy gate and prints its plan;
  // nothing is merged here. That gate is asserted by its own test above.
  const fx = fixture(PROJECT_YML + 'autonomy: auto-trunk\n');
  assert.strictEqual(colab(fx, ['worktree', 'new', 'feat/on-line-4', '--base', 'v2', '--repo', fx.work]).code, 0);
  const r = colab(fx, ['ship', '--worktree', 'on-line-4', '--repo', fx.work, '--dry']);
  assert.match(r.out, /branch feat\/on-line-4 → v2/, r.out + r.err);
  assert.ok(!/→ main/.test(r.out), `ship retargeted at trunk:\n${r.out}`);
});

test('a base the repo no longer declares fails closed — ship does not retarget at trunk', () => {
  const fx = fixture();
  assert.strictEqual(colab(fx, ['worktree', 'new', 'feat/orphan-base-5', '--base', 'v2', '--repo', fx.work]).code, 0);
  // The line is merged and dropped from project.yml while the session is open.
  fs.writeFileSync(path.join(fx.work, '.github', 'project.yml'), 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\n');
  const r = colab(fx, ['ship', '--worktree', 'orphan-base-5', '--repo', fx.work, '--dry']);
  assert.notStrictEqual(r.code, 0);
  assert.match(r.err, /no longer a declared base/);
});

// --- the line itself never ships -------------------------------------------

test('shipping the line into trunk is refused, before autonomy is even consulted', () => {
  const fx = fixture(PROJECT_YML + 'autonomy: auto-trunk\n');
  const r = colab(fx, ['ship', '--branch', 'v2', '--repo', fx.work]);
  assert.notStrictEqual(r.code, 0);
  assert.match(r.err, /declared integration line/);
  assert.match(r.err, /human act/);
});

// --- the lifecycle question is asked against the base ----------------------

test('landed asks about the recorded base', () => {
  const fx = fixture();
  assert.strictEqual(colab(fx, ['worktree', 'new', 'feat/ask-6', '--base', 'v2', '--repo', fx.work]).code, 0);
  const r = colab(fx, ['landed', '--worktree', 'ask-6', '--repo', fx.work, '--json']);
  const [row] = JSON.parse(r.out);
  assert.strictEqual(row.base, 'v2');
  // Freshly cut and empty: it has landed on its base by construction. Measured against TRUNK it
  // would instead look like a branch carrying the whole line — the mistake this wiring prevents.
  assert.strictEqual(row.state, 'landed');
  assert.strictEqual(row.commitsAhead, 0);
});
