'use strict';
/**
 * Subprocess/CLI tests for the ci-grant feature (#105): `colab ci-grant` itself, and its wiring
 * into `colab ship`'s trunk-CI-green precondition (both the prose table and `--dry --json`).
 *
 * Real CLI, real repo, real bare `origin` on disk (no network) — same fixture/colab() shape as
 * tools/lib/ship-migration-grant.test.js, copied rather than extracted into a shared harness
 * (extracting one would touch a passing test file for an unrelated reason — same call #98's file
 * already made about ITS fixture).
 *
 * WHY THIS FILE CANNOT EXERCISE THE GRANT ACTUALLY FIRING END TO END. `shipCiCheck` only ever
 * consults a grant when the RAW verdict is HUMAN_GATED — a real `gh run list` that succeeded and
 * reported a non-success conclusion for a real commit. Against this fixture's local-bare `origin`
 * (not a real GitHub repository), `gh run list` always FAILS outright, so the raw verdict is always
 * SELF_CLEARING ("gh run list failed") — see tools/lib/ship-dry-json.test.js's identical finding
 * ("--dry --json: a branch with no commits of its own to ship is a clean, all-green table", which
 * is in fact NOT all-green: the one non-ok row is CI, self-clearing, unavoidably). A grant can
 * therefore never be WRITTEN (COLAB_HUMAN write path also fails here — see below) or CONSULTED
 * inside this fixture. That is not a coverage hole: the pure resolution logic (redSha binding,
 * evidence matching, author trust, non-vacuity, anti-stacking) is fully covered without a live `gh`
 * in tools/lib/ci-grant.test.js, on purpose. What THIS file proves is the WIRING: the human-only
 * gate fires before any network dependency, a failed/absent/self-clearing case never reads as
 * granted, `ciGrant` stays additive and null on the ordinary path, and the pre-existing
 * ship-dry-json contract survives untouched.
 *
 * Deliberately NOT built: any `COLAB_FAKE_GH`-style hook that would let a test inject a fake granted
 * read. A backdoor into an authorization read is the one thing this feature must not have.
 *
 * #101/#100: a real `gh` binary is placed first on PATH so `isGhUsable()` reads true regardless of
 * whether THIS machine has `gh` authenticated — every actual `gh` subcommand still fails for real
 * against this fixture's local-bare origin. Same wiring `withFakeGh` in tools/lib/git.test.js uses.
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

test('human-only property: no file under skills/ ever sets COLAB_HUMAN (ci-grant shares the bar)', () => {
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
    `a skill sets COLAB_HUMAN=1 — this would let an unattended session grant itself a CI exemption: ${offenders.join(', ')}`);
});

const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

/** A clone with a real bare `origin` and a `main` trunk, private COLAB_HOME — copied from
 *  ship-migration-grant.test.js's fixture(), on purpose (see file banner). */
function fixture(projectYml) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-ci-grant-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  fs.mkdirSync(home);
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { encoding: 'utf8' });
  execFileSync('git', ['init', '-q', '-b', 'main', work], { encoding: 'utf8' });
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'colab ci-grant test');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  g(work, 'remote', 'add', 'origin', origin);
  fs.mkdirSync(path.join(work, '.github'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), projectYml);
  fs.writeFileSync(path.join(work, 'f.txt'), 'base\n');
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', 'chore: fixture');
  g(work, 'push', '-q', 'origin', 'main');

  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then echo "gh version 0.0.0 (fixture)"; exit 0; fi',
    'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then echo "Logged in to github.com (fixture)" >&2; exit 0; fi',
    'echo "fixture gh: refusing $*" >&2',
    'exit 1',
  ].join('\n') + '\n', { mode: 0o755 });

  return { root, origin, work, home, bin, g };
}

