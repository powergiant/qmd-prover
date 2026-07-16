# qmd-prover design

## Purpose

qmd-prover is a skill and tool set for disciplined mathematical proof
development in Quarto Markdown. It describes the discipline an agent must
follow, provides tools for checking that discipline and discovering logical
dependencies, helps the agent construct and independently verify proof
candidates, and makes proof progress observable through ordinary Quarto
rendering.

A user asks Codex, Claude Code, or another compatible coding agent to use the
skill. The host follows project policy, writes semantic mathematical QMD, reads structured
diagnostics and verifier reports, and explains results in natural language.

`AGENTS.md` supplies the agent-facing contract; it does not establish
compliance by itself. The compiler turns Pandoc JSON into facts, dependency
edges, and machine diagnostics. An optional external verifier supplies a local
conditional mathematical judgment. The inspector composes those independent
products into global verification state.

The design is project-centric. Every QMD file in any project folder is full
semantic mathematics, compiled in one pass into one dependency graph with one
ID namespace. Folders are organizational only, never a semantic boundary. By
convention, agents place new proof QMD under a plain `workspace/` folder in
the project root; the tooling attaches no meaning to that location.
qmd-prover never promotes proof text or status markers into QMD sources.

## Components

The maintainable TypeScript runtime and dependency direction are documented in
[Runtime architecture](architecture.md).

The project has four components:

1. [Discipline](design-discipline.md) defines the rules for mathematical QMD
   and for agents working on it, including protected main goals, project-wide
   semantic QMD, global identity, external basis, and agent conduct.
2. [Inspector](design-inspector.md) builds the project index, checks facts,
   paths, and the whole project, runs optional local AI checks, composes
   global status, and exposes dependency analysis and read-only staleness.
3. [Proving utilities](design-proving.md) protect the goal context, create
   bounded direct-dependency verifier packets, retain exact local decisions,
   and publish local and globally composed evidence safely.
4. [Rendering](design-rendering.md) uses Quarto to present the QMD project and
   any generated observability material.

The skill ties these components together. Node is an execution mechanism for
the utilities, not a separately designed user-facing CLI. A person may run a
script with `node`, but the normal interaction is to ask Codex or Claude Code
in natural language.

## System boundary

```text
user
  |
  v
Codex / Claude Code                                (outside qmd-prover)
  |
  | loads skill and project policy
  v
+-------------------------------------------------------+
| qmd-prover skill                                      |
|                                                       |
| discipline                                            |
|  + inspector (machine graph + local AI + composition) |
|  + project semantic QMD                               |
|                  |                                    |
|                  +------> proving utilities           |
|                                 | retained evidence   |
|                                 v                     |
|                         derived tool state            |
+-------------------------------------------------------+
                                  |
                                  v
                              Quarto render        (outside qmd-prover)
```

Codex or Claude Code is not a qmd-prover component. It decides how to reason,
how long to continue, and whether to use host-provided sub-agents. Every such
agent must load the skill and project contract for itself.

Quarto is also outside qmd-prover. It renders the project QMD and any
generated observability inputs. A successful render does not
establish proof correctness.

The optional verifier is an external boundary process. qmd-prover owns the
packet contract, cache identity, freshness checks, and interpretation of the
structured result, not the verifier's implementation. Its verdict answers one
conditional question only: assuming the supplied direct dependency
conclusions, does the submitted proof establish this fact? It does not certify
those dependencies. qmd-prover computes whole-proof status separately.

## Mathematical project model

A managed project has three different kinds of mathematical material:

1. **Project QMD** is every QMD file outside `.qmd-prover/`. All of it is full
   semantic mathematics, compiled in one pass into one dependency graph with
   one ID namespace. Folders organize files; they never form a semantic
   boundary.
2. **Protected main goals** are the `thm-main-* .theorem .goal` blocks. Their
   IDs, captions, classes, hypotheses, quantifiers, and statements are locked,
   and they anchor unreachable and frontier analyses.
3. **Agent proof QMD** is placed, by contract-text convention only, under a
   plain `workspace/` folder in the project root. Its internal organization is
   free-form, and the tooling attaches no meaning to the location.

