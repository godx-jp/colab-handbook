'use strict';
/**
 * Tests for the optional observer push (tools/lib/notify.js).
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * Two properties carry the whole feature, and they are the two the Issue asked to be able to score:
 *
 *   1. Unconfigured means SILENT — not "quiet", not "fails fast". Zero network calls, zero
 *      processes spawned. This is the state every machine is in by default, so a regression here
 *      is a regression for everyone, and it would be invisible: the events go nowhere anyway.
 *   2. A dead or hanging receiver costs the calling command nothing. The push happens after the
 *      real work has succeeded, so any cost here is charged to a command that is already done.
 *
 * The delivery test at the end is what stops 1 and 2 from being satisfiable by a no-op. It is the
 * only one that opens a socket, and it opens it on 127.0.0.1 against a server this file owns.
 */

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');

const { notify, buildEvent, ACTION_KIND, ACTIONS, SEND_TIMEOUT_MS } = require('./notify.js');

/** A spawn stand-in that records calls instead of making them. */
function recordingSpawn() {
  const calls = [];
  const fn = (...args) => { calls.push(args); return { unref() {} }; };
  fn.calls = calls;
  return fn;
}

// ─────────────────────────────────────────────── 1. unset notifyUrl = absolute silence

test('no notifyUrl: nothing is spawned, for any action', () => {
  for (const cfg of [{}, null, undefined, { notifyUrl: '' }, { notifyUrl: '   ' }]) {
    for (const action of ACTIONS) {
      const spawn = recordingSpawn();
      const r = notify(cfg, action, { repo: '/r', issue: 1 }, { spawn });
      assert.equal(r, 'silent', `cfg ${JSON.stringify(cfg)} / ${action} must be silent`);
      assert.equal(spawn.calls.length, 0, 'a silent push must not spawn anything');
    }
  }
});

test('notifyUrl of a non-http scheme is refused, not attempted', () => {
  // file:// and friends would have the child require('http') and fail anyway, but failing INSIDE a
  // spawned process is a process we should never have paid for — and, for file://, a request we
  // should never make on behalf of a config we cannot vouch for.
  for (const url of ['file:///etc/passwd', 'ftp://x/y', 'javascript:0', '/api/events', 'x']) {
    const spawn = recordingSpawn();
    assert.equal(notify({ notifyUrl: url }, 'claim', { repo: '/r' }, { spawn }), 'skipped');
    assert.equal(spawn.calls.length, 0);
  }
});

test('an action outside the map never reaches the wire', () => {
  // The receiver's kind vocabulary is closed; an unknown action has no kind, and sending one would
  // earn a 400. Refusing here keeps the wire honest instead of relying on the receiver to say no.
  const spawn = recordingSpawn();
  assert.equal(notify({ notifyUrl: 'http://127.0.0.1:1/x' }, 'promote', { repo: '/r' }, { spawn }), 'skipped');
  assert.equal(spawn.calls.length, 0);
  assert.equal(buildEvent('promote', {}), null);
});

// ─────────────────────────────────────────────── 2. a dead receiver costs the caller nothing

test('a hanging receiver does not delay the caller', async () => {
  // A real server that accepts the connection and then never answers — the nastiest case, because
  // TCP succeeds and only the response is missing. If the push were awaited, this would block for
  // SEND_TIMEOUT_MS at minimum; being detached, the caller should not wait even that long.
  const server = http.createServer(() => { /* accept, never respond */ });
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  const url = `http://127.0.0.1:${server.address().port}/api/events`;
  try {
    const t0 = process.hrtime.bigint();
    assert.equal(notify({ notifyUrl: url }, 'claim', { repo: '/r', issue: 7 }), 'sent');
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    // Generous on purpose: this asserts "the caller is not waiting on the network", not a spawn
    // benchmark. A regression to an awaited request shows up as >= SEND_TIMEOUT_MS, far above this.
    assert.ok(ms < 150, `notify() took ${ms.toFixed(1)}ms — it must not wait on the receiver`);
  } finally {
    server.close();
  }
});

test('an unroutable address is the same non-event', () => {
  // Port 1 on loopback: connection refused, immediately. The caller must not see it.
  const t0 = process.hrtime.bigint();
  assert.equal(notify({ notifyUrl: 'http://127.0.0.1:1/api/events' }, 'ship', { repo: '/r' }), 'sent');
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms < 150, `notify() took ${ms.toFixed(1)}ms`);
});