function colab(fx, args, extraEnv = {}) {
  const r = spawnSync('node', [COLAB, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${fx.bin}:${process.env.PATH}`, COLAB_HOME: fx.home, COLAB_SESSION: '', COLAB_SESSION_NAME: '', ...extraEnv },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

const PROJECT_YML_AUTO_TRUNK = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nautonomy: auto-trunk\n';

function addCommitBranch(fx, branch, file = 'g.txt') {
  fx.g(fx.work, 'checkout', '-q', '-b', branch);
  fs.writeFileSync(path.join(fx.work, file), 'x\n');
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', 'feat: x');
  fx.g(fx.work, 'checkout', '-q', 'main');
}

// --- human-only enforcement, fires BEFORE any network dependency ---------------------------

test('ci-grant CREATE without COLAB_HUMAN=1 refuses, mentioning the exact re-run instruction', () => {
  const fx = fixture(PROJECT_YML_AUTO_TRUNK);
  const r = colab(fx, ['ci-grant', '1', '--branch', 'feat/x-1', '--repo', fx.work], { COLAB_HUMAN: '' });
  assert.notStrictEqual(r.code, 0);
  assert.match(r.err, /requires a human/);
  assert.match(r.err, /COLAB_HUMAN=1/);
  assert.match(r.err, /No field, flag or project\.yml value can lower this bar/);
});

test('ci-grant REVOKE without COLAB_HUMAN=1 refuses the same way as CREATE', () => {
  const fx = fixture(PROJECT_YML_AUTO_TRUNK);
  const r = colab(fx, ['ci-grant', '1', '--revoke', '--repo', fx.work], { COLAB_HUMAN: '' });
  assert.notStrictEqual(r.code, 0);
  assert.match(r.err, /requires a human/);
  assert.match(r.err, /COLAB_HUMAN=1/);
});

test('the human-only check runs BEFORE any repo/branch resolution — no --repo needed to trigger it', () => {
  const r = spawnSync('node', [COLAB, 'ci-grant', '1', '--branch', 'feat/x-1'], {
    encoding: 'utf8', cwd: os.tmpdir(),
    env: { ...process.env, COLAB_HUMAN: '', COLAB_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'colab-home-')) },
  });
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stderr, /requires a human/);
});

test('ci-grant --list needs no COLAB_HUMAN — it is read-only', () => {
  const fx = fixture(PROJECT_YML_AUTO_TRUNK);
  const r = colab(fx, ['ci-grant', '--list', '--repo', fx.work], { COLAB_HUMAN: '' });
  assert.doesNotMatch(r.err, /requires a human/);
});

// --- no local fallback: a write or read that cannot reach GitHub never fakes success --------

test('ci-grant CREATE with COLAB_HUMAN=1 against a non-existent branch refuses before any gh write', () => {
  const fx = fixture(PROJECT_YML_AUTO_TRUNK);
  const r = colab(fx, ['ci-grant', '1', '--branch', 'no-such-branch', '--repo', fx.work], { COLAB_HUMAN: '1' });
  assert.notStrictEqual(r.code, 0);
  assert.match(r.err, /does not resolve to a ref/);
});

test('ci-grant CREATE requires --branch — never inferred from the current checkout', () => {
  const fx = fixture(PROJECT_YML_AUTO_TRUNK);
  const r = colab(fx, ['ci-grant', '1', '--repo', fx.work], { COLAB_HUMAN: '1' });
  assert.notStrictEqual(r.code, 0);
  assert.match(r.err, /--branch <branch> is required/);
});

test('ci-grant CREATE against a real branch still refuses (never a silent local-only success) — this fixture is not a real GitHub repo', () => {
  const fx = fixture(PROJECT_YML_AUTO_TRUNK);
  addCommitBranch(fx, 'feat/x-1');
  const r = colab(fx, ['ci-grant', '1', '--branch', 'feat/x-1', '--repo', fx.work], { COLAB_HUMAN: '1' });
  assert.notStrictEqual(r.code, 0, r.out + r.err);
  assert.doesNotMatch(r.out, /Granted/);
  // The FIRST network-dependent read cmdCiGrantCreate attempts is the issue itself
  // (git.ghIssueView) — before the anti-stacking scan, before evidence — so this must be the
  // refusal reached, exactly mirroring migration-grant's equivalent test.
  assert.match(r.err, /could not read #1 from the tracker — refusing to write a grant blind/);
});

test('ci-grant --list never reports "no outstanding grants" on a failed read', () => {
  const fx = fixture(PROJECT_YML_AUTO_TRUNK);
  const r = colab(fx, ['ci-grant', '--list', '--repo', fx.work], { COLAB_HUMAN: '' });
  assert.notStrictEqual(r.code, 0, r.out + r.err);
  assert.doesNotMatch(r.out, /no outstanding CI grants/);
});

// --- `colab ship`'s wiring: SELF_CLEARING is never exempted, ciGrant stays additive+null ----

test('ship --dry --json: the "trunk CI green" row is SELF_CLEARING against this fixture (gh run list always fails), and NO grant is ever consulted for it', () => {
  const fx = fixture(PROJECT_YML_AUTO_TRUNK);
  addCommitBranch(fx, 'feat/clean-1');

  const r = colab(fx, ['ship', '--branch', 'feat/clean-1', '--repo', fx.work, '--dry', '--json']);
  const body = JSON.parse(r.out);
  const ci = body.checks.find((c) => c.name === 'trunk CI green');
  assert.strictEqual(ci.ok, false);
  assert.strictEqual(ci.class, 'self-clearing'); // NEVER human-gated in this fixture — see file banner
  // #105's additive field: null because applyCiGrant only ever fires on a HUMAN_GATED verdict,
  // and this fixture can never produce one — the acceptance oracle's "SELF_CLEARING is never
  // exempted by any grant" property, made concrete.
  assert.strictEqual(body.ciGrant, null);
});

test('ship --dry --json: ciGrant is additive and does not disturb any other precondition row', () => {
  const fx = fixture(PROJECT_YML_AUTO_TRUNK);
  addCommitBranch(fx, 'feat/clean-2');

  const r = colab(fx, ['ship', '--branch', 'feat/clean-2', '--repo', fx.work, '--dry', '--json']);
  const body = JSON.parse(r.out);
  const names = body.checks.map((c) => c.name);
  // #105 must never widen beyond the ONE row it targets — the regression this test pins.
  for (const n of ['branch resolves', 'not an integration line', 'declared base', 'autonomy granted',
    'no new migrations', 'trunk checkout ready', 'no hand-merge conflict']) {
    assert.ok(names.includes(n), `missing check "${n}" in ${JSON.stringify(names)}`);
  }
  assert.ok('ciGrant' in body, 'ciGrant must be present in the JSON payload, additive');
  assert.strictEqual(body.migrationGrant, null); // untouched by this feature
});

test('ship (real path, prose table): the "trunk CI green" row prints ✗ with the self-clearing detail, unaffected by ci-grant wiring', () => {
  const fx = fixture(PROJECT_YML_AUTO_TRUNK);
  addCommitBranch(fx, 'feat/clean-3');
  colab(fx, ['claim', '55', '--branch', 'feat/clean-3', '--repo', fx.work]);

  const r = colab(fx, ['ship', '--branch', 'feat/clean-3', '--repo', fx.work, '--dry']);
  assert.notStrictEqual(r.code, 0);
  assert.match(r.out, /✗\s+trunk CI green/);
  assert.doesNotMatch(r.out, /PRECONDITION OVERRIDDEN/); // never claims a grant that was never consulted
});

test('regression: the JSON and prose paths still agree on the CI row (both read not-ok) on the identical fixture', () => {
  const fx = fixture(PROJECT_YML_AUTO_TRUNK);
  addCommitBranch(fx, 'feat/clean-4');

  const jr = colab(fx, ['ship', '--branch', 'feat/clean-4', '--repo', fx.work, '--dry', '--json']);
  const body = JSON.parse(jr.out);
  const ci = body.checks.find((c) => c.name === 'trunk CI green');

  const pr = colab(fx, ['ship', '--branch', 'feat/clean-4', '--repo', fx.work, '--dry']);
  assert.strictEqual(ci.ok, false);
  assert.match(pr.out, /✗\s+trunk CI green/);
});
