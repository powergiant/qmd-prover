import { readFile } from 'node:fs/promises';
import { auxLayout } from './aux.js';
import { asRecord, asStringArray, hasErrorCode } from '../shared/core.js';
/** The verifier backends a config may name. An unrecognized value is a ConfigError. */
export const VERIFIER_BACKENDS = ['none', 'claude', 'codex', 'command'];
const defaults = {
    project: { exclude: ['.qmd-prover'] },
    goals: { 'id-prefix': 'thm-main-', 'protect-statements': true },
    semantic: { 'wildcard-imports': false },
    tools: { pandoc: '', quarto: '' },
    verification: { backend: 'none', model: '', effort: 'high', 'fresh-context': true, citations: 'standard', rigor: 'standard', 'rigor-disprove': 'standard', tools: [], executable: '' },
    render: { 'graph-engine': 'builtin', 'output-dir': '.qmd-prover/generated' }
};
/**
 * A problem with the shape or content of `.qmd-prover/config.yml` — a malformed line, or a value
 * outside the accepted set. Thrown by the parser and by validation so callers (e.g. doctor) can
 * report a config problem instead of crashing on an unexpected error.
 */
export class ConfigError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ConfigError';
    }
}
/** Remove one pair of matching surrounding quotes if present. No escape sequences are interpreted. */
function unquote(text) {
    const quote = text[0];
    if (text.length >= 2 && (quote === '"' || quote === "'") && text.at(-1) === quote)
        return text.slice(1, -1);
    return text;
}
/**
 * Split inline-list contents on commas that are not inside a quoted element, so a quoted element
 * may contain a comma. Empty elements (e.g. a trailing comma) are dropped.
 */
function splitList(inner) {
    const items = [];
    let current = '';
    let quote = '';
    for (const char of inner) {
        if (quote) {
            current += char;
            if (char === quote)
                quote = '';
            continue;
        }
        if (char === '"' || char === "'") {
            quote = char;
            current += char;
            continue;
        }
        if (char === ',') {
            items.push(current);
            current = '';
            continue;
        }
        current += char;
    }
    items.push(current);
    return items.map((part) => part.trim()).filter(Boolean);
}
/**
 * Interpret the text after a `key:` colon. The value's kind is fixed by its first character: a
 * quote opens a literal string, `[` opens an inline list of strings, and anything else is bare
 * text — the exact words `true`/`false` become booleans, everything else stays a string (there are
 * no numbers or nulls in this subset). Quotes and brackets protect their contents from comment
 * removal; elsewhere a `#` that starts the text or follows whitespace begins a comment that runs to
 * end of line. An empty value, or one that is only a comment, opens a nested mapping.
 */
function parseValue(rest, lineNo) {
    const value = rest.replace(/^[ \t]+/, '');
    if (value === '')
        return { nested: true };
    const first = value[0];
    if (first === '"' || first === "'") {
        const end = value.indexOf(first, 1);
        if (end === -1)
            throw new ConfigError(`line ${lineNo}: unterminated quoted string`);
        const after = value.slice(end + 1).replace(/^[ \t]+/, '');
        if (after !== '' && !after.startsWith('#'))
            throw new ConfigError(`line ${lineNo}: unexpected text after quoted value`);
        return { nested: false, value: value.slice(1, end) };
    }
    if (first === '[') {
        let end = -1;
        let quote = '';
        for (let i = 1; i < value.length; i += 1) {
            const char = value[i];
            if (quote) {
                if (char === quote)
                    quote = '';
                continue;
            }
            if (char === '"' || char === "'")
                quote = char;
            else if (char === ']') {
                end = i;
                break;
            }
        }
        if (end === -1)
            throw new ConfigError(`line ${lineNo}: unterminated inline list`);
        const after = value.slice(end + 1).replace(/^[ \t]+/, '');
        if (after !== '' && !after.startsWith('#'))
            throw new ConfigError(`line ${lineNo}: unexpected text after inline list`);
        return { nested: false, value: splitList(value.slice(1, end)).map(unquote) };
    }
    let cut = -1;
    for (let i = 0; i < value.length; i += 1) {
        if (value[i] === '#' && (i === 0 || /\s/.test(value[i - 1] ?? ''))) {
            cut = i;
            break;
        }
    }
    const core = (cut === -1 ? value : value.slice(0, cut)).trimEnd();
    if (core === '')
        return { nested: true };
    if (core === 'true')
        return { nested: false, value: true };
    if (core === 'false')
        return { nested: false, value: false };
    return { nested: false, value: core };
}
/**
 * Parse the restricted config subset: nested mappings by (space-only) indentation, with scalar
 * values that are booleans, strings (optionally quoted), or inline string lists. Numbers, null,
 * block sequences (`- item`), anchors, and multi-line scalars are not part of the subset. A
 * malformed line — a tab in the indentation, a line that is not `key: value`/`key:`, or a value
 * with an unterminated quote/bracket — throws a ConfigError naming the line number.
 */
