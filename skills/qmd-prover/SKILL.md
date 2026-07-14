---
name: qmd-prover
description: Initialize and inspect semantic-QMD mathematical projects; formulate definitions and results from ideas; develop, independently verify, repair, report, and render proofs. Use when a user asks to initialize qmd-prover, state or prove one or more results, grow a mathematical development, inspect dependencies or progress, submit or review a candidate, revoke an accepted proof, or render theorem navigation.
---

# qmd-prover

## Project setup

When the user asks to initialize qmd-prover in the current project, run this from the project root:

```bash
node "${CODEX_HOME:-$HOME/.codex}/skills/qmd-prover/scripts/qmd-prover.js" init
```

Read the returned `existing` inventory. If the status is `intent-required`, summarize the detected `AGENTS.md`, QMD files, Quarto configuration, `.qmd-prover` state, and external-policy mode, then ask whether the user wants to adopt the files in place, inspect them first, or leave them unchanged. Run `init --adopt-existing` only after the user chooses adoption.

If the status is `append-required`, explain that existing project policy will be preserved and ask before running `init --append-contract`. If it is `sync-required`, report the current and canonical contract versions and ask before running `init --sync-contract`. Never use any mutation flag without explicit approval. For `already-initialized`, tell the user setup is already complete, summarize existing project material, and ask whether to continue it, inspect it, or change local policy. A successful result returns `.qmd-prover/workspaces` as `workspace_root`; no QMD scaffold or initial theorem is required.

## Project contract preflight

Before drafting mathematics, changing project files or state, creating a proposal, or submitting a proof:

1. Read the project's root `AGENTS.md` and this skill's [canonical project contract](references/AGENTS.md).
2. Compare the `qmd-prover-contract` managed block in the project file with the canonical block. Require the managed block to be present, at the same version, and unchanged. Allow project-specific rules outside the managed block; obey those rules in addition to the canonical contract. Read `.qmd-prover/.external.qmd` when present and apply its external-basis policy; absence means unrestricted external results, while a whitespace-only file means none are allowed.
3. If `AGENTS.md` is missing, the managed block is missing or different, or another project rule conflicts with it, stop before any mutation. Explain the exact issue and ask whether the user wants to create or synchronize the contract. Never create, replace, or synchronize `AGENTS.md` without user approval.
4. Reuse a successful comparison for the current agent in the same project context. Do not reread the files before every QMD read. Repeat the preflight only when the project, branch, worktree, agent context, `AGENTS.md`, or `.external.qmd` may have changed, or when prior completion is uncertain.

Every independent worker must perform this preflight for itself because workers do not share context. Treat a successful preflight as a prerequisite for proof work, not as a compiler check.

Run the dispatcher from the project root:

```bash
node "${CODEX_HOME:-$HOME/.codex}/skills/qmd-prover/scripts/qmd-prover.js" <subcommand> [arguments]
```

## Proof-development boundary

When the user asks to prove an existing `thm-main-*` goal, run `workspace init @thm-main-ID` and use the returned `.qmd-prover/workspaces/<thm-main-ID>/` directory. Resume it if it already exists. This is mandatory even though the mathematical plan is flexible.

Keep canonical QMD read-only while proving. Write all agent-created definitions, intermediate results, proof attempts, calculations, examples, counterexamples, and progress notes inside the goal workspace. Maintain `progress.qmd`; put the main candidate in `main-proof.qmd` as a linked `.proof` block without repeating the protected theorem. Follow unproved workspace dependencies instead of treating them as established, and promote accepted mathematics only through the protected path.

`workspace inspect` verifies the selected active workspace in dependency order and reuses exact cached verdicts. Treat `workspace-verified` as provisional evidence confined to that workspace snapshot, never as canonical `VERIFIED`; submit it through the protected promotion path before canonical use.

## Using the infrastructure

Do not impose a fixed mathematical strategy. A request may concern one theorem, a family of results, an existing mathematical development, or an idea that first needs precise formulation. Decide which definitions, lemmas, propositions, theorems, examples, or counterexamples to develop and in what order, while preserving the mandatory workspace boundary.

Use the supplied tools when they help:

- initialize or compare the project contract;
- inspect a fact, path, project, workspace, or dependency graph;
- search available mathematics and unresolved frontiers;
- inspect and resume the required noncanonical goal workspace;
- inspect the relevant scope before relying on `VERIFIED` mathematics; inspection removes stale markers before verification;
- submit a linked proof or a new declaration with its linked proof for mechanical and independent AI checking;
- inspect rejection feedback and retry after repairing every critical error and gap;
- promote accepted mathematics through the protected atomic path; and
- render status, dependency, or ordinary Quarto views.

Whenever writing QMD, follow the canonical block discipline. Never redefine a protected result in a proposal, treat a candidate workspace claim as established, edit a canonical proof directly, or declare your own work verified. Only a `correct` verdict with no critical errors or gaps is accepted. Treat `verified`, `formally verified`, and `human reviewed` as distinct states.

For theorem-like facts qmd-prover writes record-backed control markers at the start of the linked proof. For definitions it writes the marker at the end of the definition block, outside the cached construction identity. Agents never write either form themselves.

## Status and rendering

- Every `inspect *` operation runs staleness checking first, then independently verifies mechanically eligible cache misses. Exact cached acceptances and rejections are reused without another verifier call.
- During iteration, use `inspect fact` or `inspect path` for the narrowest useful scope. Use `inspect project` at project-wide audit or reporting milestones, not after every small edit.
- If inspection reports that the verifier command is unconfigured, missing, failing, malformed, or schema-invalid, do not rerun it in a loop and never write `VERIFIED` manually. Explain the infrastructure failure, repair `verification.command` or `QMD_PROVER_VERIFIER`, then rerun the narrowest affected scope.
- Use standalone `check staleness` when only invalidation is wanted; it removes stale `VERIFIED` markers transitively and reports each invalidation path without starting mathematical verification.
- Use `inspect project` for all goal states and diagnostics.
- Use `inspect fact` for a bounded target/dependency/history bundle.
- Use `inspect path` for one QMD file or folder, and `dependency frontier`, `dependency search`, or the other dependency queries to work from the latest named graph snapshot.
- Use `verification show` for the complete stored report.
- Use `render` to prepare a generated QMD status page, report data, and a dependency graph; use ordinary `quarto render` for final HTML, PDF, or other output.
- Use `verification revoke @thm-ID --reason "..."` only with a concrete recorded reason.

Translate dispatcher JSON into natural language for the user. Do not make the user learn these commands.

Read [references/cli.md](references/cli.md) only when configuring a parser or verifier, troubleshooting command behavior, or installing the skill.
