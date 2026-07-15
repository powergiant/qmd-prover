# Dispatcher and installation reference

qmd-prover is a self-contained Codex skill with a dependency-free Node dispatcher for mathematical proof workflows in Quarto Markdown. Every QMD file in the project is semantic mathematics compiled into one unified dependency graph. Exact verifier decisions, dependency graphs, and generated Quarto inputs live under `.qmd-prover/`, which holds only derived tool state.

## Requirements

- Node.js 20 or later.
- Pandoc on `PATH`, or `tools.pandoc` in `.qmd-prover/config.yml`, or `QMD_PROVER_PANDOC` set to a compatible executable.
- An optional independent verifier. Set `verification.backend` to `claude` or `codex` to use a bundled adapter (with `verification.executable` pointing at that CLI when it is not on `PATH`), or `backend: command` with a custom `verification.command` argv, or `QMD_PROVER_VERIFIER`. Without a verifier, machine inspection remains available and verification states remain incomplete.
- Quarto only when rendered HTML, PDF, or another final format is wanted; configure it with `tools.quarto` or `QMD_PROVER_QUARTO` when it is not on `PATH`.

Tool-path precedence is: explicit override (env var) > `.qmd-prover/config.yml` (`tools.pandoc`, `tools.quarto`, `verification.executable`) > the bare command on `PATH`. `doctor` reports the resolved command and availability for each.

## Bundled verifier backends

`verification.backend: claude` and `verification.backend: codex` run adapters shipped at `scripts/verifiers/claude.mjs` and `scripts/verifiers/codex.mjs`. Each reads the packet on standard input, drives the corresponding CLI (`claude -p … --output-format json`, i.e. the Claude Agent SDK entry point; `codex exec …`, i.e. the Codex SDK entry point), extracts the verdict JSON, and prints it — so no custom script is needed and no qmd-prover code changes to switch model or executable, only configuration. The CLI must be installed and authenticated. `verification.model` is forwarded as `--model` when it is a concrete id (not `configurable`). The `command` backend and `QMD_PROVER_VERIFIER` remain available for a fully custom verifier that speaks the protocol below.

The verifier receives one JSON packet on standard input for one local conditional check. It includes the exact target statement or construction, the submitted proof or refutation, the exact statements of only its direct dependencies, the definitions among that direct context, checker contract, and `external_basis` mode and exact content. It deliberately excludes dependency proof text, dependency verification state, and the transitive proof closure. The verifier must assume the supplied direct dependency statements and judge the proof actually submitted, rather than replacing it with another proof. It must return:

```json
{
  "verdict": "correct",
  "summary": "...",
  "refutation": "",
  "critical_errors": [],
  "gaps": [],
  "nonblocking_comments": [],
  "repair_hints": ""
}
```

The protocol accepts `correct`, `incorrect`, or `disproved`. A locally accepted proof requires `correct` with empty `critical_errors` and `gaps`. A locally accepted disproof, including review of a source proof marked `DISPROVED`, requires `disproved`, a nonempty independently checkable `refutation`, and no critical errors or gaps. These are conditional AI decisions. The inspector separately computes global state over the machine dependency graph; neither layer is formal verification or human review.

## Commands

Run the dispatcher from the mathematical project root:

```bash
QMD_PROVER="${CODEX_HOME:-$HOME/.codex}/skills/qmd-prover/scripts/qmd-prover.js"
node "$QMD_PROVER" doctor [--print]
node "$QMD_PROVER" init [--adopt-existing|--append-contract|--sync-contract]
node "$QMD_PROVER" inspect project [--print]
node "$QMD_PROVER" inspect fact @ID [--print]
node "$QMD_PROVER" inspect path FILE_OR_FOLDER [--print]
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
node "$QMD_PROVER" verification list
node "$QMD_PROVER" verification show SUBMISSION_ID
node "$QMD_PROVER" render [--allow-errors]
```

Run `qmd-prover help`, append `help`, `--help`, or `-h` to a command group or leaf command, or use `qmd-prover help COMMAND...` for exact usage.

`doctor` is read-only and checks Node, Pandoc, the optional verifier, and optional Quarto without parsing QMD. Use it before inspection when the execution environment is uncertain.

