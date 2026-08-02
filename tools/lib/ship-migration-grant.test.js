'use strict';
/**
 * Subprocess/CLI tests for the migration-grant feature (#98): both `colab ship` call sites (the
 * real path's ✓/✗ table and the `--dry --json` path), and `colab migration-grant` itself.
 *
 * Real CLI, real repo, real bare `origin` on disk (no network) — same fixture/colab() shape as
 * tools/lib/ship-dry-json.test.js, copied rather than extracted into a shared harness (extracting
 * one would touch a passing test file for an unrelated reason).
 *
 * WHY THIS FILE CANNOT TEST THE HAPPY PATH END TO END. The fixture's `origin` is a local bare
 * repo, not a real GitHub repository, so `gh issue view`/`gh issue edit`/`gh issue comment` all
 * fail against it — `isGhUsable()` reads true (a real `gh` binary, a non-empty origin URL), but
 * every actual `gh` call downstream fails, which is EXACTLY the "no local fallback, fail closed"
 * property this feature depends on. A grant can therefore never actually be WRITTEN or READ as
 * granted inside this fixture. That is not a hole in coverage — the pure resolution logic
 * (branch binding, expiry, the group-branch case, author trust, non-vacuity) is fully covered
 * without a live `gh` in tools/lib/migration-grant.test.js, on purpose, so it does not need one.
 * What THIS file proves is the WIRING: the human-only gate fires before any network dependency,
 * a failed/absent grant always reads as `human-gated` and never as granted, and the existing
 * ship-dry-json contract survives untouched.
 *
 * Deliberately NOT built: any `COLAB_FAKE_GH`-style hook that would let a test inject a fake
 * granted read. A backdoor into an authorization read is the one thing this feature must not
 * have, and a test fixture is not an exception to that (see the plan file's Risks section).
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const COLAB = path.join(REPO_ROOT, 'tools', 'colab');

// --- the human-only property, second layer: no automated path sets COLAB_HUMAN --------------
// #98 requirement 1 rests entirely on "nothing but a human ever sets COLAB_HUMAN=1" — the same
// bar cmdPromote already holds a production promotion to. This makes that mechanical rather than
// aspirational: walk every skill under skills/ (the automated paths that could plausibly run a
// coding session unattended) and fail loudly if any of them sets the env var.

test('human-only property: no file under skills/ ever sets COLAB_HUMAN', () => {
  const skillsDir = path.join(REPO_ROOT, 'skills');
  const offenders = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) { walk(p); continue; }
      if (!/\.(md|mjs|js|sh)$/.test(name)) continue;
      const text = fs.readFileSync(p, 'utf8');
      if (/COLAB_HUMAN\s*=\s*1/.test(text) || /COLAB_HUMAN=['"]?1/.test(text)) offenders.push(p);
    }
  };
  walk(skillsDir);
  assert.deepStrictEqual(offenders, [],
    `a skill sets COLAB_HUMAN=1 — this would let an unattended session grant itself a migration exemption: ${offenders.join(', ')}`);
});

const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

/** A clone with a real bare `origin` and a `main` trunk, private COLAB_HOME — same shape as
 *  ship-dry-json.test.js's fixture(). */
function fixture(projectYml) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-migration-grant-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  fs.mkdirSync(home);
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { encoding: 'utf8' });
  execFileSync('git', ['init', '-q', '-b', 'main', work], { encoding: 'utf8' });
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'colab migration-grant test');
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

