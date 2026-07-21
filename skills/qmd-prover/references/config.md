# Project configuration reference

qmd-prover reads optional project settings from `.qmd-prover/config.yml`. This file documents every
setting exhaustively. Its companions are [cli.md](cli.md) for every command, [status.md](status.md)
for the fact status vocabulary, and [AGENTS.md](AGENTS.md) for the project contract.

The file is a version-controlled authored input (kept alongside `.external.qmd` and
`statement-locks.json`); everything else under `.qmd-prover/` is regenerated tool state. The
file is **optional**: when it is absent, or when a key is omitted, the built-in defaults below
apply. Settings are parsed by a dependency-free minimal YAML reader and merged over the
defaults, so a partial file only overrides the keys it names.

The first `qmd-prover inspect project` (or a successful `qmd-prover init`) scaffolds this file with
every key at its default, plus a `.qmd-prover/.gitignore`. Neither is ever overwritten, so both are
safe to edit.

A complete file, with every key at its default, looks like this:

```yaml
project:
  exclude: [.qmd-prover]          # extra path patterns to skip during discovery

goals:
  id-prefix: thm-main-            # IDs with this prefix are protected main goals
  protect-statements: true        # lock registered goal statements against mutation

semantic:
  wildcard-imports: false         # forbid `use: ['*']` wildcard imports

tools:
  pandoc: ""                      # path to Pandoc when not on PATH
  quarto: ""                      # path to Quarto when not on PATH (only for render)

verification:
  backend: none                   # none | claude | codex | command (none = no proof is ever verified)
  model: ""                       # concrete model id forwarded as --model, or "" for the CLI default
  effort: high                    # low | medium | high | xhigh | max — reasoning effort
  executable: ""                  # path to the backend CLI when not on PATH
  # command: [node, verify.js]    # custom verifier argv, for backend: command
  fresh-context: true             # each check runs in an isolated context
  citations: standard             # lenient | standard | strict — uncited-term scrutiny
  rigor: standard                 # lenient | standard | strict — how fully proof steps must be justified
  rigor-disprove: standard        # lenient | standard | strict — how strongly a refutation must be argued
  assumptions: allow              # allow | forbid — forbid makes a .assumed fact under a protected goal a GOAL_ASSUMED error
  tools: []                       # capabilities the verifier is TOLD it may use: [file-read, web-search, code]

render:
  graph-engine: builtin           # dependency-graph SVG engine
  output-dir: .qmd-prover/generated  # where render writes generated inputs
```

## Where settings come from

Three sources feed one run, highest precedence first:

1. **Environment variables** — override everything, per invocation.
2. **`.qmd-prover/config.yml`** — the project's own settings.
3. **Built-in defaults** — the table values below.

| Environment variable | Overrides | Notes |
|---|---|---|
| `QMD_PROVER_PANDOC` | `tools.pandoc` | Path to a Pandoc executable. |
| `QMD_PROVER_QUARTO` | `tools.quarto` | Path to Quarto, needed only for final rendering. |
| `QMD_PROVER_VERIFIER` | `verification.backend` and `verification.command` | An executable speaking the stdin/stdout packet protocol. Wins over both bundled adapters and a custom `command`. |
| `QMD_PROVER_VERIFIER_DEBUG` | — | A directory; each check dumps its exact prompt, raw model output, and parsed verdict there. |
| `QMD_PROVER_FRESH_CONTEXT` | — | Set to `1` for the verifier process when `fresh-context` is true. Read by adapters, not by the engine. |
| `QMD_PROVER_DEBUG` | — | Set to `1` to print a stack trace on stderr instead of a one-line message when a command fails. |

Run `doctor` to see which command each tool resolved to and whether it is available.

## `project`

| Key | Default | Meaning |
|---|---|---|
| `exclude` | `[.qmd-prover]` | Additional path patterns to skip during discovery, written as an inline array. `.qmd-prover`, `.git`, `node_modules`, and `render.output-dir` are always excluded regardless, and entries in a project `.gitignore` are honored too. Discovery always descends into subfolders. |

## `goals`

