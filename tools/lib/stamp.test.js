'use strict';
/**
 * Tests for the unstamped-workflow heuristic (tools/lib/stamp.js).
 *
 * Run: `node --test tools/lib/` — wired into CI's self-check job.
 *
 * The property under test is not "does it detect copies" but "does it ever accuse a file nobody
 * copied from us". A false positive here ends in advice to run `colab template <x> --force`, which
 * OVERWRITES the accused file — so an over-eager fingerprint is a data-loss bug, not a noisy
 * warning. The fixtures below are reduced from real workflows on a real fleet: each false-positive
 * case is one this heuristic actually produced.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const stamp = require('./stamp.js');
const { workflowProvenance, unstampedFinding, isHandbookItself, WORKFLOW_FINGERPRINTS } = stamp;

const TEMPLATES = new Set(['ci-node', 'ci-laravel', 'ci-python', 'release-tag']);
const REPO_ROOT = path.resolve(__dirname, '..', '..');

// --- fixtures ---------------------------------------------------------------

// A hand-written deploy workflow for a PHP framework app. Never touched a template; contains the
// framework's own codegen command because every app of that stack does.
const HANDWRITTEN_DEPLOY = `name: Deploy
on:
  push:
    tags: ['v*.*.*']
jobs:
  deploy:
    runs-on: self-hosted
    steps:
      - uses: actions/checkout@v4
      - name: Build assets on the runner
        run: |
          php artisan wayfinder:generate --with-form
          npm ci && npm run build
      - name: Rsync to host
        run: rsync -az --delete ./ "$TARGET"
`;

// A hand-written CI that installs gitleaks the obvious way: the upstream release URL.
const HANDWRITTEN_GITLEAKS_CI = `name: CI
on: [push]
jobs:
  gitleaks:
    runs-on: ubuntu-latest
    env:
      GITLEAKS_VERSION: "8.30.1"
    steps:
      - uses: actions/checkout@v4
      - name: Install gitleaks (pinned binary)
        run: |
          curl -sSL -o gitleaks.tar.gz \\
            "https://github.com/gitleaks/gitleaks/releases/download/v\${GITLEAKS_VERSION}/gitleaks_\${GITLEAKS_VERSION}_linux_x64.tar.gz"
      - name: gitleaks detect
        run: gitleaks detect --source . --no-banner
`;

// A genuine, unstamped copy of the Node CI template (stamp line stripped).
const COPIED_CI_NODE = `# CI (Node) — TEMPLATE. Copy me into your repo at .github/workflows/ci.yml.
name: CI
on: [push]
jobs:
  build:
    steps:
      - name: Install gitleaks (pinned release binary)
        run: curl -sSL -o gitleaks.tar.gz "https://github.com/gitleaks/gitleaks/releases/download/x"
      - name: Resolve Node version
        run: echo resolving
      - name: Detect optional scripts
        run: echo detecting
`;

// Prose that merely MENTIONS a step name — documentation, or a comment pointing at another file.
const MENTIONS_ONLY = `name: CI
# See the handbook: this repo does not use its "Resolve Node version" step, we pin in .nvmrc.
on: [push]
jobs:
  build:
    steps:
      - name: Build
        run: npm run build
`;

// --- the reported bug -------------------------------------------------------

test('a hand-written deploy workflow is not ours just because it uses the framework CLI', () => {
  const prov = workflowProvenance(HANDWRITTEN_DEPLOY, 'deploy-xserver', TEMPLATES);
  assert.strictEqual(prov.origin, 'none');
  assert.strictEqual(unstampedFinding(prov), null, 'must produce no finding at all');
});

test('installing gitleaks from its upstream URL is not evidence of handbook lineage', () => {
  const prov = workflowProvenance(HANDWRITTEN_GITLEAKS_CI, 'ci', TEMPLATES);
  assert.strictEqual(prov.origin, 'none');
  assert.strictEqual(unstampedFinding(prov), null);
});

// --- no regression: real copies must still be caught ------------------------

test('a genuine unstamped copy is still flagged, and names the template it came from', () => {
  const prov = workflowProvenance(COPIED_CI_NODE, 'ci', TEMPLATES);
  assert.strictEqual(prov.origin, 'derived');
  assert.strictEqual(prov.template, 'ci-node');
  const finding = unstampedFinding(prov);
  assert.strictEqual(finding.state, 'unstamped');
  assert.match(finding.reason, /colab template ci-node --force/,
    'the advice must name a real template, never a <name> placeholder');
});

test('evidence shared by several templates proves derivation but names no template', () => {
  const shared = `name: CI
jobs:
  a:
    steps:
      - name: Install gitleaks (pinned release binary)
        run: echo hi
`;
  const prov = workflowProvenance(shared, 'ci', TEMPLATES);
  assert.strictEqual(prov.origin, 'derived');
  assert.strictEqual(prov.template, null);
  const finding = unstampedFinding(prov);
  assert.strictEqual(finding.state, 'unstamped');
  assert.doesNotMatch(finding.reason, /--force/,
    'with no template identified there is nothing honest to --force');
});

test('the generic header rule catches a copy of a template this list does not know about', () => {
  // A template added after this fingerprint list was written, keeping the house header.
  const futureCopy = '# Deploy (Xserver) — TEMPLATE. Copy me into your repo at .github/workflows/deploy.yml.\nname: Deploy\n';
  const prov = workflowProvenance(futureCopy, 'deploy-xserver', new Set([...TEMPLATES, 'deploy-xserver']));
  assert.strictEqual(prov.origin, 'derived');
  assert.strictEqual(prov.template, 'deploy-xserver', 'attribution falls back to the filename only once content proved lineage');
});

test('evidence cites the most specific marker, not every overlapping one', () => {
  const prov = workflowProvenance(COPIED_CI_NODE, 'ci', TEMPLATES);
  assert.ok(prov.evidence.includes('CI (Node) — TEMPLATE. Copy me into your repo'));
  assert.ok(!prov.evidence.includes('— TEMPLATE. Copy me into your repo'),
    'the generic header always co-fires; quoting both reads as two separate findings');
});

// --- step names are matched as steps, not as prose --------------------------

test('a step name mentioned in a comment does not count as evidence', () => {
  assert.strictEqual(workflowProvenance(MENTIONS_ONLY, 'ci', TEMPLATES).origin, 'none');
});

test('a quoted step name still counts', () => {
  const quoted = 'jobs:\n  a:\n    steps:\n      - name: "Resolve Node version"\n';
  assert.strictEqual(workflowProvenance(quoted, 'ci', TEMPLATES).template, 'ci-node');
});

// --- the #16 hazard: a filename is not a lineage ----------------------------

test('a filename matching a template is NOT sufficient evidence', () => {
  // Simulates the state after a deploy template is added to the handbook: repos already have
  // their own hand-written file of that name. Matching on the name would advise overwriting it.
  const withDeployTemplate = new Set([...TEMPLATES, 'deploy-xserver']);
  const prov = workflowProvenance(HANDWRITTEN_DEPLOY, 'deploy-xserver', withDeployTemplate);
  assert.strictEqual(prov.origin, 'name-only');

  const finding = unstampedFinding(prov);
  assert.strictEqual(finding.state, 'unrelated');
  assert.notStrictEqual(finding.state, 'unstamped', 'a name clash must never be reported as a copy');
  assert.match(finding.reason, /do NOT/);
});

test('a name match plus real content evidence is still a copy', () => {
  const withDeployTemplate = new Set([...TEMPLATES, 'deploy-xserver']);
  const prov = workflowProvenance(COPIED_CI_NODE, 'ci-node', withDeployTemplate);
  assert.strictEqual(prov.origin, 'derived');
});

// --- the fingerprint list must stay true of the templates it claims ---------

test('every fingerprint still occurs in the template it is attributed to', () => {
  for (const fp of WORKFLOW_FINGERPRINTS) {
    if (!fp.template) continue; // unattributed markers are checked below
    const file = path.join(REPO_ROOT, 'templates', `${fp.template}.yml`);
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(stamp.fingerprintHits(text, fp),
      `fingerprint "${fp.marker}" no longer appears in templates/${fp.template}.yml — ` +
      'a fingerprint that outlived its template silently stops detecting copies');
  }
});

test('unattributed fingerprints occur in more than one template (else attribute them)', () => {
  const templateTexts = [...TEMPLATES].map((n) =>
    fs.readFileSync(path.join(REPO_ROOT, 'templates', `${n}.yml`), 'utf8'));
  for (const fp of WORKFLOW_FINGERPRINTS.filter((f) => !f.template)) {
    const hits = templateTexts.filter((t) => stamp.fingerprintHits(t, fp)).length;
    assert.ok(hits > 1,
      `"${fp.marker}" matches ${hits} template(s) — if it identifies exactly one, attribute it ` +
      'so the advice can name it');
  }
});

// --- the handbook is never its own adopter ----------------------------------
//
// A stamp asserts "copied from version X". The handbook IS X, so reporting it as an unstamped copy
// is not merely noisy: acting on the advice stamps its own conventions block as a paste of itself,
// turning an honest advisory into a false claim. Both tools must refuse, and they must refuse for
// the same reason — this used to be duplicated, and the copies drifted.

/** A throwaway git repo plus a worktree of it: the same repo under two different paths. */
function tempRepoWithWorktree(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-self-'));
  const main = path.join(base, 'main');
  const wt = path.join(base, 'wt');
  const git = (args, cwd) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'ignore'] });
  fs.mkdirSync(main);
  git(['init', '-q', '-b', 'main'], main);
  git(['config', 'user.email', 'test@example.invalid'], main);
  git(['config', 'user.name', 'test'], main);
  fs.writeFileSync(path.join(main, 'README.md'), 'x\n');
  git(['add', '-A'], main);
  git(['commit', '-qm', 'init'], main);
  git(['worktree', 'add', '-q', '--detach', wt], main);
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  return { main, wt };
}

