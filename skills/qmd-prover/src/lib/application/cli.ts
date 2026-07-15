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
import { asRecord, hasErrorCode } from '../shared/core.js';
import type { JsonObject, OperationResult, RuntimeOptions } from '../shared/types.js';

const usage = rootUsage;

function emitHelp(args: string[]): boolean {
  let pathArgs: string[];
  const direct = args[0] === 'help';
  if (direct) pathArgs = args.slice(1);
  else {
    const index = args.findIndex((item) => item === 'help' || item === '--help' || item === '-h');
    if (index < 0) return false;
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
  process.stdout.write(`${renderHelp(selected)}\n`);
  return true;
}

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

function output(value: unknown): void { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); }

function presentation(args: string[]): { print: boolean; args: string[] } {
  if (args.filter((item) => item === '--print').length > 1) throw new Error('Duplicate option --print');
  return { print: args.includes('--print'), args: args.filter((item) => item !== '--print') };
}

function emit(value: OperationResult, print: boolean): void {
  if (print) process.stdout.write(printReport(value));
  else output(value);
  if (value.ok === false) process.exitCode = 2;
}

type OptionMap = Record<string, string | boolean>;
const optionString = (value: string | boolean | undefined): string | undefined => typeof value === 'string' ? value : undefined;

function enumOption(name: string, value: string | undefined, allowed: readonly string[]): string | undefined {
  if (value !== undefined && !allowed.includes(value)) throw new Error(`--${name} must be one of: ${allowed.join(', ')}`);
  return value;
}

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
    if (!names.has(key) || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`Invalid or missing value for ${name}`);
    if (Object.hasOwn(options, key.replaceAll('-', ''))) throw new Error(`Duplicate option ${name}`);
    options[key.replaceAll('-', '')] = args[index + 1];
    index += 1;
  }
  return { positionals, options };
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

