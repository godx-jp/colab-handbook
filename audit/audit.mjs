#!/usr/bin/env node
// colab-handbook convention audit.
//
// This is NOT in-repo CI. It is a CLI you run locally (or on a schedule) that audits
// MANY repositories across MULTIPLE owners at once — godx-jp, vo2vo, tiximax-net,
// rika-entertainment, betoya-jp — plus local-only repos that have no GitHub presence
// at all. That breadth is the point: the failure mode it exists to catch is drift
// BETWEEN repos, which no single repo's CI can ever see.
//
// Why it left CI: a convention guard living inside each repo can only check the repo
// it ships in, has to be copied everywhere to be useful, and rots differently in each
// copy. One external auditor with one source of truth is simpler and honest about
// what it is — an advisory report, not a gate.
//
// Dependencies: none. Plain Node, plus `gh` shelled out for GitHub API reads (only
// when a repo is given as an owner/name slug rather than a local path).
//
// It also runs RECONCILIATION checks: copied handbook artifacts carry a stamp naming
// the template and the handbook version they were copied at (see `colab template`).
// This audit compares each stamp against the handbook's own git history and flags a
// repo whose copy is now behind a changed template — so an adopted repo finds out via
// the audit, not by luck. The handbook is this checkout (the audit knows its own
// location); its current version is `git describe --tags --abbrev=0`.
//
// Repo list resolution (highest precedence first):
//   1. --config <path>            explicit; errors if missing
//   2. ~/.colab/repos.txt         machine-local fleet registry (PRIVATE, not committed)
//   3. <this dir>/repos.txt       the committed neutral example (fallback only)
// (COLAB_HOME overrides ~/.colab, matching the colab CLI.)
//
// Usage:
//   node audit.mjs                       # audit everything in the resolved repo list
//   node audit.mjs --local ~/Future/foo  # audit one local path, ad hoc
//   node audit.mjs --config other.txt    # a different repo list
//   node audit.mjs --json                # machine-readable
//   node audit.mjs --quiet               # only repos with findings
//
// Exit code: 0 when every repo passes, 1 when any repo has a finding, 2 on a usage
// error. Findings never crash the run — a repo missing project.yml is a result, not
// an exception.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve, basename, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
// audit/ lives inside the handbook checkout; COLAB_HANDBOOK overrides for running the
// audit from elsewhere (or for tests that point at a scratch handbook).
const HANDBOOK_ROOT = process.env.COLAB_HANDBOOK ? resolve(process.env.COLAB_HANDBOOK) : resolve(HERE, "..");
const COLAB_HOME = process.env.COLAB_HOME || join(homedir(), ".colab");

// ---------------------------------------------------------------------------- args

function parseArgs(argv) {
  // config === null means "resolve from the precedence chain"; a string means explicit.
  const opts = { config: null, locals: [], slugs: [], json: false, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") opts.json = true;
    else if (a === "--quiet" || a === "-q") opts.quiet = true;
    else if (a === "--local") {
      const p = argv[++i];
      if (!p) die("--local needs a path");
      opts.locals.push(p);
    } else if (a === "--config" || a === "-c") {
      const p = argv[++i];
      if (!p) die("--config needs a path");
      opts.config = p;
    } else if (a === "--help" || a === "-h") {
      console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").filter((l) => l.startsWith("//")).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
      process.exit(0);
    } else if (a.startsWith("-")) die(`unknown flag: ${a}`);
    else opts.slugs.push(a); // bare argument = slug or path
  }
  return opts;
}

// Resolve the repo-list file per the documented precedence. Returns { path, source }
// or null when auditing only --local / positional targets (no list needed).
function resolveConfig(opts) {
  if (opts.config) {
    if (!existsSync(opts.config)) die(`config not found: ${opts.config}`);
    return { path: opts.config, source: "--config" };
  }
  const local = join(COLAB_HOME, "repos.txt");
  if (existsSync(local)) return { path: local, source: COLAB_HOME + "/repos.txt" };
  const bundled = join(HERE, "repos.txt");
  return { path: bundled, source: "bundled example (audit/repos.txt)" };
}

function die(msg) {
  console.error(`audit: ${msg}`);
  process.exit(2);
}

// ------------------------------------------------------------------- tiny YAML read
//
// project.yml is a flat mapping of scalars by design. A hand-rolled reader keeps this
// tool dependency-free; anything it cannot understand is reported as a parse finding
// rather than silently ignored, so the narrowness is visible instead of dangerous.

