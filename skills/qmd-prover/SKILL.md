---
name: qmd-prover
description: Initialize and inspect semantic-QMD mathematical projects; formulate definitions and results from ideas; develop, locally AI-check, globally compose, repair, report, and render proofs across one unified project. Use when a user asks to initialize qmd-prover, state or prove one or more protected main goals, grow an existing mathematical development, inspect facts, paths, dependencies, or progress, audit staleness, review verifier findings, or render theorem navigation.
---

# qmd-prover

## Introduction

qmd-prover is two things: a **fixed way of writing mathematics**, and a **tool that checks the
writing follows it** and that each proof holds up.

The way of writing is simple. All mathematics lives in `.qmd` files. Every definition, lemma,
proposition, theorem, corollary, and proof sits in its own fenced block, and every proof names the
results it uses, right where it uses them:

```markdown
::: {#def-even .definition name="Even number" date="2026-07-13"}
An integer $n$ is **even** when $n = 2k$ for some integer $k$.
:::

::: {#thm-sum-even .theorem name="Sum of two even numbers" date="2026-07-13"}
If $a$ and $b$ are even, then $a + b$ is even.
:::

::: {.proof of="thm-sum-even"}
By @def-even, write $a = 2k$ and $b = 2m$. Then $a + b = 2(k + m)$, which is even by @def-even.
:::
```

The rules that make this checkable:

- **One block per fact.** A `:::`-fenced div with exactly one kind class (`.definition`, `.lemma`,
  `.proposition`, `.theorem`, `.corollary`), a nonempty `name`, an ISO `date`, and a nonempty body.
- **The ID prefix matches the kind**: `def-`, `lem-`, `prp-`, `thm-`, `cor-`. Every explicit ID is
  unique across the whole project.
- **The proof is a separate block** with no ID of its own, linked by `of="<result-id>"` — a result
  and its proof share one identity, the result's `@id`. A statement and its proof are never mixed.
- **Every dependency is cited as `@id` at its point of use** — including the definition of any
  non-standard term at its first load-bearing use. That citation is the dependency; there is no
  separate "Uses" list.
- **Across files, cite *and* import.**
  An `@id` citation is a dependency but does not grant cross-file scope. The producer sets
  `export="<same-ID>"`, and the consumer imports that exact ID in its front matter.
- **Protected main goals.** IDs beginning `thm-main-` carry `.theorem .goal`, and their statement and
  title are locked. Never edit one.
- **Workflow state lives in div attributes, never in prose.** `.disproof` (this proof refutes the
  statement), `.draft` (deliberately unfinished, never checked), `.abandon` (kept for memory only).
  There are no body markers: `OPEN`, `VERIFIED`, `REJECTED`, and `DISPROVED` are ordinary words with
  no meaning in QMD source.

Because the writing is fixed, the work can be checked in two layers:

- **Mechanical checks (no AI).** A plain program reads the blocks and the `@id` citations and
  confirms the wiring: unique IDs, well-formed declarations, every proof linked to a real statement,
  every citation resolving to something in scope, no cycles. This says nothing about whether the
  mathematics is right.
- **The independent verifier (AI).** A separate AI reads one proof at a time and answers one
  question: assuming exactly the statements this proof cites, does the argument establish exactly
  this statement? It never sees how those cited results were proved.

Neither layer is formal verification, proof checking, or human review. The verifier is optional;
without one, everything still gets the mechanical checks and every proof stays `unverified`.

**Work like a programmer.** Inspection is the debugger. Write a coherent piece, inspect it, repair
what it flags, then build on it — rather than writing a whole development and checking at the end. A
coherent piece may be one lemma or a large batch; size it to the argument.

The complete authoring rules are the project contract in [references/AGENTS.md](references/AGENTS.md),
which is also copied into the project's own root `AGENTS.md`. Read both before writing mathematics.

## Where the documentation lives

This file is the working manual: the outline of every command, one worked example each, and the full
list of what each accepts. When that is not enough, go to the references — they cover every case.

