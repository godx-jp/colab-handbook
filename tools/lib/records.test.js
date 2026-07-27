'use strict';
/**
 * Tests for the record shape that broke three commands at once (#53): a worktree/claim pair holding
 * `{"branch": "trunk", "path": null}`.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * Two layers, deliberately:
 *   - unit, for the rules themselves (which values are refused, and the "only changed fields" rule
 *     that keeps a legacy-bad record from crashing every later command);
 *   - end-to-end against the real CLI, because the defect was a WIRING one. Every unit of the
 *     pre-fix code was individually fine: `claim` had a default, `ship` looked claims up by branch
 *     name, `doctor` checked whether a directory existed. Only running them in sequence shows the
 *     literal `trunk` being written by one and silently costing a `Closes #N` in another.
 *
 * `COLAB_HOME` is redirected per test, so the developer's real state.json is never read or written.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const records = require('./records');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const COLAB = path.join(REPO_ROOT, 'tools', 'colab');

const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

// --- unit: the rules --------------------------------------------------------

test('a role word is refused as a branch name; a real name and "no branch" are not', () => {
  assert.match(records.branchProblem('trunk'), /ROLE, not a branch name/);
  assert.match(records.branchProblem('TRUNK'), /ROLE, not a branch name/); // case is not a loophole
  assert.strictEqual(records.branchProblem('main'), null);   // a real branch that PLAYS the role
  assert.strictEqual(records.branchProblem('dev'), null);
  assert.strictEqual(records.branchProblem('fix/thing-53'), null);
  assert.strictEqual(records.branchProblem(null), null);     // the sanctioned "no branch"
  assert.match(records.branchProblem(''), /empty string/);   // '' is not null and never means null
});

test('only a pending stub may name no directory', () => {
  assert.strictEqual(records.pathProblem({ path: null, status: 'pending' }), null);
  assert.match(records.pathProblem({ path: null, status: 'running' }), /path is null/);
  assert.match(records.pathProblem({ path: null }), /path is null/); // absent status reads as running
  assert.strictEqual(records.pathProblem({ path: '/tmp/wt', status: 'running' }), null);
});

test('validation judges the change, not the file — a legacy-bad record stays writable', () => {
  // The exact record found in the field, already on disk.
  const bad = { worktrees: { x: { branch: 'trunk', path: null, status: 'running' } }, claims: {} };
  const before = records.snapshot(bad);

  // doctor flipping an unrelated field on it must not throw: the record it is trying to FIX cannot
  // be the reason it cannot write. Note the path problem's MESSAGE changes here (it names the
  // status) while its kind does not — comparing text rather than kind would refuse this write.
  bad.worktrees.x.status = 'merged';
  assert.deepStrictEqual(records.changedProblems(before, bad), []);

  // But re-writing the branch to the same bad value IS this mutation's doing, and is refused.
  const rewrite = { worktrees: { x: { branch: 'trunk', path: '/tmp/x', status: 'running' } }, claims: {} };
  assert.match(records.changedProblems(records.snapshot({ worktrees: { x: { branch: 'fix/a-1', path: '/tmp/x', status: 'running' } }, claims: {} }), rewrite).join(''),
    /ROLE, not a branch name/);
});

test('a brand-new record is validated in full', () => {
  const after = { worktrees: { n: { branch: 'trunk', path: null, status: 'running' } }, claims: { '/r#1': { branch: 'trunk' } } };
  const problems = records.changedProblems(records.snapshot({ worktrees: {}, claims: {} }), after);
  assert.strictEqual(problems.length, 3, problems.join(' | ')); // branch + path on the worktree, branch on the claim
  assert.ok(problems.some((p) => p.startsWith('claim /r#1')), problems.join(' | '));
});

// --- end-to-end: the CLI ----------------------------------------------------

const PROJECT_YML = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nautonomy: auto-trunk\n';

/** A clone with a real bare `origin`, a `main` trunk, and a private COLAB_HOME. No network. */
function fixture(projectYml = PROJECT_YML) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-records-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  fs.mkdirSync(home);
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { encoding: 'utf8' });
  execFileSync('git', ['init', '-q', '-b', 'main', work], { encoding: 'utf8' });
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'colab records test');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  g(work, 'remote', 'add', 'origin', origin);
  fs.mkdirSync(path.join(work, '.github'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), projectYml);
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

// The repo root as colab records it: `git rev-parse --show-toplevel` resolves symlinks, and on
// macOS a temp dir under /var is really /private/var — so a claim key built from `fx.work` misses.
const repoAbs = (fx) => fs.realpathSync(fx.work);
const claimKey = (fx, n) => `${repoAbs(fx)}#${n}`;

const statePath = (fx) => path.join(fx.home, 'state.json');
const readState = (fx) => JSON.parse(fs.readFileSync(statePath(fx), 'utf8'));
const writeState = (fx, st) => fs.writeFileSync(statePath(fx), JSON.stringify(st, null, 2) + '\n');

