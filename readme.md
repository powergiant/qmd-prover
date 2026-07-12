# qmd-prover

qmd-prover is a Codex skill and dependency-free Node runtime for disciplined mathematical proof workflows in Quarto Markdown. Canonical mathematics remains readable QMD; goal workspaces, verification reports, and generated Quarto observability inputs stay under `.qmd-prover/`.

## Repository layout

```text
skills/qmd-prover/   self-contained installable Codex skill
tests/               compiler, verification, concurrency, and rendering tests
tooling/             repository development and installation tools
docs/                maintainer design and architecture documentation
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

See [the CLI reference](skills/qmd-prover/references/cli.md) for configuration and commands, the [canonical project contract](skills/qmd-prover/references/AGENTS.md) for project-agent rules, and [the design](docs/design.md) for architectural details.
