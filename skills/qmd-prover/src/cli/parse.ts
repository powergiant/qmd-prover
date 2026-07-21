import { resolveHelpPath } from './help.js';
import { KINDS, ORIGINS, SETS, STATUSES } from './filters.js';
import { boundedInteger } from '../core/graph/algorithms.js';

// ---------------------------------------------------------------------------
// The command model and its parser. Everything here is pure: it maps an argument
// list to a fully-validated `Command`, throwing on invalid usage (surfaced as
// exit 1 by the entry script) and never touching the process or the disk. The
// CLI runtime (run.ts) consumes a `Command` and runs it; help prose (help.ts) is
// rendered from a command. This module is the single representation of the CLI
// surface. The filter vocabulary (KINDS/STATUSES/SETS/ORIGINS) lives in filters.js.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Command shape. A discriminated union that mirrors the command tree: a group
// command (`inspect`, `dependency`, `check`, `verification`) shares one `kind`
// and distinguishes its leaves with a string literal `sub`; every leaf carries
// exactly the fields it validated — no opaque option bags. The two non-runnable
// meta-commands, `usage` (no arguments) and `help` (a request for another
// command's help, carrying only its target path), are commands too.
// ---------------------------------------------------------------------------

/** The graph-aware filters accepted by `dependency search`. */
export interface SearchFilters {
  kind?: string;
  status?: string;
  set?: string;
  origin?: string;
  path?: string;
  relatedTo?: string;
  frontierOf?: string;
  usedBy?: string;
  dependsOn?: string;
  affectedBy?: string;
  reverse: boolean;
  direct: boolean;
  cycleParticipant: boolean;
}

export type Command =
  | { kind: 'usage' }
  | { kind: 'help'; of: string }
  | { kind: 'version' }
  | { kind: 'install'; scope: 'local' | 'global'; host: 'codex' | 'claude'; dir?: string }
  | { kind: 'doctor'; print: boolean }
  | { kind: 'init'; adoptExisting: boolean; appendContract: boolean; syncContract: boolean }
  | { kind: 'render'; allowErrors: boolean }
  | { kind: 'inspect'; sub: 'project'; print: boolean; graph: boolean }
  | { kind: 'inspect'; sub: 'fact'; id: string; print: boolean; graph: boolean }
  | { kind: 'inspect'; sub: 'path'; target: string; print: boolean; graph: boolean }
  // `dependency` sub is the operation name passed straight to analyzeDependencies.
  | { kind: 'dependency'; sub: 'dependencies'; id: string; print: boolean }
  | { kind: 'dependency'; sub: 'reverse-dependencies'; id: string; print: boolean }
  | { kind: 'dependency'; sub: 'impact'; id: string; print: boolean }
  | { kind: 'dependency'; sub: 'frontier'; id: string; print: boolean }
  | { kind: 'dependency'; sub: 'assumptions'; id: string; print: boolean }
  | { kind: 'dependency'; sub: 'path'; from: string; to: string; print: boolean }
  | { kind: 'dependency'; sub: 'cycles'; print: boolean }
  | { kind: 'dependency'; sub: 'findings'; print: boolean }
  | { kind: 'dependency'; sub: 'unused-imports'; print: boolean }
  | { kind: 'dependency'; sub: 'unused-exports'; print: boolean }
  | { kind: 'dependency'; sub: 'isolated'; print: boolean }
  | { kind: 'dependency'; sub: 'unreachable'; print: boolean }
  | { kind: 'dependency'; sub: 'ready'; print: boolean }
  | { kind: 'dependency'; sub: 'reused'; limit?: number; print: boolean }
  | { kind: 'dependency'; sub: 'alternative-paths'; from: string; to: string; maxPaths?: number; maxDepth?: number; print: boolean }
  | { kind: 'dependency'; sub: 'search'; query?: string; filters: SearchFilters; print: boolean }
  | { kind: 'check'; sub: 'staleness'; print: boolean }
  | { kind: 'verification'; sub: 'list' }
  | { kind: 'verification'; sub: 'show'; submissionId: string };

/** Every `dependency` operation name — the `sub` of the dependency variants. */
type DependencyOperation = Extract<Command, { kind: 'dependency' }>['sub'];

// ---------------------------------------------------------------------------
// Shared argument helpers.
// ---------------------------------------------------------------------------

type OptionMap = Record<string, string | boolean>;
const optionString = (value: string | boolean | undefined): string | undefined => typeof value === 'string' ? value : undefined;

