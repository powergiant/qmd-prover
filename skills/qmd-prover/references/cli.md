# CLI and installation reference

qmd-prover is a dependency-light Node CLI and Codex skill for agentic mathematical proof workflows in Quarto Markdown. Human-readable `.qmd` files remain canonical; semantic validation, proposals, verifier reports, dependency graphs, and rendered navigation live under `.qmd-prover/`.

## Requirements

- Node.js 20 or later.
- Pandoc on `PATH`, or `QMD_PROVER_PANDOC` set to a compatible executable.
- An independent verifier executable configured with `QMD_PROVER_VERIFIER` or `verification.command`.

The verifier receives one JSON packet on standard input and must return:

```json
{
  "verdict": "correct",
  "summary": "...",
  "critical_errors": [],
  "gaps": [],
  "repair_hints": ""
}
```

## Commands

```bash
node "${CODEX_HOME:-$HOME/.codex}/skills/qmd-prover/scripts/qmd-prover.mjs" inspect-project
node "${CODEX_HOME:-$HOME/.codex}/skills/qmd-prover/scripts/qmd-prover.mjs" inspect-theorem @thm-main-ID
node "${CODEX_HOME:-$HOME/.codex}/skills/qmd-prover/scripts/qmd-prover.mjs" submit-proof path/to/proposal.qmd
node "${CODEX_HOME:-$HOME/.codex}/skills/qmd-prover/scripts/qmd-prover.mjs" verification show SUBMISSION_ID
node "${CODEX_HOME:-$HOME/.codex}/skills/qmd-prover/scripts/qmd-prover.mjs" verification revoke @thm-ID --reason "reason"
node "${CODEX_HOME:-$HOME/.codex}/skills/qmd-prover/scripts/qmd-prover.mjs" render
```

All machine-readable command output is JSON. Structural diagnostics use exit code 2. `submit-proof` stores the proposal, starts a fresh verifier process, leaves canonical QMD unchanged on rejection, and atomically replaces only the target proof on acceptance. Main theorem titles and statements are locked on first inspection.

## Install the skill from a source checkout

```bash
node tooling/install-skill.mjs
```

This copies `skills/qmd-prover/` to `${CODEX_HOME:-~/.codex}/skills/qmd-prover`. The source checkout remains the source of truth.

## Test

```bash
npm test
```

The suite uses an AST-producing Pandoc test adapter and a fresh-process mock verifier; production parsing never falls back to regular expressions.

## Current boundary

This release implements informal LLM/command verification, not formal proof checking. The built-in renderer produces a standalone HTML theorem index and linked SVG graph without requiring Quarto or Graphviz. Quarto-native hover previews and formal-verifier adapters remain extensions.