test('the handbook recognises itself through a worktree, not just by path string', (t) => {
  const { main, wt } = tempRepoWithWorktree(t);
  assert.ok(isHandbookItself(main, main), 'the same path is trivially itself');
  // The real failure: the CLI resolves its root from its own file (the worktree) while the fleet
  // registry names the main checkout. Two spellings, one repo.
  assert.ok(isHandbookItself(main, wt), 'registry path vs a worktree root — same repo');
  assert.ok(isHandbookItself(wt, main), 'and symmetrically');
});

test('an unrelated repo is not the handbook', (t) => {
  const { main } = tempRepoWithWorktree(t);
  const other = tempRepoWithWorktree(t).main;
  assert.strictEqual(isHandbookItself(other, main), false);
});

test('a non-git path never claims to be the handbook', (t) => {
  const { main } = tempRepoWithWorktree(t);
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-plain-'));
  t.after(() => fs.rmSync(plain, { recursive: true, force: true }));
  assert.strictEqual(isHandbookItself(plain, main), false);
  assert.strictEqual(isHandbookItself(main, plain), false);
});

test('`colab update` skips the handbook itself, even run from a worktree of it', () => {
  // End-to-end through the real CLI and the real repo, with a throwaway registry naming the
  // handbook's MAIN checkout. Run from a worktree (a dev machine) this reproduces the original
  // bug exactly; run from a plain checkout (CI) it is the trivial path-equality case. Both must
  // report the handbook as skipped, never as an artifact.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-home-'));
  try {
    const mainCheckout = stamp.gitCommonDir(REPO_ROOT).replace(/\/\.git$/, '');
    fs.writeFileSync(path.join(home, 'repos.txt'), `${mainCheckout}\n`);
    const r = spawnSync(process.execPath, [path.join(REPO_ROOT, 'tools', 'colab'), 'update', '--json'],
      { env: { ...process.env, COLAB_HOME: home }, encoding: 'utf8' });
    const out = JSON.parse(r.stdout);
    const row = out.repos.find((x) => x.path === mainCheckout);
    assert.ok(row, 'the handbook should appear in the sweep');
    assert.strictEqual(row.kind, 'handbook');
    assert.deepStrictEqual(row.artifacts, [], 'the handbook must never be assessed as an adopter');
    assert.strictEqual(out.summary.unstamped, 0);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('neither caller keeps its own copy of the self test', () => {
  // The duplication is what allowed the two to disagree: the audit compared git common dirs while
  // the CLI compared path strings, so the handbook was exempt in one tool and audited in the other.
  const cli = fs.readFileSync(path.join(REPO_ROOT, 'tools', 'colab'), 'utf8');
  const audit = fs.readFileSync(path.join(REPO_ROOT, 'audit', 'audit.mjs'), 'utf8');
  assert.ok(!/===\s*ctx\.handbookRoot/.test(cli),
    'the CLI must not path-compare its way to "self" — use stamp.isHandbookItself');
  assert.ok(!/function gitCommonDir/.test(audit),
    'the audit must not re-implement git-common-dir identity — import it');
  assert.ok(/stamp\.isHandbookItself/.test(cli) && /stamp\.isHandbookItself/.test(audit),
    'both callers must route through the shared predicate');
});

test('no fingerprint is a bare stack/tool name', () => {
  // The admission test, encoded: these strings were removed because they identify a framework or
  // a third-party tool rather than our text. Nothing may reintroduce them as markers.
  const banned = ['wayfinder:generate', 'gitleaks/gitleaks/releases/download'];
  for (const fp of WORKFLOW_FINGERPRINTS) {
    for (const b of banned) {
      assert.notStrictEqual(fp.marker, b, `"${b}" identifies the stack, not the handbook`);
    }
  }
});

// --- the frozen CLI copy ----------------------------------------------------
//
// `install.sh --tools` copies the CLI to <COLAB_HOME>/bin so an always-on service never resolves it
// through a working tree. That copy is the one stamped artifact nobody looks at: the service keeps
// running the old CLI perfectly happily, which is what freezing it was FOR. So the only thing that
// will ever say it is old is classifyFrozen, and it must say so on exactly the right git facts.

/** A throwaway handbook: a git repo with tools/ files, tags on demand. */
function tempHandbook(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-hb-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] });
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'test');
  write('tools/colab', '#!/usr/bin/env node\n');
  write('tools/lib/state.js', 'module.exports = {};\n');
  write('README.md', 'docs\n');
  git('add', '-A'); git('commit', '-qm', 'init');
  const commit = (rel, text, msg) => { write(rel, text); git('add', '-A'); git('commit', '-qm', msg); };
  return { root, git, commit, hb: () => stamp.handbookInfo(root) };
}

