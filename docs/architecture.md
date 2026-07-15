# Runtime architecture

The maintainable runtime lives in `skills/qmd-prover/src/`. TypeScript is the
source of truth; `npm run build` emits the dependency-free JavaScript runtime
under `skills/qmd-prover/scripts/` so the installed skill remains
self-contained.

Production semantic parsing always consumes Pandoc JSON. Tests may substitute
an AST-producing Pandoc adapter, but neither production nor tests should grow a
second regular-expression semantic parser.

## Module layout

`src/lib` is organized by responsibility:

```text
lib/
├── application/      CLI dispatch, help, doctor, project setup, and rendering
├── infrastructure/   configuration, executables, filesystem safety, external policy
├── inspection/       project index, verification driver, snapshots, graph queries, findings, reports
├── semantic/         Pandoc JSON parsing, sources, compilation, discovery, dependency cycles
├── shared/           dependency-free types and compact runtime primitives
└── verification/     verifier protocol, exact caches, read-only staleness, submissions
```

There are no compatibility facades or barrel-only files under `src/lib`.
Source, tests, and tooling import the owning domain module directly. This keeps
the filesystem representation aligned with the actual dependency graph and
makes it clear which layer owns a safety decision.

`inspection/index.ts` and `inspection/snapshot.ts` are deliberate first-class
modules. The former discovers project sources and performs project-wide
preflight; the latter constructs and publishes the schema-v5 project view.
Neither belongs in the application dispatcher, because rendering, inspection,
and dependency analysis all need the same project model.

## Dependency direction

The intended file-level dependency direction is:

```text
application
  ├── inspection/operations
  │     └── inspection/verify
  │           └── inspection/{index,snapshot,graph,findings}
  └── application/render
              │
              v
semantic + verification (protocol, cache, staleness)
              │
              v
infrastructure + shared
```

`shared` and infrastructure must not depend on higher layers. Infrastructure
owns unsafe boundary operations such as JSON reads, path containment checks,
locks, and atomic writes. Semantic compilation owns the Pandoc representation
and produces typed manifests and dependency graphs. Verification owns the
external protocol and exact decision identity. None of those layers introduces
an alternative parser.

The inspection domain deliberately has two levels. Project indexing, snapshot
construction, findings, and graph mechanics are lower-level primitives; they
may depend on the verification cache and protocol, but never on the
verification driver. `inspection/verify.ts` consumes those primitives to run
local conditional verification and compose global status. The higher-level
`inspection/operations.ts` invokes that driver over the selected closure and
composes project, fact, path, and dependency
results. This ordering keeps the file import graph acyclic:
`inspection/verify.ts` never imports `inspection/operations.ts`, and the index
and snapshot builder never import `inspection/verify.ts` at runtime. The
application layer coordinates these public operations, project setup,
rendering, help, and stable output formatting; it does not reimplement
semantic or verifier decisions.

## Larger workflows

Large workflows keep orchestration separate from reusable mechanics:

- `semantic/compiler.ts` owns the single full compilation pass. Every
  discovered QMD file receives the complete semantic-QMD contract, and
  protected main goals are recognized where they are declared.
- `semantic/discovery.ts` owns deterministic QMD discovery; `.qmd-prover/` is
  excluded as derived state.
- `semantic/pandoc.ts` and `semantic/source.ts` own Pandoc invocation and
  exact source reading and fingerprints.
- `semantic/dependency-graph.ts` owns cycle normalization and detection.
- `inspection/index.ts` discovers project QMD, protected main goals, global
  IDs, and duplicate-ID conflicts without calling the verifier.
- `inspection/verify.ts` drives local conditional verification over a selected
  dependency closure and deterministically composes global status.
- `inspection/snapshot.ts` normalizes project-relative locations, computes the
  schema-v5 total graph with its `source_signature`, and publishes it
  atomically when publication is safe.
- `inspection/graph.ts` owns traversal, subgraphs, shortest paths, alternative
  paths, and proof-frontier mechanics.
- `inspection/findings.ts` derives reusable graph findings.
- `inspection/operations.ts` coordinates project, fact, path, and dependency
  operations and converts domain failures into stable schema-v5 results.
- `inspection/report.ts` is presentation-only and must not change selection,
  checking, or publication semantics.
- `verification/protocol.ts` owns the protocol-version-5 packet contract and
  the interpretation of structured verifier results.
- `verification/cache.ts` owns the project-level content-addressed exact
  decision cache under `.qmd-prover/verification/checks/`, exact-cache
  validation, and deterministic scheduling.
- `verification/staleness.ts` audits current cache records against sources,
  external basis, and checker contract without mutating QMD.
- `verification/submissions.ts` records verifier submissions and retained
  failure reports under `.qmd-prover/verification/failures/`.
- `shared/core.ts` combines only small dependency-free primitives that are
  broadly reused; domain-specific helpers stay with their owner.

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
