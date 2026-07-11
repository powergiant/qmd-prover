# qmd-prover

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
node scripts/qmd-prover.mjs inspect-project
node scripts/qmd-prover.mjs inspect-theorem @thm-main-ID
node scripts/qmd-prover.mjs submit-proof path/to/proposal.qmd
node scripts/qmd-prover.mjs verification show SUBMISSION_ID
node scripts/qmd-prover.mjs verification revoke @thm-ID --reason "reason"
node scripts/qmd-prover.mjs render
```

All machine-readable command output is JSON. Structural diagnostics use exit code 2. `submit-proof` stores the proposal, starts a fresh verifier process, leaves canonical QMD unchanged on rejection, and atomically replaces only the target proof on acceptance. Main theorem titles and statements are locked on first inspection.

## Install the Codex skill

```bash
node scripts/install-skill.mjs
```

This copies the skill and its dependency-free runtime to `${CODEX_HOME:-~/.codex}/skills/qmd-prover`. The repository remains the source of truth.

## Test

```bash
npm test
```

The suite uses an AST-producing Pandoc test adapter and a fresh-process mock verifier; production parsing never falls back to regular expressions.

## Current boundary

This release implements informal LLM/command verification, not formal proof checking. The built-in renderer produces a standalone HTML theorem index and linked SVG graph without requiring Quarto or Graphviz. Quarto-native hover previews and formal-verifier adapters remain extensions.
