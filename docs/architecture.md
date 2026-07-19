# Runtime architecture

The maintainable runtime lives in `skills/qmd-prover/src/`. TypeScript is the
source of truth; `npm run build` emits the dependency-free JavaScript runtime
under `skills/qmd-prover/scripts/`, which `package.json` `bin` installs as the
`qmd-prover` command. The skill itself carries only documentation.

Production semantic parsing always consumes Pandoc JSON. Tests may substitute
an AST-producing Pandoc adapter, but neither production nor tests should grow a
second regular-expression semantic parser.

## Module layout

`src` is organized around what the tool does. The top level separates the
command-line surface, the individual commands, the shared engine, and the
verifier adapters:

```text
src/
├── cli/            argv parsing, dispatch, help, and output projections
├── commands/       one module per command: init, doctor, render, inspect,
│                   dependency, check, verification
├── core/           the shared engine every command composes
│   ├── semantic/       Pandoc JSON parsing, sources, compilation, discovery, dependency cycles
│   ├── verification/   verifier protocol and exact decision cache
│   ├── graph/          graph algorithms, findings, snapshot persistence, the verification driver
│   ├── infrastructure/ configuration, executables, filesystem safety, external policy
│   └── shared/         dependency-free types, primitives, verdict vocabulary, result DTOs
└── verifiers/      standalone verifier adapter executables (claude, codex)
```

There are no compatibility facades or barrel-only files. Source, tests, and
tooling import the owning module directly, so the filesystem layout matches the
actual dependency graph and makes it clear which layer owns a safety decision.

Each `commands/*` module is a thin orchestrator: it composes `core/` mechanisms
over the selected scope and returns a stable schema-v6 result. Command modules
never import one another; anything shared between two commands — a helper or a
result type such as the staleness report — lives in `core/`, so the command
surface stays legible and independent.

## Dependency direction

The intended dependency direction runs strictly inward:

```text
cli  (parse, dispatch, help, output)
  │
  v
commands  (init, doctor, render, inspect, dependency, check, verification)
  │
  v
core  (semantic, verification, graph, infrastructure, shared)
```

`cli` parses argv into a command, dispatches to the matching `commands/*`
module, and renders that module's result — the full report under `--print`, the
lean agent-facing projection by default. Nothing in `core/` imports `cli` or
`commands`, and no command imports another command. The verifier adapters under
`src/verifiers/` depend only on `core/verification` and the shared verdict
vocabulary.

Within `core`, the layering is `semantic → verification → graph`, all resting on
`infrastructure` and `shared`. `shared` and `infrastructure` must not depend on
a higher layer. `infrastructure` owns unsafe boundary operations such as JSON
reads, path containment checks, locks, and atomic writes. `semantic` owns the
Pandoc representation and produces typed manifests and dependency graphs;
because the verdict vocabulary (`AiCheck`, `GlobalVerification`,
`DisproofEvidence`, …) lives in `core/shared/verdicts`, a semantic result carries
overlaid verification status without depending on the verifier. `verification`
owns the external protocol and exact decision identity. `graph` owns the
verification driver, snapshot persistence, graph traversal, and findings; it may
depend on the verification cache and protocol but never on a command. None of
these layers introduces an alternative parser.

`core/graph/verify.ts` is the verification driver: it runs local conditional
verification over a selected closure and deterministically composes global
status. `commands/inspect` and `commands/dependency` invoke it (directly or
through the published snapshot) and compose project, fact, path, and dependency
results; they never reimplement semantic or verifier decisions.

## Larger workflows

Large workflows keep orchestration separate from reusable mechanics:

- `core/semantic/compiler.ts` owns the single full compilation pass. Every
  discovered QMD file receives the complete semantic-QMD contract, and
  protected main goals are recognized where they are declared.
- `core/semantic/discovery.ts` owns deterministic QMD discovery; `.qmd-prover/`
  is excluded as derived state.
- `core/semantic/pandoc.ts` and `core/semantic/source.ts` own Pandoc invocation
  and exact source reading and fingerprints.
- `core/semantic/dependency-graph.ts` owns cycle normalization and detection.
- `core/graph/verify.ts` drives local conditional verification over a selected
  dependency closure and deterministically composes global status.
- `core/graph/snapshot.ts` normalizes project-relative locations, computes the
  schema-v6 total graph with its `source_signature`, and publishes it
  atomically when publication is safe.
- `core/graph/algorithms.ts` owns traversal, subgraphs, shortest paths,
  alternative paths, and proof-frontier mechanics.