The distinction is about ownership and protection, not verification scope or
authorship. Any file can be written by a person or an agent at the user's
request; every file receives the complete machine-enforced semantic contract,
and only protected main goals additionally carry locks.

Verified mathematics and independently confirmed refutations are
persistent project state. They remain available for later inspection,
dependency analysis, resuming proof work, and future paper tooling. They
never acquire a verifier-authored source
marker.

Derived state under `.qmd-prover/` includes:

- statement locks for protected main goals;
- content-addressed exact verifier decisions and retained failure reports;
- the published project manifest, graph, and diagnostics;
- immutable hashed graph snapshots with a `latest.json` pointer; and
- generated Quarto observability inputs.

`.qmd-prover/` holds derived tool state only and is excluded from source
discovery. `VERIFIED` and `REVOKED` source markers are recognized nowhere:
writing either marker in any file is the structural error
`PROTECTED_MARKER_FORBIDDEN`.

### Example: one theorem after prolonged work

Suppose a user note contains `@thm-main-uniform-index`:

```text
uniform-index-project/
├── AGENTS.md
├── _quarto.yml
├── index.qmd
├── notation.qmd
├── background.qmd
├── uniform-index.qmd                      # protected main goal, statement locked
├── workspace/                             # conventional agent proof folder
│   ├── progress.qmd                       # maintained route and frontier
│   ├── reductions/
│   │   ├── reduce-to-strata.qmd
│   │   ├── generic-fiber.qmd
│   │   └── specialization.qmd
│   ├── local-theory/
│   │   ├── local-class-groups.qmd
│   │   ├── exponent-bounds.qmd
│   │   └── completion-comparison.qmd
│   ├── global-theory/
│   │   ├── finite-stratification.qmd
│   │   ├── constructibility.qmd
│   │   └── lcm-argument.qmd
│   ├── examples/
│   │   ├── quotient-singularities.qmd
│   │   └── possible-counterexamples.qmd
│   └── main-proof.qmd                     # proof overlay only
└── .qmd-prover/
    ├── config.yml
    ├── statement-locks.json
    ├── manifest.json                      # published schema-v6 manifest
    ├── graph.json                         # published project graph
    ├── diagnostics.json
    ├── graphs/
    │   ├── latest.json
    │   └── <sha>.json                     # immutable hashed snapshots
    ├── verification/
    │   ├── checks/                        # content-addressed exact decisions
    │   └── failures/                      # retained failure reports
    ├── generated/
    │   ├── proof-status.qmd
    │   └── dependencies.svg
    ├── reports/
    └── cache/
```

This is an illustrative layout, not a required directory taxonomy. A short
proof may use one subject file plus `main-proof.qmd`. A large proof may grow
into a substantial development. The `workspace/` folder itself is a soft
contract convention; the tooling never treats it as a boundary.

The protected statement is locked through `statement-locks.json`, so the goal
needs no per-goal setup. `progress.qmd` is strategic prose maintained by the
agent or user; it compiles like any other QMD file and is never overwritten by
inspection.

The subject files contain ordinary semantic QMD. A declaration normally stays
beside its linked proof. Attempts and counterexamples need no special file
type. `OPEN` and `REJECTED` distinguish incomplete and inactive proof blocks.
`DISPROVED` begins a proposed counterexample or refutation in a theorem-like
linked proof; it remains a candidate until independently checked.

### Project dependency model

The inspector treats the whole project as one mathematical development with
one graph. That graph may contain:

- verified definitions and results;
- independently confirmed disproved statements with their
  refutation evidence;
- candidates that are mechanically ready but await verification;
- open dependencies with incomplete proofs;
- retained rejected attempts;
- unresolved references needed to explain a failure; and
- protected main goals with their proof overlays.

For example:

```text
@thm-main-uniform-index
  -> @lem-finite-stratification
  -> @lem-local-exponent-bound
  -> @lem-completion-preserves-index
  -> @def-local-class-group
```

An edge may connect facts in any two files. A dependency is never imported
automatically: cross-file scope remains explicit. The producer exports the
exact ID, the consumer imports it from a relative path, and the construction
or proof cites the ID at its point of use. A permitted outside theorem is
stated in the external basis instead of becoming an `@id` edge.

