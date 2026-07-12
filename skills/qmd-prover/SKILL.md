---
name: qmd-prover
description: Inspect, coordinate, propose, independently verify, repair, report, and render mathematical proofs in projects that use semantic QMD blocks and thm-main-* goals. Use when a user asks to prove one or all QMD goals, resume proof work, inspect proof status or dependencies, submit a candidate, review verification feedback, revoke an accepted proof, or render theorem navigation.
---

# qmd-prover

## Project contract preflight

Before drafting mathematics, changing project files or state, creating a proposal, or submitting a proof:

1. Read the project's root `AGENTS.md` and this skill's [canonical project contract](references/AGENTS.md).
2. Compare the `qmd-prover-contract` managed block in the project file with the canonical block. Require the managed block to be present, at the same version, and unchanged. Allow project-specific rules outside the managed block; obey those rules in addition to the canonical contract.
3. If `AGENTS.md` is missing, the managed block is missing or different, or another project rule conflicts with it, stop before any mutation. Explain the exact issue and ask whether the user wants to create or synchronize the contract. Never create, replace, or synchronize `AGENTS.md` without user approval.
4. Reuse a successful comparison for the current agent in the same project context. Do not reread the files before every QMD read. Repeat the preflight only when the project, branch, worktree, agent context, or `AGENTS.md` may have changed, or when prior completion is uncertain.

Every independent worker must perform this preflight for itself because workers do not share context. Treat a successful preflight as a prerequisite for proof work, not as a compiler check.

Run the dispatcher from the project root:

```bash
node "${CODEX_HOME:-$HOME/.codex}/skills/qmd-prover/scripts/qmd-prover.mjs" <subcommand> [arguments]
```

## Proving workflow

1. Complete the project contract preflight, then run `inspect-project`. Stop and repair structural errors before proving.
2. Run `inspect-theorem @thm-main-ID` for each requested goal.
3. Run `workspace init @thm-main-ID`, then develop the argument only under the returned goal workspace. Use isolated workers only when the user or local policy requests parallel work.
4. Read the protected target snapshot, exact statement, imports, verified dependency closure, accepted mathematics, prior proposals, and verification reports.
5. Run `workspace inspect @thm-main-ID` as the development grows. Follow open workspace dependencies instead of treating candidate lemmas as established.
6. For an existing result, write a proposal containing exactly one nonempty `.proof` block with `of="semantic-id"`. Do not copy or redefine the protected result. Semantic references inside the proof are its dependency declarations.
7. For a new result, write exactly one result block and its linked proof, then submit it with an explicit canonical destination consistent with project policy.
8. Run `submit-proof PROPOSAL_FILE` (or `submit-proof PROPOSAL_FILE --to CANONICAL_QMD` for a new result). Never edit a canonical proof directly and never declare your own proposal verified.
9. On rejection, read `verification show SUBMISSION_ID`, repair every critical error and gap in workspace QMD, and resubmit.
10. Continue until verified, precisely refuted, genuinely blocked, cancelled, or explicitly stopped. Preserve useful notes in the goal workspace.

Only a `correct` verdict with empty critical errors and gaps is accepted. Treat `verified`, `formally verified`, and `human reviewed` as distinct states.

## Status and rendering

- Use `inspect-project` for all goal states and diagnostics.
- Use `inspect-theorem` for a bounded target/dependency/history bundle.
- Use `verification show` for the complete stored report.
- Use `render` to prepare a generated QMD status page, report data, and a dependency graph; use ordinary `quarto render` for final HTML, PDF, or other output.
- Use `verification revoke @thm-ID --reason "..."` only with a concrete recorded reason.

Translate dispatcher JSON into natural language for the user. Do not make the user learn these commands.

Read [references/cli.md](references/cli.md) only when configuring a parser or verifier, troubleshooting command behavior, or installing the skill.
