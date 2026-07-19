---
name: qmd-prover
description: Initialize and inspect semantic-QMD mathematical projects; formulate definitions and results from ideas; develop, locally AI-check, globally compose, repair, report, and render proofs across one unified project. Use when a user asks to initialize qmd-prover, state or prove one or more protected main goals, grow an existing mathematical development, inspect facts, paths, dependencies, or progress, audit staleness, review verifier findings, or render theorem navigation.
---

# qmd-prover

## Running the tool

Every command here runs the `qmd-prover` engine, installed once on the host's `PATH`. This skill
supplies the instructions; the engine is a separate command. Invoke it directly:

```bash
qmd-prover <command> [arguments]
```

If `qmd-prover` is not found, the engine is not installed yet. Install it as a tool once per host,
then it is available in every project:

```bash
# From a checkout of github.com/powergiant/qmd-prover:
npm install -g .        # users — installs the `qmd-prover` command globally
npm link                # developers — same command, backed by your working checkout
```

The engine also installs this skill: `qmd-prover install --global` places the skill docs under
`~/.claude/skills/qmd-prover` (add `--codex` for Codex; a bare `qmd-prover install` scopes it to the
current project). A skill installed mid-session is not auto-registered by the host — read the printed
`SKILL.md` path to use qmd-prover now, and start a new session for automatic discovery.

Run `qmd-prover version` to confirm the install and see the tool, schema, verifier-protocol, and
contract versions it implements. `qmd-prover doctor` additionally reports any version drift between
the engine and the current project (see "Version compatibility" below).

## Version compatibility

The engine and each project carry versions independently: the installed `qmd-prover` implements a
schema, verifier-protocol, and contract version, while a project's `.qmd-prover/` state and its
`AGENTS.md` contract block were written by whatever engine last touched them. When they differ, the
tool prints a `qmd-prover: warning:` line to stderr before running a project command, and
`qmd-prover doctor` lists the same under a `compatibility` array. These are advisory — the command
still runs; the tool never refuses on a version mismatch. Relay a warning to the user and resolve it:

- **schema** — a stale snapshot; it is ignored and rebuilt on the next `qmd-prover inspect project`.
- **verifier-protocol** — affected cached proof decisions are re-verified on the next inspection.
- **contract** — the project's `AGENTS.md` managed block predates the engine's; review the difference
  and, only with user approval, run `qmd-prover init --sync-contract` (see "Project setup").

## Project setup

When the user asks to initialize qmd-prover in the current project, run this from the project root:

```bash
qmd-prover init
```

Read the returned `existing` inventory. If the status is `intent-required`, summarize the detected `AGENTS.md`, QMD files, Quarto configuration, `.qmd-prover` state, and external-policy mode, then ask whether the user wants to adopt the files in place, inspect them first, or leave them unchanged. Run `init --adopt-existing` only after the user chooses adoption.

If the status is `append-required`, explain that existing project policy will be preserved and ask before running `init --append-contract`. If it is `sync-required`, report the current and canonical contract versions and ask before running `init --sync-contract`. Never use a mutation flag without explicit approval. For `already-initialized`, report that setup is current and continue from the user's requested task. No QMD scaffold or initial theorem is required.

Stop and ask before creating, appending, or synchronizing project policy.

## Project contract preflight

Before drafting mathematics, changing qmd-prover state, or relying on a project fact:

1. Read the project's root `AGENTS.md` and this skill's [canonical project contract](references/AGENTS.md).
2. Compare the `qmd-prover-contract` managed blocks byte-for-byte. Require the project block to be present at the same version and unchanged. Obey project-specific rules outside it.
3. Read `.qmd-prover/.external.qmd` when present. Absence permits external results subject to precise hypothesis checks; whitespace-only permits none; nonempty content permits only what it states.
4. If policy is missing, different, malformed, or conflicting, stop before mutation and ask whether the user wants to create or synchronize it. Never change project policy without approval.
5. Reuse a successful comparison only for the same unchanged agent/project context: the project, branch or worktree, contract, and external policy must all remain current. Every independent agent performs its own preflight.

Run the tool from the project root:

```bash
qmd-prover <subcommand> [arguments]
```

