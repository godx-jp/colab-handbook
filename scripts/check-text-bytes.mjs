#!/usr/bin/env node
// Fail if any tracked text file contains a control byte that has no business being there.
//
// WHY THIS EXISTS. A source file in this repo picked up two raw NUL bytes, typed straight into a
// template literal as a separator. Every check we run stayed green: `node --check` parsed it, git
// diffed it as text, the unit tests passed, the audit passed. But `file` called it "binary data"
// and plain `grep` returned NOTHING without `-a` -- so a reviewer grepping for the very changes in
// that file saw an empty result and nearly concluded the work was missing. Nothing in the gate
// could see it, because every tool in the gate reads bytes and none of them reads like a human.
//
// It is worst in a tool that reads its own source: the CLI scrapes its own column-0 comments to
// build help text, so a byte that makes the file unreadable to text tooling is a live hazard, not
// an aesthetic one.
//
// Allowed control bytes are tab, newline and carriage return. Everything else below 0x20, plus
// DEL (0x7f), is a finding. This is deliberately a byte scan and not a linter: it stays cheap
// enough to run on every push and knows nothing about any language.

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

// Files that are binary ON PURPOSE. Extension-based because it needs no I/O to decide.
const BINARY_EXT = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'ico', 'webp', 'avif', 'bmp', 'tiff', 'pdf',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'zip', 'gz', 'tgz', 'bz2', 'xz', '7z', 'jar', 'tar',
  'so', 'dylib', 'dll', 'exe', 'wasm', 'class',
  'mp3', 'mp4', 'mov', 'wav', 'avi', 'webm',
  'sqlite', 'db', 'bin',
]);

const TAB = 9, LF = 10, CR = 13, SPACE = 32, DEL = 127;

function isOffending(byte) {
  if (byte === TAB || byte === LF || byte === CR) return false;
  return byte < SPACE || byte === DEL;
}

function label(byte) {
  if (byte === 0) return 'NUL';
  if (byte === DEL) return 'DEL';
  return 'control';
}

const NUL_SEP = String.fromCharCode(0); // git -z output separator

let files;
try {
  files = execFileSync('git', ['ls-files', '-z'], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 })
    .toString('utf8')
    .split(NUL_SEP)
    .filter(Boolean);
} catch (err) {
  console.error('check-text-bytes: could not list tracked files:', err.message);
  process.exit(2);
}

const findings = [];

for (const file of files) {
  const ext = (file.split('.').pop() || '').toLowerCase();
  if (file.includes('.') && BINARY_EXT.has(ext)) continue;

  let buf;
  try {
    if (!statSync(file).isFile()) continue; // submodule / symlink to a directory
    buf = readFileSync(file);
  } catch {
    continue; // deleted from the tree but still in the index -- not this check's problem
  }

  let line = 1;
  for (let i = 0; i < buf.length; i++) {
    const byte = buf[i];
    if (byte === LF) { line++; continue; }
    if (!isOffending(byte)) continue;
    findings.push({ file, line, offset: i, byte });
    if (findings.length > 200) break; // a genuinely binary file would flood the report
  }
  if (findings.length > 200) break;
}

if (findings.length === 0) {
  console.log(`check-text-bytes: ${files.length} tracked files, no stray control bytes.`);
  process.exit(0);
}

console.error('check-text-bytes: stray control bytes in tracked text files\n');
for (const f of findings) {
  const hex = f.byte.toString(16).padStart(2, '0');
  console.error(`  ${f.file}:${f.line}  offset ${f.offset}  byte 0x${hex} (${label(f.byte)})`);
}
console.error(`
${findings.length} finding(s). These pass node --check and diff as text, but make the file read as
BINARY: \`file\` says "binary data" and grep needs -a to match anything in it.

  Find them:   node -e 'const b=require("fs").readFileSync(process.argv[1]);for(let i=0;i<b.length;i++)if(b[i]<32&&![9,10,13].includes(b[i]))console.log(i)' <file>
  See them:    cat -v <file>     (NUL prints as ^@)

If a control byte is genuinely needed at RUNTIME, write it as an escape in the source
(String.fromCharCode(0), or the equivalent escape for your language) -- never as a raw byte. Better
still, restructure so no separator is needed: a nested map needs no delimiter to encode.
If the file is binary on purpose, add its extension to BINARY_EXT in this script.`);
process.exit(1);