`init` inventories existing policy, QMD, Quarto configuration, `.qmd-prover` state, and the `unrestricted`, `none`, or `declared` external-policy mode. It never creates `.external.qmd`. When existing material makes intent ambiguous, it returns `intent-required` without writing. Use `--adopt-existing`, `--append-contract`, or `--sync-contract` only after approval; synchronization preserves everything outside the managed block. Successful initialization creates no theorem QMD.

`inspect project` compiles every discovered project QMD file into one graph, runs machine analysis and optional local conditional verification for every fact, and returns the schema-v6 facts, graph, findings, local-verification totals, global-verification totals, and staleness. One malformed file does not hide healthy results elsewhere. `ok` reports operational success, not mathematical truth; inspect each main goal's `global_verification.status`.

`inspect fact @ID` locates any explicit declaration, including a protected main goal. A protected main goal is checked through its linked proof overlay; the user QMD is not changed. `inspect fact` verifies only the selected fact and its transitive dependencies. It does not verify reverse dependencies or unrelated facts.

`inspect path` applies the full semantic-QMD contract to the facts declared under any project file or directory and checks the selected facts plus their transitive local dependencies. A path with no declared facts returns an empty fact result.

Inspection and dependency commands return schema-v6 JSON by default. `--print` changes presentation only; it uses the same selection, decisions, diagnostics, and snapshot. Machine or configured-verifier infrastructure failures return `ok:false` with exit code 2. An absent verifier is not an error: local checks are `not-run` and global states are unverified. Command grammar and argument errors use exit code 1. Pandoc launch or parse failures remain parse diagnostics and are never reported as unknown facts.

All explicit IDs are globally unique across the project. A duplicate lists every project-relative declaration location and blocks dependency analysis until the conflicting declarations are renamed. Any fact may cite any other project fact, including a protected main goal, subject to explicit import scope; global composition keeps dependents blocked until the cited fact is globally verified.

Inspection exposes three separate fields. `mechanical` is computed without AI and covers source shape, exact dependency edges, existence, scope, imports/exports, cycles, and freshness. `local_verification` checks the submitted proof conditionally on direct dependency statements; it may run even when an upstream proof is rejected, unverified, or cyclic, provided the direct statements can be materialized. `global_verification` is then computed deterministically: a mechanically valid, locally accepted result is globally verified only when every direct dependency is globally verified.

A theorem-like proof beginning with `DISPROVED` is locally checked as a proposed refutation; an unmarked proof is checked as a proof, although the verifier may independently discover that the statement is false. A local disproof is globally conclusive only when its dependency closure is globally verified. Local decisions are cached by target statement or construction, submitted proof or refutation, exact direct dependency statements, semantic context, external basis, checker contract, and protocol. Dependency proof hashes and verification labels are not cache inputs. Consequently, changing an upstream proof without changing its statement reuses downstream local decisions and only recomputes global status.

Dependency commands always operate on the published project machine graph, but each returns only its own answer — the target and its dependencies or dependents, the requested path, the matching facts, cycles, or findings — not the whole graph; the returned nodes carry separate local and global fields. A node is usable as an established premise only when `global_verification.status` is `verified`; blocked, unverified, rejected, invalid, and disproved nodes appear as frontier blockers. Refutation evidence identifies whether it is merely conditional or globally composed. Queries without a target, including cycles, findings, unused declarations, isolated facts, unreachable facts, ready candidates, reused facts, and search, cover the complete project graph. Search matches every fact when its `QUERY` is omitted, and accepts text, kind, status, origin, and path filters plus dependency, reverse-dependency, frontier, stale-impact, directness, and cycle-participant filters that combine with AND. Every result identifies the snapshot used.

`check staleness` is read-only. It audits the exact verification cache records against current project sources, the external basis, and the checker contract. It reports changes and invalidations but never edits QMD or markers.

`verification list` discovers retained submission IDs. `verification show` reads one record and returns `SUBMISSION_NOT_FOUND` rather than exposing an internal filesystem error when no record matches.

`render` refreshes generated proof-status QMD, report data, and the dependency SVG from the project's semantic mathematics. Project errors block it without writing artifacts unless `--allow-errors` is explicit. It suggests ordinary `quarto render` only when Quarto is available.

### Diagnostic codes