export function parseSimpleYaml(source) {
    const root = {};
    const stack = [{ indent: -1, value: root }];
    const lines = source.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
        const raw = lines[index] ?? '';
        const lineNo = index + 1;
        if (raw.trim() === '' || raw.trimStart().startsWith('#'))
            continue;
        const lead = raw.match(/^[ \t]*/)?.[0] ?? '';
        if (lead.includes('\t'))
            throw new ConfigError(`line ${lineNo}: tabs are not allowed in indentation; use spaces`);
        const match = raw.match(/^( *)([A-Za-z0-9_-]+):(.*)$/);
        if (!match)
            throw new ConfigError(`line ${lineNo}: expected "key: value" or "key:"`);
        const indent = match[1]?.length ?? 0;
        const key = match[2] ?? '';
        const parsed = parseValue(match[3] ?? '', lineNo);
        while ((stack.at(-1)?.indent ?? -1) >= indent)
            stack.pop();
        const parent = stack.at(-1)?.value;
        if (!parent)
            throw new ConfigError(`line ${lineNo}: inconsistent indentation`);
        if (parsed.nested) {
            const child = {};
            parent[key] = child;
            stack.push({ indent, value: child });
        }
        else {
            parent[key] = parsed.value;
        }
    }
    return root;
}
function merge(left, right) {
    const result = asRecord(structuredClone(left));
    for (const [key, value] of Object.entries(right ?? {})) {
        result[key] = value && typeof value === 'object' && !Array.isArray(value)
            ? merge(asRecord(result[key]), asRecord(value)) : value;
    }
    return result;
}
function booleanSetting(value, fallback) {
    return typeof value === 'boolean' ? value : fallback;
}
const STRICTNESS_LEVELS = ['lenient', 'standard', 'strict'];
// Reasoning-effort levels shared by the codex and claude backends (both accept low..xhigh;
// claude also accepts max, which codex tolerates). Ordered from cheapest to most thorough.
const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];
function enumSetting(value, allowed, fallback) {
    return typeof value === 'string' && allowed.includes(value) ? value : fallback;
}
/** The backend name, validated against VERIFIER_BACKENDS. An unrecognized value is a hard error
 *  rather than a silent downgrade to machine-only, so a typo cannot quietly disable verification. */
function validatedBackend(value) {
    if (value === undefined)
        return defaults.verification.backend;
    if (typeof value === 'string' && VERIFIER_BACKENDS.includes(value))
        return value;
    throw new ConfigError(`verification.backend: "${String(value)}" is not one of ${VERIFIER_BACKENDS.join(', ')}`);
}
/** The model id, or "" for the CLI's own default. The retired `configurable` sentinel is rejected
 *  with a migration hint — projects scaffolded before the change carry it, and forwarding it as a
 *  literal `--model configurable` would fail the verifier with a cryptic "unknown model" error. */
function validatedModel(value) {
    if (value === 'configurable')
        throw new ConfigError('verification.model: "configurable" is no longer a value; use "" for the CLI\'s default model');
    return typeof value === 'string' ? value : defaults.verification.model;
}
function normalizedConfig(value) {
    const project = asRecord(value.project);
    const goals = asRecord(value.goals);
    const semantic = asRecord(value.semantic);
    const tools = asRecord(value.tools);
    const verification = asRecord(value.verification);
    const render = asRecord(value.render);
    return {
        project: {
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
            backend: validatedBackend(verification.backend),
            model: validatedModel(verification.model),
            effort: enumSetting(verification.effort, EFFORT_LEVELS, defaults.verification.effort),
            executable: typeof verification.executable === 'string' ? verification.executable : defaults.verification.executable,
            'fresh-context': booleanSetting(verification['fresh-context'], defaults.verification['fresh-context']),
            citations: enumSetting(verification.citations, STRICTNESS_LEVELS, defaults.verification.citations),
            rigor: enumSetting(verification.rigor, STRICTNESS_LEVELS, defaults.verification.rigor),
            'rigor-disprove': enumSetting(verification['rigor-disprove'], STRICTNESS_LEVELS, defaults.verification['rigor-disprove']),
            // Kept as authored strings; protocol.ts filters to the known tool names for the contract/prompt.
            tools: Array.isArray(verification.tools) ? asStringArray(verification.tools) : defaults.verification.tools
        },
        render: {
            'graph-engine': typeof render['graph-engine'] === 'string' ? render['graph-engine'] : defaults.render['graph-engine'],
            'output-dir': typeof render['output-dir'] === 'string' ? render['output-dir'] : defaults.render['output-dir']
        }
    };
}
export async function loadConfig(root) {
    const file = auxLayout(root).config;
    let source;
    try {
        source = await readFile(file, 'utf8');
    }
    catch (error) {
        if (hasErrorCode(error, 'ENOENT'))
            return structuredClone(defaults);
        throw error;
    }
    try {
        return normalizedConfig(merge(defaults, parseSimpleYaml(source)));
    }
    catch (error) {
        if (error instanceof ConfigError)
            throw new ConfigError(`.qmd-prover/config.yml ${error.message}`);
        throw error;
    }
}
/**
 * Resolve the pandoc command. Precedence: explicit override (programmatic/CLI) >
 * QMD_PROVER_PANDOC env > config `tools.pandoc` > `pandoc` on PATH.
 */
export function pandocCommand(config, override) {
    return override?.trim() || process.env.QMD_PROVER_PANDOC?.trim() || config?.tools?.pandoc?.trim() || 'pandoc';
}
/**
 * Resolve the quarto command. Precedence: explicit override > QMD_PROVER_QUARTO env >
 * config `tools.quarto` > `quarto` on PATH.
 */
export function quartoCommand(config, override) {
    return override?.trim() || process.env.QMD_PROVER_QUARTO?.trim() || config?.tools?.quarto?.trim() || 'quarto';
}
export { defaults };
