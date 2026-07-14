---
name: qmd-prover
description: Initialize and inspect semantic-QMD mathematical projects; formulate definitions and results from ideas; develop, independently verify, repair, report, and render proofs in persistent goal workspaces. Use when a user asks to initialize qmd-prover, state or prove one or more protected main goals, grow an existing mathematical development, inspect facts, paths, dependencies, workspaces, or progress, audit staleness, review verifier findings, or render theorem navigation.
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

Read [references/cli.md](references/cli.md) when configuring Pandoc or the verifier, troubleshooting command behavior, installing the skill, or needing the full command inventory.

## Proof-development boundary

QMD outside `.qmd-prover/` is user-owned notes. qmd-prover registers and protects only `thm-main-* .theorem .goal` blocks there; ignore other theorem-like note content for semantic-contract purposes.

When the user asks to prove an existing main goal, run `workspace init @thm-main-ID` and use the returned `.qmd-prover/workspaces/<thm-main-ID>/` directory. Resume it when it already exists. This placement is mandatory even though the mathematical strategy is flexible.

Write every agent-created definition, intermediate result, proof attempt, calculation, example, counterexample, and progress note inside that goal workspace. Maintain `progress.qmd`; put the main candidate in `main-proof.qmd` as a linked `.proof` block without repeating the protected theorem. Never edit the user statement or copy a proof or marker back into user QMD.

Within the workspace, follow the complete declaration, proof, import, and export rules in the canonical contract. An `@id` citation is a dependency but does not grant cross-file scope. Keep every explicit ID globally unique. Never cite another workspace or another protected main goal as a fact; adopt and prove the needed claim locally, or use the declared external basis.

Follow every unproved workspace dependency instead of treating it as established. `workspace-verified` is current evidence in one exact workspace snapshot, not formal verification, human review, or permission to promote material into user notes.

## Using the infrastructure

Do not impose a fixed proof loop. A request may concern one theorem, a family of results, an existing development, or an idea that first needs precise formulation. Decide which definitions, lemmas, propositions, theorems, examples, or counterexamples to develop and in what order while preserving the workspace boundary.

After each coherent semantic-QMD edit, use the narrowest relevant operation:

```bash
node "${CODEX_HOME:-$HOME/.codex}/skills/qmd-prover/scripts/qmd-prover.js" inspect fact @ID
node "${CODEX_HOME:-$HOME/.codex}/skills/qmd-prover/scripts/qmd-prover.js" inspect path PATH
node "${CODEX_HOME:-$HOME/.codex}/skills/qmd-prover/scripts/qmd-prover.js" inspect workspace @thm-main-ID
```

`workspace inspect @thm-main-ID` is a compatibility alias. Fact and workspace-path inspection check only selected facts and their transitive local dependencies. Use `inspect project` for deliberate whole-project audits: it checks initialized workspaces independently and returns their complete results plus the aggregate graph.

Repair every mechanical diagnostic and every verifier critical error or gap. If the verifier is unconfigured, unavailable, failing, or malformed, repair `verification.command` or `QMD_PROVER_VERIFIER` before rerunning the affected scope. Never bypass the independent check or declare your own work verified.

Use dependency operations to inspect the aggregate all-workspace graph, search facts, show paths and cycles, calculate impact, and locate proof frontiers. A global duplicate ID is project-fatal and must be renamed before any inspect or dependency operation can proceed.

## Status and rendering

- `OPEN` marks an incomplete active workspace proof; `REJECTED` retains an inactive failed attempt. No marker means candidate.
- `VERIFIED` and `REVOKED` are legacy canonical markers. Never add, restore, migrate, or delete them manually.
- Exact workspace acceptances and rejections are cached by mathematical identity, dependency state, import scope, external basis, checker contract, and protocol. Narrow inspection preserves current outcomes for unrelated facts and workspaces.
- `check staleness` is a read-only audit of protected goal snapshots, workspace sources, external basis, checker contract, caches, and legacy state. It never edits QMD.
- `submit proof` and `verification revoke` are retired compatibility commands. They return structured `retired` results and write nothing.
- Use `verification show` only to read a retained legacy verification record.
- Use `render` to prepare generated QMD status data and a dependency graph. Use ordinary `quarto render` for final HTML, PDF, or other output.

Translate dispatcher JSON into natural language for the user. Do not make the user memorize commands.
