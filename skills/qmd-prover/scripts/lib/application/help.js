const SECTION_ORDER = [
    ['description', 'Description'],
    ['arguments', 'Arguments'],
    ['options', 'Options'],
    ['examples', 'Examples'],
    ['notes', 'Notes']
];
function command(path, usage, { acceptsPositionals = false, summary = '', sections = {} } = {}) {
    return {
        path,
        usage,
        acceptsPositionals,
        summary,
        // Populate these arrays as detailed command documentation is added.
        // Empty sections intentionally do not appear in --help output.
        sections: {
            description: [],
            arguments: [],
            options: [],
            examples: [],
            notes: [],
            ...sections
        }
    };
}
export const HELP_COMMANDS = [
    command('', ['qmd-prover <command> [arguments]', 'qmd-prover help [COMMAND...]']),
    command('init', ['qmd-prover init [--adopt-existing|--append-contract|--sync-contract]'], {
        summary: 'Initialize or safely adopt a qmd-prover project.',
        sections: {
            description: [
                'Initialize the qmd-prover project contract and ensure `.qmd-prover/workspaces/` exists.',
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
                'A successful response includes the discovered inventory and `workspace_root`; initialization creates no theorem QMD.'
            ]
        }
    }),
    command('inspect', ['qmd-prover inspect <command> [arguments]']),
    command('inspect project', ['qmd-prover inspect project [--print]'], {
        summary: 'Inspect every initialized workspace and return the aggregate schema-v3 graph.'
    }),
    command('inspect fact', ['qmd-prover inspect fact @ID [--print]'], {
        acceptsPositionals: true,
        summary: 'Locate any main-goal or workspace fact and verify only its dependency closure.'
    }),
    command('inspect path', ['qmd-prover inspect path FILE_OR_FOLDER [--print]'], {
        acceptsPositionals: true,
        summary: 'Inspect workspace QMD, or recognize only main goals in user notes.'
    }),
    command('inspect workspace', ['qmd-prover inspect workspace @thm-main-ID [--print]'], {
        acceptsPositionals: true,
        summary: 'Inspect one complete initialized goal workspace without creating it.'
    }),
    command('dependency', ['qmd-prover dependency <command> [arguments]']),
    command('dependency dependencies', ['qmd-prover dependency dependencies @ID [--print]'], { acceptsPositionals: true }),
    command('dependency reverse', ['qmd-prover dependency reverse <command> [arguments]']),
    command('dependency reverse dependencies', ['qmd-prover dependency reverse dependencies @ID [--print]'], { acceptsPositionals: true }),
    command('dependency impact', ['qmd-prover dependency impact @ID [--print]'], { acceptsPositionals: true }),
    command('dependency frontier', ['qmd-prover dependency frontier @ID [--print]'], { acceptsPositionals: true }),
    command('dependency path', ['qmd-prover dependency path @FROM @TO [--print]'], { acceptsPositionals: true }),
    command('dependency alternative', ['qmd-prover dependency alternative <command> [arguments]']),
    command('dependency alternative paths', ['qmd-prover dependency alternative paths @FROM @TO [--limit N] [--max-depth N] [--print]'], { acceptsPositionals: true }),
    command('dependency cycles', ['qmd-prover dependency cycles [--print]']),
    command('dependency findings', ['qmd-prover dependency findings [--print]']),
    command('dependency unused', ['qmd-prover dependency unused <command> [arguments]']),
    command('dependency unused imports', ['qmd-prover dependency unused imports [--print]']),
    command('dependency unused exports', ['qmd-prover dependency unused exports [--print]']),
    command('dependency isolated', ['qmd-prover dependency isolated [--print]']),
    command('dependency unreachable', ['qmd-prover dependency unreachable [--print]']),
    command('dependency ready', ['qmd-prover dependency ready <command> [arguments]']),
    command('dependency ready for', ['qmd-prover dependency ready for <command> [arguments]']),
    command('dependency ready for ai', ['qmd-prover dependency ready for ai [--print]']),
    command('dependency reused', ['qmd-prover dependency reused [--limit N] [--print]']),
    command('dependency search', [
        'qmd-prover dependency search QUERY [--kind KIND] [--status STATUS] [--origin ORIGIN] [--path PATH]',
        '    [--used-by @ID|--depends-on @ID|--affected-by @ID|--stale-affected-by @ID]',
        '    [--frontier-of @ID] [--cycle-participant] [--direct] [--print]'
    ], { acceptsPositionals: true }),
    command('check', ['qmd-prover check <command> [arguments]']),
    command('check staleness', ['qmd-prover check staleness [--print]'], { summary: 'Audit workspace and cache freshness without modifying QMD.' }),
    command('workspace', ['qmd-prover workspace <command> [arguments]']),
    command('workspace init', ['qmd-prover workspace init @thm-main-ID'], { acceptsPositionals: true }),
    command('workspace inspect', ['qmd-prover workspace inspect @thm-main-ID [--print]'], { acceptsPositionals: true, summary: 'Compatibility alias for inspect workspace.' }),
    command('submit', ['qmd-prover submit <command> [arguments]']),
    command('submit proof', ['qmd-prover submit proof PROPOSAL_FILE [--to QMD]'], { acceptsPositionals: true, summary: 'Retired compatibility command; returns structured status and writes nothing.' }),
    command('verification', ['qmd-prover verification <command> [arguments]']),
    command('verification show', ['qmd-prover verification show SUBMISSION_ID'], { acceptsPositionals: true }),
    command('verification revoke', ['qmd-prover verification revoke @thm-ID --reason "..."'], { acceptsPositionals: true, summary: 'Retired compatibility command; legacy markers remain untouched.' }),
    command('render', ['qmd-prover render'])
];
const byPath = new Map(HELP_COMMANDS.map((item) => [item.path, item]));
function childCommands(parent) {
    const parentTokens = parent.path ? parent.path.split(' ') : [];
    return HELP_COMMANDS.filter((item) => {
        const tokens = item.path ? item.path.split(' ') : [];
        return tokens.length === parentTokens.length + 1 && parentTokens.every((token, index) => tokens[index] === token);
    });
}
export function findHelpCommand(pathArgs) {
    let selected = byPath.get('');
    if (!selected)
        throw new Error('Root help command is not registered');
    for (let length = 1; length <= pathArgs.length; length += 1) {
        const candidate = byPath.get(pathArgs.slice(0, length).join(' '));
        if (candidate)
            selected = candidate;
    }
    return selected;
}
export function isHelpGroup(item) {
    return childCommands(item).length > 0;
}
export function hasExactHelpCommand(path) {
    return byPath.has(path);
}
export function renderHelp(item) {
    const lines = ['Usage:', ...item.usage.map((line) => `  ${line}`)];
    for (const [key, title] of SECTION_ORDER) {
        const content = item.sections[key];
        if (content.length > 0)
            lines.push('', `${title}:`, ...content.map((line) => `  ${line}`));
    }
    const children = childCommands(item);
    if (children.length > 0) {
        lines.push('', 'Commands:');
        for (const child of children) {
            lines.push(`  ${child.path.split(' ').at(-1)}`);
            if (child.summary)
                lines.push(`    ${child.summary}`);
        }
    }
    return lines.join('\n');
}
export const rootUsage = renderHelp(findHelpCommand([]));