test('claiming onto a not-yet-created worktree records no branch — not the word "trunk"', () => {
  const fx = fixture();
  // The first command in code-start, and the one that produced the field record.
  const r = colab(fx, ['claim', '7', '--worktree', 'thing-7', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.err);

  const st = readState(fx);
  assert.strictEqual(st.claims[claimKey(fx, 7)].branch, null, 'a claim with no branch must say null');
  const wt = st.worktrees['thing-7'];
  assert.strictEqual(wt.branch, null);
  assert.strictEqual(wt.path, null);
  assert.strictEqual(wt.status, 'pending', 'a stub with no directory must say so in its status');
});

test('`--branch trunk` is refused at the front door, and writes nothing', () => {
  const fx = fixture();
  const r = colab(fx, ['claim', '8', '--branch', 'trunk', '--repo', fx.work]);
  assert.notStrictEqual(r.code, 0);
  assert.match(r.err + r.out, /ROLE, not a branch name/);
  assert.ok(!fs.existsSync(statePath(fx)) || !Object.keys(readState(fx).claims).length,
    'a refused claim must not leave a record behind');
});

test('`worktree new trunk` is refused — the convention finally has an enforcer', () => {
  const fx = fixture();
  const r = colab(fx, ['worktree', 'new', 'trunk', '--repo', fx.work]);
  assert.notStrictEqual(r.code, 0);
  assert.match(r.err + r.out, /ROLE, not a branch name/);
  assert.ok(!fs.existsSync(path.join(fx.work, '.worktrees', 'trunk')), 'the branch must not have been created');
});

test('ship refuses a session whose recorded branch resolves to no ref', () => {
  const fx = fixture();
  assert.strictEqual(colab(fx, ['worktree', 'new', 'fix/real-9', '--issues', '9', '--repo', fx.work]).code, 0);
  // Reproduce the field record on an otherwise healthy session: the branch exists, the record lies.
  const st = readState(fx);
  st.worktrees['real-9'].branch = 'trunk';
  st.worktrees['real-9'].path = null;
  writeState(fx, st);

  const r = colab(fx, ['ship', '--worktree', 'real-9', '--repo', fx.work, '--dry']);
  assert.notStrictEqual(r.code, 0, r.out);
  assert.match(r.err, /resolves to no ref/);
  // The pre-fix path got all the way to a squash with no Closes; it must not reach the plan at all.
  assert.ok(!/B1 squash/.test(r.out), `ship planned a merge anyway:\n${r.out}`);
});

test('ship says loudly that a branch with zero claims will carry no Closes', () => {
  const fx = fixture();
  assert.strictEqual(colab(fx, ['worktree', 'new', 'fix/unclaimed-10', '--repo', fx.work]).code, 0);
  const r = colab(fx, ['ship', '--worktree', 'unclaimed-10', '--repo', fx.work, '--dry']);
  assert.match(r.err, /ZERO claimed issues/);
  assert.match(r.err, /Closes/);
});

test('ship refuses when the empty claim set is explained by a broken claim record', () => {
  const fx = fixture();
  assert.strictEqual(colab(fx, ['worktree', 'new', 'fix/unclaimed-11', '--repo', fx.work]).code, 0);
  // Another session's claim in the same repo, recorded against a branch that resolves to nothing:
  // "no claims here" is then a broken lookup, not a fact about this branch.
  const st = readState(fx);
  st.claims[claimKey(fx, 11)] = { issue: '#11', repo: repoAbs(fx), worktree: null, branch: 'trunk', host: 'test', created: new Date().toISOString() };
  writeState(fx, st);

  const r = colab(fx, ['ship', '--worktree', 'unclaimed-11', '--repo', fx.work, '--dry']);
  assert.notStrictEqual(r.code, 0, r.out);
  assert.match(r.err, /#11/);
  assert.ok(!/B1 squash/.test(r.out), `ship planned a merge anyway:\n${r.out}`);
});

test('doctor reports the unusable record, and repairs only what the disk proves', () => {
  const fx = fixture();
  assert.strictEqual(colab(fx, ['worktree', 'new', 'fix/repairable-12', '--issues', '12', '--repo', fx.work]).code, 0);
  const wtPath = readState(fx).worktrees['repairable-12'].path;
  const st = readState(fx);
  st.worktrees['repairable-12'].branch = 'trunk';
  st.worktrees['repairable-12'].path = null;
  st.claims[claimKey(fx, 12)].branch = 'trunk';
  writeState(fx, st);

  const before = colab(fx, ['doctor']); // doctor is machine-wide; COLAB_HOME scopes it to this fixture
  assert.match(before.out, /unusable record/);
  assert.match(before.out, /ROLE, not a branch name/);
  assert.ok(!/All healthy/.test(before.out), 'a record two commands cannot act on is not health');

  const after = colab(fx, ['doctor', '--prune']);
  assert.match(after.out, /repaired from disk/);
  const fixed = readState(fx);
  assert.strictEqual(fixed.worktrees['repairable-12'].path, wtPath);
  assert.strictEqual(fixed.worktrees['repairable-12'].branch, 'fix/repairable-12');
  assert.strictEqual(fixed.claims[claimKey(fx, 12)].branch, 'fix/repairable-12', 'the claim must be repaired with it — ship reads THAT');
  assert.strictEqual(colab(fx, ['doctor']).out.includes('unusable record'), false);
});

test('doctor never guesses a branch it cannot see', () => {
  const fx = fixture();
  assert.strictEqual(colab(fx, ['claim', '13', '--worktree', 'ghost-13', '--repo', fx.work]).code, 0);
  const st = readState(fx);
  // A stub that never became a worktree, aged past the TTL.
  st.worktrees['ghost-13'].created = new Date(Date.now() - 72 * 3_600_000).toISOString();
  writeState(fx, st);

  const r = colab(fx, ['doctor', '--prune']);
  assert.match(r.out, /never created/);
  assert.ok(!/repaired from disk/.test(r.out), 'nothing on disk proved anything — it must not be "repaired"');
  assert.strictEqual(readState(fx).worktrees['ghost-13'].branch, null, 'the record must be left as it was');
});