test('a spawn that throws is swallowed, not propagated', () => {
  // Every call site sits after the command has already succeeded, so an exception escaping notify()
  // would turn a completed claim into a failed one. Under process pressure spawn genuinely throws.
  const spawn = () => { throw new Error('EAGAIN'); };
  assert.equal(notify({ notifyUrl: 'http://127.0.0.1:1/x' }, 'claim', { repo: '/r' }, { spawn }), 'skipped');
});

// ─────────────────────────────────────────────── the event body

test('buildEvent: kinds come from the closed map, never from the action name', () => {
  assert.equal(buildEvent('claim', {}).kind, 'claim.appeared');
  assert.equal(buildEvent('release', {}).kind, 'claim.released');
  assert.equal(buildEvent('worktree-new', {}).kind, 'worktree.appeared');
  assert.equal(buildEvent('worktree-rm', {}).kind, 'worktree.removed');
  assert.equal(buildEvent('ship', {}).kind, 'worktree.state-changed');
  assert.equal(buildEvent('readiness', {}).kind, 'readiness.marked');
  // Guard the shape of the map itself: a kind added here without agreeing it with the receiver
  // first is the exact drift the closed vocabulary exists to prevent.
  assert.deepEqual(Object.keys(ACTION_KIND).sort(), [...ACTIONS].sort());
});

test('buildEvent: absent fields are omitted, not sent as null', () => {
  const ev = buildEvent('claim', { repo: '/r' }, '2026-01-01T00:00:00.000Z');
  assert.deepEqual(ev, { kind: 'claim.appeared', ts: '2026-01-01T00:00:00.000Z', repo: '/r' });
  assert.ok(!('issue' in ev) && !('worktree' in ev) && !('session' in ev));
});

test('buildEvent: only a positive integer issue survives', () => {
  // Claims are stored as "#12" strings elsewhere; a caller passing the raw tag must not produce
  // `issue: "#12"` on the wire, where the receiver would coerce it to null and lose the number.
  for (const bad of ['12', '#12', 0, -1, 1.5, null, undefined, NaN]) {
    assert.ok(!('issue' in buildEvent('claim', { repo: '/r', issue: bad })), `issue ${String(bad)} must be dropped`);
  }
  assert.equal(buildEvent('claim', { issue: 12 }).issue, 12);
});

test('delivery: the child really posts the event body', async () => {
  // Without this, "silent when unset" and "fast when hanging" would both pass a no-op. This is the
  // one test that proves an event leaves the machine at all — and that it survives the parent's exit.
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push({ method: req.method, type: req.headers['content-type'], body });
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  const url = `http://127.0.0.1:${server.address().port}/api/events`;
  try {
    const arrived = new Promise((resolve) => server.once('request', () => setTimeout(resolve, 50)));
    notify({ notifyUrl: url }, 'worktree-new', {
      repo: '/repos/thing', worktree: 'feat-x', session: 'session_abc', payload: { branch: 'feat/x-1' },
    });
    await Promise.race([arrived, new Promise((_, rej) => setTimeout(() => rej(new Error('no event arrived within 5s')), 5000))]);

    assert.equal(seen.length, 1);
    assert.equal(seen[0].method, 'POST');
    assert.equal(seen[0].type, 'application/json');
    const ev = JSON.parse(seen[0].body);
    assert.equal(ev.kind, 'worktree.appeared');
    assert.equal(ev.repo, '/repos/thing');
    assert.equal(ev.worktree, 'feat-x');
    assert.equal(ev.session, 'session_abc');
    assert.deepEqual(ev.payload, { branch: 'feat/x-1' });
    assert.ok(!Number.isNaN(Date.parse(ev.ts)), 'ts must be a parseable timestamp');
  } finally {
    server.close();
  }
});

test('delivery: a name that looks like shell metacharacters is data, never code', () => {
  // Branch and worktree names are user input. spawn() with an argv array involves no shell, and the
  // body travels as an argument rather than being interpolated into the child's source — this test
  // is here so that a future "simplification" to `-e` string building fails loudly.
  const spawn = recordingSpawn();
  const nasty = '$(touch /tmp/pwned); `id`; "\'\n';
  notify({ notifyUrl: 'http://127.0.0.1:1/x' }, 'claim', { repo: '/r', worktree: nasty }, { spawn });
  const [, args, opts] = spawn.calls[0];
  assert.equal(args[0], '-e');
  assert.ok(!args[1].includes('pwned'), 'the child script must not contain caller data');
  assert.equal(JSON.parse(args[4]).worktree, nasty, 'the name travels as an argv value, intact');
  assert.equal(opts.detached, true);
  assert.equal(opts.stdio, 'ignore');
  assert.ok(args[1].includes(String(SEND_TIMEOUT_MS)), 'the child bounds itself with the timeout');
});