function colab(fx, args, extraEnv = {}) {
  const r = spawnSync('node', [COLAB, ...args], {
    encoding: 'utf8',
    env: { ...process.env, COLAB_HOME: fx.home, COLAB_SESSION: '', COLAB_SESSION_NAME: '', ...extraEnv },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

const PROJECT_YML_AUTO_TRUNK = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nautonomy: auto-trunk\n';

/** Branch fx.work onto <branch>, add a migration file, commit, return to main. */
function addMigrationBranch(fx, branch, file = 'database/migrations/2026_01_01_x.php') {
  fx.g(fx.work, 'checkout', '-q', '-b', branch);
  fs.mkdirSync(path.join(fx.work, path.dirname(file)), { recursive: true });
  fs.writeFileSync(path.join(fx.work, file), 'x\n');
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', 'feat: add a migration');
  fx.g(fx.work, 'checkout', '-q', 'main');
}

// --- human-only enforcement (req 1), fires BEFORE any network dependency --------------------

test('migration-grant CREATE without COLAB_HUMAN=1 refuses, mentioning the exact re-run instruction', () => {
  const fx = fixture(PROJECT_YML_AUTO_TRUNK);
  const r = colab(fx, ['migration-grant', '1', '--branch', 'feat/x-1', '--repo', fx.work], { COLAB_HUMAN: '' });
  assert.notStrictEqual(r.code, 0);
  assert.match(r.err, /requires a human/);
  assert.match(r.err, /COLAB_HUMAN=1/);
  assert.match(r.err, /No field, flag or project\.yml value can lower this bar/);
});

test('migration-grant REVOKE without COLAB_HUMAN=1 refuses the same way as CREATE', () => {
  const fx = fixture(PROJECT_YML_AUTO_TRUNK);
  const r = colab(fx, ['migration-grant', '1', '--revoke', '--repo', fx.work], { COLAB_HUMAN: '' });
  assert.notStrictEqual(r.code, 0);
  assert.match(r.err, /requires a human/);
  assert.match(r.err, /COLAB_HUMAN=1/);
});

test('the human-only check runs BEFORE any repo/branch resolution — no --repo needed to trigger it', () => {
  // No fixture at all: run from a directory that is not even a git repo. If the human-only check
  // ran after repo resolution, this would fail with a git error instead of the human-only refusal.
  const r = spawnSync('node', [COLAB, 'migration-grant', '1', '--branch', 'feat/x-1'], {
    encoding: 'utf8', cwd: os.tmpdir(),
    env: { ...process.env, COLAB_HUMAN: '', COLAB_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'colab-home-')) },
  });
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stderr, /requires a human/);
});

test('migration-grant --list needs no COLAB_HUMAN — it is read-only', () => {
  const fx = fixture(PROJECT_YML_AUTO_TRUNK);
  const r = colab(fx, ['migration-grant', '--list', '--repo', fx.work], { COLAB_HUMAN: '' });
  // Not gated on COLAB_HUMAN — whatever it fails or succeeds on, it must NOT be the human-only
  // refusal specifically (a real GitHub repo would succeed here; this fixture fails on the gh
  // read instead, which is a different, and correct, refusal — see the file banner).
  assert.doesNotMatch(r.err, /requires a human/);
});

// --- no local fallback (req 4): a write or read that cannot reach GitHub never fakes success ---

test('migration-grant CREATE with COLAB_HUMAN=1 against a non-existent branch refuses before any gh write', () => {
  const fx = fixture(PROJECT_YML_AUTO_TRUNK);
  const r = colab(fx, ['migration-grant', '1', '--branch', 'no-such-branch', '--repo', fx.work], { COLAB_HUMAN: '1' });
  assert.notStrictEqual(r.code, 0);
  assert.match(r.err, /does not resolve to a ref/);
});

test('migration-grant CREATE requires --branch — never inferred from the current checkout', () => {
  const fx = fixture(PROJECT_YML_AUTO_TRUNK);
  const r = colab(fx, ['migration-grant', '1', '--repo', fx.work], { COLAB_HUMAN: '1' });
  assert.notStrictEqual(r.code, 0);
  assert.match(r.err, /--branch <branch> is required/);
});

test('migration-grant CREATE against a real branch still refuses (never a silent local-only success) — this fixture is not a real GitHub repo', () => {
  const fx = fixture(PROJECT_YML_AUTO_TRUNK);
  addMigrationBranch(fx, 'feat/x-1');
  const r = colab(fx, ['migration-grant', '1', '--branch', 'feat/x-1', '--repo', fx.work], { COLAB_HUMAN: '1' });
  assert.notStrictEqual(r.code, 0, r.out + r.err);
  // Never anything that reads as success.
  assert.doesNotMatch(r.out, /Granted/);
});

test('migration-grant --list never reports "no outstanding grants" on a failed read', () => {
  const fx = fixture(PROJECT_YML_AUTO_TRUNK);
  const r = colab(fx, ['migration-grant', '--list', '--repo', fx.work], { COLAB_HUMAN: '' });
  assert.notStrictEqual(r.code, 0, r.out + r.err);
  assert.doesNotMatch(r.out, /no outstanding migration grants/);
});

// --- `colab ship`'s two call sites: fail-closed on a migration with no confirmable grant -------

