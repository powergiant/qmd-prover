# Dispatcher and installation reference

qmd-prover is a self-contained Codex skill with a dependency-free Node dispatcher for mathematical proof workflows in Quarto Markdown. QMD outside `.qmd-prover/` remains user-owned notes and protected main-goal storage. Complete semantic mathematics, proof overlays, exact verifier decisions, dependency graphs, and generated Quarto inputs live under `.qmd-prover/` goal workspaces and project state.

## Requirements

- Node.js 20 or later.
- Pandoc on `PATH`, or `QMD_PROVER_PANDOC` set to a compatible executable.
- An independent verifier executable configured with `QMD_PROVER_VERIFIER` or `verification.command`.
- Quarto only when rendered HTML, PDF, or another final format is wanted.

The verifier receives one JSON packet on standard input. It includes the exact theorem-like statement and proof or definition construction, local dependency identities and states, workspace import scope, checker contract, and `external_basis` mode and exact content. It must return:

```json
{
  "verdict": "correct",
  "summary": "...",
  "critical_errors": [],
  "gaps": [],
  "nonblocking_comments": [],
  "repair_hints": ""
}
```

Only `correct` with empty `critical_errors` and `gaps` is accepted. Informal verifier acceptance remains distinct from formal verification and human review.

## Commands

Run the dispatcher from the mathematical project root:

```bash
QMD_PROVER="${CODEX_HOME:-$HOME/.codex}/skills/qmd-prover/scripts/qmd-prover.js"
node "$QMD_PROVER" init [--adopt-existing|--append-contract|--sync-contract]
node "$QMD_PROVER" inspect project [--print]
node "$QMD_PROVER" inspect fact @ID [--print]
node "$QMD_PROVER" inspect path FILE_OR_FOLDER [--print]
node "$QMD_PROVER" inspect workspace @thm-main-ID [--print]
node "$QMD_PROVER" workspace init @thm-main-ID
node "$QMD_PROVER" workspace inspect @thm-main-ID [--print]
node "$QMD_PROVER" dependency dependencies @ID [--print]
node "$QMD_PROVER" dependency reverse dependencies @ID [--print]
node "$QMD_PROVER" dependency path @FROM @TO [--print]
node "$QMD_PROVER" dependency alternative paths @FROM @TO [--limit N] [--max-depth N] [--print]
node "$QMD_PROVER" dependency cycles [--print]
node "$QMD_PROVER" dependency impact @ID [--print]
node "$QMD_PROVER" dependency frontier @ID [--print]
node "$QMD_PROVER" dependency findings [--print]
node "$QMD_PROVER" dependency unused imports [--print]
node "$QMD_PROVER" dependency unused exports [--print]
node "$QMD_PROVER" dependency isolated [--print]
node "$QMD_PROVER" dependency unreachable [--print]
node "$QMD_PROVER" dependency ready for ai [--print]
node "$QMD_PROVER" dependency reused [--limit N] [--print]
node "$QMD_PROVER" dependency search QUERY [filters] [--print]
node "$QMD_PROVER" check staleness [--print]
node "$QMD_PROVER" submit proof PROPOSAL_FILE [--to QMD]
node "$QMD_PROVER" verification show SUBMISSION_ID
node "$QMD_PROVER" verification revoke @ID --reason "reason"
node "$QMD_PROVER" render
```

Run `qmd-prover help`, append `help`, `--help`, or `-h` to a command group or leaf command, or use `qmd-prover help COMMAND...` for exact usage. `workspace inspect` is a compatibility alias for `inspect workspace`.

`init` inventories existing policy, QMD, Quarto configuration, `.qmd-prover` state, and the `unrestricted`, `none`, or `declared` external-policy mode. It never creates `.external.qmd`. When existing material makes intent ambiguous, it returns `intent-required` without writing. Use `--adopt-existing`, `--append-contract`, or `--sync-contract` only after approval; synchronization preserves everything outside the managed block. Successful initialization ensures `.qmd-prover/workspaces/` exists but creates no theorem QMD or goal workspace.

`workspace init @thm-main-ID` creates or resumes `.qmd-prover/workspaces/thm-main-ID/`. It records the protected main-goal identity, preserves a target snapshot, and creates initial progress/state only on first initialization. Inspection does not call this command implicitly.

`inspect project` discovers user notes, protected main goals, initialized workspaces, goal-like uninitialized directories, and orphan workspaces. It checks every initialized workspace independently and returns their complete subresults together with aggregate facts, schema-v3 graph, findings, verification totals, and staleness summary. One malformed workspace does not hide healthy results. The operation is successful only when every protected goal has a current initialized workspace whose full inspection passes.

`inspect fact @ID` searches protected main goals and every workspace declaration. A protected main goal is checked through its own workspace proof overlay; the user QMD is not changed. `inspect fact` verifies only the selected fact and its transitive dependencies inside that workspace. It does not verify reverse dependencies or unrelated facts.

`inspect path` applies the full semantic-QMD contract to a workspace file or directory and checks the selected facts plus their transitive local dependencies. Outside `.qmd-prover/`, it recognizes only protected `thm-main-*` goals. An ordinary user-note path returns an empty fact result without diagnosing its theorem-like prose or metadata.

Inspection and dependency commands return schema-v3 JSON by default. `--print` changes presentation only; it uses the same selection, decisions, diagnostics, graph, and snapshot. Inspection or domain failures return `ok:false` with exit code 2. Command grammar and argument errors use exit code 1. Pandoc launch or parse failures remain parse diagnostics and are never reported as unknown facts.

All explicit IDs are globally unique across main goals and workspaces. A duplicate across project scopes lists every project-relative declaration location, stops all inspect and dependency operations before verifier invocation, and prevents publication of a replacement aggregate snapshot. A duplicate confined to one workspace blocks that workspace. Workspaces cannot depend on another workspace or another protected main goal; those edges are diagnosed and omitted from the aggregate graph.

