import { readFile } from 'node:fs/promises';

function parseFence(line) {
  const match = line.match(/^(\s*)(:{3,})\s*(?:\{([^}]*)\})?\s*$/);
  return match ? { indent: match[1].length, length: match[2].length, attrs: match[3] ?? '' } : null;
}

function attrId(attrs) {
  return attrs.match(/(?:^|\s)#([^\s}]+)/)?.[1] ?? '';
}

export function locateDiv(source, id) {
  const lines = source.split(/(?<=\n)/);
  let offset = 0;
  const stack = [];
  for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
    const line = lines[lineNumber];
    const fence = parseFence(line.replace(/\r?\n$/, ''));
    if (fence) {
      if (!fence.attrs) {
        const open = stack.pop();
        if (open?.id === id) return { start: open.offset, end: offset + line.length, startLine: open.line + 1, endLine: lineNumber + 1 };
      } else stack.push({ id: attrId(fence.attrs), offset, line: lineNumber, fenceLength: fence.length });
    }
    offset += line.length;
  }
  return null;
}

export function sectionFromDiv(source, div, heading) {
  const block = source.slice(div.start, div.end);
  const pattern = new RegExp(`^([ \\t]*)#{1,6}[ \\t]+${heading}[ \\t]*\\r?$`, 'gmi');
  const match = pattern.exec(block);
  if (!match) return null;
  const bodyStart = match.index + match[0].length + (block[match.index + match[0].length] === '\n' ? 1 : 0);
  const next = /^\s*#{1,6}\s+[^\n]+\r?$/gm;
  next.lastIndex = bodyStart;
  const nextMatch = next.exec(block);
  const closing = block.lastIndexOf(':::');
  const bodyEnd = nextMatch ? nextMatch.index : closing;
  return {
    headingStart: div.start + match.index,
    bodyStart: div.start + bodyStart,
    bodyEnd: div.start + Math.max(bodyStart, bodyEnd),
    text: block.slice(bodyStart, Math.max(bodyStart, bodyEnd)).trim()
  };
}

export async function readLocatedBlock(file, id) {
  const source = await readFile(file, 'utf8');
  const div = locateDiv(source, id);
  if (!div) return null;
  return {
    source,
    div,
    raw: source.slice(div.start, div.end),
    statement: sectionFromDiv(source, div, 'Statement'),
    uses: sectionFromDiv(source, div, 'Uses'),
    proof: sectionFromDiv(source, div, 'Proof')
  };
}

export function replaceProof(canonical, candidate) {
  if (!canonical.proof || !candidate.proof) throw new Error('Both canonical target and proposal require a Proof section');
  const replacement = candidate.source.slice(candidate.proof.bodyStart, candidate.proof.bodyEnd).replace(/^\s+|\s+$/g, '');
  const rawPrefix = canonical.source.slice(0, canonical.proof.bodyStart);
  const prefix = rawPrefix.endsWith('\n\n') ? rawPrefix : `${rawPrefix}\n`;
  const suffix = canonical.source.slice(canonical.proof.bodyEnd);
  return `${prefix}${replacement ? `${replacement}\n` : ''}${suffix.replace(/^\n*/, '\n')}`;
}