function parseFlatYaml(text) {
  const out = {};
  const problems = [];
  text.split(/\r?\n/).forEach((raw, idx) => {
    const line = raw.replace(/\t/g, "  ");
    if (!line.trim() || /^\s*#/.test(line)) return;
    if (/^\s+/.test(line)) {
      problems.push(`line ${idx + 1}: nested/indented YAML is not supported by this reader (flat key: value only)`);
      return;
    }
    const m = line.match(/^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
    if (!m) {
      problems.push(`line ${idx + 1}: not a "key: value" pair -> ${line.trim()}`);
      return;
    }
    let [, key, val] = m;
    val = val.replace(/\s+#.*$/, "").trim(); // strip trailing comment
    if (/^".*"$/.test(val) || /^'.*'$/.test(val)) val = val.slice(1, -1);
    else if (val === "" || val === "null" || val === "~") val = null;
    else if (val === "true") val = true;
    else if (val === "false") val = false;
    out[key] = val;
  });
  return { data: out, problems };
}

// ------------------------------------------------------------------ version helpers

// "^8.3" ">=22.1 <23" "v22" "22.x" -> "8.3" "22.1" "22" "22"
function normaliseVersion(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  const m = s.match(/(\d+(?:\.\d+)*)/);
  return m ? m[1] : null;
}

function major(v) {
  const n = normaliseVersion(v);
  return n ? n.split(".")[0] : null;
}

function isRange(s) {
  const t = String(s).trim();
  return /^[\^~><=]/.test(t) || /[\s|]/.test(t) || /\.(\*|x)$/i.test(t);
}

function cmpParts(a, b) {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

// Agreement at the precision both sides actually state. "22" vs "22.1" agree —
// nobody declared the minor, so nobody is claiming anything about it. "8.3" vs "8.4"
// DISagree, because both sides stated a minor and they differ. This matters: a Node
// major is the unit that breaks builds, while PHP minors are real feature releases.
function prefixAgree(a, b) {
  const A = (normaliseVersion(a) || "").split(".").map(Number);
  const B = (normaliseVersion(b) || "").split(".").map(Number);
  if (!A.length || !B.length) return true;
  const n = Math.min(A.length, B.length);
  for (let i = 0; i < n; i++) if (A[i] !== B[i]) return false;
  return true;
}

// Does a concrete version satisfy a manifest constraint like "^8.3", "~22.1",
// ">=22 <23"? Whitespace-separated clauses are ANDed, which is how both npm and
// composer read them. Anything unparseable returns true — this tool reports drift,
// it does not invent violations out of syntax it does not understand.
function satisfiesConstraint(version, constraint) {
  const v = normaliseVersion(version);
  if (!v) return true;
  const vp = v.split(".").map(Number);
  const clauses = String(constraint).trim().split(/\s+/).filter(Boolean);
  if (!clauses.length) return true;
  return clauses.every((cl) => {
    const m = cl.match(/^(\^|~|>=|<=|>|<|=)?v?(\d+(?:\.\d+)*)/);
    if (!m) return true;
    const op = m[1] || "=";
    const t = m[2].split(".").map(Number);
    const c = cmpParts(vp, t);
    switch (op) {
      case "^": // same major, at or above
        return vp[0] === t[0] && c >= 0;
      case "~": // same major.minor (when a minor was given), at or above
        return vp[0] === t[0] && (t.length < 2 || vp[1] === t[1]) && c >= 0;
      case ">=": return c >= 0;
      case ">": return c > 0;
      case "<=": return c <= 0;
      case "<": return c < 0;
      default: return prefixAgree(v, m[2]);
    }
  });
}


// ------------------------------------------------------- handbook version + stamps
//
// Reconciliation rests on two facts the audit can establish locally:
//   1. The handbook's CURRENT version — `git describe --tags --abbrev=0` in this
//      checkout. Before any tag exists that command fails; we then treat the version
//      as `v0` and mark the handbook "untagged", which DEACTIVATES stamp comparisons
//      (there is no real version line to compare against) rather than failing.
//   2. Whether a template CHANGED since a given stamp — `git log <stamp>..HEAD` scoped
//      to that template's file. Non-empty history = the adopter's copy is behind.

function gitIn(root, args) {
  try {
    return {
      ok: true,
      out: execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(),
    };
  } catch {
    return { ok: false, out: "" };
  }
}

function handbookInfo() {
  const isGit = gitIn(HANDBOOK_ROOT, ["rev-parse", "--show-toplevel"]).ok;
  if (!isGit) return { root: HANDBOOK_ROOT, hasGit: false, untagged: true, version: "v0" };
  const d = gitIn(HANDBOOK_ROOT, ["describe", "--tags", "--abbrev=0"]);
  if (!d.ok || !d.out) return { root: HANDBOOK_ROOT, hasGit: true, untagged: true, version: "v0" };
  return { root: HANDBOOK_ROOT, hasGit: true, untagged: false, version: d.out };
}

// Template stems present in the handbook (e.g. "ci-node", "ci-laravel", "release-tag").
function templateNames() {
  try {
    return new Set(
      readdirSync(join(HANDBOOK_ROOT, "templates"))
        .filter((f) => /\.ya?ml$/.test(f))
        .map((f) => f.replace(/\.ya?ml$/, "")),
    );
  } catch {
    return new Set();
  }
}

// vX.Y.Z comparison; missing components count as 0. Non-numeric junk sorts as 0 so a
// malformed stamp never throws.
function cmpSemver(a, b) {
  const norm = (s) => String(s).replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
  return cmpParts(norm(a), norm(b));
}

// Did any of the given template files change between the stamped version and HEAD?
// Returns { verifiable, changed }. verifiable=false when the stamped ref does not
// resolve in this checkout (a tag we don't have) — reported, never guessed.
function templateChangedSince(files, sinceRef) {
  const resolvable = gitIn(HANDBOOK_ROOT, ["rev-parse", "--verify", "--quiet", sinceRef + "^{commit}"]).ok;
  if (!resolvable) return { verifiable: false, changed: false };
  const log = gitIn(HANDBOOK_ROOT, ["log", "--oneline", `${sinceRef}..HEAD`, "--", ...files]);
  return { verifiable: true, changed: log.ok && log.out.length > 0 };
}

// First-line-ish workflow stamp: `# colab-handbook: <name> @ <version>`.
function parseWorkflowStamp(text) {
  if (!text) return null;
  const m = text.match(/#\s*colab-handbook:\s*([A-Za-z0-9._-]+)\s*@\s*(v?[0-9][0-9A-Za-z.\-+]*)/);
  return m ? { name: m[1], version: m[2] } : null;
}

// CLAUDE-block stamp: `<!-- colab-handbook @ <version> -->`.
function parseClaudeStamp(text) {
  if (!text) return null;
  const m = text.match(/<!--\s*colab-handbook\s*@\s*(v?[0-9][0-9A-Za-z.\-+]*)\s*-->/);
  return m ? { version: m[1] } : null;
}

// Content fingerprints that mark a workflow/CLAUDE file as a handbook derivative even
// when someone renamed the file or pasted the block without the stamp. Precise on
// purpose: better to miss an unstamped copy than to nag an unrelated ci.yml.
const WORKFLOW_FINGERPRINTS = [
  "gitleaks/gitleaks/releases/download", // our exact pinned-binary install
  "wayfinder:generate",                  // ci-laravel bootstrap
  "Build grouped release summary",       // release-tag
  "Resolve Node version",                // ci-node toolchain step
  "Resolve toolchain versions",          // ci-laravel toolchain step
];
function looksLikeHandbookWorkflow(text, stem, tmplNames) {
  if (tmplNames.has(stem)) return true;
  if (!text) return false;
  return WORKFLOW_FINGERPRINTS.some((s) => text.includes(s));
}

// A CLAUDE.md that pasted the conventions block (the "follows the colab-handbook
// conventions" line is unique to templates/repo-CLAUDE-block.md).
function looksLikeHandbookClaude(text) {
  return !!text && /follows the \[?colab-handbook/i.test(text);
}

// Run all stamp/reconciliation checks for one repo, pushing findings via fail/warn.
// Silent when there is nothing to say (the common, healthy case).
function checkStamps(src, hb, tmplNames, fail, warn) {
  const cur = hb.version;

  const compareStamp = (kind, name, stampVersion, files) => {
    // Deactivated while the handbook is untagged — a global note already says so.
    if (hb.untagged || !hb.hasGit) return;
    if (name !== null && !tmplNames.has(name)) {
      warn(`${kind} stamped @ ${stampVersion} names unknown template "${name}" — not in handbook templates/`);
      return;
    }
    if (cmpSemver(stampVersion, cur) > 0) {
      warn(`${kind} stamped @ ${stampVersion} is NEWER than handbook current ${cur} — clock skew or a hand-edited stamp`);
      return;
    }
    const { verifiable, changed } = templateChangedSince(files, stampVersion);
    if (!verifiable) {
      warn(`${kind} stamped @ ${stampVersion}, a version not in this handbook checkout — cannot verify drift (fetch tags, or re-copy)`);
      return;
    }
    if (changed) {
      fail(`${kind} copied @ ${stampVersion} — template changed since (${cur}): review, re-copy via colab template`);
    }
  };

  // --- workflow copies ---
  for (const wf of src.listDir(".github/workflows").filter((f) => /\.ya?ml$/.test(f))) {
    const text = src.readFile(`.github/workflows/${wf}`);
    const stem = wf.replace(/\.ya?ml$/, "");
    const stamp = parseWorkflowStamp(text);
    if (stamp) {
      compareStamp(`${wf}`, stamp.name, stamp.version, [`templates/${stamp.name}.yml`, `templates/${stamp.name}.yaml`]);
    } else if (looksLikeHandbookWorkflow(text, stem, tmplNames)) {
      warn(`${wf} unstamped — looks copied from the handbook but cannot track template drift; re-copy via colab template`);
    }
  }

  // --- CLAUDE.md conventions block ---
  const claude = src.readFile("CLAUDE.md");
  if (claude) {
    const stamp = parseClaudeStamp(claude);
    if (stamp) {
      compareStamp("CLAUDE block", null, stamp.version, ["templates/repo-CLAUDE-block.md"]);
    } else if (looksLikeHandbookClaude(claude)) {
      warn("CLAUDE.md has the conventions block but no colab-handbook stamp — cannot track handbook drift; re-paste the current block");
    }
  }
}

// -------------------------------------------------------- workflow `on:` triggers
//
// project.yml gets a flat reader; a GitHub workflow's `on:` block is nested, so it
// gets its own pragmatic parser. Workflows are machine-formatted enough that a small
// indentation-aware scan (not a full YAML engine) reads triggers reliably. We only
// need a few facts per workflow: which events fire it, and — for push and
// pull_request — the branch/tag filter lists. Everything else is ignored on purpose.
//
// Returns { found, events:Set,
//           pushBranches:[]|null, pushBranchesIgnore:[]|null, pushTags:[]|null,
//           prBranches:[]|null }.
// A null list means the filter is ABSENT. For push, absent branches + absent tags =
// "all branches" (a bare `push:` fires on every branch). Absent branches but PRESENT
// tags = "tags only" — no branch push at all (a release/tag workflow).
function parseWorkflowOn(text) {
  const res = { found: false, events: new Set(), pushBranches: null, pushBranchesIgnore: null, pushTags: null, prBranches: null };
  if (!text) return res;
  const all = text.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < all.length; i++) {
    // top-level `on:` at column 0 (YAML also lets it be quoted).
    if (/^(on|["']on["'])\s*:/.test(all[i])) { start = i; break; }
  }
  if (start === -1) return res;
  res.found = true;
  const header = all[start];
  const inline = header.slice(header.indexOf(":") + 1).replace(/#.*$/, "").trim();

  // Inline forms `on: push` / `on: [push, pull_request]` carry no branch filters.
  if (inline) {
    const items = inline.startsWith("[") ? inline.replace(/^\[|\].*$/g, "").split(",") : [inline];
    items.map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean).forEach((e) => res.events.add(e));
    return res;
  }

  // Block form: everything indented past column 0 belongs to the `on:` block.
  const body = [];
  for (let i = start + 1; i < all.length; i++) {
    if (/^\S/.test(all[i])) break; // next column-0 key ends the block
    body.push(all[i]);
  }
  const meaningful = body.filter((l) => l.trim() && !/^\s*#/.test(l));
  if (!meaningful.length) return res;
  const childIndent = Math.min(...meaningful.map((l) => l.match(/^(\s*)/)[1].length));

  for (let i = 0; i < body.length; i++) {
    const m = body[i].match(/^(\s*)([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!m || m[1].length !== childIndent) continue;
    const ev = m[2];
    res.events.add(ev);
    if (ev !== "push" && ev !== "pull_request" && ev !== "pull_request_target") continue;
    // The event's sub-block = following lines indented deeper than childIndent.
    const sub = [];
    for (let j = i + 1; j < body.length; j++) {
      if (body[j].trim() === "") { sub.push(body[j]); continue; }
      if (body[j].match(/^(\s*)/)[1].length <= childIndent) break;
      sub.push(body[j]);
    }
    if (ev === "push") {
      res.pushBranches = listField(sub, "branches");
      res.pushBranchesIgnore = listField(sub, "branches-ignore");
      res.pushTags = listField(sub, "tags");
    } else {
      const b = listField(sub, "branches");
      if (b !== null) res.prBranches = b;
    }
  }
  return res;
}

// Extract a YAML list field ("branches"/"tags") from an event sub-block. Handles the
// flow form (`branches: [a, b]`), the block form (`branches:` then `- a` lines) and a
// bare scalar (`branches: main`). Returns null when the field is absent entirely.
function listField(subLines, field) {
  const re = new RegExp("^(\\s*)" + field + "\\s*:\\s*(.*)$");
  for (let i = 0; i < subLines.length; i++) {
    const m = subLines[i].match(re);
    if (!m) continue;
    const indent = m[1].length;
    const inline = m[2].replace(/#.*$/, "").trim();
    if (inline) {
      if (inline.startsWith("[")) {
        return inline.replace(/^\[|\].*$/g, "").split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
      }
      return [inline.replace(/^["']|["']$/g, "")];
    }
    const out = [];
    for (let j = i + 1; j < subLines.length; j++) {
      if (subLines[j].trim() === "") continue;
      const bm = subLines[j].match(/^(\s*)-\s*(.+)$/);
      if (bm && bm[1].length > indent) {
        out.push(bm[2].replace(/#.*$/, "").trim().replace(/^["']|["']$/g, ""));
        continue;
      }
      if (subLines[j].match(/^(\s*)/)[1].length <= indent) break; // dedent ends the list
    }
    return out;
  }
  return null;
}

// Minimal shell-glob for branch patterns like `release/*`. Plain names compare as
// equality; only `*` and `?` are honoured — enough for GitHub branch filters.
function globMatch(pattern, name) {
  if (!/[*?[]/.test(pattern)) return pattern === name;
  const rx = "^" + pattern.replace(/[.+^${}()|\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$";
  try { return new RegExp(rx).test(name); } catch { return false; }
}

// ------------------------------------------------------------------- repo acquisition

function runGh(args) {
  return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

// A slug is fetched read-only through the API — nothing is cloned, nothing is written
// into anyone's working tree.
function readRemoteFile(slug, path) {
  try {
    return runGh(["api", `repos/${slug}/contents/${path}`, "-H", "Accept: application/vnd.github.raw"]);
  } catch {
    return null;
  }
}

function listRemoteDir(slug, path) {
  try {
    const out = runGh(["api", `repos/${slug}/contents/${path}`, "--jq", ".[].name"]);
    return out.split("\n").map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function listRemoteBranches(slug) {
  try {
    const out = runGh(["api", `repos/${slug}/branches`, "--paginate", "--jq", ".[].name"]);
    return out.split("\n").map((s) => s.trim()).filter(Boolean);
  } catch {
    return null; // null = could not determine, distinct from "no branches"
  }
}

// A uniform accessor so every check below is written once and works for both a local
// path and a remote slug.
function makeSource(target) {
  if (target.kind === "local") {
    const root = resolve(target.path);
    return {
      label: target.label,
      kind: "local",
      exists: existsSync(root),
      readFile: (p) => {
        const f = join(root, p);
        return existsSync(f) ? readFileSync(f, "utf8") : null;
      },
      listDir: (p) => {
        const d = join(root, p);
        try {
          return existsSync(d) ? readdirSync(d) : [];
        } catch {
          return [];
        }
      },
      branches: () => {
        try {
          const out = execFileSync("git", ["-C", root, "for-each-ref", "--format=%(refname:short)", "refs/heads"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
          return out.split("\n").map((s) => s.trim()).filter(Boolean);
        } catch {
          return null; // not a git repo, or git unavailable
        }
      },
      currentBranch: () => {
        try {
          return execFileSync("git", ["-C", root, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
        } catch {
          return null;
        }
      },
    };
  }
  return {
    label: target.label,
    kind: "remote",
    exists: true,
    readFile: (p) => readRemoteFile(target.slug, p),
    listDir: (p) => listRemoteDir(target.slug, p),
    branches: () => listRemoteBranches(target.slug),
    currentBranch: () => null,
  };
}

// ------------------------------------------------------------------------- checks

const BRANCH_RE = /^(feat|fix|docs|chore|refactor|test|perf)\/[a-z0-9._-]+$/;
const INTEGRATION_BRANCHES = new Set(["main", "dev", "master", "trunk"]);
// Tiers count the GATES between a merge and users: B has no production (0), C promotes and
// that promotion IS the deploy (1), A promotes to verify and a tag deploys (2). They are
// labels, not grades — C is not "worse than B"; B has no production at all.
const VALID_TIERS = new Set(["A", "B", "C"]);
const VALID_DEPLOY = new Set(["tag", "manual", "push-main", "none"]);
// `deploy` answers HOW a repo reaches production, never WHETHER it is tier A — the tier
// test is "does a deploy target exist today?". `manual` describes the honest third case:
// production exists, but shipping is a human running a documented runbook (rsync, compose
// up) with no workflow and no tag trigger. Before it existed, such repos had to either
// claim `tier: A, deploy: tag` (and fail the deploy-workflow rule) or claim `tier: B` and
// declare `production: null` — a lie, which §8 calls the worst outcome we can produce.
// `push-main` stays in the enum and always will: for the repos using it, a push to `main`
// GENUINELY triggers the deploy, and a project.yml that describes something other than what
// happens is the worst outcome this tool can produce (§8). It is a legitimate mechanism —
// the finding is on the combination `tier: A` + `push-main` (see the tier A block), because
// tier A's contract requires a release artifact gating production, which this shape has no
// room for. That is a mismatch with the tier, not a defect in the mechanism — and `tier: C`
// is where the mechanism fits, so the finding now has somewhere to point rather than only
// telling repos what they are not.
// NOTE: `stack` is deliberately NOT validated against a closed set. The old enum had
// no value for a Capacitor mobile app and forced everyday to be mislabelled, so the
// enum was doing harm. It is now free-form documentation.

function auditRepo(target, ctx) {
  const src = makeSource(target);
  const findings = []; // { level: 'fail'|'warn', text }
  const info = { repo: src.label, kind: src.kind, tier: null, findings: [] };

  const fail = (t) => findings.push({ level: "fail", text: t });
  const warn = (t) => findings.push({ level: "warn", text: t });

  if (!src.exists) {
    fail(`path does not exist: ${target.path}`);
    return finish();
  }

  // ---- .github/project.yml -------------------------------------------------
  const rawCfg = src.readFile(".github/project.yml");
  let cfg = null;
  if (rawCfg === null) {
    fail("no .github/project.yml — repo is undescribed (tier/trunk/deploy unknown)");
  } else {
    const { data, problems } = parseFlatYaml(rawCfg);
    problems.forEach((p) => fail(`project.yml: ${p}`));
    cfg = data;
    const required = ["tier", "trunk", "production", "deploy", "stack"];
    // `production: null` is legal and meaningful for Tier B, so test key PRESENCE,
    // not truthiness.
    const missing = required.filter((k) => !(k in data));
    if (missing.length) fail(`project.yml: missing key(s): ${missing.join(", ")}`);
  }

  const tier = cfg?.tier ?? null;
  const trunk = cfg?.trunk ?? null;
  const production = cfg?.production ?? null;
  const deploy = cfg?.deploy ?? null;
  info.tier = tier;

  if (cfg) {
    if (!VALID_TIERS.has(tier)) fail(`tier is ${JSON.stringify(tier)}, expected "A", "B" or "C"`);
    if (deploy !== null && !VALID_DEPLOY.has(deploy)) fail(`deploy is ${JSON.stringify(deploy)}, expected one of: ${[...VALID_DEPLOY].join(", ")}`);
    // Only when the key exists but is blank — a wholly absent key is already
    // reported by the missing-keys check above, and saying it twice is noise.
    if ("stack" in cfg && (cfg.stack === null || cfg.stack === "")) warn("stack is empty — set a free-form string describing the stack");

    // ---- tier <-> trunk coherence ------------------------------------------
    if (tier === "A" && trunk !== "dev") fail(`tier A requires trunk "dev", found ${JSON.stringify(trunk)}`);
    if (tier === "B" && trunk !== "main") fail(`tier B requires trunk "main", found ${JSON.stringify(trunk)}`);
    // C uses A's two-branch split: main = what is live, dev = where sessions land.
    if (tier === "C" && trunk !== "dev") fail(`tier C requires trunk "dev", found ${JSON.stringify(trunk)} — C uses the same split as A (main = what is live, dev = where sessions land)`);
  }

  // ---- deploy workflow presence -------------------------------------------
  const workflows = src.listDir(".github/workflows").filter((f) => /\.ya?ml$/.test(f));
  const deployWorkflows = workflows.filter((f) => /^deploy[-.]/.test(f));

  const runbook = cfg && "runbook" in cfg ? cfg.runbook : null;

  if (tier === "A") {
    // An automated path to production must be IN the repo; a manual one must be WRITTEN
    // DOWN in it. Either way the answer to "how does this reach production?" is committed.
    if (deploy !== "manual" && !deployWorkflows.length) fail("tier A but no .github/workflows/deploy-*.yml — the path to production is not in the repo (use deploy: manual + runbook: if it really ships by hand)");
    if (production === null || production === "") fail("tier A but production is null — set the live URL, or drop to tier B");
    if (deploy === "none") fail('tier A with deploy: none is contradictory — use "tag" or "manual"');
    if (deploy === "manual") checkRunbook(src, runbook, fail, warn);
    // A TIER MISMATCH, not a bad mechanism. push-main is a perfectly good way to deploy;
    // it just cannot satisfy tier A's contract, which is that a deliberate release artifact
    // gates production. Here every push to main reaches users, so that gate does not exist.
    // The message says "options include" on purpose: the two named exits are not exhaustive
    // and must not read as though they were.
    if (deploy === "push-main") {
      fail(
        "tier A with deploy: push-main — tier A's contract is that a deliberate release " +
        "artifact gates production, and here every push to main reaches users with no such " +
        "gate. Options include: retier to C (tier C is exactly this shape — promotion IS the " +
        "deploy — and is the honest home for a live, low-stakes site), migrate the pipeline " +
        "to a tag trigger (deploy: tag), or — if shipping really is run by hand — " +
        "deploy: manual plus runbook: naming the committed procedure.",
      );
    }
  } else if (tier === "C") {
    // C = "promotion IS the deploy": one gate (the dev→main merge) stands between a merge and
    // users. It exists because a tag ritual nobody honours is worse than no tag ritual — a
    // live low-stakes site had nowhere honest to sit, so it claimed A and failed A's contract.
    if (production === null || production === "") fail("tier C but production is null — tier C is for repos that ARE live; set the live URL, or drop to tier B");
    if (!deployWorkflows.length) fail("tier C but no .github/workflows/deploy-*.yml — the path to production is not in the repo");
    // C is defined by its mechanism: the promotion itself deploys. Any other `deploy` value
    // describes a DIFFERENT number of gates, which is a different tier — so each wrong value
    // is redirected to the tier that actually matches it, rather than being merely rejected.
    if (deploy !== "push-main") {
      if (deploy === "tag") {
        fail('tier C with deploy: tag — a tag gating production is tier A\'s shape (promotion verifies, the tag deploys = two gates). If you really have a tag ritual, you are tier A; if the tag is aspirational, drop it and use deploy: push-main');
      } else if (deploy === "manual") {
        fail('tier C with deploy: manual — there the promotion does NOT deploy (a human running the runbook does), which is tier A with deploy: manual. Retier to A, or use deploy: push-main if the promotion itself ships');
      } else if (deploy === "none") {
        fail('tier C with deploy: none is contradictory — tier C means the promotion deploys. Use deploy: push-main, or drop to tier B if nothing is live');
      } else {
        fail(`tier C requires deploy: push-main, found ${JSON.stringify(deploy)} — C is defined as "promotion IS the deploy"`);
      }
    }
  } else if (tier === "B") {
    // This was silently unchecked before: a tier B repo that actually deploys is
    // either mistiered or shipping to production with none of the tier A gates.
    if (deploy !== null && deploy !== "none") fail(`tier B must have deploy: none, found ${JSON.stringify(deploy)} — if this really deploys, retier: C when the promotion itself ships, A when a tag or a runbook gates it`);
    if (production !== null && production !== "") fail(`tier B must not declare a production URL, found ${JSON.stringify(production)} — retier to C (promotion deploys) or A (a tag/runbook gates the deploy)`);
    if (deployWorkflows.length) fail(`tier B but a deploy workflow exists (${deployWorkflows.join(", ")}) — retier to C or A, or delete it`);
  }

  // ---- declared trunk actually exists -------------------------------------
  const branches = src.branches();
  if (trunk && branches === null) {
    warn(`cannot list branches (not a git checkout, or gh unavailable) — trunk "${trunk}" unverified`);
  } else if (trunk && branches && !branches.includes(trunk)) {
    fail(`declared trunk "${trunk}" does not exist (branches: ${branches.slice(0, 6).join(", ")}${branches.length > 6 ? ", …" : ""})`);
  }

  // ---- branch naming -------------------------------------------------------
  if (branches) {
    const bad = branches.filter((b) => !INTEGRATION_BRANCHES.has(b) && !BRANCH_RE.test(b));
    if (bad.length) {
      warn(`branch name(s) off-convention: ${bad.slice(0, 4).join(", ")}${bad.length > 4 ? ` (+${bad.length - 4})` : ""} — want <type>/<slug>`);
    }
  }

  // ---- trunk is CI-gated ---------------------------------------------------
  // Merges land on the trunk as PUSHES; if no CI workflow triggers on push to the
  // declared trunk, every merge runs zero CI while everyone believes it is gated.
  checkTrunkCiGated(src, trunk, workflows, branches, fail, warn);

  // ---- toolchain agreement -------------------------------------------------
  // Report disagreement; never auto-resolve. Three sources can disagree: the
  // descriptor, the ecosystem manifest, and what the workflows actually pin.
  const tool = collectToolchain(src, cfg, workflows);
  tool.findings.forEach((f) => findings.push(f));

  // ---- handbook reconciliation (stamps) -----------------------------------
  checkStamps(src, ctx.handbook, ctx.templateNames, fail, warn);

  function finish() {
    info.findings = findings;
    info.ok = !findings.some((f) => f.level === "fail");
    info.clean = findings.length === 0;
    return info;
  }
  return finish();
}

// `deploy: manual` promises that the hand-deploy procedure is written down and findable.
// An unwritten runbook is how "only one person can ship this" happens, so the field is
// required and the path is verified — but verification degrades by source:
//
//   local working tree  → authoritative. A declared path that is not on disk is a FAIL.
//   remote (gh API)     → best-effort. A miss can mean "file absent" OR "the API read
//                         failed" (private repo, token scope, rate limit, default branch
//                         differs). Those are indistinguishable from here, so a miss is an
//                         ADVISORY naming both possibilities. We would rather under-report
//                         than invent a violation — the same reason `branches === null`
//                         downgrades the trunk check to "unverified".
function checkRunbook(src, runbook, fail, warn) {
  if (runbook === null || runbook === "") {
    fail("deploy: manual requires runbook: — name the committed doc that describes the hand-deploy (e.g. docs/deploy.md), or nobody but you can ship");
    return;
  }
  const path = String(runbook).trim().replace(/^\.\//, "");
  if (src.readFile(path) !== null) return;
  if (src.kind === "local") fail(`runbook "${runbook}" does not exist in the repo — deploy: manual points at a doc that is not there`);
  else warn(`runbook "${runbook}" not found via the API — either it is missing, or the read failed (permissions/branch); verify in a checkout`);
}

// The bug this catches (found in the wild in shoots/hr-double/corebooks): a repo moved
// its trunk (main -> dev) but its CI workflows' push triggers still named the OLD
// branches, so every merge to the real trunk ran ZERO CI — silently — while the B1
// gate ("check trunk CI is green") checked runs that could never exist.
//
// Deploy/release workflows are NOT CI gates: a deploy-*.yml firing on a push to main is a
// deploy trigger, not a check, so it must never be counted as "the trunk is gated". We
// exclude them by filename (deploy*/release*) and by trigger shape (a tags-only or
// workflow_dispatch-only workflow does no branch gating and is not CI-type). This exclusion
// is about what COUNTS AS CI here and says nothing about whether the setup is desirable —
// a `deploy: push-main` repo is separately a tier A finding above.
function checkTrunkCiGated(src, trunk, workflows, branches, fail, warn) {
  if (!trunk || !workflows.length) return;

  const ci = []; // CI-type workflows: { wf, pushGate, prGate, refs }
  for (const wf of workflows) {
    if (/^(deploy|release)[-.]/.test(wf)) continue; // deploy/release by filename
    const on = parseWorkflowOn(src.readFile(`.github/workflows/${wf}`));
    if (!on.found) continue;

    // Effective push branch gate: an array of patterns | "all" | {ignore:[…]} | null.
    // Bare `push:` = every branch ("all"); `push:` with only tags = no branch push.
    let pushGate = null;
    if (on.events.has("push")) {
      if (on.pushBranches !== null) pushGate = on.pushBranches;
      else if (on.pushBranchesIgnore !== null) pushGate = { ignore: on.pushBranchesIgnore };
      else if (on.pushTags !== null) pushGate = null; // tags-only push
      else pushGate = "all";
    }
    const prGate = (on.events.has("pull_request") || on.events.has("pull_request_target"))
      ? (on.prBranches !== null ? on.prBranches : "all")
      : null;

    // Not CI-type if it does no branch-based triggering (tags-only + dispatch, etc.).
    if (pushGate === null && prGate === null) continue;

    // Positive branch references, for the stale-reference advisory (ignore lists and
    // glob patterns are not concrete "references" to a branch).
    const refs = [];
    for (const list of [on.pushBranches, on.prBranches]) {
      if (Array.isArray(list)) for (const b of list) if (b) refs.push(b);
    }
    ci.push({ wf, pushGate, prGate, refs });
  }

  // No CI at all here is a DIFFERENT concern (does this repo want CI?) — out of scope.
  // This check only catches CI that exists but points at the wrong branch.
  if (!ci.length) return;

  const pushGatesTrunk = (g) => {
    if (g === "all") return true;
    if (Array.isArray(g)) return g.some((p) => globMatch(p, trunk));
    if (g && g.ignore) return !g.ignore.some((p) => globMatch(p, trunk));
    return false;
  };

  if (!ci.some((c) => pushGatesTrunk(c.pushGate))) {
    const gates = ci.map((c) => {
      if (Array.isArray(c.pushGate)) return `${c.wf} gates: ${c.pushGate.join(", ")}`;
      if (c.pushGate === "all") return `${c.wf} gates: all branches`;
      return `${c.wf}: pull_request only`;
    });
    fail(`trunk "${trunk}" is not CI-gated — no workflow triggers on push to it (${gates.join("; ")})`);
  }

  // Stale-reference advisory: a workflow names a branch that does not exist. Standard
  // integration aliases (main/master/dev/trunk) are exempt — teams list them
  // defensively; the anti-pattern is a project-specific ghost like develop/workos.
  if (Array.isArray(branches)) {
    for (const c of ci) {
      const ghosts = [...new Set(c.refs)]
        .filter((b) => !/[*?[]/.test(b)) // glob patterns aren't concrete branches
        .filter((b) => !INTEGRATION_BRANCHES.has(b))
        .filter((b) => !branches.includes(b));
      if (ghosts.length) warn(`${c.wf} triggers on nonexistent branch(es): ${ghosts.join(", ")}`);
    }
  }
}

function collectToolchain(src, cfg, workflows) {
  const findings = [];

  // --- declared -------------------------------------------------------------
  const declared = {
    node: cfg && "node" in cfg ? cfg.node : null,
    php: cfg && "php" in cfg ? cfg.php : null,
  };

  // --- manifest -------------------------------------------------------------
  const manifest = { node: null, nodeRaw: null, nodeFrom: null, php: null, phpRaw: null, phpFrom: null };

  const nvmrc = src.readFile(".nvmrc");
  if (nvmrc && nvmrc.trim()) {
    manifest.nodeRaw = nvmrc.split("\n").find((l) => l.trim() && !l.trim().startsWith("#"))?.trim() ?? null;
    manifest.node = normaliseVersion(manifest.nodeRaw);
    manifest.nodeFrom = ".nvmrc";
  }
  const pkgRaw = src.readFile("package.json");
  let pkg = null;
  if (pkgRaw) {
    try {
      pkg = JSON.parse(pkgRaw);
    } catch (e) {
      findings.push({ level: "fail", text: `package.json does not parse: ${e.message.split("\n")[0]}` });
    }
  }
  if (pkg && !manifest.node && pkg.engines?.node) {
    manifest.nodeRaw = pkg.engines.node;
    manifest.node = normaliseVersion(pkg.engines.node);
    manifest.nodeFrom = "engines.node";
  }

  const composerRaw = src.readFile("composer.json");
  let composer = null;
  if (composerRaw) {
    try {
      composer = JSON.parse(composerRaw);
    } catch (e) {
      findings.push({ level: "fail", text: `composer.json does not parse: ${e.message.split("\n")[0]}` });
    }
  }
  if (composer?.require?.php) {
    manifest.phpRaw = composer.require.php;
    manifest.php = normaliseVersion(composer.require.php);
    manifest.phpFrom = "composer.json require.php";
  }

  // --- what the workflows actually pin -------------------------------------
  const pins = { node: [], php: [] };
  for (const wf of workflows) {
    const text = src.readFile(`.github/workflows/${wf}`);
    if (!text) continue;
    for (const [, v] of text.matchAll(/^\s*node-version:\s*["']?([^"'\s#]+)/gm)) {
      if (!v.includes("${{")) pins.node.push({ wf, v: normaliseVersion(v) });
    }
    for (const [, v] of text.matchAll(/^\s*php-version:\s*["']?([^"'\s#]+)/gm)) {
      if (!v.includes("${{")) pins.php.push({ wf, v: normaliseVersion(v) });
    }
  }

  for (const eco of ["node", "php"]) {
    const d = declared[eco] ? normaliseVersion(declared[eco]) : null;
    const m = manifest[eco];
    const rawConstraint = eco === "node" ? manifest.nodeRaw : manifest.phpRaw;
    const from = eco === "node" ? manifest.nodeFrom : manifest.phpFrom;

    // Descriptor vs manifest. If the manifest states a range, the descriptor's
    // concrete version must live inside it; otherwise compare them directly.
    if (d && m) {
      const agrees = isRange(rawConstraint) ? satisfiesConstraint(d, rawConstraint) : prefixAgree(d, m);
      if (!agrees) {
        findings.push({ level: "fail", text: `${eco}: project.yml=${d} but ${from}=${rawConstraint}` });
      }
    }

    // Declared truth vs what the workflows actually pin. project.yml wins as the
    // reference when present; otherwise the manifest is the reference.
    const truthLabel = d ? "project.yml" : from;
    const reference = d || m;
    const referenceIsRange = !d && isRange(rawConstraint);
    for (const p of pins[eco]) {
      if (!p.v || !reference) continue;
      const agrees = referenceIsRange ? satisfiesConstraint(p.v, rawConstraint) : prefixAgree(reference, p.v);
      if (!agrees) {
        const shown = referenceIsRange ? rawConstraint : normaliseVersion(reference);
        findings.push({ level: "fail", text: `${eco}: ${truthLabel}=${shown} but ${p.wf} pins ${p.v}` });
      }
    }

    // workflows disagreeing with EACH OTHER is the exact bug that started this:
    // ci.yml on Node 20, deploy-xserver.yml on Node 22.
    const pinned = pins[eco].filter((p) => p.v);
    const inconsistent = pinned.some((p) => !prefixAgree(p.v, pinned[0].v));
    if (inconsistent) {
      findings.push({
        level: "fail",
        text: `${eco}: workflows disagree — ${pins[eco].map((p) => `${p.wf}=${p.v}`).join(", ")}`,
      });
    }

    // Nothing declared anywhere, but CI pins something: the pin is the only source
    // of truth and nobody can see it without opening the YAML.
    if (!reference && pins[eco].length) {
      findings.push({
        level: "warn",
        text: `${eco}: undeclared — only pinned inside ${[...new Set(pins[eco].map((p) => p.wf))].join(", ")} (declare it in project.yml)`,
      });
    }
  }

  return { findings };
}

// -------------------------------------------------------------------- config load

function loadTargets(opts) {
  const targets = [];

  for (const p of opts.locals) {
    targets.push({ kind: "local", path: p, label: labelForPath(p) });
  }

  const entries = [];
  if (opts.slugs.length) {
    entries.push(...opts.slugs);
  } else if (!opts.locals.length) {
    const cfg = resolveConfig(opts);
    opts.resolvedConfig = cfg; // surfaced in the report header
    for (const line of readFileSync(cfg.path, "utf8").split(/\r?\n/)) {
      const s = line.replace(/#.*$/, "").trim();
      if (s) entries.push(s);
    }
  }

  for (const e of entries) {
    // A path if it looks like one or exists on disk; otherwise an owner/name slug.
    const looksPath = e.startsWith("/") || e.startsWith("~") || e.startsWith(".");
    const expanded = e.startsWith("~") ? join(process.env.HOME || "", e.slice(1)) : e;
    if (looksPath || existsSync(expanded)) {
      targets.push({ kind: "local", path: expanded, label: labelForPath(expanded) });
    } else if (/^[^/]+\/[^/]+$/.test(e)) {
      targets.push({ kind: "remote", slug: e, label: e });
    } else {
      targets.push({ kind: "local", path: expanded, label: e }); // will report "does not exist"
    }
  }
  return targets;
}

// Two path segments read better than one in a report: `futurelastic/everyday`.
function labelForPath(p) {
  const r = resolve(p.startsWith("~") ? join(process.env.HOME || "", p.slice(1)) : p);
  const parent = basename(dirname(r));
  return parent && parent !== "/" ? `${parent}/${basename(r)}` : basename(r);
}

// ------------------------------------------------------------------------- output

function report(results, opts, ctx) {
  if (opts.json) {
    console.log(JSON.stringify({
      generated: new Date().toISOString(),
      handbook: { version: ctx.handbook.version, untagged: ctx.handbook.untagged, root: ctx.handbook.root },
      configSource: opts.resolvedConfig?.source ?? (opts.locals.length || opts.slugs.length ? "ad-hoc (--local / positional)" : null),
      results,
    }, null, 2));
    return;
  }

  // Header: which repo list + handbook version, so a scheduled run is self-documenting.
  if (opts.resolvedConfig) console.log(`repo list: ${opts.resolvedConfig.source}`);
  console.log(`handbook:  ${ctx.handbook.version}${ctx.handbook.untagged ? " (untagged — stamp checks inactive)" : ""}`);
  console.log("");

  const shown = opts.quiet ? results.filter((r) => !r.clean) : results;
  const width = Math.max(0, ...shown.map((r) => r.repo.length));
  const tierW = 6;

  for (const r of shown) {
    const tier = r.tier ? `tier ${r.tier}` : "tier ?";
    const head = `${r.repo.padEnd(width)}  ${tier.padEnd(tierW)}`;
    if (r.clean) {
      console.log(`${head}  ✓`);
      continue;
    }
    r.findings.forEach((f, i) => {
      const mark = f.level === "fail" ? "⚠" : "·";
      // Repeat the name on every line so the output stays greppable.
      console.log(`${i === 0 ? head : "".padEnd(width + 2 + tierW + 2)}  ${mark} ${f.text}`);
    });
  }

  const failed = results.filter((r) => !r.ok).length;
  const warned = results.filter((r) => r.ok && !r.clean).length;
  console.log("");
  console.log(`${results.length} repo(s): ${results.length - failed - warned} clean, ${warned} with advisories, ${failed} with problems.`);
}

// --------------------------------------------------------------------------- main

const opts = parseArgs(process.argv.slice(2));
const targets = loadTargets(opts);
if (!targets.length) die("nothing to audit — add entries to the repo list or pass --local <path>");

const ctx = { handbook: handbookInfo(), templateNames: templateNames() };

const results = [];
for (const t of targets) {
  try {
    results.push(auditRepo(t, ctx));
  } catch (err) {
    // Degrade gracefully: one broken repo must never take the whole sweep down.
    results.push({
      repo: t.label,
      kind: t.kind,
      tier: null,
      ok: false,
      clean: false,
      findings: [{ level: "fail", text: `audit crashed: ${err.message.split("\n")[0]}` }],
    });
  }
}

report(results, opts, ctx);
process.exit(results.every((r) => r.ok) ? 0 : 1);
