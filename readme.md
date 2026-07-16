# qmd-prover

qmd-prover is a Codex skill and dependency-free Node runtime for disciplined mathematical proof workflows in Quarto Markdown. Project QMD is the semantic mathematics itself, compiled in one pass into a single dependency graph; `.qmd-prover/` holds only derived tool state such as verification records, dependency graphs, and generated Quarto observability inputs.

## Repository layout

```text
skills/qmd-prover/
  src/               canonical TypeScript runtime source
  scripts/           dependency-free compiled Node runtime
  references/        installed project contract and CLI reference
tests/               TypeScript compiler, verification, concurrency, and rendering tests
tooling/             TypeScript development and installation tools
docs/                maintainer design and architecture documentation
```

The skill package contains its own `SKILL.md`, UI metadata, references, TypeScript source, dispatcher, and compiled runtime. It can be copied independently of the rest of this repository. TypeScript tooling is development-only; installed runtime code has no package dependency.

The dispatcher is `scripts/qmd-prover.js`.

## Requirements

- Node.js 20 or later
- Pandoc on `PATH`, or `QMD_PROVER_PANDOC` pointing to a compatible executable
- An optional AI verifier configured through `QMD_PROVER_VERIFIER` or `.qmd-prover/config.yml`; without one, machine dependency inspection still works and AI verification remains `not-run`

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

For a faster compile-only check while editing:

```bash
npm run typecheck
npm run build
```

See [the CLI reference](skills/qmd-prover/references/cli.md) for commands, [the configuration reference](skills/qmd-prover/references/config.md) for every `.qmd-prover/config.yml` setting, the [canonical project contract](skills/qmd-prover/references/AGENTS.md) for project-agent rules, and [the design](docs/design.md) for architectural details.
