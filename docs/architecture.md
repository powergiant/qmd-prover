# Runtime architecture

The maintainable runtime lives in `skills/qmd-prover/src/`. TypeScript is the
source of truth; `npm run build` emits the dependency-free JavaScript runtime
under `skills/qmd-prover/scripts/` so the installed skill remains
self-contained.

## Module layout

`src/lib` is organized by responsibility:

```text
lib/
├── application/      CLI dispatch, help, project setup, and rendering
├── infrastructure/   configuration, filesystem safety, and external policy
├── inspection/       graph queries, findings, operations, and reports
├── semantic/         Pandoc JSON parsing, source edits, compilation, discovery
├── shared/           dependency-free types and compact runtime primitives
├── verification/     verifier protocol, canonical checks, submissions, staleness
└── workspace/        workspace initialization, inspection, cache, and fingerprints
```

There are no compatibility facades or barrel-only files under `src/lib`.
Source, tests, and tooling import the owning domain module directly. This keeps
the filesystem representation aligned with the actual dependency graph.

## Dependency direction

The intended dependency direction is:

```text
shared
  ↑
infrastructure
  ↑
semantic ─────→ verification protocol
  ↑                    ↑
inspection         verification workflows
  ↑                    ↑
workspace ─────────────┘
  ↑
application
```

`shared` must not depend on higher layers. Infrastructure owns unsafe boundary
operations such as JSON reads and atomic writes. Semantic compilation owns the
Pandoc representation and produces typed manifests and dependency graphs.
Inspection and verification consume those products without introducing an
alternative parser. The application layer only coordinates public operations,
project setup, rendering, and stable output formatting.

## Larger workflows

Large workflows should keep orchestration separate from reusable mechanics:

- `inspection/graph.ts` owns traversal and path algorithms.
- `inspection/findings.ts` derives reusable graph findings.
- `inspection/operations.ts` coordinates project, fact, path, and dependency
  inspections.
- `inspection/report.ts` is presentation-only and must not change semantics.
- `workspace/initialize.ts` creates protected workspace state.
- `workspace/support.ts` owns cache validation, deterministic ordering,
  fingerprints, and workspace path rules.
- `workspace/inspect.ts` coordinates a complete workspace inspection.
- `semantic/discovery.ts` owns deterministic QMD discovery and exclusions.
- `semantic/dependency-graph.ts` owns cycle detection.
- `shared/core.ts` combines only the small, dependency-free runtime primitives
  that are broadly reused; domain-specific helpers stay with their owner.

When a workflow grows, first extract a cohesive mechanism with a typed input
and output. Do not create a general `utils` module or move unrelated helpers
together merely because they are short.

## Safety invariants

Reorganization must preserve the stable JSON schema and top-level dispatcher
commands. Canonical writes still pass through the protected atomic write path;
verification remains independent and record-backed; stale submissions fail
closed; rejected work never mutates canonical mathematics; and Pandoc JSON
remains the only semantic parser.

Run `npm test` after every change. It rebuilds the installable JavaScript,
compiles fixtures, and runs the behavioral suite.