Independent workspace verification runs in dependency order. Exact decisions are cached by statement or construction, proof, dependency identities and states, import scope, external basis, checker contract, and protocol. Repeating an unchanged inspection reuses the cache. Narrow inspection persists its selected results while preserving current outcomes from unchanged, unrelated workspace snapshots, so refreshing the aggregate graph does not downgrade unrelated verified nodes to candidates.

Dependency commands always operate on the aggregate all-workspace graph. Queries without a target, including cycles, findings, unused declarations, isolated facts, unreachable facts, ready candidates, reused facts, and search, cover the complete project graph. Search accepts text, kind, status, origin, and path filters plus dependency, reverse-dependency, frontier, stale-impact, directness, and cycle-participant filters. Every result identifies the snapshot used.

`check staleness` is read-only. It audits protected goal identities, workspace sources, external basis, checker contract, current workspace snapshots, exact cache records, and legacy canonical state. It reports changes and invalidations but never edits QMD, markers, or `progress.qmd`.

`submit proof` and `verification revoke` are retired command surfaces. They return schema-v3 `status: "retired"`, use exit code 2 through the normal structured-result path, and never read or modify the proposal, destination, user QMD, or legacy marker. `verification show` remains a read-only way to inspect an old submission record.

`render` refreshes generated proof-status QMD, report data, and the dependency SVG from protected goals and retained workspace mathematics. It does not build a parallel website. Run ordinary `quarto render` through the project's configured pipeline for final output.

### Diagnostic codes

An uppercase diagnostic code is a stable value in the JSON
`diagnostics[].code` field. It is not a QMD class, attribute, status marker, or
instruction to edit a workspace file. Codes may also appear in `--print`
output and derived diagnostic or snapshot JSON; qmd-prover never inserts them
into mathematical QMD or `progress.qmd`.

The workspace-centric inspection codes most useful when handling command
output are:

| Code | Meaning and response |
|---|---|
| `PARSE_ERROR` | Pandoc could not start or parse a relevant file. Fix the parser configuration or QMD syntax before interpreting lookup results. |
| `FACT_UNKNOWN` | Parsing and indexing completed, but the requested ID was not found. Check the ID and project scope. |
| `PATH_NOT_FOUND`, `PATH_OUTSIDE_PROJECT`, `PATH_TYPE_INVALID` | A path request names no entry, escapes the project, or is not a QMD file or directory. Correct the requested path. |
| `WORKSPACE_MISSING` | A protected goal has no initialized workspace. Initialize it only after the user requests proof work. |
| `WORKSPACE_UNINITIALIZED` | A goal-shaped directory contains QMD but lacks workspace metadata. Inspect reports it and does not initialize it implicitly. |
| `WORKSPACE_ORPHAN` | Workspace metadata has no matching protected main goal or disagrees with the directory name. Repair the ownership mismatch before inspection. |
| `WORKSPACE_STALE` | The protected main goal differs from the workspace's initialization snapshot. Preserve the user statement and resolve the stale workspace explicitly. |
| `WORKSPACE_SOURCE_STALE` | Sources or verifier context changed while a check was running. Discard that result and reinspect the affected scope. |
| `DUPLICATE_ID` | One workspace declares an ID more than once. Rename the local declarations before compiling that workspace. |
| `GLOBAL_DUPLICATE_ID` | An ID is declared in more than one project scope. Rename every conflict before any inspection, dependency query, or aggregate publication can continue. |
| `CROSS_WORKSPACE_DEPENDENCY`, `WORKSPACE_EXTERNAL_FACT_DEPENDENCY` | A workspace cites another workspace or protected main goal as a fact. Adopt and prove the needed claim locally, or use the permitted external basis without a cross-workspace ID edge. |

Other semantic-shape, import, proof, verifier, cache, and legacy codes are
interpreted the same way: read the diagnostic's message, source location,
remediation, and repair hints. They describe why an operation failed; they do
not extend the QMD source language.

## Semantic QMD

Only `thm-main-* .theorem .goal` declarations are semantic in user notes. Complete declaration/proof semantics apply inside initialized workspaces. A workspace result uses a Quarto theorem block with a `name` caption and a separate linked proof:

```markdown
::: {#lem-even-square .lemma name="Even squares" date="2026-07-13" export="lem-even-square"}
For every even integer (n), the integer (n^2) is divisible by (4).
:::

::: {.proof of="lem-even-square"}
By @def-even-integer, write (n=2k). Then (n^2=4k^2).
:::
```

Cross-file workspace availability is declared in front matter:

```yaml
---
qmd-prover:
  imports:
    - from: foundations.qmd
      use:
        - def-even-integer
---
```

The producer must export the same ID. Semantic references inside the construction or linked proof are the dependency declaration; there are no `Statement`, `Uses`, or `Proof` subheadings.

## Install the skill from a source checkout

```bash
npm run install:skill
```

This copies `skills/qmd-prover/` to `${CODEX_HOME:-~/.codex}/skills/qmd-prover`. The source checkout remains the source of truth.

## Test

```bash
npm run typecheck
npm test
git diff --check
```

The suite uses an AST-producing Pandoc test adapter and fresh-process mock verifiers. Production parsing never falls back to regular expressions. Tests also check contract/example synchronization, stable JSON, CLI help, large-workspace topology and caching, global duplicate preflight, parse-error fidelity, and read-only retired operations.

## Current boundary

This release implements informal command/LLM verification, not formal proof checking. It retains verified mathematics inside goal workspaces for inspection and future paper tooling; it does not promote proofs into user notes. Formal-verifier adapters, paper generation, and richer Quarto extensions remain separate integrations.