Citing a protected main goal is an ordinary legal edge. The citing fact simply
stays globally blocked until that goal itself verifies.

Every node carries an origin of `main-goal`, `fact`, or `unresolved`. The
published project graph records that provenance in one project-wide ID
namespace; a protected goal with no proof is simply status `open`.

### Retention instead of canonical promotion

The earlier design promoted accepted proofs and new results into a canonical
QMD project. That model caused user notes to serve simultaneously as notes,
proof database, and machine status store. It also made inspection depend on
marker writes and canonical destination selection.

The current model removes that boundary crossing, separates machine and AI
state, and adds explicit retained disproof evidence:

1. The user statement remains in its note.
2. The agent creates complete mathematics in ordinary project QMD,
   conventionally under `workspace/`.
3. The compiler builds the dependency graph without consulting AI state.
4. The optional verifier checks each selected fact against only its direct
   dependency statements, and exact local decisions are cached.
5. The inspector deterministically composes global status over the graph;
   confirmed false statements carry conditional or global evidence explicitly.
6. The published project graph exposes all three layers for search, dependency
   analysis, progress reporting, and future paper selection.

`submit proof` and `verification revoke` have been removed entirely. The
dispatcher no longer recognizes them, and no command writes proof text.

Statement locks, exact dependency edges, external basis, checker contract,
source freshness, rejection safety, and atomic writes are still checked. The
machine graph does not become more or less valid when an AI verdict changes.
The safest canonical write is now no proof write at all.

The files therefore have distinct ownership:

- `AGENTS.md` is project-owned policy with one managed block and optional local
  additions.
- QMD outside `.qmd-prover/` is the mathematical project: notes, protected
  goals, and proof development in one semantic namespace.
- `_quarto.yml` is ordinary project configuration.
- QMD under the conventional `workspace/` folder is persistent agent-created
  mathematical development and evidence, like any other project QMD.
- project JSON snapshots and verification records are derived machine state.
- generated QMD and SVG files are disposable observability inputs.

## Semantic QMD and inspection

The compiler has one pass.

Every discovered QMD file is parsed through Pandoc JSON and receives the
complete declaration/proof/import/export/ID contract. There is no separate
notes mode: protected main goals are recognized where they are declared, and
every other fact must be an explicit declaration.

A linked `.proof of="thm-main-ID"` overlay may live in any file,
conventionally `workspace/main-proof.qmd`. The dependencies it contributes
resolve in the proof file's own import scope.

Within semantic QMD, an `@id` citation in a definition construction
or linked proof is a dependency. The inspector first checks existence, global
uniqueness, local ownership, import scope, and cycles without consulting AI.
For a selected fact, it can then send the exact candidate and the exact
statements of its direct dependencies to the optional verifier. Dependency
proofs, dependency verdicts, and transitive proof text are deliberately absent.

### Complete semantic QMD example

The following is a complete semantic file, not merely an isolated
block. Suppose it is stored as
`workspace/parity-results.qmd`, next to a
producer file named `workspace/foundations.qmd`:

```markdown
---
title: "Parity results"
qmd-prover:
  imports:
    - from: foundations.qmd
      use:
        - def-even-integer
---

This file develops the local parity facts needed by the protected main goal.

::: {#lem-square-of-even .lemma name="Square of an even integer" date="2026-07-14" export="lem-square-of-even"}
For every even integer \(n\), there is an integer \(k\) such that
\(n^2=4k^2\).
:::

::: {.proof of="lem-square-of-even"}
By @def-even-integer, write \(n=2k\) for an integer \(k\). Squaring gives
\(n^2=(2k)^2=4k^2\).
:::

::: {#cor-even-square-divisible-by-four .corollary name="Even squares are divisible by four" date="2026-07-14" export="cor-even-square-divisible-by-four"}
For every even integer \(n\), the integer \(n^2\) is divisible by \(4\).
:::

::: {.proof of="cor-even-square-divisible-by-four"}
By @lem-square-of-even, write \(n^2=4k^2\) for an integer \(k\). Therefore
\(4\mid n^2\).
:::
```

This one file demonstrates the complete semantic format:

