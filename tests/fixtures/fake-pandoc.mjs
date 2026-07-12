#!/usr/bin/env node

import { readFileSync } from 'node:fs';

const file = process.argv.at(-1);
const source = readFileSync(file, 'utf8');

function metaString(value) { return { t: 'MetaString', c: value }; }

function parseMetadata(text) {
  const lines = text.split(/\r?\n/);
  const first = lines.findIndex((line) => line.trim() === '---');
  if (first < 0) return {};
  const last = lines.findIndex((line, index) => index > first && line.trim() === '---');
  if (last < 0) return {};
  const imports = [];
  let current = null;
  let inQmdProver = false;
  let inImports = false;
  let inUse = false;
  for (const raw of lines.slice(first + 1, last)) {
    const indent = raw.match(/^\s*/)[0].length;
    const line = raw.trim();
    if (indent === 0) {
      inQmdProver = line === 'qmd-prover:';
      inImports = false;
      inUse = false;
      continue;
    }
    if (!inQmdProver) continue;
    if (indent === 2 && line === 'imports:') { inImports = true; inUse = false; continue; }
    if (!inImports) continue;
    const from = line.match(/^-\s*from:\s*(.+)$/);
    if (from) { current = { from: from[1].replace(/^['"]|['"]$/g, ''), use: [] }; imports.push(current); inUse = false; continue; }
    if (line === 'use:') { inUse = true; continue; }
    const item = inUse && line.match(/^-\s*(.+)$/);
    if (item && current) current.use.push(item[1].replace(/^@/, '').replace(/^['"]|['"]$/g, ''));
  }
  if (!inQmdProver && imports.length === 0) return {};
  return {
    'qmd-prover': {
      t: 'MetaMap',
      c: { imports: { t: 'MetaList', c: imports.map((entry) => ({ t: 'MetaMap', c: { from: metaString(entry.from), use: { t: 'MetaList', c: entry.use.map(metaString) } } })) } }
    }
  };
}

function inlines(text) {
  const output = [];
  const parts = text.trim().split(/(\s+|@(def|lem|thm|prp|cor)-[A-Za-z0-9_:-]+(?:\.[A-Za-z0-9_:-]+)*)/).filter((part) => part && !/^(def|lem|thm|prp|cor)$/.test(part));
  for (const part of parts) {
    if (/^\s+$/.test(part)) output.push({ t: 'Space' });
    else if (/^@(def|lem|thm|prp|cor)-/.test(part)) {
      const id = part.slice(1);
      output.push({ t: 'Cite', c: [[{ citationId: id, citationPrefix: [], citationSuffix: [], citationMode: { t: 'NormalCitation' }, citationNoteNum: 0, citationHash: 0 }], [{ t: 'Str', c: part }]] });
    } else output.push({ t: 'Str', c: part });
  }
  return output;
}

function attribute(text) {
  const id = text.match(/#([^\s}]+)/)?.[1] ?? '';
  const classes = [...text.matchAll(/\.([^\s}]+)/g)].map((match) => match[1]);
  const values = [...text.matchAll(/([^\s=]+)=(?:"([^"]*)"|'([^']*)'|([^\s}]+))/g)].map((match) => [match[1], match[2] ?? match[3] ?? match[4]]);
  return [id, classes, values];
}

function blocks(text) {
  const output = [];
  let paragraph = [];
  function flush() {
    if (paragraph.length) { output.push({ t: 'Para', c: inlines(paragraph.join(' ')) }); paragraph = []; }
  }
  for (const line of text.split(/\r?\n/)) {
    const header = line.match(/^(#{1,6})\s+(.*)$/);
    if (header) { flush(); output.push({ t: 'Header', c: [header[1].length, ['', [], []], inlines(header[2])] }); }
    else if (!line.trim()) flush();
    else paragraph.push(line.replace(/^\s*-\s*/, ''));
  }
  flush();
  return output;
}

const astBlocks = [];
const lines = source.split(/\r?\n/);
for (let index = 0; index < lines.length; index += 1) {
  const open = lines[index].match(/^\s*:::\s*\{([^}]*)\}\s*$/);
  if (!open) continue;
  let end = index + 1;
  while (end < lines.length && !/^\s*:::\s*$/.test(lines[end])) end += 1;
  astBlocks.push({ t: 'Div', c: [attribute(open[1]), blocks(lines.slice(index + 1, end).join('\n'))] });
  index = end;
}

process.stdout.write(JSON.stringify({ 'pandoc-api-version': [1, 23], meta: parseMetadata(source), blocks: astBlocks }));