/** Split off a `--print` flag, rejecting duplicates, and return the remaining args. */
function presentation(args: string[]): { print: boolean; args: string[] } {
  if (args.filter((item) => item === '--print').length > 1) throw new Error('Duplicate option --print');
  return { print: args.includes('--print'), args: args.filter((item) => item !== '--print') };
}

/** Pull an optional boolean flag out of an argument list, rejecting duplicates. */
function extractFlag(args: string[], flag: string): { present: boolean; args: string[] } {
  const occurrences = args.filter((item) => item === flag).length;
  if (occurrences > 1) throw new Error(`Duplicate option ${flag}`);
  return { present: occurrences === 1, args: args.filter((item) => item !== flag) };
}

function enumOption(name: string, value: string | undefined, allowed: readonly string[]): string | undefined {
  if (value !== undefined && !allowed.includes(value)) throw new Error(`--${name} must be one of: ${allowed.join(', ')}`);
  return value;
}

/** Parse `--name value` options and boolean `--flag`s into a map, collecting positionals. */
function optionValues(args: string[], names: Set<string>, flags = new Set<string>()): { options: OptionMap; positionals: string[] } {
  const options: OptionMap = {};
  const positionals: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (!name.startsWith('--')) { positionals.push(name); continue; }
    const key = name.slice(2);
    if (flags.has(key)) {
      if (options[key.replaceAll('-', '')] === true) throw new Error(`Duplicate option ${name}`);
      options[key.replaceAll('-', '')] = true;
      continue;
    }
    if (!names.has(key)) throw new Error(`Unknown option ${name}`);
    if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`Missing value for ${name}`);
    if (Object.hasOwn(options, key.replaceAll('-', ''))) throw new Error(`Duplicate option ${name}`);
    options[key.replaceAll('-', '')] = args[index + 1];
    index += 1;
  }
  return { positionals, options };
}

// ---------------------------------------------------------------------------
// Dependency operation resolution. Several operations are multi-word (`reverse
// dependencies`, `alternative paths`, `unused imports`); the
// longest matching token sequence wins, and a directly typed hyphenated form
// (e.g. `reverse-dependencies`) is rejected as retired.
// ---------------------------------------------------------------------------

// The command-name tokens for every `dependency` operation, longest sequence
// winning during resolution. Exported so the help-coverage test can derive the
// documented command surface from this single source rather than restating it.
export const DEPENDENCY_OPERATIONS = [
  ['dependencies'], ['reverse', 'dependencies'], ['impact'], ['frontier'], ['assumptions'], ['path'],
  ['alternative', 'paths'], ['cycles'], ['findings'], ['unused', 'imports'], ['unused', 'exports'],
  ['isolated'], ['unreachable'], ['ready'], ['reused'], ['search']
] as const;
const OPERATION_NAMES = new Set<string>(DEPENDENCY_OPERATIONS.map((sequence) => sequence.join('-')));

// Compile-time guarantee that DEPENDENCY_OPERATIONS and the `Command` union list
// exactly the same operations. If they drift, one assertion below stops compiling
// — otherwise `resolveOperation`'s cast to DependencyOperation would silently lie,
// and the help-coverage test (which derives from this table) could miss the gap.
type Join<T extends readonly string[], D extends string> =
  T extends readonly [infer Head extends string]
    ? Head
    : T extends readonly [infer Head extends string, ...infer Rest extends readonly string[]]
      ? `${Head}${D}${Join<Rest, D>}`
      : never;
type TableOperation = Join<(typeof DEPENDENCY_OPERATIONS)[number], '-'>;
type AssertAssignable<Super, Sub extends Super> = Sub;
type _CommandCoversTable = AssertAssignable<DependencyOperation, TableOperation>;
type _TableCoversCommand = AssertAssignable<TableOperation, DependencyOperation>;