| Key | Default | Meaning |
|---|---|---|
| `id-prefix` | `thm-main-` | Explicit IDs beginning with this prefix are the project's **protected main goals**: their origin is `user` (all other declarations are `agent`), and each must carry both the `.theorem` and `.goal` classes — otherwise inspection reports `MAIN_GOAL_SHAPE`. |
| `protect-statements` | `true` | Enables statement protection for registered goals. Their statement and title are baselined in `statement-locks.json`; editing a protected statement or title raises `MAIN_STATEMENT_MUTATED` / `MAIN_TITLE_MUTATED` until it is restored (or the user approves a new baseline). |

## `semantic`

| Key | Default | Meaning |
|---|---|---|
| `wildcard-imports` | `false` | When `false`, a `use: ['*']` wildcard in a front-matter import is a `WILDCARD_IMPORT` error, so every cross-file dependency must be imported by exact ID. Set `true` to permit wildcard imports. |

## `tools`

| Key | Default | Meaning |
|---|---|---|
| `pandoc` | `""` | Path to a Pandoc executable when it is not on `PATH`. Resolution precedence: `QMD_PROVER_PANDOC` env var > this key > the bare `pandoc` on `PATH`. |
| `quarto` | `""` | Path to Quarto, needed only when rendering to a final HTML/PDF format. Precedence: `QMD_PROVER_QUARTO` env var > this key > `quarto` on `PATH`. |

## `verification`

Selects and configures the independent verifier. See [the dispatcher reference](cli.md) for the
packet protocol and the bundled `claude`/`codex` adapters.

| Key | Default | Accepted values | Meaning |
|---|---|---|---|
| `backend` | `none` | `none` · `claude` · `codex` · `command` | Which verifier runs. `none` = machine inspection only (local checks stay `not-run`, nothing becomes globally verified), and any `verification.command` is ignored. `claude`/`codex` run the bundled adapters. `command` uses the custom `command` below. Any other value is a config error, so a typo cannot quietly disable verification. |
| `model` | `""` | `""` or a concrete model id | Forwarded to the backend CLI as `--model`. Empty (`""`) forwards nothing, so the CLI uses its own default model; a concrete id (e.g. `gpt-5-codex`, `claude-opus-4-8`) is passed through. The checker contract hashes the model as written (unset and `""` are the same), so blanking or removing the line does not re-verify — but pinning a concrete id does, even if it equals the CLI's own default. (The retired `configurable` sentinel is rejected; use `""`.) |
| `effort` | `high` | `low` · `medium` · `high` · `xhigh` · `max` | Reasoning effort forwarded to the backend, ordered cheapest→most thorough. Both backends accept `low`/`medium`/`high`/`xhigh`; `max` is claude's top level (codex tolerates it). It is forwarded as `--effort` to claude and as `-c model_reasoning_effort="<effort>"` to codex. An unrecognized value falls back to `high`. Higher effort means more reasoning tokens and time per check. |
| `executable` | `""` | filesystem path | Path to the backend CLI when it is not on `PATH`. Empty = use the bare command (`codex`/`claude`) from `PATH`. |
| `command` | — (unset) | string, or inline array | The custom verifier for `backend: command`. A string is the executable; an array is `[executable, ...args]`. It must speak the JSON packet protocol on stdin/stdout. |
| `fresh-context` | `true` | boolean | Declares that each check runs in an isolated context (sets `QMD_PROVER_FRESH_CONTEXT=1` for the verifier process) and is recorded in the checker contract. |
| `citations` | `standard` | `lenient` · `standard` · `strict` | How aggressively the verifier flags a specialized term used **without a cited definition**. `lenient` = assume its evident meaning, never flag a missing citation; `standard` = flag only genuine doubt; `strict` = every load-bearing term must be fixed by a citation. |
| `rigor` | `standard` | `lenient` · `standard` · `strict` | How completely a **valid** proof step must be spelled out — i.e. what counts as a `gap`. `lenient` = accept informal/textbook argument; `standard` = ask for material justification but take routine steps as evident; `strict` = every load-bearing step must be explicit **and** any reported gap blocks acceptance. Wrong or misapplied steps (`critical_errors`) always block, at every level. |
| `rigor-disprove` | `standard` | `lenient` · `standard` · `strict` | The refutation-side analogue of `rigor`: how strongly a proposed counterexample or refutation (a `.disproof` proof) must be argued. Applies only in refutation mode; `strict` makes a refutation's reported gaps block, just as `rigor: strict` does for a proof. |
| `assumptions` | `allow` | `allow` · `forbid` | Whether a protected main goal may rest on `.assumed` facts. `allow` permits them; the goal composes as `verified` and reports its footprint as `verified modulo N assumptions`. `forbid` turns any non-empty footprint under a protected goal into the `GOAL_ASSUMED` error, naming every assumption. **Operational, not part of the checker contract:** it never affects a cache key, since `.assumed` facts are never sent to the verifier. |
| `tools` | `[]` | inline list of `file-read` · `web-search` · `code` | Which tool capabilities the verifier is **told, in its prompt,** that it may use — always only to *check* the submission, never to import unsupplied premises. **Prompt-only:** qmd-prover neither provides a tool nor enforces this; whether a permitted tool actually works depends on what the backend agent has (e.g. `web-search` needs network, which the read-only codex sandbox lacks). `file-read` = look up a term's definition/notation in the project (never a dependency's proof); `web-search` = confirm an external result the external basis permits/cites; `code` = run a computation to check a step. Empty = reason from the packet alone. |

