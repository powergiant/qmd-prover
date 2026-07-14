# Dispatcher and installation reference

qmd-prover is a self-contained Codex skill with a dependency-free Node dispatcher for mathematical proof workflows in Quarto Markdown. Human-readable `.qmd` files remain canonical. Goal workspaces, semantic indexes, proposals, verifier reports, dependency graphs, and generated Quarto inputs live under `.qmd-prover/`.

## Requirements

- Node.js 20 or later.
- Pandoc on `PATH`, or `QMD_PROVER_PANDOC` set to a compatible executable.
- An independent verifier executable configured with `QMD_PROVER_VERIFIER` or `verification.command`.
- Quarto only when rendered HTML, PDF, or another final format is wanted.

The verifier receives one JSON packet on standard input. It includes an explicit
independent-review instruction, the exact theorem-like statement and proof or
definition construction, dependency identities, import scope, checker contract,
and the `external_basis` mode and exact content. The verifier must return:

```json
{
  "verdict": "correct",
  "summary": "...",
  "critical_errors": [],
  "gaps": [],
  "nonblocking_comments": [],
  "repair_hints": ""
}
```

## Commands

```bash
node "${CODEX_HOME:-$HOME/.codex}/skills/qmd-prover/scripts/qmd-prover.js" init
node "${CODEX_HOME:-$HOME/.codex}/skills/qmd-prover/scripts/qmd-prover.js" inspect project
node "${CODEX_HOME:-$HOME/.codex}/skills/qmd-prover/scripts/qmd-prover.js" inspect fact @ID
node "${CODEX_HOME:-$HOME/.codex}/skills/qmd-prover/scripts/qmd-prover.js" inspect path path/to/file-or-folder
node "${CODEX_HOME:-$HOME/.codex}/skills/qmd-prover/scripts/qmd-prover.js" dependency frontier @thm-main-ID
node "${CODEX_HOME:-$HOME/.codex}/skills/qmd-prover/scripts/qmd-prover.js" dependency search "query" --kind lemma
node "${CODEX_HOME:-$HOME/.codex}/skills/qmd-prover/scripts/qmd-prover.js" dependency findings
node "${CODEX_HOME:-$HOME/.codex}/skills/qmd-prover/scripts/qmd-prover.js" dependency alternative paths @FROM @TO
node "${CODEX_HOME:-$HOME/.codex}/skills/qmd-prover/scripts/qmd-prover.js" check staleness
node "${CODEX_HOME:-$HOME/.codex}/skills/qmd-prover/scripts/qmd-prover.js" workspace init @thm-main-ID
node "${CODEX_HOME:-$HOME/.codex}/skills/qmd-prover/scripts/qmd-prover.js" workspace inspect @thm-main-ID
node "${CODEX_HOME:-$HOME/.codex}/skills/qmd-prover/scripts/qmd-prover.js" submit proof path/to/proposal.qmd
node "${CODEX_HOME:-$HOME/.codex}/skills/qmd-prover/scripts/qmd-prover.js" submit proof path/to/new-result.qmd --to path/to/canonical.qmd
node "${CODEX_HOME:-$HOME/.codex}/skills/qmd-prover/scripts/qmd-prover.js" verification show SUBMISSION_ID
node "${CODEX_HOME:-$HOME/.codex}/skills/qmd-prover/scripts/qmd-prover.js" verification revoke @thm-ID --reason "reason"
node "${CODEX_HOME:-$HOME/.codex}/skills/qmd-prover/scripts/qmd-prover.js" render
```

`init` inventories existing policy, QMD sources, Quarto configuration, `.qmd-prover` state, and the `unrestricted`, `none`, or `declared` external-policy mode. It never creates `.external.qmd`. When project material exists but `AGENTS.md` is missing, it returns `intent-required` without writing; use `--adopt-existing` only after approval. It otherwise creates the canonical policy idempotently, ensures `.qmd-prover/workspaces/` exists, and returns that path as `workspace_root`. It fails closed on existing policy: use `--append-contract` only with approval to preserve that policy and append the block, or `--sync-contract` only with approval to replace an existing managed block while preserving everything outside it.

`workspace init @thm-main-ID` creates or resumes `.qmd-prover/workspaces/thm-main-ID/` and returns the exact path. Proof development for that main goal belongs there; canonical QMD remains unchanged until accepted promotion.

`workspace inspect @thm-main-ID` checks canonical staleness, then independently verifies the selected active workspace in dependency order. Exact workspace verdicts are cached under that workspace. `workspace-verified` is provisional state in its named workspace snapshot; no workspace marker is written and canonical promotion still requires the protected submission path.

Inspection and dependency commands return schema-versioned JSON by default. Add `--print` to any inspection or dependency command for the same decision and snapshot as a human-readable report. Blocking diagnostics use exit code 2. `inspect fact` accepts any semantic fact ID.

Every inspection checks staleness first, removes stale markers transitively, and then calls the independent verifier only for mechanically eligible facts whose exact verification input is not cached. The cache key includes mathematical identities, dependency state, import scope, external basis, and checker contract. Repeating an unchanged inspection therefore performs no new verifier calls. If the verifier command is unavailable or malformed, inspection returns per-fact diagnostics and remediation, leaves facts unverified, and does not continue spawning identical failing checks; repair the command before rerunning.

Dependency command paths are `dependencies`, `reverse dependencies`, `path`, `alternative paths`, `cycles`, `impact`, `frontier`, `findings`, `unused imports`, `unused exports`, `isolated`, `unreachable`, `ready for ai`, `reused`, and `search`. Every query names the complete graph snapshot it used. Search accepts text/kind/status/origin/path filters plus dependency, reverse-dependency, frontier, stale-impact, and cycle-participant filters. Run `qmd-prover help`, append `help`, `--help`, or `-h` to any command group or leaf command, or use `qmd-prover help COMMAND...` for exact usage.

`submit proof` stores the isolated proposal, reuses an exact valid decision cache or starts a fresh verifier process on a miss, leaves canonical QMD unchanged on rejection, and atomically inserts or replaces only the linked proof on acceptance. Acceptance stores the exact evidence cache and matching record and inserts the record-backed `VERIFIED` control marker. `check staleness` fails closed on missing or corrupt evidence, removes stale markers from the changed fact and verified reverse dependencies, marks retained active records and fact caches stale while preserving immutable decisions, and reports invalidation paths. A new-result proposal requires `--to` so project policy, rather than qmd-prover, chooses its canonical location. Main theorem IDs, `name` captions, and statement bodies are locked on first successful inspection.

`render` refreshes `.qmd-prover/generated/proof-status.qmd`, its dependency SVG, and report data. It does not build a parallel website. Run ordinary `quarto render` through the project's configured pipeline for final output.

## Semantic QMD

A result uses a Quarto theorem block with a `name` caption. Its proof is a separate linked block:

```markdown
::: {#thm-main-even-square .theorem .goal name="Even squares" date="2026-07-13"}
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
npm run install:skill
```

This copies `skills/qmd-prover/` to `${CODEX_HOME:-~/.codex}/skills/qmd-prover`. The source checkout remains the source of truth.

## Test

```bash
npm test
```

The suite uses an AST-producing Pandoc test adapter and fresh-process mock verifiers; production parsing never falls back to regular expressions.

## Current boundary

This release implements informal command/LLM verification, not formal proof checking. Formal-verifier adapters and Quarto extensions remain separate integrations.
