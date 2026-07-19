'use strict';
/**
 * Minimal YAML subset parser — enough for `.github/project.yml`, no dependencies.
 *
 * Supported:
 *   key: value                  scalars: string, number, true/false, null/~, quoted strings
 *   key: [a, b, 3]              inline (flow) sequences of scalars
 *   key:                        block sequences
 *     - a
 *     - b
 *   key:                        nested maps (indentation based)
 *     sub: value
 *   # comments, blank lines
 *
 * NOT supported (deliberately — keep it small and predictable):
 *   anchors/aliases, multi-line scalars (| >), flow maps {a: 1}, multi-doc (---),
 *   sequences of maps. If a project descriptor ever needs those, replace this
 *   with a real parser rather than growing this one.
 */

function parseScalar(raw) {
  const s = raw.trim();
  if (s === '') return '';
  if ((s.startsWith('"') && s.endsWith('"') && s.length > 1) ||
      (s.startsWith("'") && s.endsWith("'") && s.length > 1)) {
    return s.slice(1, -1);
  }
  if (s === 'null' || s === '~') return null;
  if (s === 'true' || s === 'yes') return true;
  if (s === 'false' || s === 'no') return false;
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d*\.\d+$/.test(s)) return parseFloat(s);
  return s;
}

function parseFlowSeq(raw) {
  const inner = raw.trim().slice(1, -1).trim();
  if (inner === '') return [];
  return inner.split(',').map((p) => parseScalar(p));
}

// Strip a trailing ` # comment`, but not a `#` inside quotes.
function stripComment(line) {
  let inS = false, inD = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'" && !inD) inS = !inS;
    else if (c === '"' && !inS) inD = !inD;
    else if (c === '#' && !inS && !inD && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i);
    }
  }
  return line;
}

function parse(text) {
  const lines = [];
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = stripComment(rawLine).replace(/\s+$/, '');
    if (line.trim() === '') continue;
    lines.push({ indent: line.match(/^ */)[0].length, text: line.trim() });
  }
  let i = 0;

  function parseBlock(indent) {
    // Sequence?
    if (i < lines.length && lines[i].indent === indent && lines[i].text.startsWith('- ')) {
      const arr = [];
      while (i < lines.length && lines[i].indent === indent && lines[i].text.startsWith('- ')) {
        arr.push(parseScalar(lines[i].text.slice(2)));
        i++;
      }
      return arr;
    }
    // Map
    const obj = {};
    while (i < lines.length && lines[i].indent >= indent) {
      if (lines[i].indent > indent) { i++; continue; } // defensive: stray deeper line
      const { text } = lines[i];
      const m = text.match(/^([^:]+):\s*(.*)$/);
      if (!m) { i++; continue; }
      const key = m[1].trim();
      const rest = m[2].trim();
      i++;
      if (rest === '') {
        if (i < lines.length && lines[i].indent > indent) obj[key] = parseBlock(lines[i].indent);
        else obj[key] = null;
      } else if (rest.startsWith('[') && rest.endsWith(']')) {
        obj[key] = parseFlowSeq(rest);
      } else {
        obj[key] = parseScalar(rest);
      }
    }
    return obj;
  }

  if (lines.length === 0) return {};
  return parseBlock(lines[0].indent);
}

module.exports = { parse };