| File | Covers |
|---|---|
| `SKILL.md` (this file) | How to work: setup, the checking loop, what each command is for. |
| [references/AGENTS.md](references/AGENTS.md) | The project contract: every declaration, proof, import, export, and conduct rule. Must match the project's own `AGENTS.md`. |
| [references/cli.md](references/cli.md) | Every command, argument, option, output field, exit code, diagnostic code, and the verifier packet protocol. |
| [references/config.md](references/config.md) | Every `.qmd-prover/config.yml` setting, every environment variable, the state-directory layout, and the external-basis file. |
| [references/status.md](references/status.md) | The complete status model: four fields, every value, every reason, every set, worked cases. |

## Running the tool

Every command runs the `qmd-prover` engine, installed once on the host's `PATH`. This skill supplies
the instructions; the engine is a separate command. Invoke it from the project root:

```bash
qmd-prover <command> [arguments]
```

If `qmd-prover` is not found, the engine is not installed yet. Install it once per host, and it is
then available in every project:

```bash
# From a checkout of github.com/powergiant/qmd-prover:
npm install -g .        # puts the `qmd-prover` command on PATH, backed by this checkout
npm link                # equivalent — npm links a local folder either way
```

Both forms symlink the checkout rather than copying it, so the folder must stay where it is, and
`npm run build` must be rerun after editing `src/`. For a standalone copy that does not depend on
the checkout, install the packed tarball instead: `npm install -g "$(npm pack)"`.

Installing the skill is a separate, docs-only step. Once the command is on your `PATH` you never
reinstall the engine — `qmd-prover install --global` only **copies the skill documentation**
(`SKILL.md`, `references/`, `agents/`) into `~/.claude/skills/qmd-prover`, so running it again just
refreshes the docs. Add `--codex` for Codex; a bare `qmd-prover install` scopes the copy to the
current project. A skill installed mid-session is not auto-registered by the host — read the printed
`SKILL.md` path to use qmd-prover now, and start a new session for automatic discovery.

`qmd-prover version` confirms the install and prints the tool, schema, verifier-protocol, and
contract versions. `qmd-prover doctor` additionally reports version drift against the current
project.

Complete leaf-command map. Two flags recur in it:

- **`--print`** swaps the JSON for a concise human-readable report. It changes presentation only —
  same selection, same decisions, same diagnostics — so use it when you want to read the result
  yourself, and the default JSON when you need to act on specific fields.
- **`--graph`** adds the full dependency graph (nodes, edges, cycles) inline in the JSON, which is
  otherwise left out because it is large.

```text
version
doctor [--print]
install [--global|-g] [--codex|--claude] [--dir PROJECT]
init [--adopt-existing|--append-contract|--sync-contract]
inspect project [--print] [--graph]
inspect fact @ID [--print] [--graph]
inspect path FILE_OR_FOLDER [--print] [--graph]
dependency dependencies @ID [--print]
dependency reverse dependencies @ID [--print]
dependency impact @ID [--print]
dependency frontier @ID [--print]
dependency path @FROM @TO [--print]
dependency alternative paths @FROM @TO [--limit N] [--max-depth N] [--print]
dependency cycles [--print]
dependency findings [--print]
dependency unused imports [--print]
dependency unused exports [--print]
dependency isolated [--print]
dependency unreachable [--print]
dependency ready [--print]
dependency reused [--limit N] [--print]
dependency search [QUERY] [--kind KIND] [--status STATUS] [--set SET] [--origin ORIGIN] [--path PATH] [graph filters] [--print]
check staleness [--print]
verification list
verification show SUBMISSION_ID
render [--allow-errors]
```

Conventions that hold everywhere:

- JSON is the default output. Only the commands marked `[--print]` above accept that flag; `version`,
  `install`, `init`, `verification list`, `verification show`, and `render` emit JSON only. `--graph`
  is accepted only by the three `inspect` commands.
- The JSON is lean: every fact appears as `{id, kind, status, file, line}`, and listings carry
  counts. Drill into `inspect fact @ID` for per-fact detail, or pass `--graph` for the whole
  dependency graph (which is also always written to `.qmd-prover/graph.json`).
- A dependency query returns only its own answer — target, dependencies, path, matches — never the
  whole graph.
- Semantic IDs accept either `@ID` or bare `ID`; output normalizes them to `@ID`.
- `ok` reports only that the operation ran without infrastructure errors. It is never a mathematical
  claim. Read `global_verification.status`.
