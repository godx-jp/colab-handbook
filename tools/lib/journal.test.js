'use strict';
/**
 * Tests for the optional local journal (tools/lib/journal.js).
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * The suite is organised around the questions the Issue said the feature is only done when it can
 * answer FROM THE FILE ALONE. So most of these tests do not assert on a shape; they generate
 * records, then run the actual query and check the answer. A journal that merely narrates would
 * pass shape assertions and fail every one of these.
 *
 * The first group is the most important, and it is a NEGATIVE: with `journal` unset, not one byte
 * is written. That is the state every machine is in by default, so a regression there is a
 * regression for everyone — and an invisible one, because the whole feature is supposed to be
 * quiet. It is proved by spying on every fs write entry point rather than by reading the source,
 * since a grep cannot see a write that reaches the disk through a path nobody thought to grep for.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const CLI = path.join(__dirname, '..', 'colab');

/** A fresh COLAB_HOME. Never the real one: it holds other sessions' live claims. */
function tmpHome(name) {
  // realpath because on macOS os.tmpdir() is a symlink (/var → /private/var) and repoRootOf
  // resolves what it walks. Comparing an unresolved path against a resolved one fails for a
  // reason that has nothing to do with the feature.
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `colab-journal-${name}-`)));
}

/** Run the real CLI against a sandboxed COLAB_HOME. Returns {code, stdout, stderr}. */
function colab(home, args, opts = {}) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      env: { ...process.env, COLAB_HOME: home },
      cwd: opts.cwd || home,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status === undefined ? -1 : e.status, stdout: e.stdout || '', stderr: e.stderr || '' };
  }
}

/** Read journal.jsonl as parsed records; [] when the file does not exist. */
function readJournal(home) {
  const f = path.join(home, 'journal.jsonl');
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

function enable(home) {
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ journal: true }, null, 2) + '\n');
}

// ─────────────────────────────────────── 1. unset journal = not one byte written

test('journal unset: no fs write of any kind targets a journal path', () => {
  const home = tmpHome('silent');
  process.env.COLAB_HOME = home;
  // Re-require with the sandboxed COLAB_HOME in place (the module resolves it at load time).
  delete require.cache[require.resolve('./journal.js')];
  const j = require('./journal.js');
  j._resetForTests();

  const writes = [];
  const spied = ['appendFileSync', 'writeFileSync', 'openSync', 'createWriteStream', 'writeSync', 'mkdirSync'];
  const orig = {};
  for (const name of spied) {
    orig[name] = fs[name];
    fs[name] = function (p, ...rest) {
      if (typeof p === 'string' && p.includes('journal')) writes.push([name, p]);
      return orig[name].call(fs, p, ...rest);
    };
  }
  try {
    // Everything the disabled path could conceivably touch.
    assert.equal(j.on(), false);
    assert.equal(j.snapshot({ worktrees: {}, claims: {}, ports: {} }), null);
    assert.equal(j.append([{ kind: 'x' }]), 0);
    assert.equal(j.invoked({ argv: ['claims'], exit: 0, durationMs: 5 }), 0);
    assert.deepEqual(j.recordDiff(null, null), []);
  } finally {
    for (const name of spied) fs[name] = orig[name];
  }

  assert.deepEqual(writes, [], `disabled journal must write nothing; got ${JSON.stringify(writes)}`);
  assert.equal(fs.existsSync(path.join(home, 'journal.jsonl')), false);
});

test('journal unset: a real CLI lifecycle leaves no journal file', () => {
  const home = tmpHome('silent-e2e');
  // No config.json at all — the state every machine starts in.
  colab(home, ['port', 'alloc', '--label', 'demo']);
  colab(home, ['claims']);
  colab(home, ['config', 'show']);
  colab(home, ['nonsense-command']);
  assert.equal(fs.existsSync(path.join(home, 'journal.jsonl')), false,
    'an unconfigured machine must not acquire a journal file by using colab');
  // State was genuinely exercised, so the absence above is not "nothing happened".
  assert.equal(fs.existsSync(path.join(home, 'state.json')), true);
});

test('enabled() accepts only the boolean true', () => {
  for (const cfg of [null, undefined, {}, { journal: false }, { journal: 'true' }, { journal: 1 }, { journal: {} }]) {
    assert.equal(require('./journal.js').enabled(cfg), false, `${JSON.stringify(cfg)} must not enable`);
  }
  assert.equal(require('./journal.js').enabled({ journal: true }), true);
});

// ─────────────────────────────────────── 2. diff shapes — livedMs is the point

const j = require('./journal.js');

const T0 = Date.parse('2026-07-22T00:00:00.000Z');

function stateWith(over = {}) {
  return { worktrees: {}, claims: {}, ports: {}, ...over };
}

