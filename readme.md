# qmd-prover

qmd-prover is a Codex skill and dependency-light Node CLI for agentic mathematical proof workflows in Quarto Markdown. Canonical mathematics remains readable QMD; generated state, verification reports, and rendered navigation stay under `.qmd-prover/`.

## Repository layout

```text
skills/qmd-prover/   self-contained installable Codex skill
tests/               compiler, verification, concurrency, and rendering tests
tooling/             repository development and installation tools
```

The skill package contains its own `SKILL.md`, UI metadata, references, dispatcher, and runtime. It can be copied independently of the rest of this repository.

## Requirements

- Node.js 20 or later
- Pandoc on `PATH`, or `QMD_PROVER_PANDOC` pointing to a compatible executable
- An independent verifier configured through `QMD_PROVER_VERIFIER` or `.qmd-prover/config.yml`

## Install

```bash
npm run install:skill
```

This installs `skills/qmd-prover/` into `${CODEX_HOME:-~/.codex}/skills/qmd-prover`.

## Test

```bash
npm test
```

The test suite uses an AST-producing Pandoc adapter and fresh-process mock verifiers, so it does not require production Pandoc or verifier credentials.

See [the CLI reference](skills/qmd-prover/references/cli.md) for configuration and commands, and [the design](skills/qmd-prover/references/design.md) for architectural details.
