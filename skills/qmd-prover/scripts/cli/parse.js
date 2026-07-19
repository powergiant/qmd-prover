import { resolveHelpPath } from './help.js';
import { KINDS, ORIGINS, STATUSES } from './filters.js';
import { boundedInteger } from '../core/graph/algorithms.js';
const optionString = (value) => typeof value === 'string' ? value : undefined;
/** Split off a `--print` flag, rejecting duplicates, and return the remaining args. */
function presentation(args) {
    if (args.filter((item) => item === '--print').length > 1)
        throw new Error('Duplicate option --print');
    return { print: args.includes('--print'), args: args.filter((item) => item !== '--print') };
}
/** Pull an optional boolean flag out of an argument list, rejecting duplicates. */
function extractFlag(args, flag) {
    const occurrences = args.filter((item) => item === flag).length;
    if (occurrences > 1)
        throw new Error(`Duplicate option ${flag}`);
    return { present: occurrences === 1, args: args.filter((item) => item !== flag) };
}
function enumOption(name, value, allowed) {
    if (value !== undefined && !allowed.includes(value))
        throw new Error(`--${name} must be one of: ${allowed.join(', ')}`);
    return value;
}
/** Parse `--name value` options and boolean `--flag`s into a map, collecting positionals. */
function optionValues(args, names, flags = new Set()) {
    const options = {};
    const positionals = [];
    for (let index = 0; index < args.length; index += 1) {
        const name = args[index];
        if (!name.startsWith('--')) {
            positionals.push(name);
            continue;
        }
        const key = name.slice(2);
        if (flags.has(key)) {
            if (options[key.replaceAll('-', '')] === true)
                throw new Error(`Duplicate option ${name}`);
            options[key.replaceAll('-', '')] = true;
            continue;
        }
        if (!names.has(key))
            throw new Error(`Unknown option ${name}`);
        if (!args[index + 1] || args[index + 1].startsWith('--'))
            throw new Error(`Missing value for ${name}`);
        if (Object.hasOwn(options, key.replaceAll('-', '')))
            throw new Error(`Duplicate option ${name}`);
        options[key.replaceAll('-', '')] = args[index + 1];
        index += 1;
    }
    return { positionals, options };
}
// ---------------------------------------------------------------------------
// Dependency operation resolution. Several operations are multi-word (`reverse
// dependencies`, `alternative paths`, `unused imports`, `ready for ai`); the
// longest matching token sequence wins, and a directly typed hyphenated form
// (e.g. `reverse-dependencies`) is rejected as retired.
// ---------------------------------------------------------------------------
const DEPENDENCY_OPERATIONS = [
    ['dependencies'], ['reverse', 'dependencies'], ['impact'], ['frontier'], ['path'],
    ['alternative', 'paths'], ['cycles'], ['findings'], ['unused', 'imports'], ['unused', 'exports'],
    ['isolated'], ['unreachable'], ['ready', 'for', 'ai'], ['reused'], ['search']
];
const OPERATION_NAMES = new Set(DEPENDENCY_OPERATIONS.map((sequence) => sequence.join('-')));
function resolveOperation(tokens) {
    const compound = DEPENDENCY_OPERATIONS.filter((sequence) => sequence.length > 1).sort((left, right) => right.length - left.length);
    for (const sequence of compound) {
        if (sequence.every((token, index) => tokens[index] === token)) {
            return { operation: sequence.join('-'), tail: tokens.slice(sequence.length) };
        }
    }
    return { operation: tokens[0], tail: tokens.slice(1), retired: tokens[0]?.includes('-') === true };
}
// ---------------------------------------------------------------------------
// Per-command parsers. Each maps its argument tail to a Command variant.
// ---------------------------------------------------------------------------
function parseHelp(args) {
    let pathArgs;
    const direct = args[0] === 'help';
    if (direct)
        pathArgs = args.slice(1);
    else {
        const index = args.findIndex((item) => item === 'help' || item === '--help' || item === '-h');
        if (index < 0)
            return null;
        pathArgs = args.slice(0, index);
    }
    return { kind: 'help', of: resolveHelpPath(pathArgs, direct) };
}
function parseDoctor(rest) {
    const parsed = presentation(rest);
    if (parsed.args.length)
        throw new Error('doctor accepts only --print');
    return { kind: 'doctor', print: parsed.print };
}
function parseInit(rest) {
    const allowed = new Set(['--adopt-existing', '--append-contract', '--sync-contract']);
    const positional = rest.find((item) => !item.startsWith('--'));
    if (positional)
        throw new Error(`init accepts no positional arguments; received: ${positional}`);
    const unknown = rest.find((item) => !allowed.has(item));
    if (unknown)
        throw new Error(`Unknown init option: ${unknown}`);
    if (new Set(rest).size !== rest.length)
        throw new Error(`Duplicate init option: ${rest.find((item, index) => rest.indexOf(item) !== index)}`);
    if (rest.length > 1)
        throw new Error('The init mutation options --adopt-existing, --append-contract, and --sync-contract are mutually exclusive');
    return {
        kind: 'init',
        adoptExisting: rest.includes('--adopt-existing'),
        appendContract: rest.includes('--append-contract'),
        syncContract: rest.includes('--sync-contract')
    };
}
function parseInspect(rest) {
    const graphFlag = extractFlag(rest, '--graph');
    const { print, args } = presentation(graphFlag.args);
    const graph = graphFlag.present;
    const [subcommand, ...tail] = args;
    if (subcommand === 'project') {
        if (tail.length)
            throw new Error('inspect project accepts only --print and --graph');
        return { kind: 'inspect', sub: 'project', print, graph };
    }
    if (subcommand === 'fact') {
        if (tail.length !== 1)
            throw new Error(`inspect ${subcommand} requires one semantic ID and optional --print and --graph`);
        if (!tail[0].replace(/^@/, '').trim())
            throw new Error('inspect fact requires a non-empty semantic ID');
        return { kind: 'inspect', sub: 'fact', id: tail[0], print, graph };
    }
    if (subcommand === 'path') {
        if (tail.length !== 1)
            throw new Error('inspect path requires one QMD file or folder and optional --print and --graph');
        return { kind: 'inspect', sub: 'path', target: tail[0], print, graph };
    }
    throw new Error('inspect requires project, fact, or path');
}
function parseDependencySearch(tail, print) {
    const valueOptions = new Set(['kind', 'status', 'origin', 'path', 'related-to', 'frontier-of', 'used-by', 'depends-on', 'affected-by', 'stale-affected-by']);
    const flags = new Set(['reverse', 'direct', 'cycle-participant']);
    const extracted = optionValues(tail, valueOptions, flags);
    if (extracted.positionals.length > 1)
        throw new Error('dependency search accepts at most one query');
    const filters = {
        kind: enumOption('kind', optionString(extracted.options.kind), KINDS),
        status: enumOption('status', optionString(extracted.options.status), STATUSES),
        origin: enumOption('origin', optionString(extracted.options.origin), ORIGINS),
        path: optionString(extracted.options.path),
        relatedTo: optionString(extracted.options.relatedto),
        frontierOf: optionString(extracted.options.frontierof),
        usedBy: optionString(extracted.options.usedby),
        dependsOn: optionString(extracted.options.dependson),
        affectedBy: optionString(extracted.options.affectedby),
        staleAffectedBy: optionString(extracted.options.staleaffectedby),
        reverse: extracted.options.reverse === true,
        direct: extracted.options.direct === true,
        cycleParticipant: extracted.options.cycleparticipant === true
    };
    return { kind: 'dependency', sub: 'search', query: extracted.positionals[0], filters, print };
}
function parseDependency(rest) {
    const { print, args } = presentation(rest);
    const { operation, tail, retired } = resolveOperation(args);
    if (!operation)
        throw new Error('dependency requires an operation. Run qmd-prover help dependency.');
    if (retired || !OPERATION_NAMES.has(operation))
        throw new Error(`Unknown dependency command: ${operation}. Run qmd-prover help dependency.`);
    const op = operation;
    if (op === 'search')
        return parseDependencySearch(tail, print);
    if (op === 'alternative-paths') {
        const extracted = optionValues(tail, new Set(['limit', 'max-depth']));
        if (extracted.positionals.length !== 2)
            throw new Error('dependency alternative paths requires two semantic IDs');
        const maxPaths = extracted.options.limit === undefined ? undefined : boundedInteger(extracted.options.limit, 5, { name: '--limit', min: 1, max: 25 });
        const maxDepth = extracted.options.maxdepth === undefined ? undefined : boundedInteger(extracted.options.maxdepth, 64, { name: '--max-depth', min: 1, max: 100 });
        return { kind: 'dependency', sub: 'alternative-paths', from: extracted.positionals[0], to: extracted.positionals[1], maxPaths, maxDepth, print };
    }
    if (op === 'reused') {
        const extracted = optionValues(tail, new Set(['limit']));
        if (extracted.positionals.length)
            throw new Error('dependency reused accepts only --limit N and --print');
        const limit = extracted.options.limit === undefined ? undefined : boundedInteger(extracted.options.limit, 20, { name: '--limit', min: 1, max: 1000 });
        return { kind: 'dependency', sub: 'reused', limit, print };
    }
    const unknownOption = tail.find((item) => item.startsWith('--'));
    if (unknownOption)
        throw new Error(`Unknown option ${unknownOption}`);
    if (op === 'path') {
        if (tail.length !== 2)
            throw new Error('dependency path requires 2 semantic IDs');
        return { kind: 'dependency', sub: 'path', from: tail[0], to: tail[1], print };
    }
    if (op === 'dependencies' || op === 'reverse-dependencies' || op === 'impact' || op === 'frontier') {
        if (tail.length !== 1)
            throw new Error(`dependency ${op.replaceAll('-', ' ')} requires 1 semantic ID`);
        return { kind: 'dependency', sub: op, id: tail[0], print };
    }
    if (tail.length)
        throw new Error(`dependency ${op.replaceAll('-', ' ')} accepts no positional arguments`);
    return { kind: 'dependency', sub: op, print };
}
function parseCheck(rest) {
    const parsed = presentation(rest);
    const [subcommand, ...tail] = parsed.args;
    if (subcommand !== 'staleness')
        throw new Error('check requires the staleness subcommand. Run qmd-prover help check.');
    if (tail.length)
        throw new Error('check staleness accepts only --print');
    return { kind: 'check', sub: 'staleness', print: parsed.print };
}
function parseVerification(rest) {
    const [subcommand, value, ...tail] = rest;
    if (subcommand === 'list') {
        if (value !== undefined)
            throw new Error('verification list accepts no options');
        return { kind: 'verification', sub: 'list' };
    }
    if (subcommand === 'show') {
        if (!value)
            throw new Error('verification show requires a submission ID. Run qmd-prover verification list to discover IDs.');
        if (tail.length)
            throw new Error('verification show accepts only a submission ID');
        return { kind: 'verification', sub: 'show', submissionId: value };
    }
    throw new Error('verification requires the list or show subcommand. Run qmd-prover help verification.');
}
function parseRender(rest) {
    if (rest.some((item) => item !== '--allow-errors') || rest.filter((item) => item === '--allow-errors').length > 1) {
        throw new Error('render accepts only optional --allow-errors');
    }
    return { kind: 'render', allowErrors: rest.includes('--allow-errors') };
}
/** Pure map from argv to a fully-validated Command. Throws on invalid usage. */
export function parseCommand(args) {
    if (args.length === 0)
        return { kind: 'usage' };
    if (args[0] === 'version' || args[0] === '--version' || args[0] === '-v') {
        if (args.length > 1)
            throw new Error('version accepts no arguments');
        return { kind: 'version' };
    }
    const help = parseHelp(args);
    if (help !== null)
        return help;
    const [command, ...rest] = args;
    switch (command) {
        case 'doctor': return parseDoctor(rest);
        case 'init': return parseInit(rest);
        case 'inspect': return parseInspect(rest);
        case 'dependency': return parseDependency(rest);
        case 'check': return parseCheck(rest);
        case 'verification': return parseVerification(rest);
        case 'render': return parseRender(rest);
        default: throw new Error(`Unknown command: ${command}. Run qmd-prover help.`);
    }
}