Requirements: Node.js 20 or later and Pandoc on `PATH` (or `QMD_PROVER_PANDOC`, or `tools.pandoc` in config). Decide the verifier up front: to have proofs independently checked, set `verification.backend` to `claude` or `codex` before your first inspection (see "Environment and verifier setup" below) — with `backend: none` every proof stays unverified. Quarto is optional unless final rendered output is requested. Run `doctor` first when availability is uncertain, and see "Environment and verifier setup" below to configure any missing tool. JSON is the default output; commands marked below accept `--print` for a concise human report. Semantic IDs accept either `@ID` or bare `ID`, and output normalizes them as `@ID`.

Complete leaf-command map:

```text
doctor [--print]
init [--adopt-existing|--append-contract|--sync-contract]
inspect project [--print]
inspect fact @ID [--print]
inspect path FILE_OR_FOLDER [--print]
dependency dependencies @ID [--print]
dependency reverse dependencies x@ID [--print]
dependency impact @ID [--print]
dependency frontier @ID [--print]
dependency path @FROM @TO [--print]
dependency alternative paths @FROM @TO [--limit N] [--max-depth N] [--print]
dependency cycles [--print]
dependency findings [--print]
dependency unused imports [--print]
dependency unused exports [--print]
dependency isolated [--print]
dependency unreachable [--print]
dependency ready [--print]
dependency reused [--limit N] [--print]
dependency search [QUERY] [--kind KIND] [--status STATUS] [--origin ORIGIN] [--path PATH] [graph filters] [--print]
check staleness [--print]
verification list
verification show SUBMISSION_ID
render [--allow-errors]
```

Use `help COMMAND...` for exact filters, status values, ranges, side effects, and failure semantics. Only the commands shown with `[--print]` accept it; `init`, `verification list`, `verification show`, and `render` emit JSON only. `dependency search` matches every fact when `QUERY` is omitted, so its filters can be used on their own. A dependency query returns only its own answer (target, dependencies, path, matches, and so on) as compact fact references; run `inspect project --graph` when the whole graph is wanted. `render` writes nothing when project errors exist unless `--allow-errors` is explicit.

Read [references/cli.md](references/cli.md) when configuring Pandoc or the verifier, troubleshooting command behavior, installing the skill, or needing the full command inventory.

## Environment and verifier setup

Run `doctor` first: it reports Node, Pandoc, the optional verifier, and Quarto, plus the exact path it resolved for each. Configure anything it reports missing entirely through `.qmd-prover/config.yml` (or environment variables) — you never edit qmd-prover's own code. Every `.qmd-prover/config.yml` setting is documented in [references/config.md](references/config.md).

- **Pandoc (required) and Quarto (optional for final render).** If `doctor` reports either as unavailable, install or download it, then record its path under `tools:` so every later command finds it:

  ```yaml
  tools:
    pandoc: /absolute/path/to/pandoc
    quarto: /absolute/path/to/quarto
  ```

  `QMD_PROVER_PANDOC` and `QMD_PROVER_QUARTO` also work and take precedence. Leave a value blank to fall back to `PATH`.

- **Independent AI verifier.** As an early step, decide whether proofs will be independently checked. Run `doctor`; if you intend to verify and it shows no verifier, set a backend in `.qmd-prover/config.yml` before your first inspection:

  ```yaml
  verification:
    backend: claude        # or: codex
    executable: ""         # path to the claude/codex CLI; blank uses PATH
    model: ""              # "" lets the CLI use its own default model
  ```

  Leaving `backend: none` is a deliberate machine-only choice — local checks stay `not-run` and global states stay unverified; never present that as verified work.

  qmd-prover ships the `claude` and `codex` adapters, so no external verifier script is needed. The selected CLI must be installed and authenticated (an API key or a completed interactive login in this environment). Re-run `doctor` until the verifier reads `available`, then `inspect` calls it automatically. For a bespoke verifier, set `backend: command` with a `verification.command` argv, or point `QMD_PROVER_VERIFIER` at an executable that speaks the stdin/stdout protocol in [references/cli.md](references/cli.md).

Only a configured, available verifier produces verification state. Never declare your own work verified.

## Proof-development layout

Every QMD file in the project is semantic mathematics in one unified dependency graph. qmd-prover registers and protects `thm-main-* .theorem .goal` blocks wherever they appear; their statements are locked and must never be edited. A goal with no proof yet is simply open — proving it needs no setup step.

