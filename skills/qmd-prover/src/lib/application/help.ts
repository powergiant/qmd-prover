type HelpSection = 'description' | 'arguments' | 'options' | 'examples' | 'notes';
interface HelpCommand {
  path: string;
  usage: string[];
  acceptsPositionals: boolean;
  summary: string;
  sections: Record<HelpSection, string[]>;
}

const SECTION_ORDER: ReadonlyArray<readonly [HelpSection, string]> = [
  ['description', 'Description'],
  ['arguments', 'Arguments'],
  ['options', 'Options'],
  ['examples', 'Examples'],
  ['notes', 'Notes']
];

function command(
  path: string,
  usage: string[],
  { acceptsPositionals = false, summary = '', sections = {} }: {
    acceptsPositionals?: boolean;
    summary?: string;
    sections?: Partial<Record<HelpSection, string[]>>;
  } = {}
): HelpCommand {
  const normalizedSections: Record<HelpSection, string[]> = {
    description: [],
    arguments: [],
    options: [],
    examples: [],
    notes: [],
    ...sections
  };
  if (summary && normalizedSections.description.length === 0) normalizedSections.description = [summary];
  return {
    path,
    usage,
    acceptsPositionals,
    summary,
    // Populate these arrays as detailed command documentation is added.
    // Empty sections intentionally do not appear in --help output.
    sections: normalizedSections
  };
}

export const HELP_COMMANDS = [
  command('', ['qmd-prover <command> [arguments]', 'qmd-prover help [COMMAND...]'], {
    sections: {
      notes: [
        'Requirements: Node.js 20+ and Pandoc (or QMD_PROVER_PANDOC). A verifier and Quarto are optional.',
        'Run `qmd-prover doctor` to check dependencies before inspecting QMD.',
        'JSON is the default stable output. `--print` selects a concise human report where documented.',
        'Semantic IDs may be written as `@ID` or `ID`; output uses the canonical `@ID` form.',
        'Exit 1 means CLI usage/runtime failure; exit 2 means a structured domain result with ok:false.'
      ]
    }
  }),
  command('doctor', ['qmd-prover doctor [--print]'], {
    summary: 'Check Node, Pandoc, verifier, and Quarto availability without changing the project.'
  }),
  command('init', ['qmd-prover init [--adopt-existing|--append-contract|--sync-contract]'], {
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
  }),
  command('inspect', ['qmd-prover inspect <command> [arguments]']),
  command('inspect project', ['qmd-prover inspect project [--print]'], {
    summary: 'Run machine analysis, optional local conditional verification, and global composition for every fact in the project; return the schema-v5 project graph.'
  }),
  command('inspect fact', ['qmd-prover inspect fact @ID [--print]'], {
    acceptsPositionals: true,
    summary: 'Locate a fact, locally check its dependency closure when a verifier is configured, and compute its global status.'
  }),
  command('inspect path', ['qmd-prover inspect path FILE_OR_FOLDER [--print]'], {
    acceptsPositionals: true,
    summary: 'Run machine analysis and optional local/global verification for the facts declared under one project QMD file or folder.'
  }),
  command('dependency', ['qmd-prover dependency <command> [arguments]']),
  command('dependency dependencies', ['qmd-prover dependency dependencies @ID [--print]'], { acceptsPositionals: true, summary: 'Show direct and transitive dependencies of one fact.' }),
  command('dependency reverse', ['qmd-prover dependency reverse <command> [arguments]']),
  command('dependency reverse dependencies', ['qmd-prover dependency reverse dependencies @ID [--print]'], { acceptsPositionals: true, summary: 'Show facts that directly or transitively depend on one fact.' }),
  command('dependency impact', ['qmd-prover dependency impact @ID [--print]'], { acceptsPositionals: true, summary: 'Show downstream facts affected by a fact change.' }),
  command('dependency frontier', ['qmd-prover dependency frontier @ID [--print]'], {
    acceptsPositionals: true,
    summary: 'Show the lowest open, rejected, disproved, stale, or otherwise unusable dependencies.'
  }),
  command('dependency path', ['qmd-prover dependency path @FROM @TO [--print]'], { acceptsPositionals: true, summary: 'Show the shortest dependency path; FROM=TO returns the one-node path.' }),
  command('dependency alternative', ['qmd-prover dependency alternative <command> [arguments]']),
  command('dependency alternative paths', ['qmd-prover dependency alternative paths @FROM @TO [--limit N] [--max-depth N] [--print]'], {
    acceptsPositionals: true,
    summary: 'Enumerate bounded simple paths between two facts.',
    sections: { options: ['--limit N       Number of paths, 1-25 (default 5).', '--max-depth N   Maximum edge depth, 1-100.'] }
  }),
  command('dependency cycles', ['qmd-prover dependency cycles [--print]'], { summary: 'List dependency cycles in the aggregate graph.' }),
  command('dependency findings', ['qmd-prover dependency findings [--print]'], { summary: 'Return all graph hygiene, readiness, staleness-impact, and reuse findings.' }),
  command('dependency unused', ['qmd-prover dependency unused <command> [arguments]']),
  command('dependency unused imports', ['qmd-prover dependency unused imports [--print]'], { summary: 'List imported fact IDs not referenced by their consumer file.' }),
  command('dependency unused exports', ['qmd-prover dependency unused exports [--print]'], { summary: 'List exported facts not imported elsewhere.' }),
  command('dependency isolated', ['qmd-prover dependency isolated [--print]'], { summary: 'List facts with no incoming or outgoing dependency edge.' }),
  command('dependency unreachable', ['qmd-prover dependency unreachable [--print]'], { summary: 'List facts outside every protected main-goal dependency closure.' }),
  command('dependency ready', ['qmd-prover dependency ready <command> [arguments]']),
  command('dependency ready for', ['qmd-prover dependency ready for <command> [arguments]']),
  command('dependency ready for ai', ['qmd-prover dependency ready for ai [--print]'], { summary: 'List candidates whose machine checks and direct dependency edges pass.' }),
  command('dependency reused', ['qmd-prover dependency reused [--limit N] [--print]'], {
    summary: 'Rank facts by transitive and direct reverse-dependency counts.',
    sections: { options: ['--limit N   Number of facts, 1-1000 (default 20).'] }
  }),
  command('dependency search', [
    'qmd-prover dependency search QUERY [--kind KIND] [--status STATUS] [--origin ORIGIN] [--path PATH]',
    '    [--used-by @ID|--depends-on @ID|--affected-by @ID|--stale-affected-by @ID]',
    '    [--related-to @ID] [--reverse] [--frontier-of @ID] [--cycle-participant] [--direct] [--print]'
  ], {
    acceptsPositionals: true,
    summary: 'Search fact IDs, titles, paths, statements, and proofs with graph-aware filters.',
    sections: {
      options: [
        '--kind definition|lemma|theorem|proposition|corollary|unknown',
        '--origin fact|main-goal|unresolved',
        '--status STATUS   Use one of the statuses listed by inspect output.',
        '--path PATH       Match one file or directory prefix.',
        '--used-by/--depends-on/--affected-by/--stale-affected-by/--frontier-of @ID',
        '--related-to @ID [--reverse]   Search dependencies or reverse dependencies.',
        '--direct          Restrict graph relationship filters to one edge.',
        '--cycle-participant   Restrict matches to nodes in cycles.'
      ]
    }
  }),
  command('check', ['qmd-prover check <command> [arguments]']),
  command('check staleness', ['qmd-prover check staleness [--print]'], { summary: 'Audit verification cache freshness without modifying QMD.' }),
  command('verification', ['qmd-prover verification <command> [arguments]']),
  command('verification list', ['qmd-prover verification list'], { summary: 'List retained verification records and discover submission IDs.' }),
  command('verification show', ['qmd-prover verification show SUBMISSION_ID'], { acceptsPositionals: true, summary: 'Read one retained verification record by submission ID.' }),
  command('render', ['qmd-prover render [--allow-errors]'], {
    summary: 'Prepare generated status QMD, graph SVG, and JSON report.',
    sections: {
      options: ['--allow-errors   Explicitly generate diagnostic artifacts when project errors exist.'],
      notes: ['Without --allow-errors, project errors block rendering and no render artifacts are written.', 'The final `quarto render` command is suggested only when Quarto is available.']
    }
  })
];

