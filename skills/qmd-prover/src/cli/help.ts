import { KINDS, ORIGINS, STATUSES } from './filters.js';

// One function — `node` — holds every command's usage, prose, and place in the
// tree, keyed by the command path as typed on the command line. No help text
// lives in the Command type; cli.ts parses a help request to its target path
// and this module renders it. Validation (unknown-command detection) and the
// group listings are derived from the same `node` map, so the command surface
// is described here exactly once.

type HelpSection = 'description' | 'arguments' | 'options' | 'examples' | 'notes';

interface HelpNode {
  /** Usage lines shown verbatim under `Usage:`. */
  usage: string[];
  /** One-line purpose; seeds `Description` and the parent's command listing. */
  summary?: string;
  /** Explicit section bodies; a present `description` overrides `summary`. */
  sections?: Partial<Record<HelpSection, string[]>>;
  /** Whether the command takes positional arguments (guards help error detection). */
  positional?: boolean;
  /** Immediate sub-command names, in display order (present only on groups). */
  children?: readonly string[];
}

const SECTION_ORDER: ReadonlyArray<readonly [HelpSection, string]> = [
  ['description', 'Description'],
  ['arguments', 'Arguments'],
  ['options', 'Options'],
  ['examples', 'Examples'],
  ['notes', 'Notes']
];

