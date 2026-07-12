import { readFile } from 'node:fs/promises';

function parseFence(line) {
  const match = line.match(/^(\s*)(:{3,})\s*(?:\{([^}]*)\})?\s*$/);
  return match ? { indent: match[1].length, length: match[2].length, attrs: match[3] ?? '' } : null;
}

function parseAttrs(source = '') {
  const tokens = source.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  const id = tokens.find((token) => token.startsWith('#'))?.slice(1) ?? '';
  const classes = tokens.filter((token) => token.startsWith('.')).map((token) => token.slice(1));
  const values = {};
  for (const token of tokens) {
    const equals = token.indexOf('=');
    if (equals < 1) continue;
    const key = token.slice(0, equals);
    const raw = token.slice(equals + 1);
    values[key] = raw.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, (_, double, single) => double ?? single);
  }
  return { id, classes, values };
}

export function locateDivs(source) {
  const lines = source.split(/(?<=\n)/);
  let offset = 0;
  const stack = [];
  const found = [];
  for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
    const line = lines[lineNumber];
    const fence = parseFence(line.replace(/\r?\n$/, ''));
    if (fence) {
      if (!fence.attrs) {
        const open = stack.pop();
        if (open) found.push({ ...open, end: offset + line.length, endLine: lineNumber + 1 });
      } else stack.push({ attrs: parseAttrs(fence.attrs), rawAttrs: fence.attrs, start: offset, startLine: lineNumber + 1, bodyStart: offset + line.length });
    }
    offset += line.length;
  }
  return found.sort((left, right) => left.start - right.start);
}

export function locateDiv(source, id) {
  return locateDivs(source).find((div) => div.attrs.id === id) ?? null;
}

export function locateProof(source, target) {
  return locateDivs(source).find((div) => div.attrs.classes.includes('proof') && div.attrs.values.of?.replace(/^@/, '') === target.replace(/^@/, '')) ?? null;
}

function body(source, div) {
  if (!div) return null;
  const raw = source.slice(div.bodyStart, div.end);
  const closing = raw.lastIndexOf(':::');
  const bodyEnd = div.bodyStart + Math.max(0, closing);
  return { bodyStart: div.bodyStart, bodyEnd, text: source.slice(div.bodyStart, bodyEnd).trim() };
}

export async function readLocatedBlock(file, id) {
  const source = await readFile(file, 'utf8');
  const div = locateDiv(source, id);
  if (!div) return null;
  const proofDiv = locateProof(source, id);
  return {
    source,
    div,
    raw: source.slice(div.start, div.end),
    statement: body(source, div),
    proof: proofDiv ? body(source, proofDiv) : null,
    proofDiv
  };
}

export async function readLocatedProof(file, id) {
  const source = await readFile(file, 'utf8');
  const proofDiv = locateProof(source, id);
  return proofDiv ? { source, proofDiv, proof: body(source, proofDiv), raw: source.slice(proofDiv.start, proofDiv.end) } : null;
}

export function mergeProof(canonical, candidate) {
  if (!canonical?.div || !candidate?.proofDiv) throw new Error('Canonical result and linked proposal proof are required');
  const proofText = candidate.source.slice(candidate.proofDiv.start, candidate.proofDiv.end).trim();
  if (canonical.proofDiv) {
    return `${canonical.source.slice(0, canonical.proofDiv.start)}${proofText}${canonical.source.slice(canonical.proofDiv.end)}`;
  }
  const before = canonical.source.slice(0, canonical.div.end).replace(/\s*$/, '');
  const after = canonical.source.slice(canonical.div.end).replace(/^\s*/, '');
  return `${before}\n\n${proofText}\n${after ? `\n${after}` : ''}`;
}

const controlMarkers = new Set(['OPEN', 'REJECTED', 'VERIFIED', 'REVOKED']);

export function setProofMarker(source, target, marker = null) {
  if (marker != null && !controlMarkers.has(marker)) throw new Error(`Invalid proof marker: ${marker}`);
  const proofDiv = locateProof(source, target);
  if (!proofDiv) throw new Error(`Linked proof of @${target.replace(/^@/, '')} was not found`);
  const proofBody = body(source, proofDiv);
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.slice(proofBody.bodyStart, proofBody.bodyEnd).split(/\r?\n/);
  const firstContent = lines.findIndex((line) => line.trim() !== '');
  if (firstContent >= 0 && controlMarkers.has(lines[firstContent].trim())) lines.splice(firstContent, 1);
  const content = lines.join(newline).trim();
  const nextBody = marker
    ? `${marker}${content ? `${newline}${newline}${content}` : ''}${newline}`
    : `${content}${content ? newline : ''}`;
  return `${source.slice(0, proofBody.bodyStart)}${nextBody}${source.slice(proofBody.bodyEnd)}`;
}
