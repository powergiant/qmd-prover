import { renderHelp, rootUsage } from './help.js';
import { parseCommand } from './parse.js';
import { inspectFact, inspectPath, inspectProject } from '../commands/inspect/index.js';
import { analyzeDependencies } from '../commands/dependency/index.js';
import { renderProject } from '../commands/render/index.js';
import { doctorProject } from '../commands/doctor/index.js';
import { installSkillCommand } from '../commands/install/index.js';
import { initializeProject } from '../commands/init/index.js';
import { checkStaleness } from '../commands/check/index.js';
import { listVerifications, showVerification } from '../commands/verification/index.js';
import { printReport } from './output/report.js';
import { leanView } from './output/lean.js';
import { collectCompatibilityWarnings, engineVersions } from '../core/infrastructure/compatibility.js';
// ---------------------------------------------------------------------------
// The CLI runtime. It parses argv into a Command (commands.ts), runs it, and
// writes output — the only module that touches the process, the disk, and the
// inspection/verification operations. --print renders the full internal result;
// the default JSON path emits the lean agent-facing projection (leanView), so
// report.ts and the on-disk snapshot keep the complete object.
// ---------------------------------------------------------------------------
function emit(value, print, view = {}) {
    if (print)
        process.stdout.write(printReport(value));
    else
        process.stdout.write(`${JSON.stringify(leanView(value, view), null, 2)}\n`);
    if (value.ok === false)
        process.exitCode = 2;
}
// Commands that read a project's persisted state. Before they run, surface any
// version drift between this engine and that state as a soft stderr warning — the
// gate warns, it never refuses. `doctor` reports the same information in its JSON
// instead, and `init` owns the contract, so both are handled separately.
const PROJECT_COMMANDS = new Set(['render', 'inspect', 'dependency', 'check', 'verification']);
async function warnCompatibility(root) {
    for (const warning of await collectCompatibilityWarnings(root)) {
        process.stderr.write(`qmd-prover: warning: ${warning.message}\n`);
    }
}
// ---------------------------------------------------------------------------
// Dispatch. Pattern-match the parsed command and run it, rebuilding each
// operation's option bag from the command's explicit fields and merging the
// environment-derived pandoc option.
// ---------------------------------------------------------------------------
export async function main(args, { root = process.cwd(), pandoc = process.env.QMD_PROVER_PANDOC } = {}) {
    const command = parseCommand(args);
    const options = pandoc ? { pandoc } : {};
    if (PROJECT_COMMANDS.has(command.kind))
        await warnCompatibility(root);
    switch (command.kind) {
        case 'usage':
            process.stdout.write(`${rootUsage}\n`);
            return;
        case 'help':
            process.stdout.write(`${renderHelp(command.of)}\n`);
            return;
        case 'version': {
            const versions = await engineVersions();
            process.stdout.write(`${JSON.stringify({
                operation: 'version',
                tool: versions.tool,
                schema_version: versions.schema,
                verifier_protocol_version: versions.verifier_protocol,
                contract_version: versions.contract
            }, null, 2)}\n`);
            return;
        }
        case 'doctor':
            emit(await doctorProject(root), command.print);
            return;
        case 'install':
            emit(await installSkillCommand(root, { scope: command.scope, host: command.host, dir: command.dir }), false);
            return;
        case 'init':
            emit(await initializeProject(root, {
                adoptExisting: command.adoptExisting,
                appendContract: command.appendContract,
                syncContract: command.syncContract
            }), false);
            return;
        case 'render':
            emit(await renderProject(root, { ...options, allowErrors: command.allowErrors }), false);
            return;
        case 'inspect':
            switch (command.sub) {
                case 'project':
                    emit(await inspectProject(root, options), command.print, { graph: command.graph });
                    return;
                case 'fact':
                    emit(await inspectFact(root, command.id, options), command.print, { graph: command.graph });
                    return;
                case 'path':
                    emit(await inspectPath(root, command.target, options), command.print, { graph: command.graph });
                    return;
                default:
                    return command;
            }
        case 'dependency':
            switch (command.sub) {
                case 'search':
                    emit(await analyzeDependencies(root, 'search', command.query === undefined ? [] : [command.query], { ...options, ...command.filters }), command.print);
                    return;
                case 'alternative-paths':
                    emit(await analyzeDependencies(root, 'alternative-paths', [command.from, command.to], { ...options, maxPaths: command.maxPaths, maxDepth: command.maxDepth }), command.print);
                    return;
                case 'reused':
                    emit(await analyzeDependencies(root, 'reused', [], { ...options, limit: command.limit }), command.print);
                    return;
                case 'path':
                    emit(await analyzeDependencies(root, 'path', [command.from, command.to], options), command.print);
                    return;
                case 'dependencies':
                case 'reverse-dependencies':
                case 'impact':
                case 'frontier':
                    emit(await analyzeDependencies(root, command.sub, [command.id], options), command.print);
                    return;
                case 'cycles':
                case 'findings':
                case 'unused-imports':
                case 'unused-exports':
                case 'isolated':
                case 'unreachable':
                case 'ready-for-ai':
                    emit(await analyzeDependencies(root, command.sub, [], options), command.print);
                    return;
                default:
                    return command;
            }
        case 'check':
            emit(await checkStaleness(root, options), command.print);
            return;
        case 'verification':
            switch (command.sub) {
                case 'list':
                    emit(await listVerifications(root), false);
                    return;
                case 'show':
                    emit(await showVerification(root, command.submissionId), false);
                    return;
                default:
                    return command;
            }
        default:
            return command;
    }
}