test('a removed worktree carries livedMs computed from the record being destroyed', () => {
  const before = {
    worktrees: { wt: { created: '2026-07-22T00:00:00.000Z', repo: '/r', branch: 'feat/x-1', ports: [5201], status: 'running' } },
    claims: {}, ports: {},
  };
  const after = { worktrees: {}, claims: {}, ports: {} };
  const recs = j.diff(before, after, T0 + 486000, {});
  assert.equal(recs.length, 1);
  const r = recs[0];
  assert.equal(r.kind, 'worktree.removed');
  assert.equal(r.name, 'wt');
  assert.equal(r.repo, '/r');
  assert.equal(r.livedMs, 486000, 'livedMs must be the real elapsed time, not a placeholder');
  assert.deepEqual(r.ports, [5201]);
  assert.equal(r.status, 'running');
  assert.ok(!('created' in r), 'created is folded into ts/livedMs, not repeated');
});

test('creations, changes and removals are distinguished across all three collections', () => {
  const before = stateWith({
    worktrees: { a: { created: '2026-07-22T00:00:00.000Z', repo: '/r', status: 'running' } },
    claims: { 'k1': { created: '2026-07-22T00:00:00.000Z', issue: '#7', repo: '/r', worktree: 'a' } },
    ports: { '5201': { created: '2026-07-22T00:00:00.000Z', port: 5201, owner: { type: 'worktree', ref: 'a' } } },
  });
  const after = stateWith({
    worktrees: { a: { created: '2026-07-22T00:00:00.000Z', repo: '/r', status: 'merged' } },
    claims: {},
    ports: { '5202': { created: '2026-07-22T00:01:00.000Z', port: 5202, owner: { type: 'manual', ref: 'x' } } },
  });
  const kinds = j.diff(before, after, T0 + 60000, {}).map((r) => r.kind).sort();
  assert.deepEqual(kinds, ['claim.removed', 'port.allocated', 'port.freed', 'worktree.changed'].sort());
});

test('a status transition records both sides, which is what dates the merge', () => {
  const before = stateWith({ worktrees: { a: { created: '2026-07-22T00:00:00.000Z', repo: '/r', status: 'running' } } });
  const after = stateWith({ worktrees: { a: { created: '2026-07-22T00:00:00.000Z', repo: '/r', status: 'merged' } } });
  const [r] = j.diff(before, after, T0 + 3600000, {});
  assert.equal(r.kind, 'worktree.changed');
  assert.deepEqual(r.changed.status, ['running', 'merged']);
  assert.equal(r.ageMs, 3600000, 'age at the transition is claim → merge for this worktree');
});

test('an unparseable or future `created` yields no livedMs rather than a wrong one', () => {
  for (const created of [undefined, '', 'not-a-date', '2099-01-01T00:00:00.000Z']) {
    const before = stateWith({ worktrees: { a: { created, repo: '/r' } } });
    const [r] = j.diff(before, stateWith(), T0, {});
    assert.equal(r.kind, 'worktree.removed');
    assert.equal(r.livedMs, undefined, `created=${created} must not produce a number`);
  }
});

test('ctx is stamped on every record, so a removal names the command that caused it', () => {
  const before = stateWith({ worktrees: { a: { created: '2026-07-22T00:00:00.000Z', repo: '/r' } } });
  const [r] = j.diff(before, stateWith(), T0, { cmd: 'doctor' });
  assert.equal(r.cmd, 'doctor', 'worktree rm, ship and doctor --prune all delete; state cannot tell them apart afterwards');
});

test('a container command keeps its sub-command, but an argument is not one', () => {
  assert.equal(j.cmdOf(['worktree', 'new', 'feat/x-1']), 'worktree new');
  assert.equal(j.cmdOf(['worktree', 'rm', 'x']), 'worktree rm',
    'new and rm are opposites; collapsing both to "worktree" loses the lifespan story');
  assert.equal(j.cmdOf(['claim', '115']), 'claim', 'an issue number must not become a command name');
  assert.equal(j.cmdOf(['worktrees']), 'worktrees');
  assert.equal(j.cmdOf(['worktree', '--help']), 'worktree');
  assert.equal(j.cmdOf([]), undefined);
});

// ─────────────────────────────────────── 3. argv redaction

test('config set values are redacted; the key survives', () => {
  assert.deepEqual(j.safeArgv(['config', 'set', 'notifyUrl', 'https://h/x?token=abc']),
    ['config', 'set', 'notifyUrl', '<redacted>']);
  assert.deepEqual(j.safeArgv(['config', 'show']), ['config', 'show']);
  assert.deepEqual(j.safeArgv(['worktree', 'new', 'feat/x-1']), ['worktree', 'new', 'feat/x-1']);
});

// ─────────────────────────────────────── 4. rotation

