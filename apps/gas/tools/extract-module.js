'use strict';
/**
 * Codemod: move a named set of top-level declarations (functions + consts/lets)
 * out of Code.gs into a target .gs module, preserving original order and any
 * attached leading comment block. GAS shares one global namespace across .gs
 * files, so moved declarations stay callable everywhere.
 *
 *   node tools/extract-module.js <TargetFile.gs> "<Header>" name1 name2 ...
 *
 * Safety: aborts on a missing or ambiguous name, or on overlapping ranges. The
 * real correctness net is `npm test`, which re-bundles all .gs files and fails
 * loudly on any syntax error, duplicate const, or load-order (TDZ) problem.
 */
const fs = require('fs');
const path = require('path');

const [, , targetFile, header, ...names] = process.argv;
if (!targetFile || !header || names.length === 0) {
  console.error('usage: node tools/extract-module.js <TargetFile.gs> "<Header>" name...');
  process.exit(2);
}

const root = path.join(__dirname, '..');
const codePath = path.join(root, 'Code.gs');
const lines = fs.readFileSync(codePath, 'utf8').split('\n');

const declRe = /^(?:function\s+(\w+)|const\s+(\w+)|let\s+(\w+)|var\s+(\w+))\b/;
const decls = [];
lines.forEach((ln, i) => {
  const m = ln.match(declRe);
  if (m) decls.push({ name: m[1] || m[2] || m[3] || m[4], line: i });
});
const declLines = decls.map(d => d.line).sort((a, b) => a - b);

function nextDeclLine(start) {
  for (const l of declLines) if (l > start) return l;
  return lines.length;
}
function isCommentLine(s) {
  const t = s.trim();
  return t.startsWith('//') || t.startsWith('/*') || t.startsWith('*') || t.endsWith('*/');
}
function balanced(s) {
  let o = 0;
  for (const c of s) { if ('([{'.includes(c)) o++; else if (')]}'.includes(c)) o--; }
  return o === 0;
}
function findStart(name) {
  const hits = decls.filter(d => d.name === name);
  if (hits.length === 0) throw new Error('NOT FOUND: ' + name);
  if (hits.length > 1) throw new Error('AMBIGUOUS (multiple top-level defs): ' + name);
  return hits[0].line;
}
function findEnd(start) {
  const s = lines[start];
  if (/;\s*$/.test(s) && balanced(s)) return start;       // complete single-line decl
  const limit = nextDeclLine(start);
  for (let i = start + 1; i < limit; i++) {
    if (/^[}\])]/.test(lines[i])) return i;               // closing bracket at column 0
  }
  return limit - 1;
}
function extendUpOverComments(start) {
  let s = start;
  while (s - 1 >= 0 && lines[s - 1].trim() !== '' && isCommentLine(lines[s - 1])) s--;
  // Guard: only attach the leading comment if we climbed to a clean block opener
  // (/* or //). If we stopped on a continuation line (* or */) — e.g. a banner
  // comment sits directly above the JSDoc — attaching would SPLIT the block and
  // orphan its opener. In that case attach nothing; the comment stays intact in
  // Code.gs. (This is the fix for the rate-limit JSDoc split caught earlier.)
  if (s < start) {
    const top = lines[s].trim();
    if (!(top.startsWith('/*') || top.startsWith('//'))) return start;
  }
  return s;
}

const ranges = names.map(n => {
  const declStart = findStart(n);
  return { name: n, start: extendUpOverComments(declStart), end: findEnd(declStart) };
}).sort((a, b) => a.start - b.start);

for (let i = 1; i < ranges.length; i++) {
  if (ranges[i].start <= ranges[i - 1].end) {
    throw new Error('OVERLAP between ' + ranges[i - 1].name + ' and ' + ranges[i].name);
  }
}

const blocks = ranges.map(r => lines.slice(r.start, r.end + 1).join('\n').replace(/\s+$/, ''));
const moduleBody =
  '/**\n * ════════════════════════════════════════════════════════════════════════\n' +
  ' *  ' + header + '   (extracted module)\n' +
  ' * ════════════════════════════════════════════════════════════════════════\n' +
  ' * Extracted from Code.gs. In Google Apps Script all .gs files share ONE global\n' +
  ' * namespace, so these declarations remain callable everywhere unchanged.\n */\n\n' +
  blocks.join('\n\n') + '\n';
fs.writeFileSync(path.join(root, targetFile), moduleBody);

const removed = new Set();
ranges.forEach(r => { for (let i = r.start; i <= r.end; i++) removed.add(i); });
const firstStart = ranges[0].start;
const pointer =
  '// ── ' + header.toUpperCase() + ' ──\n' +
  '// Extracted to ' + targetFile + ' (GAS shares one global namespace across .gs\n' +
  '// files, so the moved declarations remain callable here).';

const out = [];
for (let i = 0; i < lines.length; i++) {
  if (i === firstStart) out.push(pointer);
  if (removed.has(i)) continue;
  out.push(lines[i]);
}
fs.writeFileSync(codePath, out.join('\n'));

console.log('Extracted ' + names.length + ' declarations → ' + targetFile);
ranges.forEach(r => console.log('  - ' + r.name + '  (lines ' + (r.start + 1) + '-' + (r.end + 1) + ')'));
