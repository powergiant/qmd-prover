import { spawn } from 'node:child_process';
import { asArray, asErrorLike, asRecord, asString, isRecord } from '../shared/core.js';
import type { JsonObject } from '../shared/types.js';

export interface PandocNode extends Record<string, unknown> {
  t: string;
  c?: unknown;
}

export interface PandocDocument extends JsonObject {
  meta: JsonObject;
  blocks: unknown[];
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

export async function readAst(file: string, { pandoc = process.env.QMD_PROVER_PANDOC || 'pandoc' }: { pandoc?: string } = {}): Promise<PandocDocument> {
  let result;
  try {
    result = await collect(spawn(pandoc, ['--from=markdown+fenced_divs+citations', '--to=json', file], { stdio: ['ignore', 'pipe', 'pipe'] }));
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
    return { ...parsed, meta: asRecord(parsed.meta), blocks: parsed.blocks };
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

export function inlineText(inlines: unknown = []): string {
  let text = '';
  walk(inlines, (node) => {
    if (node.t === 'Str') text += asString(node.c);
    else if (node.t === 'Space' || node.t === 'SoftBreak' || node.t === 'LineBreak') text += ' ';
    else if (node.t === 'Code' || node.t === 'Math') text += asString(asArray(node.c).at(-1));
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