test('a frozen copy stamped at the current version is current', (t) => {
  const h = tempHandbook(t);
  h.git('tag', 'v1.0.0');
  const c = stamp.classifyFrozen({ root: h.root, hb: h.hb(), stampVersion: 'v1.0.0' });
  assert.strictEqual(c.state, 'current');
});

test('a handbook release that touched no CLI code does not make a frozen copy behind', (t) => {
  // The whole reason this asks git rather than comparing version strings: otherwise every release
  // marks every machine stale, and people learn to ignore the line.
  const h = tempHandbook(t);
  h.git('tag', 'v1.0.0');
  h.commit('README.md', 'docs, revised\n', 'docs: prose only');
  h.git('tag', 'v1.1.0');
  const c = stamp.classifyFrozen({ root: h.root, hb: h.hb(), stampVersion: 'v1.0.0' });
  assert.strictEqual(c.state, 'current');
  assert.match(c.reason, /unchanged since v1\.0\.0/);
});

test('a change to the CLI script makes a frozen copy behind', (t) => {
  const h = tempHandbook(t);
  h.git('tag', 'v1.0.0');
  h.commit('tools/colab', '#!/usr/bin/env node\n// new\n', 'feat: cli');
  h.git('tag', 'v1.1.0');
  const c = stamp.classifyFrozen({ root: h.root, hb: h.hb(), stampVersion: 'v1.0.0' });
  assert.strictEqual(c.state, 'behind');
  assert.strictEqual(c.from, 'v1.0.0');
  assert.strictEqual(c.to, 'v1.1.0');
});

