import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { findHelpCommand, hasExactHelpCommand, isHelpGroup, renderHelp, rootUsage } from './help.js';
import { AUX, readJson } from '../infrastructure/files.js';
import { analyzeDependencies, inspectFact, inspectPath, inspectProject } from '../inspection/operations.js';
import { boundedInteger } from '../inspection/graph.js';
import { printReport } from '../inspection/report.js';
import { renderProject } from './render.js';
import { doctorProject } from './doctor.js';
import { initializeProject } from './project.js';
import { checkStaleness } from '../verification/staleness.js';
import { listVerifications, showVerification } from '../verification/submissions.js';
import { leanView } from '../inspection/lean.js';
import type { LeanViewOptions } from '../inspection/lean.js';
import { asRecord, hasErrorCode } from '../shared/core.js';
import type { JsonObject, OperationResult, RuntimeOptions } from '../shared/types.js';

// ---------------------------------------------------------------------------
// Command shape: one variant per subcommand, each carrying exactly the flags
// that subcommand accepts. `query` on the dependency variant holds only the
// arg-derived RuntimeOptions; the environment-derived `pandoc` is merged in at
// dispatch time so parsing stays pure.
// ---------------------------------------------------------------------------
export type Command =
  | { kind: 'usage' }
  | { kind: 'help'; text: string }
  | { kind: 'doctor'; print: boolean }
  | { kind: 'init'; adoptExisting: boolean; appendContract: boolean; syncContract: boolean }
  | { kind: 'inspect-project'; print: boolean; view: LeanViewOptions }
  | { kind: 'inspect-fact'; id: string; print: boolean; view: LeanViewOptions }
  | { kind: 'inspect-path'; target: string; print: boolean; view: LeanViewOptions }
  | { kind: 'dependency'; operation: string; ids: string[]; print: boolean; query: RuntimeOptions }
  | { kind: 'check-staleness'; print: boolean }
  | { kind: 'verification-list' }
  | { kind: 'verification-show'; submissionId: string }
  | { kind: 'render'; allowErrors: boolean };

// ---------------------------------------------------------------------------
// Shared argument helpers. All parsing is pure: helpers throw on invalid usage
// (surfaced as exit 1 by the entry script) and never touch process or the disk.
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

/** Resolve a compound dependency operation (e.g. `reverse dependencies`) to its canonical name. */
function dependencyOperation(args: string[]): { operation?: string; tail: string[]; retired?: boolean } {
  const compound: Array<[string[], string]> = [
    [['reverse', 'dependencies'], 'reverse-dependencies'],
    [['alternative', 'paths'], 'alternative-paths'],
    [['unused', 'imports'], 'unused-imports'],
    [['unused', 'exports'], 'unused-exports'],
    [['ready', 'for', 'ai'], 'ready-for-ai']
  ];
  for (const [tokens, operation] of compound) {
    if (tokens.every((token, index) => args[index] === token)) return { operation, tail: args.slice(tokens.length) };
  }
  return { operation: args[0], tail: args.slice(1), retired: args[0]?.includes('-') === true };
}

// ---------------------------------------------------------------------------
// Per-command parsers. Each maps its argument tail to a Command variant.
// ---------------------------------------------------------------------------

