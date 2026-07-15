---
name: qmd-prover
description: Initialize and inspect semantic-QMD mathematical projects; formulate definitions and results from ideas; develop, locally AI-check, globally compose, repair, report, and render proofs in persistent goal workspaces. Use when a user asks to initialize qmd-prover, state or prove one or more protected main goals, grow an existing mathematical development, inspect facts, paths, dependencies, workspaces, or progress, audit staleness, review verifier findings, or render theorem navigation.
---

# qmd-prover

## Project setup

When the user asks to initialize qmd-prover in the current project, run this from the project root:

```bash
node "${CODEX_HOME:-$HOME/.codex}/skills/qmd-prover/scripts/qmd-prover.js" init
```

Read the returned `existing` inventory. If the status is `intent-required`, summarize the detected `AGENTS.md`, QMD files, Quarto configuration, `.qmd-prover` state, and external-policy mode, then ask whether the user wants to adopt the files in place, inspect them first, or leave them unchanged. Run `init --adopt-existing` only after the user chooses adoption.

If the status is `append-required`, explain that existing project policy will be preserved and ask before running `init --append-contract`. If it is `sync-required`, report the current and canonical contract versions and ask before running `init --sync-contract`. Never use a mutation flag without explicit approval. For `already-initialized`, report that setup is current and continue from the user's requested task. A successful result returns `.qmd-prover/workspaces` as `workspace_root`; no QMD scaffold or initial theorem is required.

Stop and ask before creating, appending, or synchronizing project policy.

## Project contract preflight

Before drafting mathematics, changing qmd-prover state, or relying on a workspace fact:

1. Read the project's root `AGENTS.md` and this skill's [canonical project contract](references/AGENTS.md).
2. Compare the `qmd-prover-contract` managed blocks byte-for-byte. Require the project block to be present at the same version and unchanged. Obey project-specific rules outside it.
3. Read `.qmd-prover/.external.qmd` when present. Absence permits external results subject to precise hypothesis checks; whitespace-only permits none; nonempty content permits only what it states.
4. If policy is missing, different, malformed, or conflicting, stop before mutation and ask whether the user wants to create or synchronize it. Never change project policy without approval.
5. Reuse a successful comparison only for the same unchanged agent/project context: the project, branch or worktree, contract, and external policy must all remain current. Every independent agent performs its own preflight.

Run the dispatcher from the project root:

```bash
node "${CODEX_HOME:-$HOME/.codex}/skills/qmd-prover/scripts/qmd-prover.js" <subcommand> [arguments]
```

Requirements: Node.js 20 or later and Pandoc on `PATH` (or `QMD_PROVER_PANDOC`). The independent verifier is optional unless AI verification is requested; Quarto is optional unless final rendered output is requested. Run `doctor` first when availability is uncertain. JSON is the default output; commands marked below accept `--print` for a concise human report. Semantic IDs accept either `@ID` or bare `ID`, and output normalizes them as `@ID`.

Complete leaf-command map:

```text
doctor [--print]
init [--adopt-existing|--append-contract|--sync-contract]
inspect project [--print]
inspect fact @ID [--print]
inspect path FILE_OR_FOLDER [--print]
inspect workspace @thm-main-ID [--print]
dependency dependencies @ID [--print]
dependency reverse dependencies @ID [--print]
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
dependency ready for ai [--print]
dependency reused [--limit N] [--print]
dependency search QUERY [--kind KIND] [--status STATUS] [--origin ORIGIN] [--path PATH] [graph filters] [--print]
check staleness [--print]
workspace init @thm-main-ID
workspace inspect @thm-main-ID [--print]
submit proof PROPOSAL_FILE [--to QMD]                 # retired, no writes
verification list
verification show SUBMISSION_ID
verification revoke @thm-ID [--reason TEXT]          # retired, no writes
render [--allow-errors]
```

Use `help COMMAND...` for exact filters, ranges, side effects, and failure semantics. `workspace inspect` is a compatibility alias whose canonical operation is `inspect-workspace`. `render` writes nothing when project errors exist unless `--allow-errors` is explicit.

Read [references/cli.md](references/cli.md) when configuring Pandoc or the verifier, troubleshooting command behavior, installing the skill, or needing the full command inventory.

## Proof-development boundary