test('a change under tools/lib counts too — the frozen copy is the whole toolchain', (t) => {
  // lib/ is copied alongside the script; a fix that lives entirely in a library would otherwise
  // report "current" while every service on the machine still runs the bug.
  const h = tempHandbook(t);
  h.git('tag', 'v1.0.0');
  h.commit('tools/lib/state.js', 'module.exports = { fixed: true };\n', 'fix: state');
  h.git('tag', 'v1.1.0');
  assert.strictEqual(stamp.classifyFrozen({ root: h.root, hb: h.hb(), stampVersion: 'v1.0.0' }).state, 'behind');
});

test('a frozen copy with no stamp is n-a, never behind and never current', (t) => {
  const h = tempHandbook(t);
  h.git('tag', 'v1.0.0');
  const c = stamp.classifyFrozen({ root: h.root, hb: h.hb(), stampVersion: null });
  assert.strictEqual(c.state, 'n-a');
  assert.match(c.reason, /STAMP/);
});

test('a stamp naming a tag this checkout lacks is n-a, not behind', (t) => {
  // Fetch your tags; do not guess. Guessing "behind" here would advise re-freezing on no evidence.
  const h = tempHandbook(t);
  h.git('tag', 'v1.0.0');
  const c = stamp.classifyFrozen({ root: h.root, hb: h.hb(), stampVersion: 'v9.9.9-nope' });
  assert.strictEqual(c.state, 'n-a');
});