- the YAML front matter imports one exact exported ID from a path relative to
  this consumer file;
- each declaration has one globally unique ID, exactly one semantic class, a
  human-readable `name`, an ISO introduction `date`, and a nonempty body;
- each non-definition declaration has one separate, nonempty `.proof` linked
  by `of` and carrying no ID;
- `@def-even-integer` is a cross-file dependency made available by the import;
- `@lem-square-of-even` is a same-file dependency and needs no import; and
- each `export` value is identical to the declaration's semantic ID, allowing
  another file in the project to import it explicitly.

The protected theorem itself is not redeclared. Its linked overlay,
conventionally `workspace/main-proof.qmd`, can import the corollary from the
file above:

```markdown
---
qmd-prover:
  imports:
    - from: parity-results.qmd
      use:
        - cor-even-square-divisible-by-four
---

::: {.proof of="thm-main-even-square"}
The conclusion is exactly @cor-even-square-divisible-by-four.
:::
```

Here `thm-main-even-square` resolves to the protected declaration in the user
note, while the imported corollary resolves in this proof file's own import
scope. The proof block is an overlay, not a second theorem
declaration. Neither inspection nor successful verification copies this proof
into the user-owned QMD file.

If the exact theorem-like statement is false, its linked proof instead begins
with `DISPROVED` and supplies the counterexample or refutation after that
marker. This changes the independent review mode; it does not itself establish
falsity. Definitions cannot use the marker. A verifier may also discover a
counterexample while checking an unmarked proof, and derived state records that
outcome without editing the QMD source.

### Inspection scopes

The public scopes are:

- `inspect fact @ID` for one auto-located fact and its transitive
  dependency closure;
- `inspect path PATH` for the facts declared in one project path, for example
  `inspect path workspace/foundations.qmd`;
- `inspect project` for one unified compile, machine analysis, optional local
  conditional verification, and global composition over every fact; and
- `dependency ...` for analysis and search over the current published
  schema-v6 snapshot.

Narrow scopes verify the selected facts plus their transitive dependency
closure, and unchanged facts inherit their results from the last published
snapshot. No inspect command scaffolds files.

A protected goal with no proof is simply status `open`; there is no per-goal
setup command and no missing-scaffold error. The top-level project result is
still unsuccessful until every protected main goal is globally verified and
all machine checks pass.

### Three inspection layers

A directly inspected fact (`inspect fact @ID`) exposes separate `mechanical`,
`local_verification`, and `global_verification` fields. In list contexts — the
project and path `facts[]` and the `dependency` subcommands — facts appear as
compact references (`id`, `kind`, `status`, `file`, `line`), and the full
per-fact verification is obtained from `inspect fact @ID`. The composed status
string is a compact presentation of that state, not an input to dependency
analysis.

Mechanical state covers parsing, declaration and proof shape, ID ownership,
exact imports and exports, reference existence and scope, cycles, protected
goal freshness, and source freshness. It is computed without an AI verifier.

Local verification checks the exact submitted proof or refutation while
assuming the exact conclusions of only its direct dependencies. A rejected,
unverified, or cyclic upstream proof does not prevent this local check when
the dependency statements can be materialized. Without a configured verifier,
local state is `not-run` rather than a machine failure.

Global verification is deterministic. A result is globally `verified` only if
its machine state passes, its local proof is accepted, and every direct
dependency is globally `verified`. Otherwise it is `blocked`, `unverified`,
`rejected`, `invalid`, or `disproved` as appropriate. Operational `ok` says
whether inspection and configured verifier execution completed; it is not the
mathematical answer.

While local verification has not run, a fact keeps its machine status, which
is derived from markers and proof shape alone:

- `open`: a required proof is absent or begins with `OPEN`;
- `candidate`: complete unmarked mathematics awaits checking;
- `disproof-candidate`: a `DISPROVED` proof proposes a counterexample
  or refutation and awaits checking;
- `rejected`: the active proof begins with `REJECTED`; and
- `revoked`: a retained prior decision is no longer usable.

Once local verification has run, the composed verification status is one of:

- `verified`: the exact current candidate has an accepted local
  verifier record and every direct dependency is globally verified;
