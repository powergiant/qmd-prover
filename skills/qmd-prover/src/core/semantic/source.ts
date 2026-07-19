import { readFile } from 'node:fs/promises';
import type { FactStatusValue } from '../shared/core.js';

interface ParsedAttributes { id: string; classes: string[]; values: Record<string, string> }
export interface LocatedDiv {
  attrs: ParsedAttributes;
  rawAttrs: string;
  start: number;
  startLine: number;
  bodyStart: number;
  end: number;
  endLine: number;
}
export interface LocatedBody { bodyStart: number; bodyEnd: number; text: string }
export interface LocatedBlock {
  source: string;
  div: LocatedDiv;
  raw: string;
  statement: LocatedBody | null;
  proof: LocatedBody | null;
  proofDiv: LocatedDiv | null;
}
export interface LocatedProof {
  source: string;
  proofDiv: LocatedDiv;
  proof: LocatedBody | null;
  raw: string;
}

function parseFence(line: string): { indent: number; length: number; attrs: string } | null {
  const match = line.match(/^(\s*)(:{3,})\s*(?:\{([^}]*)\})?\s*$/);
  return match ? { indent: match[1].length, length: match[2].length, attrs: match[3] ?? '' } : null;
}

function parseAttrs(source = ''): ParsedAttributes {
  const tokens = source.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  const id = tokens.find((token) => token.startsWith('#'))?.slice(1) ?? '';
  const classes = tokens.filter((token) => token.startsWith('.')).map((token) => token.slice(1));
  const values: Record<string, string> = {};
  for (const token of tokens) {
    const equals = token.indexOf('=');
    if (equals < 1) continue;
    const key = token.slice(0, equals);
    const raw = token.slice(equals + 1);
    values[key] = raw.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, (_, double, single) => double ?? single);
  }
  return { id, classes, values };
}

export function locateDivs(source: string): LocatedDiv[] {
  const lines = source.split(/(?<=\n)/);
  let offset = 0;
  const stack: Omit<LocatedDiv, 'end' | 'endLine'>[] = [];
  const found: LocatedDiv[] = [];
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

export function locateDiv(source: string, id: string): LocatedDiv | null {
  return locateDivs(source).find((div) => div.attrs.id === id) ?? null;
}

export function locateProof(source: string, target: string): LocatedDiv | null {
  return locateProofs(source, target)[0] ?? null;
}

/** Every `.proof` div targeting `target`, in document order (an abandoned attempt may sit beside the active proof). */
export function locateProofs(source: string, target: string): LocatedDiv[] {
  const id = target.replace(/^@/, '');
  return locateDivs(source).filter((div) => div.attrs.classes.includes('proof') && div.attrs.values.of?.replace(/^@/, '') === id);
}

function body(source: string, div: LocatedDiv | null): LocatedBody | null {
  if (!div) return null;
  const raw = source.slice(div.bodyStart, div.end);
  const closing = raw.lastIndexOf(':::');
  const bodyEnd = div.bodyStart + Math.max(0, closing);
  return { bodyStart: div.bodyStart, bodyEnd, text: source.slice(div.bodyStart, bodyEnd).trim() };
}

export async function readLocatedBlock(file: string, id: string): Promise<LocatedBlock | null> {
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

export async function readLocatedProof(file: string, id: string): Promise<LocatedProof | null> {
  const source = await readFile(file, 'utf8');
  const proofDiv = locateProof(source, id);
  return proofDiv ? { source, proofDiv, proof: body(source, proofDiv), raw: source.slice(proofDiv.start, proofDiv.end) } : null;
}

/**
 * Set or clear the engine-written `status` attribute on a located div's opening fence, leaving the
 * body — and therefore every content hash — untouched. Returns the source unchanged when the
 * attribute is already what we want, so a no-op inspection rewrites nothing.
 */
export function setStatusAttribute(source: string, div: LocatedDiv, status: FactStatusValue | null): string {
  const fence = source.slice(div.start, div.bodyStart);
  const next = fence.replace(/\{([^}]*)\}/, (_, inner: string) => `{${withStatus(inner, status)}}`);
  return next === fence ? source : `${source.slice(0, div.start)}${next}${source.slice(div.bodyStart)}`;
}

/** Rewrite a fence's attribute contents: drop any existing `status=…` token, then append the new one. */
function withStatus(inner: string, status: FactStatusValue | null): string {
  const cleaned = inner
    .replace(/(^|\s)status=(?:"[^"]*"|'[^']*'|[^\s}]+)/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^\s+|\s+$/g, '');
  if (!status) return cleaned;
  return `${cleaned}${cleaned ? ' ' : ''}status="${status}"`;
}
