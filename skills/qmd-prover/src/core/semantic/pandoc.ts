import { spawn } from 'node:child_process';
import { asArray, asErrorLike, asRecord, asString, isRecord } from '../shared/core.js';
import type { JsonObject } from '../shared/types.js';

export interface PandocNode extends Record<string, unknown> {
  t: string;
  c?: unknown;
}

export interface PandocDocument extends JsonObject {
  meta: JsonObject;
  blocks: PandocNode[];
}

/** The parsed form of a Pandoc attribute tuple `[id, classes, [[key, value], ...]]`. */
export interface PandocAttributes {
  id: string;
  classes: string[];
  values: Record<string, unknown>;
}

function collect(child: ReturnType<typeof spawn>, input?: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    if (!child.stdout || !child.stderr) return reject(new Error('Pandoc process pipes were not created'));
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    if (child.stdin) child.stdin.end(input);
  });
}

/**
 * The reader format. `tex_math_single_backslash` is what makes `\(…\)` and `\[…\]` parse as math
 * rather than as escaped brackets wrapped around raw TeX — without it every LaTeX delimiter a
 * mathematical source actually uses collapses into loose `Str` fragments and dropped `Raw*` nodes,
 * and the formulas vanish from every text projection.
 *
 * Quarto's own reader does *not* enable it, so `\(…\)` renders as a literal parenthesis while every
 * check here passes. The reader stays permissive anyway — adopting an existing development must not
 * fail on notation — and the project contract carries the rule that source is written with `$…$`.
 */
const READER_FORMAT = 'markdown+fenced_divs+citations+tex_math_single_backslash';

export async function readAst(file: string, { pandoc = process.env.QMD_PROVER_PANDOC || 'pandoc' }: { pandoc?: string } = {}): Promise<PandocDocument> {
  let result;
  try {
    result = await collect(spawn(pandoc, [`--from=${READER_FORMAT}`, '--to=json', file], { stdio: ['ignore', 'pipe', 'pipe'] }));
  } catch (error) {
    if (asErrorLike(error).code === 'ENOENT') {
      throw new Error(`Pandoc is required to parse QMD. Install Pandoc or set QMD_PROVER_PANDOC (tried: ${pandoc}).`);
    }
    throw error;
  }
  if (result.code !== 0) throw new Error(`Pandoc could not parse ${file}: ${result.stderr.trim()}`);
  try {
    const parsed: unknown = JSON.parse(result.stdout);
    if (!isRecord(parsed) || !Array.isArray(parsed.blocks)) throw new Error('invalid Pandoc document');
    return { ...parsed, meta: asRecord(parsed.meta), blocks: parsed.blocks as PandocNode[] };
  } catch {
    throw new Error(`Pandoc returned invalid JSON for ${file}`);
  }
}

export function walk(value: unknown, visit: (node: PandocNode) => void): void {
  if (!value || typeof value !== 'object') return;
  if (isRecord(value) && typeof value.t === 'string') visit({ ...value, t: value.t });
  if (Array.isArray(value)) for (const item of value) walk(item, visit);
  else for (const child of Object.values(value)) walk(child, visit);
}

/** TeX-flavoured raw formats, whose content is source we want to keep rather than markup to drop. */
const TEX_FORMATS = new Set(['tex', 'latex']);

/**
 * Render a `Math` node back to its LaTeX source, delimiters included. A statement is mostly formulas,
 * so the text projection has to carry them verbatim; keeping the delimiters means a reader (human or
 * model) can still tell display math from inline math and from the surrounding prose.
 */
function mathText(node: PandocNode): string {
  const content = asArray(node.c);
  const body = asString(content.at(-1));
  return asRecord(content[0]).t === 'DisplayMath' ? `\\[${body}\\]` : `\\(${body}\\)`;
}

export function inlineText(inlines: unknown = []): string {
  let text = '';
  walk(inlines, (node) => {
    if (node.t === 'Str') text += asString(node.c);
    else if (node.t === 'Space' || node.t === 'SoftBreak' || node.t === 'LineBreak') text += ' ';
    else if (node.t === 'Math') text += mathText(node);
    else if (node.t === 'Code') text += asString(asArray(node.c).at(-1));
    // Raw TeX is what an environment written out longhand (`\begin{equation}…`) parses to. It is
    // content, not presentation, so it is kept verbatim; raw HTML and other formats stay dropped.
    else if (node.t === 'RawInline' || node.t === 'RawBlock') {
      const content = asArray(node.c);
      if (TEX_FORMATS.has(asString(content[0]))) text += ` ${asString(content[1])} `;
    }
  });
  return text.replace(/\s+/g, ' ').trim();
}

export function references(value: unknown): string[] {
  const found = new Set<string>();
  walk(value, (node) => {
    const content = asArray(node.c);
    if (node.t === 'Cite' && Array.isArray(content[0])) {
      for (const value of content[0]) {
        const citation = asRecord(value);
        const id = asString(citation.citationId);
        if (/^(def|lem|thm|prp|cor)-/.test(id)) found.add(id);
      }
    }
  });
  return [...found].sort();
}

export function normalizedAst(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizedAst);
  if (!value || typeof value !== 'object') return value;
  const record = asRecord(value);
  if (record.t === 'Space' || record.t === 'SoftBreak' || record.t === 'LineBreak') return { t: 'Space' };
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) output[key] = normalizedAst(record[key]);
  return output;
}

/** Parse a Pandoc attribute tuple `[id, classes, [[key, value], ...]]` into named fields. */
export function attrs(value: unknown = ['', [], []]): PandocAttributes {
  const tuple = asArray(value);
  const pairs = asArray(tuple[2]).filter((item): item is [unknown, unknown] => Array.isArray(item) && item.length >= 2);
  return {
    id: asString(tuple[0]),
    classes: asArray(tuple[1]).map(String),
    values: Object.fromEntries(pairs.map(([key, item]) => [String(key), item]))
  };
}

/** Unpack a `Div` node into its attributes and its child block nodes. */
export function divContent(node: PandocNode): { attr: PandocAttributes; blocks: PandocNode[] } {
  const content = asArray(node.c);
  return {
    attr: attrs(content[0]),
    blocks: asArray(content[1]).filter((block): block is PandocNode => isRecord(block) && typeof block.t === 'string')
  };
}

/** The inline text of a `Para`/`Plain` block, or `null` for any other block. */
export function paragraphText(block: PandocNode | undefined): string | null {
  if (!block || (block.t !== 'Para' && block.t !== 'Plain')) return null;
  return inlineText(block.c ?? []);
}

/** Flatten a Pandoc `Meta*` value into plain JS strings, arrays, and maps. */
export function metaValue(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const record = asRecord(value);
  if (record.t === 'MetaMap') return Object.fromEntries(Object.entries(asRecord(record.c)).map(([key, item]) => [key, metaValue(item)]));
  if (record.t === 'MetaList') return asArray(record.c).map(metaValue);
  if (record.t === 'MetaString' || record.t === 'MetaBool') return record.c;
  if (record.t === 'MetaInlines') return inlineText(record.c);
  if (record.t === 'MetaBlocks') return inlineText(record.c);
  return record.c ?? value;
}