**Correctness floor, plus two strictness axes.** No level of either axis ever relaxes correctness:
a wrong, circular, or misapplied step, or a hole that cannot be routinely filled, is a
`critical_error` and always blocks acceptance. The two axes only tune what *else* is reported and
whether it blocks. `citations` controls whether an uncited non-standard term is flagged.
`rigor` controls how completely a valid step must be spelled out (what counts as a `gap`); only
`rigor: strict` makes reported gaps block acceptance — at `lenient`/`standard` a correct argument
with formality gaps still verifies, and the gaps are recorded as advisories. `rigor-disprove` is the
same axis for a proposed refutation and applies only in refutation mode.

**Checker-contract keys vs. operational keys.** Eight keys — `backend`, `model`, `effort`,
`fresh-context`, `citations`, `rigor`, `rigor-disprove`, `tools` — form the *checker contract* that is hashed into
every verification cache key. Changing any of them re-verifies every fact, because old cached verdicts no
longer match the contract. The rest — `executable` and `command` (only *how to spawn* the verifier)
and `assumptions` (a project policy applied after composition, never sent to the verifier) — do not
invalidate cached verdicts.

**Which verifier actually runs** (highest precedence first): the `QMD_PROVER_VERIFIER` environment
variable > the `claude`/`codex` bundled adapter selected by `backend` > `verification.command`.
Each fresh check records its wall-clock duration and, when the backend reports tokens, its token
usage, surfaced per fact as `local_verification.metrics` and summed into the verification summary's
`verifier_duration_ms` and `verifier_tokens`.

## `render`

| Key | Default | Meaning |
|---|---|---|
| `graph-engine` | `builtin` | Engine used to draw the dependency-graph SVG. `builtin` is the shipped, dependency-free engine. |
| `output-dir` | `.qmd-prover/generated` | Directory where `render` writes generated proof-status QMD, report data, and the dependency SVG. It is created on demand and is always excluded from discovery. |

`render.output-dir` governs only what `qmd-prover render` writes. It is not where the rendered book
lands: that is `project.output-dir` in the project's own `_quarto.yml`, which the `init` scaffold sets
to `.qmd-prover/site/book`. There is no configuration key for it — `_quarto.yml` belongs to the
project, and qmd-prover never rewrites it. Quarto, not qmd-prover, writes that directory.

## Notes on the file format

- The reader accepts a **minimal YAML subset**: nested mappings by (space-only) indentation, and
  three kinds of value. A value's kind is fixed by its first character: a quote opens a literal
  string (`name: ""`, `pandoc: "/opt/pandoc"`), a `[` opens an **inline list** of strings
  (`exclude: [a, b]`, `command: [node, verify.js]`), and anything else is bare text — the exact
  words `true`/`false` become booleans, and everything else is a string. There are **no numbers and
  no null**: `30` and `null` are just the strings `"30"` and `"null"`.
