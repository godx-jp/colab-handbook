'use strict';
/**
 * Guards the convention #108 fixed instances of: a test fixture that `git init`s AND `git
 * commit`s a throwaway repo must neutralise `core.hooksPath` locally, or it silently inherits
 * whatever the developer's machine points its GLOBAL hooks at (this handbook installs one). Two
 * incidents now share this exact shape — #101 (ambient `gh` credentials) and #108 (ambient
 * `core.hooksPath`) — both a fixture copied from a sibling test file with one guard dropped. Step 1
 * of #108 was fixing every instance found; this is step 2, the point of the issue: a cheap
 * grep-based check so the NEXT copied fixture cannot drop the same line silently.
 *
 * Checked PER TOP-LEVEL BLOCK, not per file — a whole-file check reads as satisfied the moment
 * `hooksPath` appears ANYWHERE, including in a sibling fixture the file also happens to define.
 * Writing this check found the gap wasn't hypothetical, twice over: `audit-ceremony.test.js` has
 * three top-level fixture functions, two of which set `hooksPath` and one (`fakeHandbook`) that
 * didn't; `release-status.test.js` builds two of its fixtures INLINE inside a `test(...)` body
 * rather than a named helper, and both were missing it too. A whole-file grep sees each file as
 * compliant and misses every one of those. Fixed alongside this check landing, not after — a check
 * that ships already failing its own repo would just get skipped by the next reader instead of
 * trusted.
 *
 * The parse is intentionally simple: split on lines starting at column 0 with `function <name>(`
 * or `test(` (this repo's actual style — every fixture helper and every test body starts flush
 * left, confirmed by grep before writing this), track brace depth to isolate each block, and apply
 * the `'init'` + `'commit'` without `hooksPath` check within each block independently. A fixture
 * built any other way (an indented helper, an arrow function assigned to a `const`) would not be
 * caught — none are, today; if that style shows up, extend the parser rather than trust the gap
 * silently.
 *
 * Scoped to tools/lib/*.test.js — the CI glob these run under (`node --test tools/lib/*.test.js`)
 * — so a fixture anywhere else in the repo (there is none today) is out of this check's reach by
 * the same boundary the test suite itself uses.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const LIB_DIR = __dirname;

/**
 * Split `text` into top-level blocks — either `function name(...) { ... }` or `test(...) { ... }`
 * — by brace-depth tracking from each column-0 `^function \w+\(` or `^test\(` line. Returns
 * `[{name, body}]`. Code outside any such block (module scope, an indented or arrow-function
 * fixture) is not represented — see the module docstring.
 */
function topLevelBlocks(text) {
  const lines = text.split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const fn = /^function (\w+)\(/.exec(lines[i]);
    const t = !fn && /^test\(/.test(lines[i]);
    if (!fn && !t) { i++; continue; }
    const name = fn ? fn[1] : `test(...) at line ${i + 1}`;
    let depth = 0;
    let started = false;
    const bodyLines = [];
    let j = i;
    for (; j < lines.length; j++) {
      const line = lines[j];
      bodyLines.push(line);
      for (const ch of line) {
        if (ch === '{' || ch === '(') { depth++; started = true; }
        else if (ch === '}' || ch === ')') depth--;
      }
      if (started && depth === 0) { j++; break; }
    }
    blocks.push({ name, body: bodyLines.join('\n') });
    i = j;
  }
  return blocks;
}

test('every tools/lib/*.test.js git fixture that inits AND commits neutralises core.hooksPath', () => {
  const offenders = [];
  for (const name of fs.readdirSync(LIB_DIR)) {
    if (!name.endsWith('.test.js')) continue;
    if (name === 'fixture-hooks-lint.test.js') continue; // this file — no git fixtures of its own
    const file = path.join(LIB_DIR, name);
    const text = fs.readFileSync(file, 'utf8');
    for (const block of topLevelBlocks(text)) {
      const initsAndCommits = /'init'/.test(block.body) && /'commit'/.test(block.body);
      if (initsAndCommits && !/hooksPath/.test(block.body)) {
        offenders.push(`${name}: ${block.name}`);
      }
    }
  }
  assert.deepStrictEqual(
    offenders,
    [],
    `these fixture functions git-init AND git-commit a throwaway repo but never set hooksPath — add ` +
    `\`g('config', 'core.hooksPath', path.join(dir, '.nohooks'))\` (or the function's equivalent), or ` +
    `the fixture silently runs the developer's real global hooks: ${offenders.join(', ')}`,
  );
});