- Exit 1 is a usage error; exit 2 is a valid result with `ok: false`.
- `qmd-prover help COMMAND...` prints exact usage for any command.

Translate this JSON into ordinary language for the user. Do not make them memorize commands.

### Version compatibility

The engine and each project carry versions independently: the installed `qmd-prover` implements a
schema, verifier-protocol, and contract version, while a project's `.qmd-prover/` state and its
`AGENTS.md` contract block were written by whatever engine last touched them. When they differ, the
tool prints a `qmd-prover: warning:` line to stderr before running a project command, and
`qmd-prover doctor` lists the same under a `compatibility` array. These are advisory — the command
still runs; the tool never refuses on a version mismatch. Relay a warning to the user and resolve it:

- **schema** — a stale snapshot; it is ignored and rebuilt on the next `qmd-prover inspect project`.
- **verifier-protocol** — affected cached proof decisions are re-verified on the next inspection.
- **contract** — the project's `AGENTS.md` managed block predates the engine's; review the difference
  and, only with user approval, run `qmd-prover init --sync-contract`.

## Basic project structure

A qmd-prover project is one folder. Everything in it is one unified dependency graph.

```text
my-project/
  AGENTS.md              the project contract (managed block) + local project rules
  _quarto.yml            the book layout: chapter list and render output directory
  index.qmd              the book landing page
  completeness.md        the user's rough note, if any
  completeness.qmd       the user's protected main goal(s)
  workspace/             agent-created mathematics, by convention
    foundations.qmd
    semantics.qmd
    henkin.qmd
    main-proof.qmd       the linked proof of the main goal
  .qmd-prover/           tool state: config.yml, .external.qmd, caches, graph, snapshots
```

What matters about this layout:

- **Every QMD file in the project is semantic mathematics**, wherever it sits. Folders are
  organization for humans, never a semantic boundary. Imports and citations work identically across
  any layout.
- **New agent work goes under a `workspace/` folder** in the project root by convention: definitions,
  intermediate results, proof attempts, calculations, examples, counterexamples, and progress notes.
  Organize it by theme, by goal, or flat, as the argument demands, and follow any folder rules in
  local project policy.
- **Protected main goals stay in the user's file.** qmd-prover registers and protects
  `thm-main-* .theorem .goal` blocks wherever they appear; their statements are locked and must never
  be edited. Put the goal's linked proof in an overlay file such as `workspace/main-proof.qmd`
  without repeating the protected theorem. A goal with no proof yet is simply `open` — proving it
  needs no setup step.
- **Edit pre-existing user files cautiously**, and only as the developing mathematics requires.
- **`.qmd-prover/` is tool state.** Three files in it are authored inputs you may edit —
  `config.yml`, `.external.qmd`, `statement-locks.json`; everything else is regenerated.

The complete rules for declarations, proofs, imports, exports, and conduct are in
[references/AGENTS.md](references/AGENTS.md). Two that are easy to get wrong:

- Any fact may cite any other project fact, including a protected main goal, subject to import scope.
  Global composition keeps dependents blocked until the cited fact is globally verified.
- Never copy a proof, a refutation, or the engine-written `status` attribute into a protected
  statement.

## Project setup

Two commands set a project up. **`doctor`** is read-only and answers "is the environment usable?" —
it checks Node, Pandoc, the optional verifier, and optional Quarto, reports the exact path resolved
for each, and reports version drift. **`init`** answers "is this project a qmd-prover project?" — it
inventories what already exists and writes the canonical contract block into the root `AGENTS.md`.
`init` never creates a theorem and never edits mathematics.

Run `doctor` first whenever tool availability is uncertain:

```bash
qmd-prover doctor --print
```

Then initialize from the project root:

```bash
qmd-prover init
```

Read the returned `existing` inventory and act on the `status`:

| `status` | What it means | What to do |
|---|---|---|
| `created` | Nothing existed; the contract was written. | Continue. |
| `adopted` / `appended` / `synchronized` | A mutation flag you were authorized to use succeeded. | Continue. |
| `already-initialized` | The canonical block is already present. | Setup is current; continue with the user's task. |
| `intent-required` | Project material exists but `AGENTS.md` is missing or empty. Nothing was written. | Summarize the detected `AGENTS.md`, QMD files, Quarto config, `.qmd-prover` state, and external-policy mode, then ask whether to adopt in place, inspect first, or leave unchanged. Run `init --adopt-existing` only after the user chooses adoption. |
| `append-required` | `AGENTS.md` exists without the contract. Nothing was written. | Explain that existing policy will be preserved, then ask before `init --append-contract`. |
| `sync-required` | A different contract version is present. | Report the current and canonical versions, then ask before `init --sync-contract`. |
| `malformed-contract` | Duplicate or unbalanced contract markers. | No flag fixes this; repair `AGENTS.md` by hand. |

