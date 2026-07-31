'use strict';
/**
 * Tests for `colab doctor`'s shipped-branches heuristic vs a declared `releaseBranch:` — issue #63.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * `doctor`'s routine-maintenance list (tools/colab, `shippedBranches()`) flags any local branch
 * whose content is already contained in trunk as safe to delete — the standard shape a squash-merged
 * session branch leaves behind. A GitOps-polled release branch produces the IDENTICAL shape between
 * releases: a release script fast-forwarded it to trunk's tip at the last tag, and trunk has moved on
 * since, so its content is a subset of trunk's. Undeclared, that reads as spent. Declaring the branch
 * in `releaseBranch:` (project.schema.md) is what lets doctor tell the two apart.
 *
 * Drives the real CLI against a real repo with a real bare `origin`, because the property under test
 * is that `shippedBranches()` reads project.yml at all — a unit test of the resolver alone would not
 * catch a wiring mistake in `cmdDoctor` failing to pass it through. Modelled on colab-base.test.js.
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

/**
 * A clone with a real bare `origin`, a `main` trunk, a `release` branch left BEHIND trunk (the
 * fast-forwarded-at-last-tag shape), and a private COLAB_HOME. `projectYml` is a function of the
 * fixture so a test can point `trunk`/`releaseBranch` at branch names the fixture actually created.
 */
function fixture(projectYml) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-release-branch-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  fs.mkdirSync(home);
  const g = (...args) => execFileSync('git', args, { cwd: work, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { encoding: 'utf8' });
  execFileSync('git', ['init', '-q', '-b', 'main', work], { encoding: 'utf8' });
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'doctor release-branch test');
  g('config', 'core.hooksPath', path.join(root, '.nohooks'));
  g('remote', 'add', 'origin', origin);
  fs.mkdirSync(path.join(work, '.github'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), projectYml);
  g('add', '-A');
  g('commit', '-q', '-m', 'chore: fixture');
  g('push', '-q', 'origin', 'main');

  // The release branch is cut HERE — at trunk's current tip — which is exactly what a release
  // script's fast-forward leaves behind at the moment of the last tag.
  g('branch', 'release');
  g('push', '-q', 'origin', 'release');

  // Trunk then moves on, same as ordinary development between releases. The release branch is
  // now strictly BEHIND trunk: its content is fully contained in trunk, the shape the shipped-
  // branches heuristic hunts for.
  fs.writeFileSync(path.join(work, 'after-release.txt'), 'work landed after the last tag\n');
  g('add', '-A');
  g('commit', '-q', '-m', 'feat: work after the last release');
  g('push', '-q', 'origin', 'main');

  return { root, origin, work, home };
}

function doctor(fx) {
  const r = spawnSync('node', [COLAB, 'doctor', '--json'], {
    cwd: fx.work,
    encoding: 'utf8',
    env: { ...process.env, COLAB_HOME: fx.home, COLAB_SESSION: '', COLAB_SESSION_NAME: '' },
  });
  assert.strictEqual(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

const TIER_B = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\n';

test('undeclared: a release branch behind trunk is misread as a spent branch, safe to delete', () => {
  const fx = fixture(TIER_B);
  const report = doctor(fx);
  const names = report.shippedBranches.map((b) => b.branch);
  assert.ok(names.includes('release'), `expected "release" flagged as shipped, got: ${names.join(', ')}`);
});

test('declared releaseBranch: is excluded from the shipped-branches list', () => {
  const fx = fixture(TIER_B + 'releaseBranch: release\n');
  const report = doctor(fx);
  const names = report.shippedBranches.map((b) => b.branch);
  assert.ok(!names.includes('release'), `"release" still flagged as shipped despite releaseBranch: — ${names.join(', ')}`);
});

test('a DIFFERENT branch in the same shape is unaffected by the declaration', () => {
  // Guards against an overbroad fix (e.g. skipping the whole check when releaseBranch: is set,
  // rather than excluding only the named branch).
  const fx = fixture(TIER_B + 'releaseBranch: release\n');
  execFileSync('git', ['branch', 'other-spent'], { cwd: fx.work, encoding: 'utf8' });
  const report = doctor(fx);
  const names = report.shippedBranches.map((b) => b.branch);
  assert.ok(names.includes('other-spent'), `an unrelated spent branch must still be flagged — got: ${names.join(', ')}`);
  assert.ok(!names.includes('release'), `"release" still flagged as shipped — ${names.join(', ')}`);
});