function resolveOperation(tokens: string[]): { operation?: string; tail: string[]; retired?: boolean } {
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

function parseHelp(args: string[]): Command | null {
  let pathArgs: string[];
  const direct = args[0] === 'help';
  if (direct) pathArgs = args.slice(1);
  else {
    const index = args.findIndex((item) => item === 'help' || item === '--help' || item === '-h');
    if (index < 0) return null;
    pathArgs = args.slice(0, index);
  }
  return { kind: 'help', of: resolveHelpPath(pathArgs, direct) };
}

function parseDoctor(rest: string[]): Command {
  const parsed = presentation(rest);
  if (parsed.args.length) throw new Error('doctor accepts only --print');
  return { kind: 'doctor', print: parsed.print };
}

function parseInit(rest: string[]): Command {
  const allowed = new Set(['--adopt-existing', '--append-contract', '--sync-contract']);
  const positional = rest.find((item) => !item.startsWith('--'));
  if (positional) throw new Error(`init accepts no positional arguments; received: ${positional}`);
  const unknown = rest.find((item) => !allowed.has(item));
  if (unknown) throw new Error(`Unknown init option: ${unknown}`);
  if (new Set(rest).size !== rest.length) throw new Error(`Duplicate init option: ${rest.find((item, index) => rest.indexOf(item) !== index)}`);
  if (rest.length > 1) throw new Error('The init mutation options --adopt-existing, --append-contract, and --sync-contract are mutually exclusive');
  return {
    kind: 'init',
    adoptExisting: rest.includes('--adopt-existing'),
    appendContract: rest.includes('--append-contract'),
    syncContract: rest.includes('--sync-contract')
  };
}

function parseInstall(rest: string[]): Command {
  let scope: 'local' | 'global' = 'local';
  let host: 'codex' | 'claude' = 'claude';
  let dir: string | undefined;
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--global' || arg === '-g') scope = 'global';
    else if (arg === '--local') scope = 'local';
    else if (arg === '--codex') host = 'codex';
    else if (arg === '--claude') host = 'claude';
    else if (arg === '--dir') {
      const value = rest[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--dir requires a path');
      dir = value;
      index += 1;
    } else {
      throw new Error(`Unknown install option: ${arg}. Run qmd-prover help install.`);
    }
  }
  if (dir !== undefined && scope === 'global') throw new Error('--dir applies only to a local (per-project) install; drop --global/-g');
  return { kind: 'install', scope, host, dir };
}

function parseInspect(rest: string[]): Command {
  const graphFlag = extractFlag(rest, '--graph');
  const { print, args } = presentation(graphFlag.args);
  const graph = graphFlag.present;
  const [subcommand, ...tail] = args;
  if (subcommand === 'project') {
    if (tail.length) throw new Error('inspect project accepts only --print and --graph');
    return { kind: 'inspect', sub: 'project', print, graph };
  }
  if (subcommand === 'fact') {
    if (tail.length !== 1) throw new Error(`inspect ${subcommand} requires one semantic ID and optional --print and --graph`);
    if (!tail[0].replace(/^@/, '').trim()) throw new Error('inspect fact requires a non-empty semantic ID');
    return { kind: 'inspect', sub: 'fact', id: tail[0], print, graph };
  }
  if (subcommand === 'path') {
    if (tail.length !== 1) throw new Error('inspect path requires one QMD file or folder and optional --print and --graph');
    return { kind: 'inspect', sub: 'path', target: tail[0], print, graph };
  }
  throw new Error('inspect requires project, fact, or path');
}

function parseDependencySearch(tail: string[], print: boolean): Command {
  const valueOptions = new Set(['kind', 'status', 'set', 'origin', 'path', 'related-to', 'frontier-of', 'used-by', 'depends-on', 'affected-by']);
  const flags = new Set(['reverse', 'direct', 'cycle-participant']);
  const extracted = optionValues(tail, valueOptions, flags);
  if (extracted.positionals.length > 1) throw new Error('dependency search accepts at most one query');
  const filters: SearchFilters = {
    kind: enumOption('kind', optionString(extracted.options.kind), KINDS),
    status: enumOption('status', optionString(extracted.options.status), STATUSES),
    set: enumOption('set', optionString(extracted.options.set), SETS),
    origin: enumOption('origin', optionString(extracted.options.origin), ORIGINS),
    path: optionString(extracted.options.path),
    relatedTo: optionString(extracted.options.relatedto),
    frontierOf: optionString(extracted.options.frontierof),
    usedBy: optionString(extracted.options.usedby),
    dependsOn: optionString(extracted.options.dependson),
    affectedBy: optionString(extracted.options.affectedby),
    reverse: extracted.options.reverse === true,
    direct: extracted.options.direct === true,
    cycleParticipant: extracted.options.cycleparticipant === true
  };
  return { kind: 'dependency', sub: 'search', query: extracted.positionals[0], filters, print };
}

function parseDependency(rest: string[]): Command {
  const { print, args } = presentation(rest);
  const { operation, tail, retired } = resolveOperation(args);
  if (!operation) throw new Error('dependency requires an operation. Run qmd-prover help dependency.');
  if (retired || !OPERATION_NAMES.has(operation)) throw new Error(`Unknown dependency command: ${operation}. Run qmd-prover help dependency.`);
  const op = operation as DependencyOperation;

  if (op === 'search') return parseDependencySearch(tail, print);
  if (op === 'alternative-paths') {
    const extracted = optionValues(tail, new Set(['limit', 'max-depth']));
    if (extracted.positionals.length !== 2) throw new Error('dependency alternative paths requires two semantic IDs');
    const maxPaths = extracted.options.limit === undefined ? undefined : boundedInteger(extracted.options.limit, 5, { name: '--limit', min: 1, max: 25 });
    const maxDepth = extracted.options.maxdepth === undefined ? undefined : boundedInteger(extracted.options.maxdepth, 64, { name: '--max-depth', min: 1, max: 100 });
    return { kind: 'dependency', sub: 'alternative-paths', from: extracted.positionals[0], to: extracted.positionals[1], maxPaths, maxDepth, print };
  }
  if (op === 'reused') {
    const extracted = optionValues(tail, new Set(['limit']));
    if (extracted.positionals.length) throw new Error('dependency reused accepts only --limit N and --print');
    const limit = extracted.options.limit === undefined ? undefined : boundedInteger(extracted.options.limit, 20, { name: '--limit', min: 1, max: 1000 });
    return { kind: 'dependency', sub: 'reused', limit, print };
  }

  const unknownOption = tail.find((item) => item.startsWith('--'));
  if (unknownOption) throw new Error(`Unknown option ${unknownOption}`);
  if (op === 'path') {
    if (tail.length !== 2) throw new Error('dependency path requires 2 semantic IDs');
    return { kind: 'dependency', sub: 'path', from: tail[0], to: tail[1], print };
  }
  if (op === 'dependencies' || op === 'reverse-dependencies' || op === 'impact' || op === 'frontier' || op === 'assumptions') {
    if (tail.length !== 1) throw new Error(`dependency ${op.replaceAll('-', ' ')} requires 1 semantic ID`);
    return { kind: 'dependency', sub: op, id: tail[0], print };
  }
  if (tail.length) throw new Error(`dependency ${op.replaceAll('-', ' ')} accepts no positional arguments`);
  return { kind: 'dependency', sub: op, print };
}

function parseCheck(rest: string[]): Command {
  const parsed = presentation(rest);
  const [subcommand, ...tail] = parsed.args;
  if (subcommand !== 'staleness') throw new Error('check requires the staleness subcommand. Run qmd-prover help check.');
  if (tail.length) throw new Error('check staleness accepts only --print');
  return { kind: 'check', sub: 'staleness', print: parsed.print };
}

function parseVerification(rest: string[]): Command {
  const [subcommand, value, ...tail] = rest;
  if (subcommand === 'list') {
    if (value !== undefined) throw new Error('verification list accepts no options');
    return { kind: 'verification', sub: 'list' };
  }
  if (subcommand === 'show') {
    if (!value) throw new Error('verification show requires a submission ID. Run qmd-prover verification list to discover IDs.');
    if (tail.length) throw new Error('verification show accepts only a submission ID');
    return { kind: 'verification', sub: 'show', submissionId: value };
  }
  throw new Error('verification requires the list or show subcommand. Run qmd-prover help verification.');
}

function parseRender(rest: string[]): Command {
  if (rest.some((item) => item !== '--allow-errors') || rest.filter((item) => item === '--allow-errors').length > 1) {
    throw new Error('render accepts only optional --allow-errors');
  }
  return { kind: 'render', allowErrors: rest.includes('--allow-errors') };
}

/** Pure map from argv to a fully-validated Command. Throws on invalid usage. */
export function parseCommand(args: string[]): Command {
  if (args.length === 0) return { kind: 'usage' };
  if (args[0] === 'version' || args[0] === '--version' || args[0] === '-v') {
    if (args.length > 1) throw new Error('version accepts no arguments');
    return { kind: 'version' };
  }
  const help = parseHelp(args);
  if (help !== null) return help;
  const [command, ...rest] = args;
  switch (command) {
    case 'doctor': return parseDoctor(rest);
    case 'install': return parseInstall(rest);
    case 'init': return parseInit(rest);
    case 'inspect': return parseInspect(rest);
    case 'dependency': return parseDependency(rest);
    case 'check': return parseCheck(rest);
    case 'verification': return parseVerification(rest);
    case 'render': return parseRender(rest);
    default: throw new Error(`Unknown command: ${command}. Run qmd-prover help.`);
  }
}
