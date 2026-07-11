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
3. Partition independent goals and claim work in `.qmd-prover/goal-locks.json`. Use isolated workers only when the user or local policy requests parallel work.
4. Read the exact statement, imports, verified dependency closure, accepted mathematics, prior proposals, and verification reports.
5. Write a proposal containing exactly one complete semantic result block. Preserve a main theorem's ID, title, and Statement byte-for-byte. Put every logical premise in `Uses` and cite it in the proof.
6. Run `submit-proof PROPOSAL_FILE`. Never edit a canonical proof directly and never declare your own proposal verified.
7. On rejection, read `verification show SUBMISSION_ID`, repair every critical error and gap in a new proposal, and resubmit.
8. Continue until verified, precisely refuted, genuinely blocked, cancelled, or explicitly stopped. Preserve useful notes under the assigned worker directory.

Only a `correct` verdict with empty critical errors and gaps is accepted. Treat `verified`, `formally verified`, and `human reviewed` as distinct states.

## Status and rendering

- Use `inspect-project` for all goal states and diagnostics.
- Use `inspect-theorem` for a bounded target/dependency/history bundle.
- Use `verification show` for the complete stored report.
- Use `render` for linked theorem pages, reports, and a dependency graph.
- Use `verification revoke @thm-ID --reason "..."` only with a concrete recorded reason.

Translate dispatcher JSON into natural language for the user. Do not make the user learn these commands.

Read [references/cli.md](references/cli.md) only when configuring a parser or verifier, troubleshooting command behavior, or installing the skill.