test('the file is capped, oldest first, and the loss is recorded in the file itself', () => {
  const home = tmpHome('cap');
  enable(home);
  process.env.COLAB_HOME = home;
  delete require.cache[require.resolve('./journal.js')];
  const jj = require('./journal.js');
  jj._resetForTests();

  const f = path.join(home, 'journal.jsonl');
  // Seed past the cap with identifiable lines.
  const line = JSON.stringify({ kind: 'colab.invoked', pad: 'x'.repeat(500) }) + '\n';
  fs.writeFileSync(f, `${JSON.stringify({ kind: 'colab.invoked', marker: 'OLDEST' })}\n` +
    line.repeat(Math.ceil(jj.MAX_BYTES / line.length) + 100));
  assert.ok(fs.statSync(f).size > jj.MAX_BYTES);

  jj.append([{ kind: 'colab.invoked', marker: 'NEWEST' }]);

  const size = fs.statSync(f).size;
  assert.ok(size <= jj.MAX_BYTES, `capped file must be under the cap, was ${size}`);
  const recs = readJournal(home);
  assert.ok(!recs.some((r) => r.marker === 'OLDEST'), 'the oldest line is what gets dropped');
  assert.equal(recs[recs.length - 1].marker, 'NEWEST', 'the new line survives the truncation');
  const trunc = recs.find((r) => r.kind === 'journal.truncated');
  assert.ok(trunc && trunc.droppedBytes > 0, 'a truncated file must say so, or a count taken from it lies');
  // Every surviving line parsed above, which is the assertion that the cut landed on a newline.
});

// ─────────────────────────────────────── 5. repo attribution without a subprocess

test('repoRootOf follows a linked worktree back to its main repo', () => {
  const home = tmpHome('repo');
  const main = path.join(home, 'mainrepo');
  const wt = path.join(home, 'wt');
  fs.mkdirSync(path.join(main, '.git', 'worktrees', 'w1'), { recursive: true });
  fs.mkdirSync(path.join(wt, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${path.join(main, '.git', 'worktrees', 'w1')}\n`);
  assert.equal(j.repoRootOf(path.join(wt, 'sub')), main,
    'a worktree counted as its own repo would split one repo total in two');
  assert.equal(j.repoRootOf(path.join(main, 'x')), main);
  assert.equal(j.repoRootOf(path.join(home, 'nowhere')), null);
});

// ─────────────────────────────────────── 6. the acceptance queries, answered from the file

test('end-to-end: a real lifecycle produces a file that answers all five questions', () => {
  const home = tmpHome('e2e');
  enable(home);
  const repo = path.join(home, 'repo');
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });

  // Two allocations and a release, plus a failing invocation, driven through the real binary.
  const a1 = colab(home, ['port', 'alloc', '--label', 'one']);
  assert.equal(a1.code, 0, a1.stderr);
  const a2 = colab(home, ['port', 'alloc', '--label', 'two'], { cwd: repo });
  assert.equal(a2.code, 0, a2.stderr);
  const port = /(\d{4,5})/.exec(a1.stdout)[1];
  const rel = colab(home, ['port', 'free', port]);
  assert.equal(rel.code, 0, rel.stderr);
  const bad = colab(home, ['definitely-not-a-command']);
  assert.notEqual(bad.code, 0);

  const recs = readJournal(home);
  assert.ok(recs.length >= 5, `expected a populated journal, got ${recs.length}`);

  // Q2a: which invocations exit non-zero?
  const failures = recs.filter((r) => r.kind === 'colab.invoked' && r.exit !== 0);
  assert.ok(failures.some((r) => r.cmd === 'definitely-not-a-command'),
    'a failing invocation must be in the file, or "which invocations failed" is unanswerable');

  // Q2b: which argv repeat inside a window?
  const invocations = recs.filter((r) => r.kind === 'colab.invoked');
  assert.ok(invocations.every((r) => Array.isArray(r.argv) && typeof r.ts === 'string'),
    'argv + ts on every invocation is what makes a repeat-within-a-window query possible');
  const repeats = new Map();
  for (const r of invocations) {
    const k = r.argv.slice(0, 2).join(' ');
    repeats.set(k, (repeats.get(k) || 0) + 1);
  }
  assert.equal(repeats.get('port alloc'), 2, 'repeated argv must be countable');

  // Q4: wall clock and invocation counts per repo.
  assert.ok(invocations.every((r) => Number.isFinite(r.durationMs)),
    'every invocation must carry a duration, or "where does the wall clock go" is unanswerable');
  const byRepo = new Map();
  for (const r of invocations) {
    const key = r.repo || '(none)';
    const cur = byRepo.get(key) || { n: 0, ms: 0 };
    cur.n += 1; cur.ms += r.durationMs;
    byRepo.set(key, cur);
  }
  assert.ok(byRepo.has(repo), `invocations run inside a repo must be attributed to it; saw ${[...byRepo.keys()]}`);

  // Q1/Q3 at the port level: a freed port carries a real elapsed lifespan.
  const freed = recs.find((r) => r.kind === 'port.freed');
  assert.ok(freed, 'freeing a port must leave a trace; state deletes the record');
  assert.equal(typeof freed.livedMs, 'number');
  assert.ok(freed.livedMs >= 0 && freed.livedMs < 600000, `implausible livedMs ${freed.livedMs}`);
  assert.equal(freed.cmd, 'port free', 'the command that destroyed the record is named, sub-command included');
});