const byPath = new Map<string, HelpCommand>(HELP_COMMANDS.map((item) => [item.path, item]));

function childCommands(parent: HelpCommand): HelpCommand[] {
  const parentTokens = parent.path ? parent.path.split(' ') : [];
  return HELP_COMMANDS.filter((item) => {
    const tokens = item.path ? item.path.split(' ') : [];
    return tokens.length === parentTokens.length + 1 && parentTokens.every((token, index) => tokens[index] === token);
  });
}

export function findHelpCommand(pathArgs: string[]): HelpCommand {
  let selected = byPath.get('');
  if (!selected) throw new Error('Root help command is not registered');
  for (let length = 1; length <= pathArgs.length; length += 1) {
    const candidate = byPath.get(pathArgs.slice(0, length).join(' '));
    if (candidate) selected = candidate;
  }
  return selected;
}

export function isHelpGroup(item: HelpCommand): boolean {
  return childCommands(item).length > 0;
}

export function hasExactHelpCommand(path: string): boolean {
  return byPath.has(path);
}

export function renderHelp(item: HelpCommand): string {
  const lines = ['Usage:', ...item.usage.map((line) => `  ${line}`)];

  for (const [key, title] of SECTION_ORDER) {
    const content = item.sections[key];
    if (content.length > 0) lines.push('', `${title}:`, ...content.map((line) => `  ${line}`));
  }

  const children = childCommands(item);
  if (children.length > 0) {
    lines.push('', 'Commands:');
    for (const child of children) {
      lines.push(`  ${child.path.split(' ').at(-1)}`);
      if (child.summary) lines.push(`    ${child.summary}`);
    }
  }

  return lines.join('\n');
}

export const rootUsage = renderHelp(findHelpCommand([]));
