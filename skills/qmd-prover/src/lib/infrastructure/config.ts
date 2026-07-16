import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { asRecord, asStringArray, hasErrorCode } from '../shared/core.js';
import type { JsonObject, JsonValue } from '../shared/types.js';

export interface ProjectConfig {
  name: string;
  root: string;
  'discover-qmd-recursively': boolean;
  exclude: string[];
}

export interface GoalsConfig {
  'id-prefix': string;
  'protect-statements': boolean;
}

export interface SemanticConfig { 'wildcard-imports': boolean }

/** Optional explicit paths to external tools, used when they are not on PATH. */
export interface ToolsConfig {
  pandoc: string;
  quarto: string;
}

export interface VerificationConfig {
  /** none | claude | codex | command */
  backend: string;
  model: string;
  /** Reasoning effort forwarded to the backend: low | medium | high | xhigh | max. */
  effort: string;
  'fresh-context': boolean;
  /** How strictly an uncited non-standard term is flagged: lenient | standard | strict. */
  citations: string;
  /** How completely a valid step must be spelled out — and whether gaps block: lenient | standard | strict. */
  rigor: string;
  /** Path to the claude/codex CLI when backend is claude|codex (defaults to the backend name on PATH). */
  executable?: string;
  /** Fully custom verifier argv when backend is `command` (advanced escape hatch). */
  command?: string | string[];
  args?: string[];
  timeout?: number;
  [key: string]: unknown;
}

export interface RenderConfig {
  'graph-engine': string;
  'output-dir': string;
}

export interface QmdProverConfig {
  project: ProjectConfig;
  goals: GoalsConfig;
  semantic: SemanticConfig;
  tools: ToolsConfig;
  verification: VerificationConfig;
  render: RenderConfig;
}

const defaults: QmdProverConfig = {
  project: { name: '', root: '..', 'discover-qmd-recursively': true, exclude: ['.qmd-prover'] },
  goals: { 'id-prefix': 'thm-main-', 'protect-statements': true },
  semantic: { 'wildcard-imports': false },
  tools: { pandoc: '', quarto: '' },
  verification: { backend: 'none', model: 'configurable', effort: 'high', 'fresh-context': true, citations: 'standard', rigor: 'standard', executable: '' },
  render: { 'graph-engine': 'builtin', 'output-dir': '.qmd-prover/generated' }
};

function scalar(text: string): JsonValue {
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

export function parseSimpleYaml(source: string): JsonObject {
  const root: JsonObject = {};
  const stack = [{ indent: -1, value: root }];
  for (const raw of source.split(/\r?\n/)) {
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue;
    const indent = raw.match(/^\s*/)?.[0].length ?? 0;
    const match = raw.trim().match(/^([^:]+):(?:\s*(.*))?$/);
    if (!match) continue;
    while ((stack.at(-1)?.indent ?? -1) >= indent) stack.pop();
    const parent = stack.at(-1)?.value;
    if (!parent) continue;
    const key = match[1]?.trim() ?? '';
    if (!match[2]) {
      parent[key] = {};
      stack.push({ indent, value: asRecord(parent[key]) });
    } else parent[key] = scalar(match[2]);
  }
  return root;
}

function merge(left: object, right: JsonObject): JsonObject {
  const result = asRecord(structuredClone(left));
  for (const [key, value] of Object.entries(right ?? {})) {
    result[key] = value && typeof value === 'object' && !Array.isArray(value)
      ? merge(asRecord(result[key]), asRecord(value)) : value;
  }
  return result;
}

function booleanSetting(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

const STRICTNESS_LEVELS = ['lenient', 'standard', 'strict'];
// Reasoning-effort levels shared by the codex and claude backends (both accept low..xhigh;
// claude also accepts max, which codex tolerates). Ordered from cheapest to most thorough.
const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];

function enumSetting(value: unknown, allowed: string[], fallback: string): string {
  return typeof value === 'string' && allowed.includes(value) ? value : fallback;
}

function normalizedConfig(value: JsonObject): QmdProverConfig {
  const project = asRecord(value.project);
  const goals = asRecord(value.goals);
  const semantic = asRecord(value.semantic);
  const tools = asRecord(value.tools);
  const verification = asRecord(value.verification);
  const render = asRecord(value.render);
  return {
    project: {
      name: typeof project.name === 'string' ? project.name : defaults.project.name,
      root: typeof project.root === 'string' ? project.root : defaults.project.root,
      'discover-qmd-recursively': booleanSetting(project['discover-qmd-recursively'], defaults.project['discover-qmd-recursively']),
      exclude: Array.isArray(project.exclude) ? asStringArray(project.exclude) : defaults.project.exclude
    },
    goals: {
      'id-prefix': typeof goals['id-prefix'] === 'string' ? goals['id-prefix'] : defaults.goals['id-prefix'],
      'protect-statements': booleanSetting(goals['protect-statements'], defaults.goals['protect-statements'])
    },
    semantic: {
      'wildcard-imports': booleanSetting(semantic['wildcard-imports'], defaults.semantic['wildcard-imports'])
    },
    tools: {
      pandoc: typeof tools.pandoc === 'string' ? tools.pandoc : defaults.tools.pandoc,
      quarto: typeof tools.quarto === 'string' ? tools.quarto : defaults.tools.quarto
    },
    verification: {
      ...verification,
      backend: typeof verification.backend === 'string' ? verification.backend : defaults.verification.backend,
      model: typeof verification.model === 'string' ? verification.model : defaults.verification.model,
      effort: enumSetting(verification.effort, EFFORT_LEVELS, defaults.verification.effort),
      executable: typeof verification.executable === 'string' ? verification.executable : defaults.verification.executable,
      'fresh-context': booleanSetting(verification['fresh-context'], defaults.verification['fresh-context']),
      citations: enumSetting(verification.citations, STRICTNESS_LEVELS, defaults.verification.citations),
      rigor: enumSetting(verification.rigor, STRICTNESS_LEVELS, defaults.verification.rigor)
    },
    render: {
      'graph-engine': typeof render['graph-engine'] === 'string' ? render['graph-engine'] : defaults.render['graph-engine'],
      'output-dir': typeof render['output-dir'] === 'string' ? render['output-dir'] : defaults.render['output-dir']
    }
  };
}

export async function loadConfig(root: string): Promise<QmdProverConfig> {
  try {
    const source = await readFile(path.join(root, '.qmd-prover', 'config.yml'), 'utf8');
    return normalizedConfig(merge(defaults, parseSimpleYaml(source)));
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return structuredClone(defaults);
    throw error;
  }
}

/**
 * Resolve the pandoc command. Precedence: explicit override (programmatic/CLI) >
 * QMD_PROVER_PANDOC env > config `tools.pandoc` > `pandoc` on PATH.
 */
export function pandocCommand(config?: QmdProverConfig, override?: string): string {
  return override?.trim() || process.env.QMD_PROVER_PANDOC?.trim() || config?.tools?.pandoc?.trim() || 'pandoc';
}

/**
 * Resolve the quarto command. Precedence: explicit override > QMD_PROVER_QUARTO env >
 * config `tools.quarto` > `quarto` on PATH.
 */
export function quartoCommand(config?: QmdProverConfig, override?: string): string {
  return override?.trim() || process.env.QMD_PROVER_QUARTO?.trim() || config?.tools?.quarto?.trim() || 'quarto';
}

export { defaults };