QMD outside `.qmd-prover/` is user-owned notes. qmd-prover registers and protects only `thm-main-* .theorem .goal` blocks there; ignore other theorem-like note content for semantic-contract purposes.

When the user asks to prove an existing main goal, run `workspace init @thm-main-ID` and use the returned `.qmd-prover/workspaces/<thm-main-ID>/` directory. Resume it when it already exists. This placement is mandatory even though the mathematical strategy is flexible.

Write every agent-created definition, intermediate result, proof attempt, calculation, example, counterexample, and progress note inside that goal workspace. Maintain `progress.qmd`; put the main candidate in `main-proof.qmd` as a linked `.proof` block without repeating the protected theorem. Never edit the user statement or copy a proof or marker back into user QMD.

Within the workspace, follow the complete declaration, proof, import, and export rules in the canonical contract. An `@id` citation is a dependency but does not grant cross-file scope. Keep every explicit ID globally unique. Never cite another workspace or another protected main goal as a fact; adopt and prove the needed claim locally, or use the declared external basis.

Follow every unproved workspace dependency instead of treating it as established. Read the three separate inspection layers: `mechanical` describes machine structure, `local_verification` says only whether the submitted proof follows conditionally from its direct dependency statements, and `global_verification` composes the whole upstream closure. Use a fact as a premise only when its global status is `verified`. These are informal AI-review states, not formal verification, human review, or permission to promote material into user notes.

## Using the infrastructure

Do not impose a fixed proof loop. A request may concern one theorem, a family of results, an existing development, or an idea that first needs precise formulation. Decide which definitions, lemmas, propositions, theorems, examples, or counterexamples to develop and in what order while preserving the workspace boundary.

After each coherent semantic-QMD edit, use the narrowest relevant operation:

```bash
node "${CODEX_HOME:-$HOME/.codex}/skills/qmd-prover/scripts/qmd-prover.js" inspect fact @ID
node "${CODEX_HOME:-$HOME/.codex}/skills/qmd-prover/scripts/qmd-prover.js" inspect path PATH
node "${CODEX_HOME:-$HOME/.codex}/skills/qmd-prover/scripts/qmd-prover.js" inspect workspace @thm-main-ID
```

`workspace inspect @thm-main-ID` is a compatibility alias. Fact and workspace-path inspection check only selected facts and their transitive local dependencies. Use `inspect project` for deliberate whole-project audits: it checks initialized workspaces independently and returns their complete results plus the aggregate graph.

Repair every mechanical diagnostic and every local-verifier critical error or gap. An unconfigured verifier is a supported machine-only mode: the graph remains available, local checks are `not-run`, and global results remain unverified. When the user requests AI verification, repair an unavailable, failing, or malformed `verification.command` or `QMD_PROVER_VERIFIER` before relying on global results. Never declare your own work verified.

Use dependency operations to inspect the aggregate all-workspace graph, search facts, show paths and cycles, calculate impact, and locate proof frontiers. A global duplicate ID is project-fatal and must be renamed before any inspect or dependency operation can proceed.

## Status and rendering

- `OPEN` marks an incomplete active workspace proof; `REJECTED` retains an inactive failed attempt. No marker means candidate.
- `DISPROVED` begins a theorem-like proof body that proposes a precise counterexample or refutation; definitions cannot use it. A local disproof is conditional on its direct dependencies and becomes globally disproved only when the complete upstream closure is globally verified. A verifier may also discover a refutation without changing QMD.
- `VERIFIED` and `REVOKED` are legacy canonical markers. Never add, restore, migrate, or delete them manually.
- Exact local verified, disproved, and rejected outcomes are cached by the target statement, submitted proof or refutation, direct dependency statements, semantic context, external basis, checker contract, and protocol. Dependency proof text and verification state are excluded; changing only an upstream proof triggers global recomposition rather than downstream AI calls.
- `check staleness` is a read-only audit of protected goal snapshots, workspace sources, external basis, checker contract, caches, and legacy state. It never edits QMD.
- `submit proof` and `verification revoke` are retired compatibility commands. They return structured `retired` results and write nothing.
- Use `verification show` only to read a retained legacy verification record.
- Use `render` to prepare generated QMD status data and a dependency graph. Use ordinary `quarto render` for final HTML, PDF, or other output.

Translate dispatcher JSON into natural language for the user. Do not make the user memorize commands.