- `disproved`: local verification established a refutation and every
  direct dependency is globally verified, so the exact theorem-like statement
  is globally false with retained structured evidence;
- `blocked`: a cited dependency is not globally verified;
- `unverified` or `rejected`: the local check did not run for this candidate
  or rejected it, including a rejected proposed refutation; and
- `invalid`: mechanical, source, or cache checks prevent use.

`verified` is informal globally composed AI evidence, not formal
proof and not human review. It is never inferred from the agent's confidence
and never written as a source marker.

`disproved` has the same freshness requirement. It is conclusive
evidence about a false statement, not an available premise. Global composition
blocks any dependent fact that cites it, and frontier queries expose it as an
obstruction. The machine edge remains present and independent of the verdict.

`VERIFIED` and `REVOKED` are recognized nowhere. Writing either marker in any
file is the structural error `PROTECTED_MARKER_FORBIDDEN`; no legacy-marker
compatibility remains.

### Dependency analysis and search

An edge points from a definition or result to a fact cited by
its construction or proof. From the published project graph, qmd-prover
provides:

- direct and transitive dependencies;
- reverse dependencies and impact;
- shortest and alternative paths;
- complete cycle paths;
- proof frontiers;
- unused imports and exports;
- isolated and unreachable facts;
- candidates ready for AI;
- heavily reused facts; and
- text and graph-aware search.

Queries without a target cover the entire project graph. Search can filter
by ID, title, text, kind, status, source path, origin, graph relationship,
frontier membership, stale impact, directness, or cycle participation.

Every ID is globally unique in one project-wide namespace. A duplicate
anywhere is the project-wide diagnostic `DUPLICATE_ID`: it stops all inspect
and dependency operations before verifier invocation and leaves the
previously published snapshot untouched.

### Staleness and transitive invalidation

Exact local decisions include the target statement or construction, proof or
refutation, verification mode, exact direct dependency statements, semantic
context, external basis, checker contract, and protocol. They exclude upstream
proof text, upstream verdicts, and the transitive proof closure. Published
snapshots add a `source_signature` over the exact compiled sources, the
external basis, and the checker contract.

Changing an upstream proof without changing its statement invalidates that
upstream local decision but preserves downstream local cache hits; global state
is recomputed over the changed graph. Changing a direct dependency statement
invalidates the dependent local decision. Narrow inspection merges current
previous outcomes for unchanged facts so unrelated nodes are not downgraded.

`check staleness` is read-only. It audits the project-level cache records and
reports each stale entry with a reason: `cache-invalid`,
`external-basis-changed`, `checker-contract-changed`, `source-changed`, or
`dependency-context-changed`. It does not remove or add markers,
rewrite QMD, or overwrite progress notes.

## How agents use the infrastructure

qmd-prover does not prescribe a proof loop. After preflight, the host follows
the user's mathematical direction. The user may provide one theorem, many
related goals, an existing development, or an informal idea.

The infrastructure is available to:

- initialize or compare project policy;
- start or resume proof work under the conventional `workspace/` folder;
- inspect facts, paths, or the whole project;
- discover missing imports, cycles, and proof frontiers;
- search retained project mathematics;
- locally verify exact candidates against direct dependency conclusions;
- retain and expose independently checked counterexamples and refutations;
- retain rejection reports and repair hints;
- audit current source and cache freshness;
- query the published project graph; and
- prepare Quarto observability inputs.

Only the safety gates are mandatory. The agent keeps user statements unchanged,
places new proof QMD under the conventional `workspace/` folder, follows
unproved dependencies, responds to every
verification gap, and never declares its own work verified.

The external basis can evolve with the requested proof context, but the agent
states the change and accepts that affected cache keys will miss.

## Installation and requirements

The skill and runtime are self-contained under `skills/qmd-prover/`. TypeScript
source under `src/` is authoritative; `npm run build` emits Node-compatible ESM
under `scripts/`. The generated runtime has no third-party Node dependency.

The environment provides:

- Node.js 20 or later;
- Pandoc on `PATH`, or `QMD_PROVER_PANDOC`;
- optionally, an external verifier command through `QMD_PROVER_VERIFIER` or
  project configuration; and