/** The help node for a command path, or undefined if the path is not a command. */
function node(path: string): HelpNode | undefined {
  switch (path) {
    case '':
      return {
        usage: ['qmd-prover <command> [arguments]', 'qmd-prover help [COMMAND...]'],
        children: ['doctor', 'version', 'install', 'init', 'inspect', 'dependency', 'check', 'verification', 'render'],
        sections: {
          notes: [
            'Requirements: Node.js 20+ and Pandoc (via PATH, tools.pandoc, or QMD_PROVER_PANDOC). A verifier (verification.backend claude|codex) and Quarto are optional.',
            'Run `qmd-prover doctor` to check dependencies before inspecting QMD.',
            'JSON is the default stable output. `--print` selects a concise human report where documented.',
            'JSON is lean by default: facts are compact references {id, kind, status, file, line}, and listings carry counts. Drill into `inspect fact @ID` for per-fact detail, the dedicated `dependency` subcommands for itemized findings, or pass `--graph` to inspect for the full graph.',
            'Semantic IDs may be written as `@ID` or `ID`; output uses the canonical `@ID` form.',
            'Exit 1 means CLI usage/runtime failure; exit 2 means a structured domain result with ok:false.'
          ]
        }
      };
    case 'doctor':
      return {
        usage: ['qmd-prover doctor [--print]'],
        summary: 'Check Node, Pandoc, verifier, and Quarto availability, plus engine/project version compatibility, without changing the project.'
      };
    case 'version':
      return {
        usage: ['qmd-prover version'],
        summary: 'Print the installed tool version and the schema, verifier-protocol, and contract versions it implements.'
      };
    case 'install':
      return {
        usage: ['qmd-prover install [--global|-g] [--codex|--claude] [--dir <project>]'],
        summary: 'Install the qmd-prover skill (docs) into a host assistant so it can drive this command.',
        sections: {
          description: [
            'Copies the skill documentation (SKILL.md, references, agents) into the host\'s skills directory.',
            'This is the skill half; the engine is this `qmd-prover` command itself, already on PATH.'
          ],
          options: [
            '--global, -g   Install for every project, into the host home (~/.claude or ~/.codex).',
            '--local        (default) Install into the current project (./.claude or ./.codex).',
            '--claude       (default) Target Claude Code.',
            '--codex        Target Codex.',
            '--dir <project>   Local install target other than the current directory.'
          ],
          notes: [
            'A skill installed now is not auto-activated in the running session; read the installed SKILL.md to use qmd-prover immediately, and start a new session for the host to discover it automatically.'
          ]
        }
      };
    case 'init':
      return {
        usage: ['qmd-prover init [--adopt-existing|--append-contract|--sync-contract]'],
        summary: 'Initialize or safely adopt a qmd-prover project.',
        sections: {
          description: [
            'Initialize the qmd-prover project contract.',
            'Before writing, inspect existing `AGENTS.md`, QMD files, Quarto configuration, and qmd-prover state.',
            'When existing material needs approval, preserve it and return the required next action instead of changing it.'
          ],
          arguments: [
            'This command accepts no positional arguments.'
          ],
          options: [
            '--adopt-existing',
            '  Authorize adoption when mathematical project material exists but `AGENTS.md` is missing or empty.',
            '--append-contract',
            '  Append the canonical managed contract to an existing `AGENTS.md` without one; preserve all existing policy.',
            '--sync-contract',
            '  Replace one differing managed contract block with the canonical block; preserve text outside that block.',
            'help, --help, -h',
            '  Show this help without writing project files.'
          ],
          notes: [
            'Use at most one mutation option: `--adopt-existing`, `--append-contract`, or `--sync-contract`.',
            'Without a mutation option, existing material remains unchanged when approval is needed.',
            'A successful response includes the discovered inventory; initialization creates no theorem QMD.'
          ]
        }
      };
    case 'inspect':
      return { usage: ['qmd-prover inspect <command> [arguments]'], children: ['project', 'fact', 'path'] };
    case 'inspect project':
      return {
        usage: ['qmd-prover inspect project [--print] [--graph]'],
        summary: 'Run machine analysis, optional local conditional verification, and global composition for every fact in the project.',
        sections: {
          options: [
            '--print   Concise human report instead of JSON.',
            '--graph   Include the full dependency graph (nodes and edges) inline in the JSON.'
          ],
          notes: [
            'Default JSON is a lean dashboard: summary, goals, compact per-fact status, blockers, finding counts, and diagnostics.',
            'Per-fact detail is available via `qmd-prover inspect fact @ID`; the complete graph is also written to .qmd-prover/graph.json.'
          ]
        }
      };
    case 'inspect fact':
      return {
        usage: ['qmd-prover inspect fact @ID [--print] [--graph]'],
        summary: 'Locate a fact, locally check its dependency closure when a verifier is configured, and compute its global status.',
        positional: true,
        sections: {
          options: [
            '--print   Concise human report instead of JSON.',
            '--graph   Include the fact’s dependency subgraph inline in the JSON.'
          ],
          notes: ['Dependency lists are compact fact references {id, kind, status, file, line}; pass --graph for the full subgraph.']
        }
      };
    case 'inspect path':
      return {
        usage: ['qmd-prover inspect path FILE_OR_FOLDER [--print] [--graph]'],
        summary: 'Run machine analysis and optional local/global verification for the facts declared under one project QMD file or folder.',
        positional: true,
        sections: {
          options: [
            '--print   Concise human report instead of JSON.',
            '--graph   Include the selected closure graph inline in the JSON.'
          ]
        }
      };
    case 'dependency':
      return {
        usage: ['qmd-prover dependency <command> [arguments]'],
        children: [
          'dependencies', 'reverse', 'impact', 'frontier', 'path', 'alternative', 'cycles',
          'findings', 'unused', 'isolated', 'unreachable', 'ready', 'reused', 'search'
        ]
      };
    case 'dependency dependencies':
      return { usage: ['qmd-prover dependency dependencies @ID [--print]'], summary: 'Show direct and transitive dependencies of one fact.', positional: true };
    case 'dependency reverse':
      return { usage: ['qmd-prover dependency reverse <command> [arguments]'], children: ['dependencies'] };
    case 'dependency reverse dependencies':
      return { usage: ['qmd-prover dependency reverse dependencies @ID [--print]'], summary: 'Show facts that directly or transitively depend on one fact.', positional: true };
    case 'dependency impact':
      return { usage: ['qmd-prover dependency impact @ID [--print]'], summary: 'Show downstream facts affected by a fact change.', positional: true };
    case 'dependency frontier':
      return { usage: ['qmd-prover dependency frontier @ID [--print]'], summary: 'Show the lowest open, rejected, disproved, stale, or otherwise unusable dependencies.', positional: true };
    case 'dependency path':
      return { usage: ['qmd-prover dependency path @FROM @TO [--print]'], summary: 'Show the shortest dependency path; FROM=TO returns the one-node path.', positional: true };
    case 'dependency alternative':
      return { usage: ['qmd-prover dependency alternative <command> [arguments]'], children: ['paths'] };
    case 'dependency alternative paths':
      return {
        usage: ['qmd-prover dependency alternative paths @FROM @TO [--limit N] [--max-depth N] [--print]'],
        summary: 'Enumerate bounded simple paths between two facts.',
        positional: true,
        sections: { options: ['--limit N       Number of paths, 1-25 (default 5).', '--max-depth N   Maximum edge depth, 1-100.'] }
      };
    case 'dependency cycles':
      return { usage: ['qmd-prover dependency cycles [--print]'], summary: 'List dependency cycles in the aggregate graph.' };
    case 'dependency findings':
      return {
        usage: ['qmd-prover dependency findings [--print]'],
        summary: 'Return all graph hygiene, readiness, staleness-impact, and reuse findings.',
        sections: {
          notes: [
            'JSON returns per-category counts plus compact fact references. Categories: unused_imports/exports, isolated_facts (no dependency edges), unreachable (outside every goal closure), invalid_evidence_dependents, candidate_ready_for_ai, and heavily_reused.',
            'The large itemized lists also have dedicated commands: `dependency ready for ai`, `dependency reused`, `dependency isolated`, `dependency unreachable`.'
          ]
        }
      };
    case 'dependency unused':
      return { usage: ['qmd-prover dependency unused <command> [arguments]'], children: ['imports', 'exports'] };
    case 'dependency unused imports':
      return { usage: ['qmd-prover dependency unused imports [--print]'], summary: 'List imported fact IDs not referenced by their consumer file.' };
    case 'dependency unused exports':
      return { usage: ['qmd-prover dependency unused exports [--print]'], summary: 'List exported facts not imported elsewhere.' };
    case 'dependency isolated':
      return { usage: ['qmd-prover dependency isolated [--print]'], summary: 'List facts with no incoming or outgoing dependency edge.' };
    case 'dependency unreachable':
      return { usage: ['qmd-prover dependency unreachable [--print]'], summary: 'List facts outside every protected main-goal dependency closure.' };
    case 'dependency ready':
      return { usage: ['qmd-prover dependency ready <command> [arguments]'], children: ['for'] };
    case 'dependency ready for':
      return { usage: ['qmd-prover dependency ready for <command> [arguments]'], children: ['ai'] };
    case 'dependency ready for ai':
      return { usage: ['qmd-prover dependency ready for ai [--print]'], summary: 'List candidates whose machine checks and direct dependency edges pass.' };
    case 'dependency reused':
      return {
        usage: ['qmd-prover dependency reused [--limit N] [--print]'],
        summary: 'Rank facts by transitive and direct reverse-dependency counts.',
        sections: { options: ['--limit N   Number of facts, 1-1000 (default 20).'] }
      };
    case 'dependency search':
      return {
        usage: [
          'qmd-prover dependency search [QUERY] [--kind KIND] [--status STATUS] [--origin ORIGIN] [--path PATH]',
          '    [--used-by @ID] [--depends-on @ID] [--affected-by @ID] [--stale-affected-by @ID]',
          '    [--related-to @ID] [--reverse] [--frontier-of @ID] [--cycle-participant] [--direct] [--print]'
        ],
        summary: 'Search fact IDs, titles, paths, statements, and proofs with graph-aware filters.',
        positional: true,
        sections: {
          arguments: [
            'QUERY   Optional case-insensitive substring. Omit it (or pass "") to match every fact and filter only.'
          ],
          options: [
            `--kind ${KINDS.join('|')}`,
            `--origin ${ORIGINS.join('|')}`,
            `--status ${STATUSES.join('|')}`,
            '--path PATH       Match one file or directory prefix.',
            '--used-by @ID       Facts that @ID transitively depends on (its dependencies).',
            '--depends-on @ID    Facts that transitively depend on @ID (its dependents).',
            '--affected-by @ID / --stale-affected-by @ID   Dependents of @ID (optionally only stale ones).',
            '--frontier-of @ID   Facts on @ID’s unresolved proof frontier.',
            '--related-to @ID [--reverse]   Search dependencies (or reverse dependencies) of @ID.',
            '--direct          Restrict graph relationship filters to one edge instead of the transitive closure.',
            '--cycle-participant   Restrict matches to nodes in cycles.',
            'Multiple filters combine with AND. QUERY and all filters are optional but at least one is usually given.'
          ]
        }
      };
    case 'check':
      return { usage: ['qmd-prover check <command> [arguments]'], children: ['staleness'] };
    case 'check staleness':
      return { usage: ['qmd-prover check staleness [--print]'], summary: 'Audit verification cache freshness without modifying QMD.' };
    case 'verification':
      return { usage: ['qmd-prover verification <command> [arguments]'], children: ['list', 'show'] };
    case 'verification list':
      return { usage: ['qmd-prover verification list'], summary: 'List retained verification records and discover submission IDs.' };
    case 'verification show':
      return { usage: ['qmd-prover verification show SUBMISSION_ID'], summary: 'Read one retained verification record by submission ID.', positional: true };
    case 'render':
      return {
        usage: ['qmd-prover render [--allow-errors]'],
        summary: 'Prepare generated status QMD, graph SVG, and JSON report.',
        sections: {
          options: ['--allow-errors   Explicitly generate diagnostic artifacts when project errors exist.'],
          notes: ['Without --allow-errors, project errors block rendering and no render artifacts are written.', 'The final `quarto render` command is suggested only when Quarto is available.']
        }
      };
    default:
      return undefined;
  }
}

