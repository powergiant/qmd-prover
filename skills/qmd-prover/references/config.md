# Project configuration reference

qmd-prover reads optional project settings from `.qmd-prover/config.yml`. The file is a
version-controlled authored input (kept alongside `.external.qmd` and
`statement-locks.json`); everything else under `.qmd-prover/` is regenerated tool state. The
file is **optional**: when it is absent, or when a key is omitted, the built-in defaults below
apply. Settings are parsed by a dependency-free minimal YAML reader and merged over the
defaults, so a partial file only overrides the keys it names.

A complete file, with every key at its default, looks like this:

```yaml
project:
  name: ""                        # informational project name
  root: ..                        # project root, relative to this .qmd-prover/ folder
  discover-qmd-recursively: true  # descend into subfolders when discovering .qmd files
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
  backend: none                   # none | claude | codex | command
  model: configurable             # forwarded as --model unless "configurable"
  effort: high                    # low | medium | high | xhigh | max — reasoning effort
  executable: ""                  # path to the backend CLI when not on PATH
  # command: [node, verify.js]    # custom verifier argv, for backend: command
  fresh-context: true             # each check runs in an isolated context
  citations: standard             # lenient | standard | strict — uncited-term scrutiny
  rigor: standard                 # lenient | standard | strict — how fully steps must be justified
  tools: []                       # capabilities the verifier is TOLD it may use: [file-read, web-search, code]

render:
  graph-engine: builtin           # dependency-graph SVG engine
  output-dir: .qmd-prover/generated  # where render writes generated inputs
```

## `project`

| Key | Default | Meaning |
|---|---|---|
| `name` | `""` | Informational project name, echoed in output. Does not affect analysis. |
| `root` | `..` | The project root directory, **relative to the `.qmd-prover/` folder that contains this config**. `..` (the normal value) means the parent directory. All discovery, imports, and paths are resolved against this root. |
| `discover-qmd-recursively` | `true` | Whether project discovery descends into subfolders under `root` rather than only its top level. |
| `exclude` | `[.qmd-prover]` | Additional path patterns to skip during discovery, written as an inline array. `.qmd-prover`, `.git`, `node_modules`, and `render.output-dir` are always excluded regardless, and entries in a project `.gitignore` are honored too. |

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
| `backend` | `none` | `none` · `claude` · `codex` · `command` | Which verifier runs. `none` = machine inspection only (local checks stay `not-run`, nothing becomes globally verified). `claude`/`codex` run the bundled adapters. `command` (and any unrecognized value) uses the custom `command` below. |
| `model` | `configurable` | `configurable` or a concrete model id | Forwarded to the backend CLI as `--model`. `configurable` (or empty) forwards nothing, so the CLI uses its own default model; a concrete id (e.g. `gpt-5-codex`, `claude-opus-4-8`) is passed through. |
| `effort` | `high` | `low` · `medium` · `high` · `xhigh` · `max` | Reasoning effort forwarded to the backend, ordered cheapest→most thorough. Both backends accept `low`/`medium`/`high`/`xhigh`; `max` is claude's top level (codex tolerates it). It is forwarded as `--effort` to claude and as `-c model_reasoning_effort="<effort>"` to codex. An unrecognized value falls back to `high`. Higher effort means more reasoning tokens and time per check. |
| `executable` | `""` | filesystem path | Path to the backend CLI when it is not on `PATH`. Empty = use the bare command (`codex`/`claude`) from `PATH`. |
| `command` | — (unset) | string, or inline array | The custom verifier for `backend: command`. A string is the executable; an array is `[executable, ...args]`. It must speak the JSON packet protocol on stdin/stdout. |
| `fresh-context` | `true` | boolean | Declares that each check runs in an isolated context (sets `QMD_PROVER_FRESH_CONTEXT=1` for the verifier process) and is recorded in the checker contract. |
| `citations` | `standard` | `lenient` · `standard` · `strict` | How aggressively the verifier flags a specialized term used **without a cited definition**. `lenient` = assume its evident meaning, never flag a missing citation; `standard` = flag only genuine doubt; `strict` = every load-bearing term must be fixed by a citation. |
| `rigor` | `standard` | `lenient` · `standard` · `strict` | How completely a **valid** step must be spelled out — i.e. what counts as a `gap`. `lenient` = accept informal/textbook argument; `standard` = ask for material justification but take routine steps as evident; `strict` = every load-bearing step must be explicit **and** any reported gap blocks acceptance. Wrong or misapplied steps (`critical_errors`) always block, at every level. |
| `tools` | `[]` | inline list of `file-read` · `web-search` · `code` | Which tool capabilities the verifier is **told, in its prompt,** that it may use — always only to *check* the submission, never to import unsupplied premises. **Prompt-only:** qmd-prover neither provides a tool nor enforces this; whether a permitted tool actually works depends on what the backend agent has (e.g. `web-search` needs network, which the read-only codex sandbox lacks). `file-read` = look up a term's definition/notation in the project (never a dependency's proof); `web-search` = confirm an external result the external basis permits/cites; `code` = run a computation to check a step. Empty = reason from the packet alone. |

**Correctness floor, plus two strictness axes.** No level of either axis ever relaxes correctness:
a wrong, circular, or misapplied step, or a hole that cannot be routinely filled, is a
`critical_error` and always blocks acceptance. The two axes only tune what *else* is reported and
whether it blocks. `citations` controls whether an uncited non-standard term is flagged.
`rigor` controls how completely a valid step must be spelled out (what counts as a `gap`); only
`rigor: strict` makes reported gaps block acceptance — at `lenient`/`standard` a correct argument
with formality gaps still verifies, and the gaps are recorded as advisories.

**Checker-contract keys vs. operational keys.** Seven keys — `backend`, `model`, `effort`,
`fresh-context`, `citations`, `rigor`, `tools` — form the *checker contract* that is hashed into
every verification cache key. Changing any of them re-verifies every fact, because old cached verdicts no
longer match the contract. The remaining two — `executable` and `command` — are only *how to spawn*
the verifier and do not invalidate cached verdicts.

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

## Notes on the file format

- The reader accepts a **minimal YAML subset**: nested mappings by indentation, and scalar values
  that are booleans (`true`/`false`), `null`, numbers, quoted strings, or **inline arrays**
  (`exclude: [a, b]`, `command: [node, verify.js]`). Block sequences (`- item` lines), anchors,
  and multi-line/block scalars are **not** supported; inline-array elements are split on commas, so
  values containing commas cannot be expressed.
- Hyphenated keys are canonical; `fresh-context` also accepts the underscore spelling
  `fresh_context`. `citations` and `rigor` are single words.
- Unknown values fall back safely: an invalid `citations` or `rigor` becomes `standard`, and an
  unrecognized `backend` with no `command` behaves like `none`.
- Run `doctor` to see the resolved Pandoc, Quarto, and verifier commands and whether each is
  available.