- Quarto only when rendered output is wanted.

From a source checkout:

```bash
npm run install:skill
```

This copies the complete installable skill to
`${CODEX_HOME:-~/.codex}/skills/qmd-prover`.

## Starting a mathematical project

The user normally asks the host to initialize the current project. The host
runs:

```bash
node "${CODEX_HOME:-$HOME/.codex}/skills/qmd-prover/scripts/qmd-prover.js" init
```

The command inventories policy, QMD, Quarto configuration, qmd-prover state,
and external-basis mode before writing. It never creates `.external.qmd`.

If a project already contains material or divergent policy, the host summarizes
it and asks before using `--adopt-existing`, `--append-contract`, or
`--sync-contract`. Successful setup writes policy and configuration but
creates no main goal and no proof QMD.

The user may later provide protected goals or ask the agent to formulate them.
A goal with no proof simply reports status `open`; no per-goal setup exists.

## Using qmd-prover through Codex or Claude Code

Natural language is the normal interface:

```text
Initialize qmd-prover in this project.
```

```text
Use qmd-prover to prove @thm-main-even-square. Keep the statement unchanged,
develop every intermediate result under the `workspace/` folder, and
independently verify the complete dependency closure.
```

```text
Inspect @def-hilbert-calculus and explain exactly which local dependencies were
checked.
```

```text
Inspect the complete project, show open and blocked facts, and print
the current proof frontier.
```

```text
Render the current proof-status and dependency views with Quarto.
```

The host loads `SKILL.md`, performs contract preflight, invokes the dispatcher,
writes semantic QMD, and translates JSON into ordinary language.

Host-provided sub-agents belong to the host environment. qmd-prover does not
maintain a worker runtime. Each independent agent must load the contract and
external basis itself.

## Using the Node utilities directly

Let the installed dispatcher be:

```bash
QMD_PROVER="${CODEX_HOME:-$HOME/.codex}/skills/qmd-prover/scripts/qmd-prover.js"
```

Initialize:

```bash
node "$QMD_PROVER" init
```

Inspect the complete project:

```bash
node "$QMD_PROVER" inspect project --print
```

Inspect one auto-located fact:

```bash
node "$QMD_PROVER" inspect fact @def-hilbert-calculus --print
```

Inspect one project path:

```bash
node "$QMD_PROVER" inspect path workspace/foundations.qmd
node "$QMD_PROVER" inspect path notes.qmd
```

Verify one protected goal with its transitive dependency closure:

```bash
node "$QMD_PROVER" inspect fact @thm-main-even-square --print
```

Query the published project graph:

```bash
node "$QMD_PROVER" dependency frontier @thm-main-even-square --print
node "$QMD_PROVER" dependency search "local exponent" --kind lemma --print
node "$QMD_PROVER" dependency cycles --print
```

Audit staleness without writing:

```bash
node "$QMD_PROVER" check staleness --print
```

List and show retained verification records:

```bash
node "$QMD_PROVER" verification list --print
node "$QMD_PROVER" verification show @thm-main-even-square --print
```

Both read retained verification state and modify no file.

These operations expose a stable tool protocol. Inspection/domain failures use
JSON plus exit code 2. Syntax errors use exit code 1.

## Rendering with Quarto

Prepare generated status and graph inputs:

```bash
node "$QMD_PROVER" render
```

Render the configured project normally:

```bash
quarto render
```

qmd-prover does not render an alternative website. Project QMD remains ordinary
Quarto input. A project may also render generated pages to expose
proof progress.

Future paper tooling may consume selected verified mathematics and
produce a separate paper artifact. That workflow does not turn inspection into
a source-rewriting operation.

## Further design documents

- [Discipline design](design-discipline.md) explains policy ownership,
  semantic regimes, rule categories, block types, and contract evolution.
- [Inspector design](design-inspector.md) explains fact, path,
  project, dependency, and read-only staleness operations.
- [Proving utilities design](design-proving.md) explains candidate preflight,
  bounded verification, exact caches, rejection, freshness, and global
  composition.
- [Rendering design](design-rendering.md) explains project rendering,
  proof observability, dependency navigation, and future paper boundaries.