test('a stamp NEWER than the handbook is n-a — that machine froze from ahead of here', (t) => {
  const h = tempHandbook(t);
  h.git('tag', 'v1.0.0');
  h.commit('tools/colab', '#!/usr/bin/env node\n// x\n', 'feat: cli');
  h.git('tag', 'v2.0.0');
  h.git('checkout', '-q', 'v1.0.0');
  const c = stamp.classifyFrozen({ root: h.root, hb: stamp.handbookInfo(h.root), stampVersion: 'v2.0.0' });
  assert.strictEqual(c.state, 'n-a');
  assert.match(c.reason, /NEWER/);
});

test('an untagged handbook deactivates the comparison, as it does for templates', (t) => {
  const h = tempHandbook(t);
  const c = stamp.classifyFrozen({ root: h.root, hb: h.hb(), stampVersion: 'v1.0.0' });
  assert.strictEqual(c.state, 'n-a');
  assert.match(c.reason, /untagged/);
});

// --- end to end through the real CLI ----------------------------------------

/** Run `colab update --json` against a throwaway COLAB_HOME. Returns the parsed report. */
function updateWithHome(t, setup) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-frozen-home-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  fs.writeFileSync(path.join(home, 'repos.txt'), `${REPO_ROOT}\n`);
  if (setup) setup(home);
  const r = spawnSync(process.execPath, [path.join(REPO_ROOT, 'tools', 'colab'), 'update', '--json'],
    { env: { ...process.env, COLAB_HOME: home }, encoding: 'utf8' });
  return { report: JSON.parse(r.stdout), status: r.status, home };
}

test('`colab update` reports a machine with no frozen copy as absent, not as an error', (t) => {
  const { report } = updateWithHome(t, null);
  assert.strictEqual(report.frozen.installed, false);
  assert.strictEqual(report.frozen.state, 'absent');
  assert.match(report.frozen.reason, /install\.sh --tools/);
});

test('`colab update` reads the frozen stamp from COLAB_HOME, not from a hardcoded ~/.colab', (t) => {
  // If this ever regresses, every test on a developer machine silently starts asserting against
  // the real frozen copy that live sessions are using.
  const { report } = updateWithHome(t, (home) => {
    const bin = path.join(home, 'bin');
    fs.mkdirSync(bin, { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, 'tools', 'colab'), path.join(bin, 'colab'));
    fs.writeFileSync(path.join(bin, stamp.FROZEN_STAMP_FILE),
      stamp.stampLine(stamp.FROZEN_STAMP_NAME, stamp.handbookInfo(REPO_ROOT).version));
  });
  assert.strictEqual(report.frozen.installed, true);
  assert.ok(report.frozen.path.includes(report.registry.replace(/\/repos\.txt$/, '')),
    'the reported path must sit under the COLAB_HOME the registry came from');
  // Deliberately asserts WHERE the stamp was read from, never what state it classified to.
  // State belongs to the fixture tests above, which control the git history they compare
  // against. This one runs against the live repo, so any state assertion here reads as
  // `behind` for every commit that touches tools/ between two tags — including the commit
  // that added this test. Version equality was never the classifier: see the pair at
  // 'a handbook release that touched no CLI code…' and 'a change to the CLI script…'.
});
