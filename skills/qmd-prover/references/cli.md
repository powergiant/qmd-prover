# Dispatcher and installation reference

qmd-prover is a command-line tool (installed on the host's `PATH`) with a dependency-free Node
dispatcher for mathematical proof workflows in Quarto Markdown. Every QMD file in the project is
semantic mathematics compiled into one unified dependency graph.

This file is the exhaustive reference: every command, every argument, every option, every output
field, every failure mode, and every diagnostic code. Three companions cover the rest —
[status.md](status.md) for the fact status vocabulary, [config.md](config.md) for every
`.qmd-prover/config.yml` setting, and [AGENTS.md](AGENTS.md) for the project contract an agent must
follow while writing mathematics. `SKILL.md` is the working summary; this file is what it points at.

Exact verifier decisions, dependency graphs, and generated Quarto inputs live under `.qmd-prover/`,
alongside the authored inputs it version-controls: `config.yml`, the `.external.qmd` basis policy,
and the `statement-locks.json` protection baseline. On first compile qmd-prover scaffolds a
`.qmd-prover/.gitignore` that keeps those three files and ignores everything it regenerates
(snapshots, manifest, diagnostics, caches, generated render output); it is written once and never
overwritten.

## Requirements

- **Node.js 20 or later.** Required to run the command at all.
- **Pandoc**, on `PATH`, or `tools.pandoc` in `.qmd-prover/config.yml`, or `QMD_PROVER_PANDOC`.
  Required: it is the semantic parser, and production parsing never falls back to regular
  expressions.
- **An independent verifier** — optional, but nothing is ever verified without one. Set
  `verification.backend` to `claude` or `codex` to use a bundled adapter (with
  `verification.executable` pointing at that CLI when it is not on `PATH`), or `backend: command`
  with a custom `verification.command` argv, or point `QMD_PROVER_VERIFIER` at an executable. With
  `backend: none` (the default) machine inspection remains fully available, every local check is
  `not-run` with reason `no-backend`, and every ready fact stays `unverified`.
- **Quarto** — optional, needed only when rendered HTML, PDF, or another final format is wanted.
  Configure it with `tools.quarto` or `QMD_PROVER_QUARTO` when it is not on `PATH`.

### Tool resolution and environment variables

Tool-path precedence, highest first:

| tool | env var | config key | fallback |
|---|---|---|---|
| Pandoc | `QMD_PROVER_PANDOC` | `tools.pandoc` | `pandoc` on `PATH` |
| Quarto | `QMD_PROVER_QUARTO` | `tools.quarto` | `quarto` on `PATH` |
| verifier | `QMD_PROVER_VERIFIER` | `verification.backend` + `verification.executable`, or `verification.command` | none |

Three further environment variables affect a run:

| variable | effect |
|---|---|
| `QMD_PROVER_VERIFIER_DEBUG` | A directory. Each check dumps its exact prompt, raw model output, and parsed verdict there for inspection. |
| `QMD_PROVER_FRESH_CONTEXT` | Set to `1` for the verifier process when `verification.fresh-context` is true. Read by adapters, not by the engine. |
| `QMD_PROVER_DEBUG` | Set to `1` to print a stack trace on stderr instead of a one-line message when a command fails. |

`doctor` reports the resolved command and availability for each tool. Run it before inspection
whenever the execution environment is uncertain.

## Output model

### The JSON envelope

Every command prints one JSON object to standard output. Common fields:

| field | meaning |
|---|---|
| `schema_version` | The output schema this build emits (currently 7). |
| `operation` | The operation name, e.g. `inspect-project`, `dependency-search`, `check-staleness`. |
| `ok` | Whether the operation and the configured verifier ran without infrastructure errors. **Never a mathematical claim.** |
| `snapshot_id` | The published graph snapshot the answer was computed from, so results can be correlated. |
| `diagnostics` | An array of `{severity, code, message, file?, line?, id?, remediation?}`. |

Read `global_verification.status` (or the `status` column) for mathematical state — never `ok`. A
project where every proof was rejected still returns `ok: true`.

### Lean by default

Default JSON is the agent-facing projection: each command emits only the answer its name promises.

- Wherever a fact is listed it appears as one compact reference: `{id, kind, status, file, line}`.
  The `status` is the composed **global** status.
- Listings carry counts (`count`, `counts`, `total`) beside the list.
- The dependency graph is never embedded unless `--graph` asks for it; it is always written to
  `.qmd-prover/graph.json` regardless.
- Per-fact detail (references, verifier report, dependency lists, verification history) is available
  from `inspect fact @ID`.

### `--print`

`--print` renders a concise human report instead of JSON, from the same selection, decisions,
diagnostics, and snapshot — it changes presentation only, and always shows the full detail rather
than the lean projection.

Accepted by: `doctor`, `inspect project`, `inspect fact`, `inspect path`, every `dependency`
subcommand, and `check staleness`. **Not** accepted by: `version`, `install`, `init`,
`verification list`, `verification show`, `render` — those emit JSON only.

### Exit codes

| code | meaning |
|---|---|
| `0` | Success. |
| `1` | CLI usage or runtime failure: unknown command, unknown or duplicate option, missing or extra positional argument, out-of-range numeric option, or an unhandled runtime error. Nothing was computed. |
| `2` | A structured domain result with `ok: false` was printed. The JSON is valid and carries diagnostics. |

An exit-1 failure still prints a JSON envelope on **stdout** so a caller never has to parse prose:

```json
{
  "schema_version": 7,
  "operation": "cli-error",
  "ok": false,
  "diagnostics": [{ "severity": "error", "code": "CLI_ERROR", "message": "render accepts only optional --allow-errors" }]
}
```

The same message is repeated on **stderr** as a plain line. Set `QMD_PROVER_DEBUG=1` to get the
stack trace on stderr instead of the message.

Machine or configured-verifier infrastructure failures return `ok: false` with exit code 2. An absent
verifier is **not** a failure: local checks are `not-run` with reason `no-backend`, and every ready
fact stays `unverified`. Pandoc launch or parse failures remain parse diagnostics and are never
reported as unknown facts.

### Version compatibility warnings

Before `render`, `inspect`, `dependency`, `check`, and `verification` run, the engine compares its
own schema, verifier-protocol, and contract versions against what the project's `.qmd-prover/` state
and `AGENTS.md` were written with. Any drift prints `qmd-prover: warning: …` to **stderr** and the
command still runs — the gate warns, it never refuses. `doctor` reports the same information in its
`compatibility` array instead.

- **schema** drift — the stale snapshot is ignored and rebuilt on the next `inspect project`.
- **verifier-protocol** drift — affected cached decisions are re-verified on the next inspection.
- **contract** drift — the project's `AGENTS.md` managed block predates the engine's. Review the
  difference and, only with user approval, run `qmd-prover init --sync-contract`.

## Commands

Run the `qmd-prover` command from the mathematical project root. It is installed once on the host's
`PATH` (see "Install the tool and skill from a source checkout" below); the skill supplies the
instructions.

```bash
qmd-prover version
qmd-prover doctor [--print]
qmd-prover install [--global|-g] [--codex|--claude] [--dir <project>]
qmd-prover init [--adopt-existing|--append-contract|--sync-contract]
qmd-prover inspect project [--print] [--graph]
qmd-prover inspect fact @ID [--print] [--graph]
qmd-prover inspect path FILE_OR_FOLDER [--print] [--graph]
qmd-prover dependency dependencies @ID [--print]
qmd-prover dependency reverse dependencies @ID [--print]
qmd-prover dependency impact @ID [--print]
qmd-prover dependency frontier @ID [--print]
qmd-prover dependency assumptions @ID [--print]
qmd-prover dependency path @FROM @TO [--print]
qmd-prover dependency alternative paths @FROM @TO [--limit N] [--max-depth N] [--print]
qmd-prover dependency cycles [--print]
qmd-prover dependency findings [--print]
qmd-prover dependency unused imports [--print]
qmd-prover dependency unused exports [--print]
qmd-prover dependency isolated [--print]
qmd-prover dependency unreachable [--print]
qmd-prover dependency ready [--print]
qmd-prover dependency reused [--limit N] [--print]
qmd-prover dependency search [QUERY] [filters] [--print]
qmd-prover check staleness [--print]
qmd-prover verification list
qmd-prover verification show SUBMISSION_ID
qmd-prover render [--allow-errors]
```

Run `qmd-prover help`, append `help`, `--help`, or `-h` to a command group or leaf command, or use
`qmd-prover help COMMAND...` for exact usage. Semantic IDs may be written `@ID` or bare `ID`; output
always uses the canonical `@ID` form.

### `version`

Read-only, touches no project. Prints the installed tool version and the three protocol versions it
implements:

```json
{
  "operation": "version",
  "tool": "0.1.0",
  "schema_version": 7,
  "verifier_protocol_version": 6,
  "contract_version": 26
}
```

`--version` and `-v` are accepted spellings. Takes no other arguments.

### `doctor`

Read-only. Checks Node, Pandoc, the optional verifier, and optional Quarto **without parsing any
QMD**, and reports engine/project version compatibility.

Output fields: `root`, `versions` (as in `version`), `dependencies`, `compatibility`, `next_actions`.
Each entry of `dependencies` is `{required, available, command, purpose, remediation?}` for the keys
`node`, `pandoc`, `verifier`, `quarto`. `next_actions` lists one `{dependency, remediation}` per
unavailable tool that has a remediation.

`ok` is true when **Node and Pandoc** are available; the verifier and Quarto are optional and never
fail it. Version drift never fails it either — `compatibility` is reported for the agent to act on.

A malformed `config.yml` is reported rather than crashing: the result carries `config_error` with the
offending line and `ok: false`.

### `install`

Copies the skill **documentation** (`SKILL.md`, `references/`, `agents/`) into a host assistant's
skills directory. The engine is this `qmd-prover` command itself and is never bundled, so re-running
`install` only refreshes the docs in place.

| option | effect |
|---|---|
| `--global`, `-g` | Install for every project, into the host home. |
| `--local` | (default) Install into the current project. |
| `--claude` | (default) Target Claude Code. |
| `--codex` | Target Codex. |
| `--dir <project>` | A local install target other than the current directory. Rejected together with `--global`. |

| scope + host | destination |
|---|---|
| local + claude | `./.claude/skills/qmd-prover` |
| local + codex | `./.codex/skills/qmd-prover` |
| global + claude | `${CLAUDE_CONFIG_DIR:-~/.claude}/skills/qmd-prover` |
| global + codex | `${CODEX_HOME:-~/.codex}/skills/qmd-prover` |

Any previous copy at the destination is replaced. A skill installed mid-session is not
auto-registered by the host, which scans skills at session start: read the printed `SKILL.md` path to
drive qmd-prover immediately, and start a new session for automatic discovery.

### `init`

Initializes or safely adopts a qmd-prover project. Before writing anything it inventories the
existing `AGENTS.md`, QMD sources, Quarto configuration, `.qmd-prover` state, and external-basis
mode, and returns that inventory as `existing`:

```json
{
  "agents_md": true,
  "external_policy": { "path": ".qmd-prover/.external.qmd", "mode": "unrestricted" },
  "qmd_prover_state": false,
  "quarto_configs": ["_quarto.yml"],
  "qmd_file_count": 3,
  "qmd_files": ["completeness.qmd", "workspace/foundations.qmd", "workspace/main-proof.qmd"]
}
```

`external_policy.mode` is `unrestricted` (file absent), `none` (present but whitespace-only), or
`declared` (nonempty). `init` never creates `.external.qmd`.

**Every `status` it can return:**

| `status` | `ok` | Meaning | Next step |
|---|---|---|---|
| `created` | ✔ | No project material existed; a root `AGENTS.md` with the canonical block was written. | Continue. |
| `adopted` | ✔ | Project material existed and `--adopt-existing` authorized writing the contract. | Continue. |
| `appended` | ✔ | `--append-contract` added the canonical block to an existing `AGENTS.md`, preserving all prior text. | Continue. |
| `synchronized` | ✔ | `--sync-contract` replaced one differing managed block. `previous_contract_version` reports what it replaced. | Continue. |
| `already-initialized` | ✔ | The canonical block is already present, byte-for-byte. | Nothing to do. |
| `intent-required` | ✘ | Mathematical project material exists but `AGENTS.md` is missing or empty. **Nothing was written.** | Summarize `existing`, ask the user, then `--adopt-existing`. |
| `append-required` | ✘ | `AGENTS.md` exists without a qmd-prover contract. **Nothing was written.** | Ask, then `--append-contract`. |
| `sync-required` | ✘ | `AGENTS.md` carries a different managed block. `current_contract_version` and `contract_version` report both. | Ask, then `--sync-contract`. |
| `malformed-contract` | ✘ | `AGENTS.md` has duplicate or unbalanced contract markers. | Repair by hand; no flag fixes this. |

The three mutation options are mutually exclusive; passing two is a usage error. `init` accepts no
positional arguments, creates no theorem QMD, and never edits mathematics. On any `ok` outcome it
also materializes `.qmd-prover/` with a default `config.yml` and `.gitignore` (each written only when
absent), so a project that lost its config gets it back even when the contract was already current.

The same `ok` outcomes scaffold the project's Quarto configuration and report it as `quarto_config`:

```json
{ "path": "_quarto.yml", "status": "created", "output_dir": ".qmd-prover/site/book" }
```

`status` is `created` when the project had neither `_quarto.yml` nor `_quarto.yaml`, and `preserved`
(with no `output_dir`) when one already existed — an existing Quarto configuration is never rewritten
or merged. A created file declares `project.type: book`, renders into `.qmd-prover/site/book`, and
lists every QMD file found at initialization under `book.chapters`, landing page first. The book
layout is what makes result numbering run across the whole project and cross-file `@id` references
resolve; the chapter list is the project's from then on, and no qmd-prover command rewrites it.

**Never use a mutation flag without explicit user approval.**

### `inspect project`

Compiles every discovered project QMD file into one graph, runs machine analysis and optional local
conditional verification for **every** fact, composes global status, publishes the snapshot, and
writes the display-only `status` attribute back onto freshly checked divs.

Returns a dashboard: `complete`, `snapshot_id`, `snapshot_published`, `scope`, `summary`, `goals`,
`notes`, `facts`, `verification`, `blockers`, `findings`, and `diagnostics`.

Each row of `facts` is compact:

```json
{
  "id": "def-canonical-term-model", "kind": "definition", "status": "verified",
  "file": "workspace/semantics.qmd", "line": 164,
  "mechanical": "pass", "local": "verified", "global": "verified"
}
```

`status` and `global` are the same composed value; `mechanical` is the flattened check result
(`pass`/`fail`, the same information a graph node spells `ok`/`broken`); `local` is the verifier's
conditional verdict. A disproved fact also carries its `disproof` evidence inline, so the
whole-project view answers "which facts are disproved and why" without an extra call.

`summary` carries `goals`, `notes`, `facts`, and `errors` from the snapshot, plus `files`, `kinds` (a
per-kind tally), `statuses` (a per-status tally), `globally_verified_goals`, and
`globally_disproved_goals`. `findings` is per-category counts only (the itemized lists have their own
`dependency` commands). `blockers` is one `{root, blocker, path}` entry per goal-to-blocker pair.

`--graph` includes the full dependency graph (nodes, edges, cycles) inline; it is always also written
to `.qmd-prover/graph.json`.

One malformed file does not hide healthy results elsewhere — except that a Pandoc **parse** error
anywhere makes the compilation incomplete, which marks every fact in the project `broken` for that
run. `ok` is true when the compilation is complete, no fact hit a `verifier-error`, and no diagnostic
is an error.

### `inspect fact @ID`

Locates any explicit declaration, including a protected main goal, and checks **only** that fact and
its transitive local dependency closure. Reverse dependencies and unrelated facts are never checked;
they report `not-run` with reason `out-of-scope`.

A protected main goal is checked through its linked proof overlay; the user's QMD is not changed.

This is the only command that returns full per-fact detail: `fact` (the whole semantic record),
`check`, `direct_dependencies`, `transitive_dependencies`, `direct_reverse_dependencies`,
`blockers`, `verification`, `verification_history` (past retained verdicts for this ID, oldest
first), plus `verified`, `disproved`, and `global_status` convenience fields. Dependency lists are
compact references; `--graph` adds the fact's dependency subgraph.

`check` is where the three layers are unfolded:

| field | content |
|---|---|
| `mechanical` | `{status: "pass"｜"fail", verification_mode, references, diagnostics, reason?}`. Each `references` entry is `{dependency, existence, scope, cycle}` with `pass`/`fail` per check, so a broken edge names itself. |
| `local_verification` | `{status, reason?, detail?, source, cached, verification_key, report, metrics}`. `report` is the verifier's own `{verdict, summary, critical_errors, gaps, nonblocking_comments, repair_hints, refutation}` — read `repair_hints` when repairing. `source` is `verification-cache` for a reused decision. |
| `global_verification` | `{status, blockers, reason?}`. |

An unknown ID returns `ok: false` with `FACT_UNKNOWN` — or, when a parse error is what hid it, with
the `PARSE_ERROR` diagnostics instead, so a broken parser is never misreported as a missing fact.

### `inspect path FILE_OR_FOLDER`

Applies the full semantic-QMD contract to the facts declared under one project QMD file or directory,
and checks the selected facts plus their transitive local dependencies.

Nodes in the returned graph carry `scope: "selected"` or `scope: "external"` so the closure pulled in
for context is distinguishable from what was asked for. `summary` reports `files`, `facts`, `kinds`,
`statuses`, `globally_verified`, `globally_disproved`, and `errors`.

A path with no declared facts is not an error: it returns `ok: true` with an empty fact list. Failure
cases are `PATH_NOT_FOUND`, `PATH_OUTSIDE_PROJECT` (the path escapes the project root), and
`PATH_TYPE_INVALID` (neither a directory nor a `.qmd` file).

### `dependency` — behavior shared by every subcommand

Every dependency query runs against the **published project machine graph**, resolved from the
current compilation, and returns only its own answer — the target and its dependencies or dependents,
the requested path, the matching facts, the cycles, or the findings. The whole graph is deliberately
not attached; use `inspect --graph` or `.qmd-prover/graph.json` when the graph itself is wanted.

**No dependency command ever calls the verifier.** It reuses the snapshot published by the last
matching inspection; when no snapshot matches the current context it builds one from the compilation
alone. A compilation-only graph carries no verdicts, so every fact in it reads `abandoned`, `broken`,
`open`, or `unverified`, and none reads `verified`, `disproved`, `rejected`, or `blocked`. Run
`inspect project` first whenever the answer depends on verification state.

- Edges point from a **citing** fact to the fact it **cites**. "Dependencies" therefore means
  downward (what this rests on) and "dependents"/"reverse dependencies" means upward (what rests on
  this).
- Every match is a compact reference `{id, kind, status, file, line}` where `status` is the composed
  global status. Use `inspect fact @ID` for the full four-field detail.
- Every result identifies the `snapshot_id` it used and carries `computed`, which is `false` when the
  graph could not be built at all — distinguishing "no answer" from "the answer is empty".
- A **`PARSE_ERROR` or `DUPLICATE_ID`** anywhere blocks every dependency command: the result is
  `ok: false`, `status: "blocked"`, with the blocking diagnostics and the remediation "Repair the
  blocking parse or duplicate-ID diagnostics, then rerun the dependency command." Rename the
  conflicting declarations first — a duplicate ID lists every project-relative declaration location.
- An `@ID` argument that names no node in the graph returns `ok: false` with one `FACT_UNKNOWN`
  diagnostic per unknown ID.
- Queries that take no target — `cycles`, `findings`, `unused imports`, `unused exports`, `isolated`,
  `unreachable`, `ready`, `reused`, and `search` — cover the complete project graph.

A fact is usable as an established premise only when its global status is `verified`. Open, blocked,
unverified, rejected, broken, abandoned, and disproved facts all appear as frontier blockers.

### `dependency dependencies @ID` / `dependency reverse dependencies @ID`

What `@ID` rests on, or what rests on `@ID`. Returns `target`, `counts: {direct, transitive}`,
`direct` (one edge away), and `transitive` (the whole closure, sorted by ID). `reverse dependencies`
is the same query with the edges reversed.

### `dependency impact @ID`

The downstream facts affected if `@ID` changes: `target`, `count`, and `affected` — the transitive
reverse closure. It is the same set as the `transitive` field of `reverse dependencies`, presented as
a blast radius rather than a relationship listing.

### `dependency frontier @ID`

The **lowest** facts in `@ID`'s closure that are not globally verified — the places where work
actually has to happen, with everything already-blocked-by-something-lower filtered out. Returns
`target`, `count`, and `frontier`, each entry `{fact, path}` where `path` is the shortest dependency
path from `@ID` down to that fact (or `null` if unreachable).

Facts inside the same cycle do not mask each other, so a cycle surfaces as a frontier rather than
disappearing. Assumed facts never appear: an `.assumed` fact composes as `verified`, so it is not an
obligation. What the closure rests on is reported by `dependency assumptions` instead.

### `dependency assumptions @ID`

The **assumption footprint** of `@ID`: every `.assumed` fact in its closure that it rests on. Returns
`target` (rendered `verified modulo N assumptions` when the footprint is non-empty) and `assumptions`,
each entry `{fact, path, basis}`, where `basis` is `assumed-proof` (a proof block whose argument is
taken as given, its citations still obligations) or `assumed-statement` (no proof block; the statement
itself is taken as given). The frontier and the footprint are the two halves of one question: what is
still owed versus what the project has decided not to prove.

### `dependency path @FROM @TO`

The shortest dependency path from `@FROM` down to `@TO`, as an array of IDs. `@FROM` equal to `@TO`
returns the one-node path `[@ID]`. When no path exists, `path` is `null` — which is an answer, not an
error.

### `dependency alternative paths @FROM @TO`

Enumerates bounded **simple** (no repeated node) paths from `@FROM` to `@TO`.

| option | range | default | meaning |
|---|---|---|---|
| `--limit N` | 1–25 | 5 | How many paths to return. |
| `--max-depth N` | 1–100 | `min(max(nodes − 1, 1), 64)` | Maximum edge depth explored. |

Returns `from`, `to`, `paths`, `truncated`, `explored`, and `limits: {max_paths, max_depth,
max_explored}`. `truncated: true` means the enumeration hit a bound — raise `--limit` or
`--max-depth`, or accept the sample. An out-of-range value is a usage error (exit 1) raised before
any project scan, so a typo is never hidden behind a graph failure.

### `dependency cycles`

Every dependency cycle in the aggregate graph, each as a closed ID list (first ID repeated last),
canonically rotated and sorted so the output is stable. Every participating fact is `broken` and is
never sent to the verifier, so cycles must be cut before those facts can be checked.

### `dependency findings`

All graph hygiene, readiness, and reuse findings in one call. JSON returns per-category `counts`
plus the itemized lists as compact references, and each category carries its own one-line
`definition`.

| category | meaning |
|---|---|
| `unused_imports` | An import declared in front matter that the consumer file never cites. |
| `unused_exports` | A fact exported but never imported anywhere. |
| `isolated_facts` | A fact with no incoming and no outgoing dependency edge. |
| `unreachable` | A fact outside the dependency closure of every protected main goal. Carries `applicable` (false when the project has no goals yet), `roots`, and `facts`. |
| `candidate_ready_for_ai` | A fact eligible to be sent to the verifier and carrying no verdict — exactly the `unverified` facts. |
| `heavily_reused` | Facts ranked by transitive then direct reverse-dependency count, each with `direct_dependents`, `transitive_dependents`, and `verified_dependents`. Facts with no dependents are omitted. |

The larger lists also have dedicated commands: `dependency ready`, `dependency reused`,
`dependency isolated`, `dependency unreachable`, `dependency unused imports|exports`.

### `dependency unused imports` / `dependency unused exports`

`unused imports` lists `{file, from, imported_file, id}` for each imported ID the consumer never
cites. A main-goal proof overlay counts as consuming imports in the proof's own file, so an overlay
does not produce false positives. `unused exports` lists `{id, export, file, line}` for each exported
fact nothing imports.

Both are hygiene signals, not errors: an unused import is harmless, but it usually means either a
citation was forgotten or the import is stale.

### `dependency isolated`

Facts with no dependency edge in either direction — nothing cites them and they cite nothing.
Returns `definition`, `count`, and `facts`. Typically a fact that was written but never wired into
the argument, or a definition whose users forgot to cite it.

### `dependency unreachable`

Facts outside the dependency closure of every protected main goal. Returns `definition`,
`applicable`, `roots` (the goal IDs used), `count`, and `facts`. When the project declares no goals,
`applicable` is `false` and no fact is reported — with no root, nothing is off-route.

### `dependency ready`

The work list: candidates whose machine checks and direct dependency edges pass and which carry no
verdict yet. Returns `definition`, `count`, and `candidates`. This is the answer to "what can the AI
work on now".

### `dependency reused`

Facts ranked by how much of the project rests on them, most-reused first. `--limit N` (1–1000,
default 20) caps the list; the result reports `total` and `limit` alongside `facts`, so a truncated
list is always visible as truncated. Useful for deciding what to prove first and what deserves the
most care.

### `dependency search [QUERY] [filters]`

Full-text plus graph-aware search over the project.

`QUERY` is an optional case-insensitive substring matched against the fact's **ID, title, file path,
statement text, and proof text**. Omit it (or pass `""`) to match every fact and filter only.

**Attribute filters** (each takes exactly one value):

| filter | accepted values |
|---|---|
| `--kind` | `definition` · `lemma` · `theorem` · `proposition` · `corollary` · `unknown` |
| `--status` | `open` · `unverified` · `rejected` · `blocked` · `broken` · `abandoned` · `verified` · `disproved` · `missing` |
| `--set` | `candidate` · `disproof-candidate` · `assumed` · `ready` · `unbroken` |
| `--origin` | `fact` · `main-goal` · `unresolved` |
| `--path` | One file path, or a directory prefix (matches the directory and everything under it). |

`--status` takes one composed global status; `--set` takes one of the five overlapping groupings.
Both vocabularies are defined in [status.md](status.md).

**Graph relationship filters** (each takes one `@ID`):

| filter | keeps facts that are… |
|---|---|
| `--used-by @ID` | dependencies of `@ID` (what `@ID` rests on) |
| `--depends-on @ID` | dependents of `@ID` (what rests on `@ID`) |
| `--affected-by @ID` | dependents of `@ID` — the same computation as `--depends-on`, named for impact analysis |
| `--related-to @ID` | dependencies of `@ID`, or dependents when `--reverse` is also given |
| `--frontier-of @ID` | on `@ID`'s unresolved proof frontier |

**Modifier flags:**

| flag | effect |
|---|---|
| `--reverse` | Flips `--related-to` from dependencies to dependents. Affects nothing else. |
| `--direct` | Restricts `--used-by`, `--depends-on`, `--affected-by`, and `--related-to` to a single edge instead of the transitive closure. Does not affect `--frontier-of` or `--cycle-participant`. |
| `--cycle-participant` | Keeps only facts that sit inside a dependency cycle. |

Every filter combines with **AND**, and every one is optional — though a bare `dependency search`
with no query and no filter simply lists the whole project. The result echoes the `query` and the
`filters` actually applied, plus `count` and `matches` sorted by ID.

Worked examples:

```bash
qmd-prover dependency search --set ready                        # what can be checked right now
qmd-prover dependency search --status rejected                  # what the verifier turned down
qmd-prover dependency search --set disproof-candidate           # every proposed refutation
qmd-prover dependency search compact --kind definition          # definitions mentioning "compact"
qmd-prover dependency search --path workspace/henkin.qmd        # everything in one file
qmd-prover dependency search --status open --used-by @thm-main-x   # unproved facts under a goal
qmd-prover dependency search --depends-on @lem-key --direct     # immediate users of a lemma
qmd-prover dependency search --frontier-of @thm-main-x --kind lemma
qmd-prover dependency search --cycle-participant                # everything tangled in a cycle
```

### `check staleness`

Read-only. Audits the on-disk verification cache records against the current project sources, the
external basis, and the checker contract. **It never edits QMD.**

Returns `changed` (one entry per affected target, with sorted `reasons` and the target's `current`
status, external-basis hash, and checker contract) and `invalidated` (the same set expressed as
`{id, path, reasons}`).

**Every staleness reason:**

| reason | meaning |
|---|---|
| `source-changed` | The target's statement or proof text no longer matches the cached record. |
| `dependency-context-changed` | A direct dependency's statement changed, or that dependency no longer exists. |
| `external-basis-changed` | `.qmd-prover/.external.qmd` differs from what the record was checked against. |
| `checker-contract-changed` | One of the eight contract keys (backend, model, effort, fresh-context, citations, rigor, rigor-disprove, tools) differs. |
| `cache-invalid` | The record is unreadable, structurally malformed, or its stored outcome disagrees with its own report. |

Each verification key gets its own cache file, so superseded records linger on disk. The audit picks
one representative per target — preferring records that still match the current source, and among
those the most recently verified — so an obsolete leftover cannot make a currently-valid result look
stale. `ok` is false when the compilation is incomplete or any target has a `cache-invalid` record.

### `verification list` / `verification show SUBMISSION_ID`

`verification list` discovers retained records and returns `submissions`, each
`{submission_id, target, outcome, verified_at, file}`, sorted by submission ID. It is the way to find
an ID for `verification show`.

`verification show` reads one record and returns `submission_id`, `file`, and the whole `record` —
the packet, the verifier's report, the outcome, and the identity hashes it was keyed on. A
non-matching ID returns `ok: false` with `SUBMISSION_NOT_FOUND` and the remediation to run
`verification list`, rather than exposing an internal filesystem error.

Both emit JSON only.

### `render`

Refreshes generated proof-status QMD, report data, and the dependency SVG from the project's semantic
mathematics. It writes into `.qmd-prover/generated/` (configurable via `render.output-dir`):

| artifact | content |
|---|---|
| `proof-status.qmd` | A generated page: one table row per fact with its local verdict, global status, refutation evidence, and source location, plus the graph image and any diagnostics. |
| `dependencies.svg` | The dependency graph, each node linking to its source and titled with its local and global state. |
| `.qmd-prover/reports/status.json` | The machine-readable summary and diagnostics. |

**Every `status` it can return:**

| `status` | `ok` | Meaning |
|---|---|---|
| `prepared` | ✔ | Artifacts written from a clean project. |
| `prepared-with-errors` | ✔ | `--allow-errors` was given and artifacts were written despite project errors; `artifacts_trustworthy` is `false`. |
| `blocked` | ✘ | Project errors exist and `--allow-errors` was not given. **Nothing was written** (`artifacts_written: false`). |

The result also carries `output`, `graph_svg`, `report`, `summary`, `diagnostics`, and a `quarto`
block reporting availability. `render_command` (`<quarto> render`) is suggested **only** when Quarto
is available. qmd-prover never runs Quarto itself; use ordinary `quarto render` for final HTML, PDF,
or other output, which the scaffolded `_quarto.yml` writes to `.qmd-prover/site/book`.

### Diagnostic codes

An uppercase diagnostic code is a stable value in the JSON `diagnostics[].code` field. It is
not a QMD class, attribute, status value, or instruction to edit a source file. Codes may also
appear in `--print` output and derived diagnostic or snapshot JSON; qmd-prover never inserts them
into mathematical QMD.

Every diagnostic carries `severity`, `code`, and `message`, plus `file`, `line`, `id`, and
`remediation` where they apply. A diagnostic with an `id` is attributed to that fact; a diagnostic
without one is attributed to its **file**, and therefore breaks every fact declared in that file.

#### Parse and structure

| Code | Severity | Meaning and response |
|---|---|---|
| `PARSE_ERROR` | error | Pandoc could not start or parse a file. The whole file body is abandoned, the compilation is incomplete, and **every fact in the project** is `broken` for that run. Fix the parser configuration or QMD syntax before interpreting anything else. |
| `INVALID_SEMANTIC_ID` | error | The div ID does not match the semantic ID pattern. Rename it. |
| `SEMANTIC_KIND_MISSING` | error | A result div carries no kind class. Add exactly one of `.definition`, `.lemma`, `.proposition`, `.theorem`, `.corollary`. |
| `SEMANTIC_KIND_MULTIPLE` | error | Two or more kind classes on one div. Keep one. |
| `ID_KIND_MISMATCH` | error | The ID prefix contradicts the kind class (e.g. `lem-` on a `.theorem`). Align the prefix with the kind. |
| `RESULT_NAME_MISSING` | error | `name` is absent or blank. Give the result a human-readable title. |
| `RESULT_DATE_MISSING` | error | No `date` attribute. Add the ISO introduction date. |
| `RESULT_DATE_INVALID` | error | `date` is not a real calendar date in ISO form. |
| `STATEMENT_MISSING` | error | The result body is empty. A declaration must state something. |
| `LEGACY_RESULT_SECTIONS` | error | The body uses retired `Statement`/`Uses`/`Proof` subheadings. Move the proof into its own linked `.proof` div and cite dependencies with `@id` inline. |

#### Identity and export

| Code | Severity | Meaning and response |
|---|---|---|
| `DUPLICATE_ID` | error | An explicit ID is declared more than once. Every project-relative declaration location is listed. Rename the conflicting declarations — **dependency analysis is blocked until you do.** |
| `DUPLICATE_EXPORT` | error | Two results export the same name. Rename one. |
| `EXPORT_ID_MISMATCH` | error | `export` names something other than the declaration's own ID. They must be identical. |

#### Main-goal protection

| Code | Severity | Meaning and response |
|---|---|---|
| `MAIN_GOAL_SHAPE` | error | An ID with the protected prefix does not carry both `.theorem` and `.goal`. Fix the classes. |
| `MAIN_STATEMENT_MUTATED` | error | A protected goal's statement differs from its locked baseline. **Restore the user's statement**; change it only with explicit user approval. |
| `MAIN_TITLE_MUTATED` | error | A protected goal's title differs from its locked baseline. Same response. |

#### Proofs

| Code | Severity | Meaning and response |
|---|---|---|
| `PROOF_TARGET_MISSING` | error | A `.proof` div has no `of=`. It is file-scoped, so it breaks every fact in the file until fixed. |
| `PROOF_TARGET_UNKNOWN` | error | `of=` names an ID that no result declares. |
| `PROOF_MULTIPLE` | error | Two live proofs target the same result. Keep one and mark the other `.abandon`. |
| `PROOF_DIFFERENT_FILE` | error | A proof sits in a different file from its result. Only a protected main goal may have its proof in an overlay file. |
| `PROOF_EMPTY` | **warning** | A `.proof` div has no content, so its fact is `open`. Write the proof, mark it `.draft` while unfinished, or delete the empty block. Not an error and never breaks the fact. |
| `RESULT_DISPROOF_FORBIDDEN` | error | `.disproof` is on a result body. Move it onto the linked `.proof` div. |
| `DEFINITION_DISPROOF_FORBIDDEN` | error | A definition's linked proof carries `.disproof`. Move the challenge to a linked theorem-like claim. |
| `ASSUMED_DRAFT` | error | The same div carries `.assumed` and `.draft`. A fact is taken as given or is unfinished, not both. Remove one mark. |
| `ASSUMED_DISPROOF` | error | The same div carries `.assumed` and `.disproof`. Assert an assumed result instead of an unargued refutation. Remove one mark. |
| `GOAL_ASSUMED` | error | A protected goal rests on `.assumed` facts while `verification.assumptions` is `forbid`. Prove the named facts, or set the policy to `allow`. |

#### References and scope

| Code | Severity | Meaning and response |
|---|---|---|
| `DEPENDENCY_UNKNOWN` | error | A cited `@ID` resolves to nothing. Fix the citation or declare the fact. |
| `DEPENDENCY_AMBIGUOUS` | error | A cited `@ID` resolves to more than one declaration. Disambiguate by renaming. |
| `DEPENDENCY_UNAVAILABLE` | error | The cited fact exists but is neither local to the citing file nor explicitly imported. Add the export/import pair or move the declaration. |
| `DEPENDENCY_CYCLE` | error | The fact participates in a dependency cycle. Every participant is `broken` and none is checked. Break the cycle. |

#### Imports

All import diagnostics are file-scoped and break every fact declared in the file.

| Code | Severity | Meaning and response |
|---|---|---|
| `IMPORT_METADATA_INVALID` | error | The `qmd-prover` front matter is not a mapping, `imports` is not a list, or an entry is not a mapping. |
| `IMPORT_FROM_MISSING` | error | An import entry has an empty `from`. |
| `IMPORT_USE_MISSING` | error | An import entry has no `use` list. |
| `IMPORT_FILE_MISSING` | error | `from` does not resolve to a known project file. Paths are relative to the importing file. |
| `IMPORT_ID_MISSING` | error | A used ID is not declared in the imported file. |
| `IMPORT_NOT_EXPORTED` | error | The ID exists there but the producer never set `export`. Add `export="<same-ID>"`. |
| `IMPORT_CYCLE` | error | Files import each other in a loop. |
| `WILDCARD_IMPORT` | error | `use: ['*']` while `semantic.wildcard-imports` is `false`. Import each ID by exact name, or enable wildcards in config. |

#### Verification and cache

| Code | Severity | Meaning and response |
|---|---|---|
| `AI_CHECK_REJECTED` | **warning** | The verifier rejected an ordinary proof. Read `repair_hints` and repair the argument. The fact is `rejected`. |
| `AI_DISPROOF_REJECTED` | **warning** | The verifier did not validate a proposed refutation. Repair the counterexample or remove `.disproof`. |
| `VERIFIER_FAILED` | error | The verifier CLI crashed, timed out, or returned an unusable report. Repair the backend; the local result stays unverified. |
| `AI_CHECK_FAILED` | error | Fallback for a verifier error carrying no more specific code. |
| `SOURCE_STALE` | error | Sources or verifier context changed while a check was running, or a block vanished mid-inspection. Fatal for the run: discard the result and reinspect the affected scope. |
| `CACHE_WRITE_FAILED` | error | The verification record could not be written. Fatal for the run; check disk permissions under `.qmd-prover/`. |

#### Command-level

| Code | Severity | Meaning and response |
|---|---|---|
| `FACT_UNKNOWN` | error | Parsing and indexing completed, but the requested ID was not found. Check the ID and project scope. |
| `PATH_NOT_FOUND` | error | The requested inspection path names no entry. |
| `PATH_OUTSIDE_PROJECT` | error | The requested path escapes the project root. |
| `PATH_TYPE_INVALID` | error | The path is neither a `.qmd` file nor a directory. |
| `SUBMISSION_NOT_FOUND` | error | No retained record has that submission ID. Run `verification list`. |
| `VERIFICATION_RECORD_INVALID` | error | A retained record could not be read while listing. |
| `DEPENDENCY_SNAPSHOT_FAILED` | error | The project snapshot could not be resolved and the underlying failure carried no code. |
| `CLI_ERROR` | error | A usage or runtime failure, reported in the `cli-error` envelope with exit 1. Read the message; nothing was computed. |

Other semantic-shape, import, proof, verifier, and cache codes are interpreted the same way: read the
diagnostic's message, source location, remediation, and repair hints. They describe why an operation
failed; they do not extend the QMD source language.

## Semantic QMD

Complete declaration/proof semantics apply to every project QMD file. A result uses a Quarto theorem
block with a `name` caption and a separate linked proof:

```markdown
::: {#lem-even-square .lemma name="Even squares" date="2026-07-13" export="lem-even-square"}
For every even integer (n), the integer (n^2) is divisible by (4).
:::

::: {.proof of="lem-even-square"}
By @def-even-integer, write (n=2k). Then (n^2=4k^2).
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

The producer must export the same ID. Semantic references inside the construction or linked proof are
the dependency declaration; there are no `Statement`, `Uses`, or `Proof` subheadings.

When the exact theorem-like statement is false, preserve the declaration and put the proposed
counterexample or refutation in its linked proof:

```markdown
::: {#lem-false-parity .lemma name="False parity claim" date="2026-07-13"}
Every integer is even.
:::

::: {.proof .disproof of="lem-false-parity"}
The integer (1) satisfies the stated domain hypothesis, but it is not divisible
by (2). Thus it is a counterexample to the universal conclusion.
:::
```

The `.disproof` attribute makes the proof a refutation and cannot be used on a definition. A
successful local check records conditional disproof evidence. It becomes `disproved` only after
global composition verifies every dependency; otherwise the node is blocked. A failed local check
records a rejected state. The verifier never edits the proof body, and it may return a disproved
outcome for an ordinary proof when it independently finds a counterexample.

Two further author attributes control whether a proof is checked at all. `.draft` says the proof is
deliberately unfinished: it is never sent to the verifier and the fact stays `open`, so an incomplete
argument costs nothing and is never reported as rejected. Remove the mark when the proof is ready.
`.abandon` on a proof div detaches that attempt from its result; on a result div it retires the whole
fact, which then resolves no references, contributes no dependency edges, and is never checked,
though it still owns its ID.

Inspection projects the local verdict into a display-only `status` attribute on the checked div —
`verified`, `disproved`, or `rejected` — which never affects checking. The complete state model is in
[status.md](status.md); the complete authoring rules are in [AGENTS.md](AGENTS.md).

## The verifier protocol

### Bundled backends

`verification.backend: claude` and `verification.backend: codex` run adapters shipped at
`scripts/verifiers/claude.js` and `scripts/verifiers/codex.js`. Each reads the packet on standard
input, drives the corresponding CLI (`claude -p … --output-format json`, i.e. the Claude Agent SDK
entry point; `codex exec …`, i.e. the Codex SDK entry point), extracts the verdict JSON, and prints
it — so no custom script is needed and no qmd-prover code changes to switch model or executable, only
configuration. The CLI must be installed and authenticated.

`verification.model` is forwarded as `--model` when it is a non-empty concrete id, and
`verification.effort` (`low`|`medium`|`high`|`xhigh`|`max`) is forwarded as the backend's
reasoning-effort control — `--effort` for claude, `-c model_reasoning_effort` for codex.

Each fresh check records its wall-clock duration and, when the backend reports token counts (codex
prints them on stderr; the claude envelope carries a `usage` object), its token usage. These appear
per fact as `local_verification.metrics` and are summed over fresh calls into the verification
summary's `verifier_duration_ms` and `verifier_tokens`; a cache hit contributes no work but still
surfaces the originally recorded cost, flagged `cached`.

The `command` backend and `QMD_PROVER_VERIFIER` remain available for a fully custom verifier that
speaks the protocol below. Precedence, highest first: `QMD_PROVER_VERIFIER` > the bundled adapter
selected by `backend` > `verification.command`.

### The packet

The verifier receives one JSON packet on standard input for one local conditional check:

| field | content |
|---|---|
| `schema_version` | The packet schema. |
| `checker_contract` | The eight hashed settings plus `protocol: {name, version}`. |
| `target` | `{id, kind, statement` or `construction, proof, identity: {statement_hash, proof_hash}, source: {file}, verification_mode}`. |
| `dependencies` | The exact statements of **only** the direct dependencies. Entries of kind `definition` are the semantic context and may be unfolded; every other entry is a fact to assume, not unfold. |
| `external_basis` | `{mode, content}` — `unrestricted`, `none`, or `declared` with its exact text. |
| `scope` | The selection context of the run. |

It deliberately **excludes** dependency proof text, dependency verification state, and the transitive
proof closure. `verification_mode` is `proof`, `definition-construction`, or `refutation`.

### The verdict

The verifier must return exactly this shape on standard output:

```json
{
  "verdict": "correct",
  "summary": "...",
  "refutation": "",
  "critical_errors": [],
  "gaps": [],
  "nonblocking_comments": [],
  "repair_hints": ""
}
```

`verdict` is `correct`, `incorrect`, or `disproved`. The mapping from report to recorded outcome is
in [status.md](status.md#how-a-verifier-report-becomes-a-verdict).

From that packet the check records a single **local, conditional** outcome: `verified`, `rejected`,
or `disproved`. It is local because the verifier assumes each direct dependency's statement exactly
as written — never inspecting how, or whether, that dependency was itself proved — and asks only
whether the submitted argument establishes the exact target from those assumed statements, the
semantic context, and the permitted external basis, and nothing else.

A submitted proof is `verified` when the verifier affirms it with no critical errors and no gaps that
the configured `rigor` treats as blocking, and `rejected` otherwise. A submitted refutation — a proof
carrying `.disproof` — is `disproved` when the verifier confirms it defeats the exact statement with
a nonempty, independently checkable `refutation` and no critical errors or blocking gaps (governed by
`rigor-disprove`), and `rejected` otherwise; the verifier may also return `disproved` for an ordinary
proof whose statement it independently finds false.

This is a conditional AI decision, not a global one: the inspector composes global state separately
over the machine dependency graph, and neither layer is formal verification or human review.

### Caching

Local decisions are cached by the target statement or construction, the submitted proof or
refutation, the exact direct dependency statements, the semantic context, the external basis, the
checker contract, and the protocol version. Dependency proof hashes and dependency verification
labels are **not** cache inputs.

Consequently, changing an upstream proof while leaving its statement alone reuses every downstream
local decision and only recomputes global status — that is the whole point of the local/global split.
Changing a direct dependency's **statement** invalidates the affected local decisions. Changing any
of the eight checker-contract keys re-verifies everything.

Set `QMD_PROVER_VERIFIER_DEBUG` to a directory to dump each check's exact prompt, raw model output,
and parsed verdict.

## Install the tool and skill from a source checkout

The engine and the skill install separately. Install the engine once per host as a `qmd-prover`
command on `PATH`, then place the docs-only skill globally (every project) or scoped to one project.

Install the engine (from a checkout of the repository):

```bash
npm install -g .   # builds, then puts the `qmd-prover` command on PATH, backed by this checkout
npm link           # equivalent — npm links a local folder either way
```

Neither form copies the project: npm symlinks a local folder into the global `node_modules`, so the
checkout must stay in place and `npm run build` must be rerun after editing `src/`. To get a
standalone compiled copy instead, install the packed tarball: `npm install -g "$(npm pack)"`.

Place the skill with the engine's own `install` command. Because `qmd-prover install` runs in your
current directory (unlike an `npm run` script, which always executes in this repository), a bare
install correctly targets the project you are in, and `--global`/`-g` targets the host home:

```bash
qmd-prover install                     # this project → ./.claude/skills/qmd-prover
qmd-prover install --global            # every project → ${CLAUDE_CONFIG_DIR:-~/.claude}/skills/qmd-prover
qmd-prover install --global --codex    # Codex, global → ${CODEX_HOME:-~/.codex}/skills/qmd-prover
qmd-prover install --dir <project>     # a named project instead of the current directory
```

The install copies the docs (`SKILL.md`, `references/`, `agents/`) into the chosen skills directory;
the executable is not bundled — it is the `qmd-prover` command itself. From a checkout without the
engine on `PATH`, the equivalent
`tsx tooling/install-skill.ts [--local|--global] [--codex|--claude] [--dir <project>]` performs the
same copy. Confirm the install with `qmd-prover version`.

A skill installed mid-session is not auto-registered by the host, which scans skills at session
start. Read the installed `SKILL.md` to drive qmd-prover immediately; start a new session for the
host to discover it automatically.

## Test

```bash
npm run typecheck
npm test
git diff --check
```

The suite uses an AST-producing Pandoc test adapter and fresh-process mock verifiers. Production
parsing never falls back to regular expressions. Tests also check contract/example synchronization,
stable JSON, CLI help, machine-only inspection, local checking despite upstream rejection and cycles,
deterministic global propagation, direct-statement cache boundaries, large-project topology,
duplicate-ID handling, parse-error fidelity, and statement-lock protection.

## Current boundary

This release implements machine dependency analysis, local conditional command/LLM review, and
deterministic global composition, not formal proof checking. It retains local decisions, global
states, and refutation evidence under `.qmd-prover/` for inspection and future paper tooling; it
never rewrites the project's mathematical QMD beyond the display-only `status` attribute. Production
AI-provider adapters, formal-verifier adapters, paper generation, and richer Quarto extensions remain
separate integrations.