/** Render one command's help. `path` must be a known command path (from `resolveHelpPath`). */
export function renderHelp(path: string): string {
  const item = node(path);
  if (!item) throw new Error(`No help registered for: ${path}`);
  const sections: Record<HelpSection, string[]> = {
    description: item.summary ? [item.summary] : [],
    arguments: [],
    options: [],
    examples: [],
    notes: [],
    ...item.sections
  };
  const lines = ['Usage:', ...item.usage.map((line) => `  ${line}`)];
  for (const [key, title] of SECTION_ORDER) {
    const content = sections[key];
    if (content.length > 0) lines.push('', `${title}:`, ...content.map((line) => `  ${line}`));
  }
  const children = item.children ?? [];
  if (children.length > 0) {
    lines.push('', 'Commands:');
    for (const child of children) {
      lines.push(`  ${child}`);
      const summary = node(path ? `${path} ${child}` : child)?.summary;
      if (summary) lines.push(`    ${summary}`);
    }
  }
  return lines.join('\n');
}

/**
 * Resolve a `help COMMAND...` (or `COMMAND... --help`) request to a known command
 * path, throwing when the requested command is unknown. `direct` is true for the
 * `help ...` spelling, which requires an exact command rather than a prefix. The
 * resolved path is the longest known command that prefixes the request.
 */
export function resolveHelpPath(pathArgs: readonly string[], direct: boolean): string {
  let selectedPath = '';
  let item = node('');
  if (!item) throw new Error('Root help command is not registered');
  for (let length = 1; length <= pathArgs.length; length += 1) {
    const candidatePath = pathArgs.slice(0, length).join(' ');
    const candidate = node(candidatePath);
    if (candidate) { selectedPath = candidatePath; item = candidate; }
  }
  const requested = pathArgs.join(' ');
  const selectedLength = selectedPath ? selectedPath.split(' ').length : 0;
  const extra = pathArgs.slice(selectedLength);
  const isGroup = (item.children?.length ?? 0) > 0;
  const unexpectedPositional = extra.some((token) => !token.startsWith('--')) && !(item.positional ?? false);
  if (pathArgs.length && ((direct && node(requested) === undefined) || (isGroup && requested !== selectedPath) || unexpectedPositional)) {
    throw new Error(`Unknown command: ${requested}. Run qmd-prover help.`);
  }
  return selectedPath;
}

export const rootUsage = renderHelp('');
