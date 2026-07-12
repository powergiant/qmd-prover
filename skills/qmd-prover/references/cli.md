# Dispatcher and installation reference

qmd-prover is a self-contained Codex skill with a dependency-free Node dispatcher for mathematical proof workflows in Quarto Markdown. Human-readable `.qmd` files remain canonical. Goal workspaces, semantic indexes, proposals, verifier reports, dependency graphs, and generated Quarto inputs live under `.qmd-prover/`.

## Requirements

- Node.js 20 or later.
- Pandoc on `PATH`, or `QMD_PROVER_PANDOC` set to a compatible executable.
- An independent verifier executable configured with `QMD_PROVER_VERIFIER` or `verification.command`.
- Quarto only when rendered HTML, PDF, or another final format is wanted.

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
node "${CODEX_HOME:-$HOME/.codex}/skills/qmd-prover/scripts/qmd-prover.mjs" inspect-path path/to/file-or-folder
node "${CODEX_HOME:-$HOME/.codex}/skills/qmd-prover/scripts/qmd-prover.mjs" dependency frontier @thm-main-ID
node "${CODEX_HOME:-$HOME/.codex}/skills/qmd-prover/scripts/qmd-prover.mjs" dependency search "query" --kind lemma
node "${CODEX_HOME:-$HOME/.codex}/skills/qmd-prover/scripts/qmd-prover.mjs" check-staleness
node "${CODEX_HOME:-$HOME/.codex}/skills/qmd-prover/scripts/qmd-prover.mjs" workspace init @thm-main-ID
node "${CODEX_HOME:-$HOME/.codex}/skills/qmd-prover/scripts/qmd-prover.mjs" workspace inspect @thm-main-ID
node "${CODEX_HOME:-$HOME/.codex}/skills/qmd-prover/scripts/qmd-prover.mjs" submit-proof path/to/proposal.qmd
node "${CODEX_HOME:-$HOME/.codex}/skills/qmd-prover/scripts/qmd-prover.mjs" submit-proof path/to/new-result.qmd --to path/to/canonical.qmd
node "${CODEX_HOME:-$HOME/.codex}/skills/qmd-prover/scripts/qmd-prover.mjs" verification show SUBMISSION_ID
node "${CODEX_HOME:-$HOME/.codex}/skills/qmd-prover/scripts/qmd-prover.mjs" verification revoke @thm-ID --reason "reason"
node "${CODEX_HOME:-$HOME/.codex}/skills/qmd-prover/scripts/qmd-prover.mjs" render
```

Inspection and dependency commands return schema-versioned JSON by default. Add `--print` to any inspection or dependency command for the same decision and snapshot as a human-readable report. Blocking diagnostics use exit code 2.

Dependency operations are `dependencies`, `reverse-dependencies`, `path`, `cycles`, `impact`, `frontier`, and `search`. Every query names the complete graph snapshot it used. Search accepts `--kind`, `--status`, `--origin`, `--path`, `--related-to`, and `--frontier-of` filters.

`submit-proof` stores the isolated proposal, starts a fresh verifier process, leaves canonical QMD unchanged on rejection, and atomically inserts or replaces only the linked proof on acceptance. Acceptance stores the exact evidence cache and matching record and inserts the record-backed `VERIFIED` control marker. `check-staleness` fails closed on missing or corrupt evidence, removes stale markers from the changed fact and verified reverse dependencies, marks retained records stale, and reports invalidation paths. A new-result proposal requires `--to` so project policy, rather than qmd-prover, chooses its canonical location. Main theorem IDs, `name` captions, and statement bodies are locked on first successful inspection.

`render` refreshes `.qmd-prover/generated/proof-status.qmd`, its dependency SVG, and report data. It does not build a parallel website. Run ordinary `quarto render` through the project's configured pipeline for final output.

## Semantic QMD

A result uses a Quarto theorem block with a `name` caption. Its proof is a separate linked block:

```markdown
::: {#thm-main-even-square .theorem .goal name="Even squares"}
For every even integer \(n\), the integer \(n^2\) is divisible by \(4\).
:::

::: {.proof of="thm-main-even-square"}
By @def-even-integer, write \(n=2k\). Then \(n^2=4k^2\).
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

The semantic references inside a linked proof are its dependency declaration. There are no `Statement`, `Uses`, or `Proof` subheadings.

## Install the skill from a source checkout

```bash
node tooling/install-skill.mjs
```

This copies `skills/qmd-prover/` to `${CODEX_HOME:-~/.codex}/skills/qmd-prover`. The source checkout remains the source of truth.

## Test

```bash
npm test
```

The suite uses an AST-producing Pandoc test adapter and fresh-process mock verifiers; production parsing never falls back to regular expressions.

## Current boundary

This release implements informal command/LLM verification, not formal proof checking. Formal-verifier adapters and Quarto extensions remain separate integrations.