export async function main(
  args: string[],
  { root = process.cwd(), pandoc = process.env.QMD_PROVER_PANDOC }: { root?: string; pandoc?: string } = {}
): Promise<void> {
  const [command, ...rest] = args;
  const options: RuntimeOptions = pandoc ? { pandoc } : {};
  if (!command) { process.stdout.write(`${usage}\n`); return; }
  if (emitHelp(args)) return;
  if (command === 'doctor') {
    const parsed = presentation(rest);
    if (parsed.args.length) throw new Error('doctor accepts only --print');
    emit(await doctorProject(root), parsed.print);
    return;
  }
  if (command === 'init') {
    const allowed = new Set(['--adopt-existing', '--append-contract', '--sync-contract']);
    const positional = rest.find((item) => !item.startsWith('--'));
    if (positional) throw new Error(`init accepts no positional arguments; received: ${positional}`);
    const unknown = rest.find((item) => !allowed.has(item));
    if (unknown) throw new Error(`Unknown init option: ${unknown}`);
    if (new Set(rest).size !== rest.length) throw new Error(`Duplicate init option: ${rest.find((item, index) => rest.indexOf(item) !== index)}`);
    if (rest.length > 1) throw new Error('The init mutation options --adopt-existing, --append-contract, and --sync-contract are mutually exclusive');
    emit(await initializeProject(root, {
      adoptExisting: rest.includes('--adopt-existing'),
      appendContract: rest.includes('--append-contract'),
      syncContract: rest.includes('--sync-contract')
    }), false);
    return;
  }
  if (command === 'inspect') {
    const parsed = presentation(rest);
    const [subcommand, ...tail] = parsed.args;
    if (subcommand === 'project') {
      if (tail.length) throw new Error('inspect project accepts only --print');
      emit(await inspectProject(root, options), parsed.print);
      return;
    }
    if (subcommand === 'fact') {
      if (tail.length !== 1) throw new Error(`inspect ${subcommand} requires one semantic ID and optional --print`);
      const result: OperationResult = await inspectFact(root, tail[0], options);
      result.verification_history = await history(root, String(asRecord(result.fact).id ?? ''));
      emit(result, parsed.print);
      return;
    }
    if (subcommand === 'path') {
      if (tail.length !== 1) throw new Error('inspect path requires one QMD file or folder and optional --print');
      emit(await inspectPath(root, tail[0], options), parsed.print);
      return;
    }
    throw new Error('inspect requires project, fact, or path');
  }
  if (command === 'dependency') {
    const parsed = presentation(rest);
    const { operation: subcommand, tail, retired } = dependencyOperation(parsed.args);
    if (!subcommand) throw new Error('dependency requires an operation');
    const operations = new Set(['dependencies', 'reverse-dependencies', 'impact', 'frontier', 'path', 'alternative-paths', 'cycles', 'findings', 'unused-imports', 'unused-exports', 'isolated', 'unreachable', 'ready-for-ai', 'reused', 'search']);
    if (retired || !operations.has(subcommand)) throw new Error(`Unknown dependency command: ${parsed.args.join(' ')}`);
    if (subcommand === 'search') {
      const extracted = optionValues(
        tail,
        new Set(['kind', 'status', 'origin', 'path', 'related-to', 'frontier-of', 'used-by', 'depends-on', 'affected-by', 'stale-affected-by']),
        new Set(['reverse', 'direct', 'cycle-participant'])
      );
      if (extracted.positionals.length !== 1) throw new Error('dependency search requires one query');
      const queryOptions: RuntimeOptions = {
        ...options,
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
      emit(await analyzeDependencies(root, subcommand, extracted.positionals, queryOptions), parsed.print);
      return;
    }
    if (subcommand === 'alternative-paths') {
      const extracted = optionValues(tail, new Set(['limit', 'max-depth']));
      if (extracted.positionals.length !== 2) throw new Error('dependency alternative paths requires two semantic IDs');
      const maxPaths = extracted.options.limit === undefined ? undefined
        : boundedInteger(extracted.options.limit, 5, { name: '--limit', min: 1, max: 25 });
      const maxDepth = extracted.options.maxdepth === undefined ? undefined
        : boundedInteger(extracted.options.maxdepth, 64, { name: '--max-depth', min: 1, max: 100 });
      emit(await analyzeDependencies(root, subcommand, extracted.positionals, {
        ...options,
        maxPaths,
        maxDepth
      }), parsed.print);
      return;
    }
    if (subcommand === 'reused') {
      const extracted = optionValues(tail, new Set(['limit']));
      if (extracted.positionals.length) throw new Error('dependency reused accepts only --limit N and --print');
      const limit = extracted.options.limit === undefined ? undefined
        : boundedInteger(extracted.options.limit, 20, { name: '--limit', min: 1, max: 1000 });
      emit(await analyzeDependencies(root, subcommand, [], { ...options, limit }), parsed.print);
      return;
    }
    const noArgument = new Set(['cycles', 'findings', 'unused-imports', 'unused-exports', 'isolated', 'unreachable', 'ready-for-ai']);
    const required = noArgument.has(subcommand) ? 0 : subcommand === 'path' ? 2 : 1;
    if (tail.length !== required) throw new Error(`dependency ${subcommand.replaceAll('-', ' ')} requires ${required} semantic ID${required === 1 ? '' : 's'}`);
    emit(await analyzeDependencies(root, subcommand, tail, options), parsed.print);
    return;
  }
  if (command === 'check') {
    const parsed = presentation(rest);
    const [subcommand, ...tail] = parsed.args;
    if (subcommand !== 'staleness' || tail.length) throw new Error('check staleness accepts only --print');
    emit(await checkStaleness(root, options), parsed.print);
    return;
  }
  if (command === 'verification') {
    const [subcommand, value, ...tail] = rest;
    if (subcommand === 'list' && value === undefined) { emit(await listVerifications(root), false); return; }
    if (subcommand === 'show' && value && tail.length === 0) { emit(await showVerification(root, value), false); return; }
    throw new Error('Invalid verification command');
  }
  if (command === 'render') {
    if (rest.some((item) => item !== '--allow-errors') || rest.filter((item) => item === '--allow-errors').length > 1) {
      throw new Error('render accepts only optional --allow-errors');
    }
    emit(await renderProject(root, { ...options, allowErrors: rest.includes('--allow-errors') }), false);
    return;
  }
  throw new Error(`Unknown command: ${command}. Run qmd-prover help.`);
}