test('ship --dry --json: a branch with a migration and NO claimed issue refuses, "no new migrations" is human-gated, migrationGrant.missing explains why', () => {
  const fx = fixture(PROJECT_YML_AUTO_TRUNK);
  addMigrationBranch(fx, 'feat/x-1');

  const r = colab(fx, ['ship', '--branch', 'feat/x-1', '--repo', fx.work, '--dry', '--json']);
  assert.strictEqual(r.code, 1, r.out + r.err);
  const body = JSON.parse(r.out);
  assert.strictEqual(body.ok, false);
  const mig = body.checks.find((c) => c.name === 'no new migrations');
  assert.strictEqual(mig.ok, false);
  assert.strictEqual(mig.class, 'human-gated'); // NEVER a new third vocabulary value
  assert.ok(body.migrationGrant, 'migrationGrant must be populated when a migration exists');
  assert.strictEqual(body.migrationGrant.branch, 'feat/x-1');
  assert.deepStrictEqual(body.migrationGrant.files, ['database/migrations/2026_01_01_x.php']);
  assert.strictEqual(body.migrationGrant.granted.length, 0);
  assert.match(body.migrationGrant.missing[0].reason, /no claimed issue/);
});

test('ship --dry --json: a branch with a migration AND a claimed issue still refuses — a claim alone is never a grant', () => {
  const fx = fixture(PROJECT_YML_AUTO_TRUNK);
  addMigrationBranch(fx, 'feat/x-2');
  const claimR = colab(fx, ['claim', '42', '--branch', 'feat/x-2', '--repo', fx.work]);
  assert.strictEqual(claimR.code, 0, claimR.out + claimR.err);

  const r = colab(fx, ['ship', '--branch', 'feat/x-2', '--repo', fx.work, '--dry', '--json']);
  assert.strictEqual(r.code, 1, r.out + r.err);
  const body = JSON.parse(r.out);
  const mig = body.checks.find((c) => c.name === 'no new migrations');
  assert.strictEqual(mig.ok, false);
  assert.strictEqual(mig.class, 'human-gated');
  assert.strictEqual(body.migrationGrant.missing[0].issue, 42);
  // The read failed (not a real GitHub repo) — reported as unreadable, never silently granted.
  assert.match(body.migrationGrant.missing[0].reason, /could not be read/);
});

test('ship (real path, prose table): the same branch reports the "no new migrations" row as ✗, and refuses the ship', () => {
  const fx = fixture(PROJECT_YML_AUTO_TRUNK);
  addMigrationBranch(fx, 'feat/x-3');
  colab(fx, ['claim', '43', '--branch', 'feat/x-3', '--repo', fx.work]);

  const r = colab(fx, ['ship', '--branch', 'feat/x-3', '--repo', fx.work, '--dry']);
  assert.notStrictEqual(r.code, 0);
  assert.match(r.out, /✗\s+no new migrations/);
  assert.doesNotMatch(r.out, /exempted by a human grant/);
});

test('ship: a branch with NO migrations is entirely unaffected — no gh reads attempted, detail unchanged', () => {
  const fx = fixture(PROJECT_YML_AUTO_TRUNK);
  fx.g(fx.work, 'checkout', '-q', '-b', 'feat/x-4');
  fs.writeFileSync(path.join(fx.work, 'g.txt'), 'x\n');
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', 'feat: x');
  fx.g(fx.work, 'checkout', '-q', 'main');

  const r = colab(fx, ['ship', '--branch', 'feat/x-4', '--repo', fx.work, '--dry', '--json']);
  const body = JSON.parse(r.out);
  const mig = body.checks.find((c) => c.name === 'no new migrations');
  assert.strictEqual(mig.ok, true);
  assert.strictEqual(mig.class, null);
  assert.strictEqual(mig.detail, 'none vs main'); // byte-identical to before #98
  assert.strictEqual(body.migrationGrant, null); // never computed when there is nothing to grant
});

// --- regression: the pre-existing ship-dry-json contract is untouched -----------------------

test('regression: every documented precondition name (from ship-dry-json.test.js\'s own list) is still present', () => {
  const fx = fixture(PROJECT_YML_AUTO_TRUNK);
  fx.g(fx.work, 'checkout', '-q', '-b', 'feat/x-5');
  fs.writeFileSync(path.join(fx.work, 'g.txt'), 'x\n');
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', 'feat: x');
  fx.g(fx.work, 'checkout', '-q', 'main');

  const r = colab(fx, ['ship', '--branch', 'feat/x-5', '--repo', fx.work, '--dry', '--json']);
  const body = JSON.parse(r.out);
  const names = body.checks.map((c) => c.name);
  for (const n of ['branch resolves', 'not an integration line', 'declared base', 'autonomy granted',
    'no new migrations', 'trunk checkout ready', 'no hand-merge conflict']) {
    assert.ok(names.includes(n), `missing check "${n}" in ${JSON.stringify(names)}`);
  }
});