Stop and ask before creating, appending, or synchronizing project policy. Never use a mutation flag
without explicit approval. No QMD scaffold or initial theorem is required.

Every outcome that writes also scaffolds `.qmd-prover/` and, when the project has no Quarto
configuration at all, a `_quarto.yml` rendering the project as a book into `.qmd-prover/site/book`.
`quarto_config.status` reports `created` or `preserved`; an existing Quarto configuration is never
touched or merged. The chapter list in that file is the project's to maintain — see
[Rendering](#rendering).

### Environment and verifier setup

Configure anything `doctor` reports missing through `.qmd-prover/config.yml` (or environment
variables) — you never edit qmd-prover's own code. Every setting is documented in
[references/config.md](references/config.md).

**Pandoc (required) and Quarto (optional, only for final render).** Record any path the tool cannot
find on `PATH`:

```yaml
tools:
  pandoc: /absolute/path/to/pandoc
  quarto: /absolute/path/to/quarto
```

`QMD_PROVER_PANDOC` and `QMD_PROVER_QUARTO` also work and take precedence. Leave a value blank to
fall back to `PATH`.

**Decide the verifier up front.** As an early step, decide whether proofs will be independently
checked, and set a backend *before* your first inspection:

```yaml
verification:
  backend: claude        # or: codex
  executable: ""         # path to the claude/codex CLI; blank uses PATH
  model: ""              # "" lets the CLI use its own default model
  effort: high           # low | medium | high | xhigh | max
```

qmd-prover ships the `claude` and `codex` adapters, so no external verifier script is needed. The
selected CLI must be installed and authenticated. Re-run `doctor` until the verifier reads
`available`, then `inspect` calls it automatically. For a bespoke verifier, set `backend: command`
with a `verification.command` argv, or point `QMD_PROVER_VERIFIER` at an executable that speaks the
protocol in [references/cli.md](references/cli.md).

Leaving `backend: none` is a deliberate machine-only choice: local checks stay `not-run` and every
fact stays `unverified`. It is supported, but it is not a default to drift into, and it is never work
you may call verified. Only a configured, available verifier produces verification state. Never
declare your own work verified.

Each check costs real time and tokens, and higher `effort` costs more. Changing any of `backend`,
`model`, `effort`, `fresh-context`, `citations`, `rigor`, `rigor-disprove`, or `tools` re-keys the
cache and re-verifies **every** fact, so switch deliberately rather than per run.

### Project contract preflight

Before drafting mathematics, changing qmd-prover state, or relying on a project fact:

1. Read the project's root `AGENTS.md` and this skill's
   [canonical project contract](references/AGENTS.md).
2. Compare the `qmd-prover-contract` managed blocks byte-for-byte. Require the project block to be
   present at the same version and unchanged. Obey project-specific rules outside it.
3. Read `.qmd-prover/.external.qmd` when present. Absence permits external results subject to precise
   hypothesis checks; whitespace-only permits none; nonempty content permits only what it states.
4. If policy is missing, different, malformed, or conflicting, stop before mutation and ask whether
   the user wants to create or synchronize it. Never change project policy without approval.
5. Reuse a successful comparison only for the same unchanged agent/project context: the project,
   branch or worktree, contract, and external policy must all remain current. Every independent agent
   performs its own preflight.

## Checking your work: `inspect`

`inspect` is the debugger. It compiles the project into one graph, runs the mechanical checks, sends
whatever is ready to the verifier, composes the global result, and publishes a snapshot. Run it after
each coherent semantic-QMD edit, using the narrowest scope that covers what you changed:

```bash
qmd-prover inspect fact @lem-henkin-witness   # one fact and its transitive dependency closure
qmd-prover inspect path workspace/henkin.qmd  # every fact declared under a file or folder
qmd-prover inspect project                    # every fact in the project
```

| Scope | Checks | Use it for |
|---|---|---|
| `inspect fact @ID` | The named fact plus its transitive local dependencies. Reverse dependencies and unrelated facts are not checked. Returns the full per-fact detail, including the verifier report, dependency lists, blockers, and past verdicts. | Iterating on one result. |
| `inspect path FILE_OR_FOLDER` | Every fact declared under that file or folder, plus their transitive dependencies. | Iterating on one part of the argument. |
| `inspect project` | Every fact. Returns the dashboard: summary, goals, one status row per fact, blockers, finding counts, verification totals, diagnostics. | Deliberate whole-project audits. |

Both narrow scopes leave every ready fact outside their closure `unverified` with reason
`out-of-scope` — that is not a problem, just an unchecked fact. Add `--print` for a human report,
`--graph` to include the dependency graph inline.

**Scope is also the cost control.** Every fresh check is a real model call. Unchanged facts are
served from cache, so re-inspecting is cheap, but a first `inspect project` over a large development
checks everything at once. Prefer `inspect fact` and `inspect path` while iterating, and save
`inspect project` for audits.

Do not impose a fixed proof loop. A request may concern one theorem, a family of results, an existing
development, or an idea that first needs precise formulation. Decide which definitions, lemmas,
propositions, theorems, examples, or counterexamples to develop and in what order.

### Read all three layers

Each fact reports three independent fields, plus the author's declared `intent`. Passing one does not
imply passing another:

- **`mechanical`** — machine structure only: shape, IDs, dates, imports, references, cycles,
  statement locks. Never consults an AI verdict. Spelled `pass`/`fail` in an inspection's check
  result and `ok`/`broken` as a graph-node state; they mean the same thing.
- **`local_verification`** — the conditional check of the submitted proof or refutation against its
  direct dependency *statements*, assumed true, their own proofs never inspected. Values: `verified`,
  `disproved`, `rejected`, `not-run`. A `not-run` result always carries a reason:
  `nothing-to-check`, `draft`, `not-eligible`, `out-of-scope`, `no-backend`, or `verifier-error`.
- **`global_verification`** — composes the whole upstream closure into the final answer. Its
  `blockers` name the dependencies that are not yet verified.

The single `status` shown in every list is the `global` one.

### Every status a fact can carry

Every fact holds exactly one, first match wins:

| `status` | Holds when | What to do |
|---|---|---|
| `abandoned` | the fact carries `.abandon` | nothing; it is kept for memory only |
| `broken` | the mechanical layer failed: a shape/date/ID error, an unresolved or out-of-scope reference, or a dependency cycle | repair the fact |
| `open` | nothing to check: no proof block, an empty one, or a `.draft` proof | write the proof, or drop `.draft` |
| `rejected` | the verifier found the proof or refutation wrong or incomplete | repair the argument, using `repair_hints` |
| `unverified` | the proof is ready but has no verdict: no verifier configured, the verifier failed, or the fact was outside the checked selection | run inspection, or repair the verifier |
| `blocked` | this proof was accepted, but some dependency is not globally verified (see its `blockers`) | fix the upstream fact |
| `verified` | the proof was accepted and the whole dependency closure is globally verified | nothing |
| `disproved` | a refutation was accepted and the whole dependency closure is globally verified | nothing |

`missing` also appears in list output, for an `@ID` that is cited but never declared. It is not a
fact state; every fact citing one is `broken`.

Only the AI verifier produces `verified`, `disproved`, and `rejected`. The mechanical layer can
withhold a verdict but never grants one. Rule order matters: an accepted refutation resting on an
unproved lemma is `blocked`, not `disproved`, and citing an `abandoned` fact blocks the citer,
because an abandoned proof is not a premise.

A **definition** is discharged by its own body rather than a proof block, so it is never `open` for
want of a proof, and it cannot be `disproved`. Challenge a definition through a theorem-like claim
about it.

Four further groupings cut across `status` and overlap each other, so they are selected with `--set`
rather than `--status`: `candidate` (everything not abandoned), `disproof-candidate` (intent is
`disproof`), `ready` (eligible to be sent to the verifier), and `unbroken` (mechanically well
formed). `--set ready` is the query for "what can the AI work on now".

Every value, every `not-run` reason, the exact composition rules, and a worked-case table are in
[references/status.md](references/status.md).

### Acting on what inspection returns

- **Repair every mechanical diagnostic first.** A parse error anywhere marks the whole project
  broken; a file-scoped error (bad import, missing proof target) breaks every fact in that file. Fix
  the file-level problem and most fact-level noise clears with it.
- **Repair every critical error and blocking gap the local verifier reports.** Read
  `repair_hints`.
- **Follow every unproved dependency** instead of treating it as established. A plan, example,
  computation, or prose sketch is not a completed proof. Decompose a long proof into lemmas.
- **Use a fact as a premise only when its global status is `verified`.** A local pass is not enough;
  a globally `disproved` fact is evidence about a false statement, not a usable dependency.
- **A rejected lemma does not make its theorem open.** Local checks are independent: the theorem's own
  proof may still be locally accepted, and it lands `blocked` until the lemma is repaired.
- **Cached decisions are keyed on statements, not proofs.** Changing an upstream proof while leaving
  its statement alone recomputes global status without re-running downstream checks. Changing a
  dependency's statement does re-verify.

Do not describe informal AI review as formal verification, proof checking, or permission to weaken a
protected statement.

## Exploring the graph: `dependency`

Every `@id` citation is an edge, so the project is a graph: edges point from a citing fact down to
the fact it cites. `dependency` queries that graph without re-running the verifier. Every command
returns compact fact references and the snapshot it used. A duplicate explicit ID or a parse error
blocks all of them until it is repaired.

**Inspect before you trust these statuses.** A dependency query reuses the published snapshot, and
when none matches it builds one from the compilation alone — which has no verdicts in it, so every
fact reads `open`, `unverified`, `broken`, or `abandoned` and nothing reads `verified`. Run
`inspect project` first when the answer depends on verification state.

**Relationships** — what rests on what:

```bash
qmd-prover dependency dependencies @thm-completeness          # what it rests on (direct + transitive)
qmd-prover dependency reverse dependencies @def-model         # what rests on it
qmd-prover dependency impact @def-model                       # blast radius if it changes
qmd-prover dependency frontier @thm-main-godel-completeness   # the lowest unverified facts under a goal
```

`frontier` is the one to reach for most: it answers "where does work actually have to happen",
filtering out everything already blocked by something lower, and gives the path from the goal down to
each blocker.

**Routes** — how one fact reaches another:

```bash
qmd-prover dependency path @thm-main-goal @def-even
qmd-prover dependency alternative paths @FROM @TO --limit 10 --max-depth 20
qmd-prover dependency cycles
```

`path` returns the shortest route, or `null` when there is none. `alternative paths` enumerates
bounded simple paths (`--limit` 1–25, default 5; `--max-depth` 1–100) and reports `truncated` when it
hit a bound. `cycles` lists every dependency cycle — every participant is `broken` and none is
checked, so cycles must be cut.

**Hygiene and progress** — whole-project questions:

```bash
qmd-prover dependency findings          # every category below, with counts
qmd-prover dependency ready             # the work list: ready to check, no verdict yet
qmd-prover dependency reused --limit 10 # what most of the project rests on
qmd-prover dependency isolated          # facts with no edges in either direction
qmd-prover dependency unreachable       # facts outside every main-goal closure
qmd-prover dependency unused imports    # imported but never cited
qmd-prover dependency unused exports    # exported but never imported
```

`findings` returns all of these as counts plus lists; the individual commands return one category in
full. `ready` is the answer to "what can I check now"; `reused` tells you what deserves the most
care.

### `dependency search`

One search command answers most "which facts are…" questions. Every filter is optional and they
combine with **AND**; the query itself is optional too, so filters can be used on their own.

A worked example — every proposed refutation in the project:

```bash
qmd-prover dependency search --set disproof-candidate
```

That reads as: match every fact (no query), keep those whose author intent is `disproof`. The result
gives `count` and one `{id, kind, status, file, line}` per match.

The complete set of possibilities:

| Filter | Values |
|---|---|
| `QUERY` | Optional case-insensitive substring, matched against ID, title, file path, statement text, and proof text. Omit it to match everything. |
| `--kind` | `definition` · `lemma` · `theorem` · `proposition` · `corollary` · `unknown` |
| `--status` | `open` · `unverified` · `rejected` · `blocked` · `broken` · `abandoned` · `verified` · `disproved` · `missing` |
| `--set` | `candidate` · `disproof-candidate` · `ready` · `unbroken` |
| `--origin` | `fact` · `main-goal` · `unresolved` |
| `--path` | One file path, or a directory prefix. |
| `--used-by @ID` | Facts `@ID` depends on. |
| `--depends-on @ID` | Facts that depend on `@ID`. |
| `--affected-by @ID` | Dependents of `@ID` (same computation, named for impact work). |
| `--related-to @ID` | Dependencies of `@ID`; add `--reverse` for dependents. |
| `--frontier-of @ID` | Facts on `@ID`'s unresolved proof frontier. |
| `--direct` | Restrict the relationship filters to one edge instead of the whole closure. |
| `--cycle-participant` | Keep only facts inside a dependency cycle. |

More examples:

```bash
qmd-prover dependency search --set ready                            # everything checkable now
qmd-prover dependency search --status rejected                      # everything the verifier turned down
qmd-prover dependency search --status open --used-by @thm-main-x    # unproved facts under one goal
qmd-prover dependency search compact --kind definition              # definitions mentioning "compact"
qmd-prover dependency search --depends-on @lem-key --direct         # immediate users of a lemma
```

Exact semantics for every filter, and the failure behavior of each command, are in
[references/cli.md](references/cli.md).

## Auditing caches and reading verdicts

```bash
qmd-prover check staleness            # which cached verdicts no longer apply, and why
qmd-prover verification list          # discover retained submission IDs
qmd-prover verification show SUB_ID   # read one full record: packet, report, outcome
```

`check staleness` is a read-only audit of the verification caches against current sources, the
external basis, and the checker contract. It reports and never edits QMD. Its reasons are
`source-changed`, `dependency-context-changed`, `external-basis-changed`,
`checker-contract-changed`, and `cache-invalid`.

Exact local decisions are cached by the target statement, the submitted proof or refutation, the
direct dependency statements, the semantic context, the external basis, the checker contract, and the
protocol. Dependency proof text and verification state are excluded — which is why changing only an
upstream proof triggers global recomposition rather than downstream AI calls.

Use `verification list` and `verification show` when you need to see exactly what the verifier was
sent and what it answered.

## Rendering

```bash
qmd-prover render [--allow-errors]
```

`render` prepares generated proof-status QMD, a report JSON, and a dependency-graph SVG from the
project's semantic mathematics, under `.qmd-prover/generated/`. Project errors block it and nothing
is written unless `--allow-errors` is explicit — and artifacts written that way are flagged
`artifacts_trustworthy: false`. qmd-prover never runs Quarto itself; use ordinary `quarto render` for
final HTML, PDF, or other output, and only when Quarto is available.

The `_quarto.yml` that `init` scaffolds renders the project as a Quarto book into
`.qmd-prover/site/book`. Keep that layout: a book is the only Quarto layout in which result numbering
runs across the whole project and an `@id` reference resolves to a declaration in another file.
Rendered as separate documents instead, every file numbers from 1 and every cross-file reference
renders as a question mark. qmd-prover never rewrites that file, so maintain `book.chapters`
yourself: add each QMD file you create, in reading order, remove the entry when you delete the file,
and keep `index.qmd` first as the book landing page. A file missing from the list is still compiled
and checked; it is only absent from the rendered book.

Write inline mathematics as `$…$` and display mathematics as `$$…$$` on their own lines. The
compiler also accepts `\(…\)` and `\[…\]`, so such formulas pass every check, but Quarto does not
read single-backslash delimiters and renders them as literal parentheses or brackets.

## Reporting to the user

- Say what is `verified`, what is `open`, what is `blocked`, and what is `rejected`, in plain words.
- Report a result as established only when its global status is `verified`; report a refutation as
  established only when it is `disproved`.
- Never present machine-only mode (`backend: none`) as verified work, and never declare your own
  proof verified.
- Never call AI review formal verification or human review.
- Relay version-drift warnings and ask before synchronizing the contract.
- Never edit a protected user statement; never treat a merely local, stale, blocked, or unverified
  claim as established.
