# qmd-prover repository instructions

This repository implements qmd-prover. Keep the installable skill self-contained under `skills/qmd-prover/`, keep runtime code dependency-free, use Pandoc JSON as the semantic parser, and run `npm test` after changes.

- Keep agent-facing workflow instructions concise in `skills/qmd-prover/SKILL.md`.
- Keep the canonical mathematical-project contract in `skills/qmd-prover/references/AGENTS.md`; do not duplicate it in this repository instruction file.
- Keep every user-facing example project's managed `AGENTS.md` block byte-for-byte synchronized with the canonical contract, and put example-specific rules outside that block.
- Keep maintainer architecture and design documentation under `docs/`, outside the installed skill.
- Preserve stable JSON output and the specified top-level dispatcher commands.
- Never weaken statement protection, independent verification, stale-submission checks, rejection safety, or atomic canonical writes.
- Add or update tests for every behavioral change.
