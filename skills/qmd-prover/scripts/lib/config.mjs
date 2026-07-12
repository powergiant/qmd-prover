import { readFile } from 'node:fs/promises';
import path from 'node:path';

const defaults = {
  project: { name: '', root: '..', 'discover-qmd-recursively': true, exclude: ['.qmd-prover'] },
  goals: { 'id-prefix': 'thm-main-', 'protect-statements': true },
  semantic: { 'wildcard-imports': false },
  verification: { backend: 'none', model: 'configurable', effort: 'high', 'fresh-context': true, 'require-zero-gaps': true },
  render: { 'graph-engine': 'builtin', 'output-dir': '.qmd-prover/generated' }
};

function scalar(text) {
  const value = text.trim();
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (value.startsWith('[') && value.endsWith(']')) {
    return value.slice(1, -1).split(',').map((part) => part.trim()).filter(Boolean).map(scalar);
  }
  return value.replace(/^(['"])(.*)\1$/, '$2');
}

export function parseSimpleYaml(source) {
  const root = {};
  const stack = [{ indent: -1, value: root }];
  for (const raw of source.split(/\r?\n/)) {
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue;
    const indent = raw.match(/^\s*/)[0].length;
    const match = raw.trim().match(/^([^:]+):(?:\s*(.*))?$/);
    if (!match) continue;
    while (stack.at(-1).indent >= indent) stack.pop();
    const parent = stack.at(-1).value;
    const key = match[1].trim();
    if (!match[2]) {
      parent[key] = {};
      stack.push({ indent, value: parent[key] });
    } else parent[key] = scalar(match[2]);
  }
  return root;
}

function merge(left, right) {
  const result = structuredClone(left);
  for (const [key, value] of Object.entries(right ?? {})) {
    result[key] = value && typeof value === 'object' && !Array.isArray(value)
      ? merge(result[key] ?? {}, value) : value;
  }
  return result;
}

export async function loadConfig(root) {
  try {
    const source = await readFile(path.join(root, '.qmd-prover', 'config.yml'), 'utf8');
    return merge(defaults, parseSimpleYaml(source));
  } catch (error) {
    if (error.code === 'ENOENT') return structuredClone(defaults);
    throw error;
  }
}

export { defaults };