- `core/graph/findings.ts` derives reusable graph findings.
- `commands/inspect/index.ts` composes project, fact, and path inspection over
  the verification driver and published snapshot.
- `commands/dependency/index.ts` composes the dependency queries and converts
  domain failures into stable schema-v6 results.
- `commands/check/index.ts` audits current cache records against sources,
  external basis, and checker contract without mutating QMD.
- `commands/verification/index.ts` reads retained verifier submissions and
  failure reports under `.qmd-prover/verification/`.
- `cli/output/report.ts` is presentation-only and must not change selection,
  checking, or publication semantics; `cli/output/lean.ts` projects the compact
  agent-facing view.
- `core/verification/protocol.ts` owns the protocol-version-6 packet contract
  and the interpretation of structured verifier results.
- `core/verification/cache.ts` owns the project-level content-addressed exact
  decision cache under `.qmd-prover/verification/checks/`, exact-cache
  validation, and deterministic scheduling.
- `core/shared/verdicts.ts` owns the verifier result vocabulary (verdicts,
  reports, and run-cost metrics) shared across the engine; `core/shared/core.ts`
  combines only small dependency-free primitives that are broadly reused, and
  domain-specific helpers stay with their owner.

When a workflow grows, first extract a cohesive mechanism with a typed input
and output. Do not create a general `utils` module or move unrelated helpers
together merely because they are short.

## Safety invariants

Reorganization must preserve the stable dispatcher and JSON contracts. The
following invariants are architectural, not merely test conveniences:

- Protected main-goal statements and titles are locked through
  `statement-locks.json` and fail closed: `MAIN_STATEMENT_MUTATED` and
  `MAIN_TITLE_MUTATED` stop verification rather than adopting a mutated goal.
- Inspection never scaffolds proof QMD and never overwrites `progress.qmd`.
- Mechanical compilation and graph analysis never read AI verdicts, proof
  acceptance, or upstream verification state.
- A local verifier call requires a materializable target and exact direct
  dependency statements, but it does not require those dependencies to have
  accepted proofs. Scope and cycle errors remain machine diagnostics and can
  invalidate global composition without becoming claims about the local
  mathematical implication.
- Exact locally verified, disproved, and rejected decisions are
  content-addressed at `.qmd-prover/verification/checks/<sha256>.json`, keyed
  by the target statement or construction, submitted proof or refutation,
  direct dependency statements, semantic context, external basis, checker
  contract, and protocol. Dependency proof text and dependency verdicts are
  not inputs.
- The freshness gate fails closed during verifier runs: when compiled sources
  change under a running verifier, the decision is discarded as `SOURCE_STALE`
  rather than cached.
- A cache write failure is fatal. `CACHE_WRITE_FAILED` fails the operation
  instead of reporting an acceptance that was never durably recorded.
- Global verification is a deterministic graph fold. A fact is globally
  verified only when it is mechanically valid, locally accepted, and every
  direct dependency is globally verified.
- A source `DISPROVED` marker selects refutation review but never establishes
  falsity by itself. Only a current independent decision may publish structured
  disproof evidence, and a disproved node is never a usable premise.
- Narrow inspection never verifies unrelated facts; unchanged facts inherit
  their results from the last published snapshot and are never downgraded.
- A project-wide `DUPLICATE_ID` stops all inspect and dependency operations
  before verifier invocation and leaves the last published pointer unchanged.
- Citing a protected main goal is a legal edge that stays globally blocked
  until the goal itself verifies.
- Writing a `VERIFIED` or `REVOKED` marker anywhere is the structural error
  `PROTECTED_MARKER_FORBIDDEN`; no legacy-marker compatibility remains.
- Parse failure remains a parse diagnostic; it is never converted to an
  unknown-ID error.
- Staleness auditing never modifies sources, caches, or published snapshots.
- Snapshot publication is atomic. Incomplete parsing
  and project-fatal preflight prevent unsafe publication.

The repository instruction still requires protection against stale verifier
results, rejection-unsafe writes, and partial canonical state. In the current
project-centric design, the strongest way to preserve those invariants is to
retire canonical proof writes entirely while keeping exact content-addressed
caches, post-verifier source fingerprint checks, and atomic state publication.

Run `npm test` after every change. It rebuilds the installable JavaScript,
compiles fixtures, and runs the behavioral suite. Run `npm run typecheck` when
changing types or module boundaries, and use `git diff --check` before handoff.
