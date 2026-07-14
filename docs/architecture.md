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
├── application/      CLI dispatch, help, project setup, and rendering
├── infrastructure/   configuration, filesystem safety, and external policy
├── inspection/       project index, aggregate snapshots, queries, findings, reports
├── semantic/         Pandoc JSON parsing, compilation, discovery, dependency cycles
├── shared/           dependency-free types and compact runtime primitives
├── verification/     verifier protocol, read-only staleness, legacy command surfaces
└── workspace/        workspace initialization, inspection, cache, and fingerprints
```

There are no compatibility facades or barrel-only files under `src/lib`.
Source, tests, and tooling import the owning domain module directly. This keeps
the filesystem representation aligned with the actual dependency graph and
makes it clear which layer owns a safety decision.

`inspection/index.ts` and `inspection/aggregate.ts` are deliberate first-class
modules. The former discovers project scopes and performs project-wide
preflight; the latter constructs and publishes the schema-v3 project view.
Neither belongs in the application dispatcher, because rendering, inspection,
and dependency analysis all need the same project model.

## Dependency direction

The intended file-level dependency direction is:

```text
application
  ├── inspection/operations
  │     └── workspace/inspect
  │           └── inspection/{index,aggregate,findings}
  ├── workspace/initialize
  └── application/render
              │
              v
workspace/support ── inspection primitives
              │
              v
semantic + verification protocol
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

The inspection domain deliberately has two levels. Project indexing,
aggregation, findings, and graph mechanics are lower-level primitives; they
may depend on `workspace/support.ts`, but never on the workspace verifier.
`workspace/inspect.ts` consumes those primitives to verify and publish one
workspace. The higher-level `inspection/operations.ts` may then invoke that one
workspace path repeatedly and compose project, fact, path, and dependency
results. This ordering keeps the file import graph acyclic:
`workspace/inspect.ts` never imports `inspection/operations.ts`, and the index
and aggregate builder never import `workspace/inspect.ts` at runtime. The
application layer coordinates these public operations, project setup,
rendering, help, and stable output formatting; it does not reimplement
semantic or verifier decisions.

## Larger workflows

Large workflows keep orchestration separate from reusable mechanics:

- `semantic/compiler.ts` owns `full`, `project-goals`, and `workspace`
  compilation modes. `project-goals` recognizes only protected main goals in
  user notes; `workspace` applies the complete semantic-QMD contract.
- `semantic/discovery.ts` owns deterministic QMD discovery and exclusions.
- `semantic/dependency-graph.ts` owns cycle normalization and detection.
- `inspection/index.ts` discovers notes, main goals, initialized workspaces,
  goal-like uninitialized directories, orphan workspaces, global IDs, and
  forbidden cross-scope dependencies without calling the verifier.
- `inspection/aggregate.ts` normalizes project-relative locations, merges
  current workspace snapshots, computes the schema-v3 total graph, and
  publishes it atomically when publication is safe.
- `inspection/graph.ts` owns traversal, subgraphs, shortest paths, alternative
  paths, and proof-frontier mechanics.
- `inspection/findings.ts` derives reusable graph findings.
- `inspection/operations.ts` coordinates project, fact, path, and dependency
  operations and converts domain failures into stable schema-v3 results.
- `inspection/report.ts` is presentation-only and must not change selection,
  checking, or publication semantics.
- `workspace/initialize.ts` creates protected goal-workspace state only after
  an explicit command.
- `workspace/support.ts` owns exact-cache validation, deterministic scheduling,
  source fingerprints, workspace paths, and current snapshot signatures.
- `workspace/inspect.ts` builds the protected-main-goal overlay, verifies a
  selected dependency closure or the full workspace, writes only workspace
  cache/snapshot state, and refreshes the aggregate project snapshot for a
  direct workspace inspection.
- `verification/staleness.ts` audits current protected snapshots, workspace
  sources, external basis, checker contract, and caches without mutating QMD.
- `verification/submissions.ts` retains the retired command surfaces; it must
  return structured results without reading or writing a proposed destination.
- `shared/core.ts` combines only small dependency-free primitives that are
  broadly reused; domain-specific helpers stay with their owner.

When a workflow grows, first extract a cohesive mechanism with a typed input
and output. Do not create a general `utils` module or move unrelated helpers
together merely because they are short.

## Safety invariants

Reorganization must preserve the stable dispatcher and JSON contracts. The
following invariants are architectural, not merely test conveniences:

- User QMD is notes and protected main-goal storage, never a proof destination.
- Inspection never initializes a workspace or overwrites `progress.qmd`.
- Main-goal statement locks and workspace protected snapshots fail closed.
- All verifier calls occur only after the relevant mechanical checks pass.
- Exact accepted and rejected workspace decisions are keyed by mathematical
  identity, dependency state, scope, external basis, checker contract, and
  protocol.
- Narrow inspection never verifies unrelated facts and never downgrades a
  current unrelated workspace snapshot when it refreshes the aggregate graph.
- A project-global duplicate ID stops all inspect and dependency operations
  before verifier invocation and leaves the last aggregate pointer unchanged.
- A malformed workspace does not suppress healthy workspace results, but it
  does make project inspection unsuccessful.
- Cross-workspace and workspace-to-other-main-goal edges are diagnosed and are
  never published into the aggregate graph.
- Parse failure remains a parse diagnostic; it is never converted to an
  unknown-ID error.
- Staleness auditing, retired submission, and retired revocation never modify
  user files or legacy markers.
- Workspace and aggregate snapshot publication is atomic. Incomplete parsing
  and project-fatal preflight prevent unsafe publication.

The repository instruction still requires protection against stale verifier
results, rejection-unsafe writes, and partial canonical state. In the current
workspace-centric design, the strongest way to preserve those invariants is to
retire canonical proof writes entirely while keeping exact workspace caches,
post-verifier source fingerprint checks, and atomic state publication.

Run `npm test` after every change. It rebuilds the installable JavaScript,
compiles fixtures, and runs the behavioral suite. Run `npm run typecheck` when
changing types or module boundaries, and use `git diff --check` before handoff.
