'use strict';
/**
 * Regression test: `audit.mjs --json` must not truncate when stdout is a PIPE.
 *
 * Run: `node --test tools/lib/` — wired into CI's self-check job.
 *
 * The bug: the tool wrote its JSON with console.log and then called process.exit().
 * Writes to a pipe are ASYNCHRONOUS, so exiting immediately discards whatever has not
 * drained yet. The reader gets a payload cut at the pipe buffer — invalid JSON — with
 * an exit code that still looks like the documented one, so nothing signals failure.
 * It is size-dependent, which is why it stayed invisible: it appears only once the
 * fleet is large enough to push the report past the buffer, and then it appears
 * everywhere at once.
 *
 * TWO THINGS THIS TEST MUST DO, or it is worse than no test at all:
 *
 *   1. Read stdout the way a TOOL reads it (execFileSync / spawn, which buffer a pipe),
 *      never `| wc -c`. A shell consumer that drains greedily wins the race and reports
 *      the full byte count, which is exactly how this bug was repeatedly dismissed.
 *
 *   2. Generate a payload past the pipe buffer OF THE PLATFORM CI RUNS ON. That buffer
 *      is ~8 KB on macOS but 64 KB on Linux, and CI is Linux. A test sized for a
 *      developer's Mac would pass against the BROKEN code on the runner and look like
 *      coverage while gating nothing. Hence MIN_PAYLOAD below, asserted explicitly:
 *      if the generated report ever shrinks under it, this test fails loudly asking to
 *      be resized rather than silently degrading into theatre.
 *
 * Verified to fail against the pre-fix commit and pass after it.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const AUDIT = path.join(REPO_ROOT, 'audit', 'audit.mjs');

// Comfortably past Linux's 64 KB pipe buffer — not merely past macOS's 8 KB.
const MIN_PAYLOAD = 128 * 1024;

// Enough synthetic repos to clear MIN_PAYLOAD at roughly 840 bytes of JSON each,
// measured. The padding lengthens each record's path label, which buys payload far
// more cheaply than more directories: the audit shells out to git per repo, so repo
// count drives runtime while label length drives bytes. 180 long-labelled repos reach
// ~150 KB in ~20s, where 300 short-labelled ones needed ~40s for the same margin.
const REPO_COUNT = 180;
const PAD = 'd'.repeat(200);

// Build N throwaway repo directories, each with a project.yml the audit can read.
// They are deliberately NOT git repos: the point is to generate report volume, and
// the resulting findings also exercise the non-zero exit path.
function makeFleet() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-pipe-'));
  const targets = [];
  for (let i = 0; i < REPO_COUNT; i++) {
    const dir = path.join(root, `group${PAD}${i}`, `repo${PAD}${i}`);
    fs.mkdirSync(path.join(dir, '.github'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.github', 'project.yml'),
      'tier: B\ntrunk: main\nproduction: null\nstack: node\n'
    );
    targets.push('--local', dir);
  }
  return { root, targets };
}

// Run the audit with stdout as a PIPE and capture both payload and exit code.
function runPiped(args) {
  try {
    const stdout = execFileSync('node', [AUDIT, ...args], {
      encoding: 'utf8',
      maxBuffer: 1 << 30,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return { stdout, code: 0 };
  } catch (err) {
    // execFileSync throws on a non-zero exit; the captured stdout is still on the error.
    return { stdout: err.stdout || '', code: err.status };
  }
}

test('--json survives a payload larger than the pipe buffer', (t) => {
  const { root, targets } = makeFleet();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const { stdout, code } = runPiped(['--json', ...targets]);

  // Order matters. A regressed tool produces a payload that is BOTH malformed and short,
  // so whichever assertion runs first writes the failure message a maintainer acts on.
  // Parse first: that failure means the bug is back. The size guard runs second, where
  // it can only fire on output that parsed cleanly — i.e. a genuinely shrunken report,
  // which is the one case its "raise REPO_COUNT" advice is correct for.
  let parsed;
  assert.doesNotThrow(() => {
    parsed = JSON.parse(stdout);
  }, `audit --json emitted malformed JSON (${stdout.length}B) — stdout was truncated ` +
     `before it drained. This is the pipe-buffer regression this test exists to catch.`);

  assert.ok(
    stdout.length > MIN_PAYLOAD,
    `payload ${stdout.length}B parsed cleanly but is under the ${MIN_PAYLOAD}B floor, so ` +
      `this test no longer crosses a pipe-buffer boundary and proves nothing. Raise REPO_COUNT.`
  );

  assert.equal(parsed.results.length, REPO_COUNT, 'every audited repo must reach the reader');

  // The exit-code contract is part of the fix: these repos carry findings, so 1.
  assert.equal(code, 1, 'repos with findings must still exit 1');
});

test('--help is not truncated either', (t) => {
  // The usage block is ~12 KB, so this call site had the same defect. Note the payload
  // clears an 8 KB buffer but not a 64 KB one: on Linux this asserts completeness rather
  // than forcing the boundary. The --json test above is the portable boundary test; this
  // one pins the second call site and catches it on small-buffer platforms.
  const { stdout, code } = runPiped(['--help']);

  assert.equal(code, 0, '--help exits 0');
  assert.ok(stdout.length > 8 * 1024, `help text unexpectedly small (${stdout.length}B)`);

  // The last line of the usage block only arrives if the stream fully drained.
  const lastLine = stdout.trimEnd().split('\n').pop();
  assert.match(lastLine, /main/, 'help output ended early — stdout was truncated');
});
