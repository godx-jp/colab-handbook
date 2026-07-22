'use strict';
/**
 * notify.js — OPTIONAL, best-effort event push to an external observer.
 *
 * Configure `notifyUrl` in ~/.colab/config.json and the state-changing commands (claim, release,
 * ship, worktree new, worktree rm) each POST one small JSON event as they succeed. Leave it unset
 * and this module makes no network call of any kind — that is the default and it is absolute.
 *
 * ── What this is NOT ──────────────────────────────────────────────────────────────────────────
 * It is not a transport anyone may depend on. The observers this exists for already discover every
 * one of these facts on their own, by polling ~/.colab/state.json on a timer; the push only sharpens
 * the timestamp from "within a tick" to "the second it happened", and records which host did it. So
 * there is deliberately no retry, no queue, no response-body read, and no error surfaced. Anything
 * that would make the push load-bearing — a caller that waits on it, a receiver that needs it — is a
 * design error upstream, not a missing feature here.
 *
 * ── What a dropped event actually costs — and it is NOT one tick for every kind ────────────────
 * For a COLAB-LOCAL fact (a worktree, a port, a claim — all in ~/.colab/state.json) the fallback is
 * that state file, polled on a timer, so a lost event costs one tick and nothing else. But some
 * events report a PROVIDER-SIDE fact colab does not keep locally: a label it wrote (deps-checked,
 * in-progress), an issue it closed. There the fallback is not state.json — it is re-reading the
 * provider, which is eventually consistent: measured on a live fleet, a label written via the REST
 * API was still absent from a fresh GraphQL read EIGHT MINUTES later. So a dropped event for a
 * provider-side fact costs minutes of staleness, not a tick. This is still acceptable under
 * best-effort — the push is a latency optimisation, never the system of record — but the cost is
 * "the provider's read-after-write lag", not "one poll", and a receiver must be built for that.
 *
 * ── Why a detached child process, and not just fetch() ────────────────────────────────────────
 * The CLI ends at `process.exit(main(...))`, a hard exit that kills in-flight sockets. An
 * un-awaited fetch would therefore be silently dropped for exactly the operations worth reporting,
 * and awaiting it would mean plumbing async through a fully synchronous CLI *and* letting a hung
 * endpoint delay a command that has already done its real work. A detached, unref'd child owns the
 * request instead: the parent's cost is the spawn call, the child outlives the exit, and a receiver
 * that hangs is the child's problem — bounded by SEND_TIMEOUT_MS, invisible to the user.
 *
 * ── The kind vocabulary is the receiver's, and it is CLOSED ───────────────────────────────────
 * Receivers reject an unrecognised `kind` with 400 and write nothing. That rejection is correct and
 * we do not work around it: a journal read by machine counts events by kind, so two names for one
 * fact makes every future count quietly half-right. Hence ACTION_KIND below is a fixed map, not a
 * string built at the call site. Adding an action means agreeing a kind with the receiver first.
 */

const { spawn } = require('child_process');

/** Request timeout inside the child. Bounds a hung receiver; never observed by the parent. */
const SEND_TIMEOUT_MS = 200;

/**
 * colab action → the receiver's event kind. Deliberately not 1:1 with command names.
 *
 * `ship` maps to worktree.state-changed because no ship-shaped kind exists and inventing one is the
 * failure the closed vocabulary prevents. The observer's `intent.*` kinds describe ITS OWN button
 * lifecycle — an event claiming to be an intent while originating out here would be a false record.
 */
const ACTION_KIND = Object.freeze({
  'claim': 'claim.appeared',
  'release': 'claim.released',
  'ship': 'worktree.state-changed',
  'worktree-new': 'worktree.appeared',
  'worktree-rm': 'worktree.removed',
});

/** Actions this module knows how to report. Exported so a caller can be checked against it. */
const ACTIONS = Object.freeze(Object.keys(ACTION_KIND));

/**
 * Build the event body for an action. Pure — no I/O — so the shape is testable without a receiver.
 * Returns null for an unknown action, which is how an unrecognised kind is prevented from ever
 * being sent rather than being sent and 400'd.
 *
 * Absent fields are omitted, not sent as null: the receiver coerces missing to null itself, and an
 * explicit null in a payload reads like a measured absence rather than a field we never had.
 */
function buildEvent(action, fields, ts) {
  const kind = ACTION_KIND[action];
  if (!kind) return null;
  const f = fields || {};
  const ev = { kind, ts: ts || new Date().toISOString() };
  if (f.repo) ev.repo = String(f.repo);
  if (Number.isInteger(f.issue) && f.issue > 0) ev.issue = f.issue;
  if (f.worktree) ev.worktree = String(f.worktree);
  if (f.session) ev.session = String(f.session);
  if (f.payload != null) ev.payload = f.payload;
  return ev;
}

/**
 * The script the child runs. Kept as one string, taking url and body from argv rather than being
 * interpolated into source — the body carries branch and worktree names typed by a user, and
 * building code out of them is how a quoting bug becomes code execution. spawn() with an argv array
 * never involves a shell, so nothing here is re-parsed.
 */
const CHILD_SCRIPT = `
const url = process.argv[1], body = process.argv[2];
try {
  const lib = require(url.startsWith('https:') ? 'https' : 'http');
  const req = lib.request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
    timeout: ${SEND_TIMEOUT_MS},
  }, (res) => { res.resume(); });
  req.on('error', () => {});
  req.on('timeout', () => req.destroy());
  req.end(body);
} catch (_) { /* best-effort: a malformed URL is silence, never a crash */ }
`;

/**
 * Fire one event. Returns a string saying what happened, for tests and for --json callers; NOTHING
 * about the send is reported to the user, because a warning about a secondary signal is noise on
 * the output of a command that succeeded.
 *
 *   'silent'  no notifyUrl configured — not one network call was made
 *   'skipped' unknown action, or a URL we will not send to
 *   'sent'    handed to a detached child; delivery is neither awaited nor known
 *
 * @param {object} cfg   loaded config (state.loadConfig())
 * @param {string} action  one of ACTIONS
 * @param {object} fields  { repo, issue, worktree, session, payload }
 * @param {object} [deps]  { spawn } — injectable so tests never open a socket
 */
function notify(cfg, action, fields, deps) {
  // The unconfigured path must return before anything else can throw, allocate, or resolve a host.
  // "Absolute silence" is the documented default, so it is checked first and checked cheaply.
  const url = cfg && typeof cfg.notifyUrl === 'string' ? cfg.notifyUrl.trim() : '';
  if (!url) return 'silent';
  if (!/^https?:\/\//i.test(url)) return 'skipped';

  const ev = buildEvent(action, fields);
  if (!ev) return 'skipped';

  const spawnFn = (deps && deps.spawn) || spawn;
  try {
    const child = spawnFn(process.execPath, ['-e', CHILD_SCRIPT, '--', url, JSON.stringify(ev)], {
      detached: true,
      stdio: 'ignore',
    });
    // unref() is what makes this fire-and-forget rather than fire-and-wait: without it the parent's
    // event loop would keep the child in its dependants and the exit would block on a hung receiver.
    if (child && typeof child.unref === 'function') child.unref();
    return 'sent';
  } catch (_) {
    // Spawning can fail for reasons that have nothing to do with the user's command (EAGAIN under
    // process pressure, a locked-down execPath). Swallowing is the whole contract.
    return 'skipped';
  }
}

module.exports = { notify, buildEvent, ACTION_KIND, ACTIONS, SEND_TIMEOUT_MS };
