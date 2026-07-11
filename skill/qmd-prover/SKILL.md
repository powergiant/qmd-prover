---
name: qmd-prover
description: Inspect, coordinate, propose, independently verify, repair, report, and render mathematical proofs in projects that use semantic QMD blocks and thm-main-* goals. Use when a user asks to prove one or all QMD goals, resume proof work, inspect proof status or dependencies, submit a candidate, review verification feedback, revoke an accepted proof, or render theorem navigation.
---

# qmd-prover

Read the project's `AGENTS.md` before mathematical work. Treat it as normative local policy.

Run the dispatcher from the project root:

```bash
node "${CODEX_HOME:-$HOME/.codex}/skills/qmd-prover/scripts/qmd-prover.mjs" <subcommand> [arguments]
```

## Proving workflow

1. Run `inspect-project`. Stop and repair structural errors before proving.
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