- **Comments** run from a `#` to end of line, whether the `#` starts the line or follows a space
  (`backend: codex   # note` reads as `codex`). A `#` with no space before it, or one inside a
  quoted string or inside `[...]`, is a literal character. A comment may sit on its own line or
  after a value.
- **Not supported:** block sequences (`- item` lines), anchors, multi-line/block scalars, numbers,
  and null. Inline-list elements are split on commas, so an element cannot contain a comma. A
  malformed line — a tab in the indentation, a line that is not `key: value` or `key:`, or an
  unterminated quote or `[` — stops loading with an error naming the line number, rather than being
  silently skipped.
- Enum values are validated: an invalid `citations`, `rigor`, `rigor-disprove`, or `effort` falls back to its default
  (`standard`, `standard`, `standard`, `high`); an unrecognized `backend` is a config error.
- Run `doctor` to see the resolved Pandoc, Quarto, and verifier commands and whether each is
  available; it also reports a malformed `config.yml` instead of crashing.

## The other authored input: `.qmd-prover/.external.qmd`

This file is not configuration in YAML, but it is the second setting that changes what the verifier
accepts. It is ordinary project-owned QMD controlling which results may be taken from **outside** the
project, and its exact content is hashed into every verification key.

| State | `mode` | Meaning |
|---|---|---|
| file absent | `unrestricted` | External results are permitted. Identify each one precisely and check every hypothesis. |
| present, whitespace only | `none` | Use no external mathematical results; develop everything in the project. |
| present, nonempty | `declared` | Use only the external results, or classes of results, that its content allows, plus unambiguously elementary reasoning. |

`init` never creates this file. Changing it invalidates the affected verification cache entries, so
every fact whose check depended on it is verified again. The external basis is the only channel for
outside mathematical premises: it creates no graph nodes, and every in-project premise remains an
ordinary `@id` dependency subject to import scope.

## The `.qmd-prover/` state directory

Only three files here are authored inputs; the scaffolded `.gitignore` tracks exactly those and
ignores the rest.

| Path | Kind | Content |
|---|---|---|
| `config.yml` | authored | This file's settings. |
| `.external.qmd` | authored | The external mathematical basis above. |
| `statement-locks.json` | authored | The protected-goal statement and title baseline. |
| `.gitignore` | authored | Written once; customize freely (e.g. to share the verifier cache). |
| `manifest.json`, `graph.json`, `diagnostics.json` | derived | The last compilation's facts, dependency graph, and diagnostics. |
| `graphs/` | derived | Published snapshots, plus `latest.json`. |
| `verification/checks/` | derived | One cached verdict per verification key; read by `verification list`/`show` and audited by `check staleness`. |
| `verification/failures/` | derived | Retained verifier failures, for debugging a broken backend. |
| `reports/status.json` | derived | The machine-readable render report. |
| `generated/` | derived | `render` output: `proof-status.qmd` and `dependencies.svg`. Relocatable via `render.output-dir`. |
| `events.jsonl`, `write.lock` | derived | Run log and the write lock held during mutating operations. |

Everything derived is safe to delete: the next inspection rebuilds it. Deleting
`verification/checks/` discards every cached verdict and re-verifies the whole project, which costs
real tokens.

## Common configurations

**Machine-only (the default).** No verifier is called, no tokens are spent. Every proof passes the
mechanical checks and stays `unverified`. A deliberate mode — never report its output as verified.

```yaml
verification:
  backend: none
```

**Independent checking, balanced.** The usual working setup once a CLI is installed and logged in.

```yaml
verification:
  backend: codex     # or: claude
  effort: high
  citations: standard
  rigor: standard
```

**Publication rigor.** Every load-bearing step must be explicit, every non-standard term must be
cited, and any reported gap blocks acceptance. Expect more rejections and more tokens per check.

```yaml
verification:
  backend: claude
  effort: max
  citations: strict
  rigor: strict
  rigor-disprove: strict
```

**Exploratory drafting.** Accept informal, textbook-level argument while an approach is still being
found; tighten before relying on the result.

```yaml
verification:
  backend: codex
  effort: medium
  citations: lenient
  rigor: lenient
```

Changing any of these re-keys the cache and re-verifies every fact, so switch deliberately rather
than per run.