An uppercase diagnostic code is a stable value in the JSON
`diagnostics[].code` field. It is not a QMD class, attribute, status marker, or
instruction to edit a source file. Codes may also appear in `--print`
output and derived diagnostic or snapshot JSON; qmd-prover never inserts them
into mathematical QMD.

The inspection codes most useful when handling command output are:

| Code | Meaning and response |
|---|---|
| `PARSE_ERROR` | Pandoc could not start or parse a relevant file. Fix the parser configuration or QMD syntax before interpreting lookup results. |
| `FACT_UNKNOWN` | Parsing and indexing completed, but the requested ID was not found. Check the ID and project scope. |
| `PATH_NOT_FOUND`, `PATH_OUTSIDE_PROJECT`, `PATH_TYPE_INVALID` | A path request names no entry, escapes the project, or is not a QMD file or directory. Correct the requested path. |
| `DUPLICATE_ID` | An explicit ID is declared more than once in the project. Rename the conflicting declarations before dependency analysis can continue. |
| `MAIN_STATEMENT_MUTATED`, `MAIN_TITLE_MUTATED` | A protected main goal differs from its locked baseline. Restore the user statement; change it only with explicit user approval. |
| `PROTECTED_MARKER_FORBIDDEN` | A source file carries a reserved `VERIFIED` or `REVOKED` marker. Remove it; verification state is recorded by inspection, never in QMD. |
| `SOURCE_STALE` | Sources or verifier context changed while a check was running. Discard that result and reinspect the affected scope. |
| `AI_DISPROOF_REJECTED` | The independent verifier did not validate a proposed refutation. Repair the counterexample or return the proof to an appropriate non-disproof state. |
| `DEFINITION_DISPROVED_FORBIDDEN` | A definition uses `DISPROVED`, which is meaningful only for a theorem-like statement. Move the challenge to a linked theorem-like claim. |
| `DEPENDENCY_UNAVAILABLE` | A citation names a fact that is neither local to the citing file nor explicitly imported. Add the export/import pair or move the declaration. |

Other semantic-shape, import, proof, verifier, and cache codes are
interpreted the same way: read the diagnostic's message, source location,
remediation, and repair hints. They describe why an operation failed; they do
not extend the QMD source language.

## Semantic QMD

Complete declaration/proof semantics apply to every project QMD file. A result uses a Quarto theorem block with a `name` caption and a separate linked proof:

```markdown
::: {#lem-even-square .lemma name="Even squares" date="2026-07-13" export="lem-even-square"}
For every even integer (n), the integer (n^2) is divisible by (4).
:::

::: {.proof of="lem-even-square"}
By @def-even-integer, write (n=2k). Then (n^2=4k^2).
:::
```

Cross-file availability is declared in front matter:

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

When the exact theorem-like statement is false, preserve the declaration and put the proposed counterexample or refutation in its linked proof:

```markdown
::: {#lem-false-parity .lemma name="False parity claim" date="2026-07-13"}
Every integer is even.
:::

::: {.proof of="lem-false-parity"}
DISPROVED

The integer (1) satisfies the stated domain hypothesis, but it is not divisible
by (2). Thus it is a counterexample to the universal conclusion.
:::
```

`DISPROVED` must be the first nonempty proof paragraph and cannot be used on a definition. A successful local check records conditional disproof evidence. It becomes `disproved` only after global composition verifies every dependency; otherwise the node is blocked. A failed local check records a rejected global state. The verifier never writes the marker or edits QMD, and it may return a disproved outcome for an ordinary candidate when it independently finds a counterexample.

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

The suite uses an AST-producing Pandoc test adapter and fresh-process mock verifiers. Production parsing never falls back to regular expressions. Tests also check contract/example synchronization, stable JSON, CLI help, machine-only inspection, local checking despite upstream rejection and cycles, deterministic global propagation, direct-statement cache boundaries, large-project topology, duplicate-ID handling, parse-error fidelity, and statement-lock protection.

## Current boundary

This release implements machine dependency analysis, local conditional command/LLM review, and deterministic global composition, not formal proof checking. It retains local decisions, global states, and refutation evidence under `.qmd-prover/` for inspection and future paper tooling; it never rewrites the project's mathematical QMD. Production AI-provider adapters, formal-verifier adapters, paper generation, and richer Quarto extensions remain separate integrations.