Write new agent-created definitions, intermediate results, proof attempts, calculations, examples, counterexamples, and progress notes in ordinary project QMD files, by convention under a `workspace/` folder in the project root. Folders are organizational only, never a semantic boundary: organize `workspace/` by theme, by goal, or flat, as the argument demands, and follow any folder principles in local project policy. Edit pre-existing user files cautiously. Put the linked proof of a main goal in a proof overlay file such as `workspace/main-proof.qmd` without repeating the protected theorem, and never copy a proof or marker into a protected statement.

Follow the complete declaration, proof, import, and export rules in the canonical contract. An `@id` citation is a dependency but does not grant cross-file scope. Cite the defining `@def-id` of any non-standard term at its first load-bearing use; the `verification.citations` setting governs how aggressively the verifier flags an uncited non-standard term, and `verification.rigor` sets how completely each step must be justified. Keep every explicit ID globally unique across the project. Any fact may cite any other project fact, including a protected main goal, subject to import scope; global composition keeps dependents blocked until the cited fact is globally verified.

Follow every unproved dependency instead of treating it as established. Read the three separate inspection layers: `mechanical` describes machine structure, `local_verification` says only whether the submitted proof follows conditionally from its direct dependency statements, and `global_verification` composes the whole upstream closure. Use a fact as a premise only when its global status is `verified`. These are informal AI-review states, not formal verification, human review, or permission to weaken protected statements.

## Using the infrastructure

Do not impose a fixed proof loop. A request may concern one theorem, a family of results, an existing development, or an idea that first needs precise formulation. Decide which definitions, lemmas, propositions, theorems, examples, or counterexamples to develop and in what order.

After each coherent semantic-QMD edit, use the narrowest relevant operation:

```bash
qmd-prover inspect fact @ID
qmd-prover inspect path PATH
qmd-prover inspect project
```

Fact and path inspection check only selected facts and their transitive local dependencies. Use `inspect project` for deliberate whole-project audits: it compiles every project QMD into one graph and checks every fact.

Repair every mechanical diagnostic and every local-verifier critical error or gap. Set up the verifier before relying on global results: run `doctor`, and if you intend to verify, configure `verification.backend` (`claude`/`codex` with an optional `executable` path, a custom `verification.command`, or `QMD_PROVER_VERIFIER`) until `doctor` reports it available. Machine-only mode (no verifier) is a deliberate choice, not a default to drift into: the graph remains available, local checks are `not-run`, and global results remain unverified. Never declare your own work verified.

Use dependency operations to inspect the project graph, search facts, show paths and cycles, calculate impact, and locate proof frontiers. A duplicate explicit ID is a structural error and must be renamed before dependency analysis can proceed.

## Status and rendering

- `OPEN` marks an incomplete active proof attempt; `REJECTED` retains an inactive failed attempt. No marker means candidate.
- `DISPROVED` begins a theorem-like proof body that proposes a precise counterexample or refutation; definitions cannot use it. A local disproof is conditional on its direct dependencies and becomes globally disproved only when the complete upstream closure is globally verified. A verifier may also discover a refutation without changing QMD.
- `VERIFIED` and `REVOKED` are reserved markers. Never write them; verification state lives in inspection state, not in QMD.
- These QMD markers are distinct from the inspection `status` field an agent reads back. A fact's `status` is derived (`candidate`, `open`, `rejected`, `stale`, `missing`, and so on) and the separate global verification status (`verified`, `disproved`, `blocked`, `unverified`, `invalid`) is what `dependency search --status` filters on; `help dependency search` lists every accepted value.
- Exact local verified, disproved, and rejected outcomes are cached by the target statement, submitted proof or refutation, direct dependency statements, semantic context, external basis, checker contract, and protocol. Dependency proof text and verification state are excluded; changing only an upstream proof triggers global recomposition rather than downstream AI calls.
- `check staleness` is a read-only audit of verification caches against current sources, the external basis, and the checker contract. It never edits QMD.
- Use `verification list` and `verification show` to discover and read retained verification records.
- Use `render` to prepare generated QMD status data and a dependency graph. Use ordinary `quarto render` for final HTML, PDF, or other output.

Translate dispatcher JSON into natural language for the user. Do not make the user memorize commands.