function parseHelp(args: string[]): string | null {
  let pathArgs: string[];
  const direct = args[0] === 'help';
  if (direct) pathArgs = args.slice(1);
  else {
    const index = args.findIndex((item) => item === 'help' || item === '--help' || item === '-h');
    if (index < 0) return null;
    pathArgs = args.slice(0, index);
  }
  const selected = findHelpCommand(pathArgs);
  const requested = pathArgs.join(' ');
  const selectedLength = selected.path ? selected.path.split(' ').length : 0;
  const extra = pathArgs.slice(selectedLength);
  const hasUnexpectedPositional = extra.some((item) => !item.startsWith('--')) && !selected.acceptsPositionals;
  if (pathArgs.length && ((direct && !hasExactHelpCommand(requested)) || (isHelpGroup(selected) && requested !== selected.path) || hasUnexpectedPositional)) {
    throw new Error(`Unknown command: ${pathArgs.join(' ')}. Run qmd-prover help.`);
  }
  return renderHelp(selected);
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

function parseInspect(rest: string[]): Command {
  const graphFlag = extractFlag(rest, '--graph');
  const parsed = presentation(graphFlag.args);
  const view: LeanViewOptions = { graph: graphFlag.present };
  const [subcommand, ...tail] = parsed.args;
  if (subcommand === 'project') {
    if (tail.length) throw new Error('inspect project accepts only --print and --graph');
    return { kind: 'inspect-project', print: parsed.print, view };
  }
  if (subcommand === 'fact') {
    if (tail.length !== 1) throw new Error(`inspect ${subcommand} requires one semantic ID and optional --print and --graph`);
    if (!tail[0].replace(/^@/, '').trim()) throw new Error('inspect fact requires a non-empty semantic ID');
    return { kind: 'inspect-fact', id: tail[0], print: parsed.print, view };
  }
  if (subcommand === 'path') {
    if (tail.length !== 1) throw new Error('inspect path requires one QMD file or folder and optional --print and --graph');
    return { kind: 'inspect-path', target: tail[0], print: parsed.print, view };
  }
  throw new Error('inspect requires project, fact, or path');
}

function parseDependencySearch(tail: string[]): RuntimeOptions & { positionals: string[] } {
  const extracted = optionValues(
    tail,
    new Set(['kind', 'status', 'origin', 'path', 'related-to', 'frontier-of', 'used-by', 'depends-on', 'affected-by', 'stale-affected-by']),
    new Set(['reverse', 'direct', 'cycle-participant'])
  );
  if (extracted.positionals.length > 1) throw new Error('dependency search accepts at most one query');
  return {
    positionals: extracted.positionals,
    kind: enumOption('kind', optionString(extracted.options.kind), ['definition', 'lemma', 'theorem', 'proposition', 'corollary', 'unknown']),
    status: enumOption('status', optionString(extracted.options.status), [
      'candidate', 'open', 'rejected', 'disproof-candidate', 'revoked', 'missing', 'stale',
      'verified', 'disproved', 'blocked', 'unverified', 'invalid'
    ]),
    origin: enumOption('origin', optionString(extracted.options.origin), ['fact', 'main-goal', 'unresolved']),
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
}

function parseDependency(rest: string[]): Command {
  const parsed = presentation(rest);
  const print = parsed.print;
  const { operation, tail, retired } = dependencyOperation(parsed.args);
  if (!operation) throw new Error('dependency requires an operation. Run qmd-prover help dependency.');
  const operations = new Set(['dependencies', 'reverse-dependencies', 'impact', 'frontier', 'path', 'alternative-paths', 'cycles', 'findings', 'unused-imports', 'unused-exports', 'isolated', 'unreachable', 'ready-for-ai', 'reused', 'search']);
  if (retired || !operations.has(operation)) throw new Error(`Unknown dependency command: ${operation}. Run qmd-prover help dependency.`);

  if (operation === 'search') {
    const { positionals, ...query } = parseDependencySearch(tail);
    return { kind: 'dependency', operation, ids: positionals, print, query };
  }
  if (operation === 'alternative-paths') {
    const extracted = optionValues(tail, new Set(['limit', 'max-depth']));
    if (extracted.positionals.length !== 2) throw new Error('dependency alternative paths requires two semantic IDs');
    const maxPaths = extracted.options.limit === undefined ? undefined
      : boundedInteger(extracted.options.limit, 5, { name: '--limit', min: 1, max: 25 });
    const maxDepth = extracted.options.maxdepth === undefined ? undefined
      : boundedInteger(extracted.options.maxdepth, 64, { name: '--max-depth', min: 1, max: 100 });
    return { kind: 'dependency', operation, ids: extracted.positionals, print, query: { maxPaths, maxDepth } };
  }
  if (operation === 'reused') {
    const extracted = optionValues(tail, new Set(['limit']));
    if (extracted.positionals.length) throw new Error('dependency reused accepts only --limit N and --print');
    const limit = extracted.options.limit === undefined ? undefined
      : boundedInteger(extracted.options.limit, 20, { name: '--limit', min: 1, max: 1000 });
    return { kind: 'dependency', operation, ids: [], print, query: { limit } };
  }

  const unknownOption = tail.find((item) => item.startsWith('--'));
  if (unknownOption) throw new Error(`Unknown option ${unknownOption}`);
  const noArgument = new Set(['cycles', 'findings', 'unused-imports', 'unused-exports', 'isolated', 'unreachable', 'ready-for-ai']);
  const required = noArgument.has(operation) ? 0 : operation === 'path' ? 2 : 1;
  if (tail.length !== required) throw new Error(`dependency ${operation.replaceAll('-', ' ')} requires ${required} semantic ID${required === 1 ? '' : 's'}`);
  return { kind: 'dependency', operation, ids: tail, print, query: {} };
}

function parseCheck(rest: string[]): Command {
  const parsed = presentation(rest);
  const [subcommand, ...tail] = parsed.args;
  if (subcommand !== 'staleness') throw new Error('check requires the staleness subcommand. Run qmd-prover help check.');
  if (tail.length) throw new Error('check staleness accepts only --print');
  return { kind: 'check-staleness', print: parsed.print };
}

function parseVerification(rest: string[]): Command {
  const [subcommand, value, ...tail] = rest;
  if (subcommand === 'list') {
    if (value !== undefined) throw new Error('verification list accepts no options');
    return { kind: 'verification-list' };
  }
  if (subcommand === 'show') {
    if (!value) throw new Error('verification show requires a submission ID. Run qmd-prover verification list to discover IDs.');
    if (tail.length) throw new Error('verification show accepts only a submission ID');
    return { kind: 'verification-show', submissionId: value };
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
  const help = parseHelp(args);
  if (help !== null) return { kind: 'help', text: help };
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

// ---------------------------------------------------------------------------
// Output. Effects live here, kept out of parsing.
// ---------------------------------------------------------------------------

function output(value: unknown): void { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); }

// --print renders the full internal result; the default JSON path emits the lean
// agent-facing projection (leanView). Slimming lives only here, so report.ts and
// the on-disk snapshot keep the complete object.
function emit(value: OperationResult, print: boolean, view: LeanViewOptions = {}): void {
  if (print) process.stdout.write(printReport(value));
  else output(leanView(value, view));
  if (value.ok === false) process.exitCode = 2;
}

async function history(root: string, id: string): Promise<JsonObject[]> {
  const directory = path.join(root, AUX, 'verification');
  try {
    const records: JsonObject[] = [];
    for (const selected of [directory, path.join(directory, 'checks')]) {
      let entries: string[] = [];
      try { entries = await readdir(selected); } catch (error) { if (!hasErrorCode(error, 'ENOENT')) throw error; }
      for (const name of entries.filter((entry) => entry.endsWith('.json')).sort()) {
        const record = await readJson<JsonObject>(path.join(selected, name));
        if (record.target === id && typeof record.verdict === 'string') records.push(record);
      }
    }
    return records.sort((left, right) => `${left.verified_at ?? ''}\0${left.submission_id ?? ''}`.localeCompare(`${right.verified_at ?? ''}\0${right.submission_id ?? ''}`));
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return [];
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Dispatch. Pattern-match the parsed command and run it, merging the
// environment-derived pandoc option into each operation's option bag.
// ---------------------------------------------------------------------------

export async function main(
  args: string[],
  { root = process.cwd(), pandoc = process.env.QMD_PROVER_PANDOC }: { root?: string; pandoc?: string } = {}
): Promise<void> {
  const command = parseCommand(args);
  const options: RuntimeOptions = pandoc ? { pandoc } : {};
  switch (command.kind) {
    case 'usage':
      process.stdout.write(`${rootUsage}\n`);
      return;
    case 'help':
      process.stdout.write(`${command.text}\n`);
      return;
    case 'doctor':
      emit(await doctorProject(root), command.print);
      return;
    case 'init':
      emit(await initializeProject(root, {
        adoptExisting: command.adoptExisting,
        appendContract: command.appendContract,
        syncContract: command.syncContract
      }), false);
      return;
    case 'inspect-project':
      emit(await inspectProject(root, options), command.print, command.view);
      return;
    case 'inspect-fact': {
      const result: OperationResult = await inspectFact(root, command.id, options);
      result.verification_history = await history(root, String(asRecord(result.fact).id ?? ''));
      emit(result, command.print, command.view);
      return;
    }
    case 'inspect-path':
      emit(await inspectPath(root, command.target, options), command.print, command.view);
      return;
    case 'dependency':
      emit(await analyzeDependencies(root, command.operation, command.ids, { ...options, ...command.query }), command.print);
      return;
    case 'check-staleness':
      emit(await checkStaleness(root, options), command.print);
      return;
    case 'verification-list':
      emit(await listVerifications(root), false);
      return;
    case 'verification-show':
      emit(await showVerification(root, command.submissionId), false);
      return;
    case 'render':
      emit(await renderProject(root, { ...options, allowErrors: command.allowErrors }), false);
      return;
    default:
      return command satisfies never;
  }
}
