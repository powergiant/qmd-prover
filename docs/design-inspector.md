# Inspector design

## Role

The inspector checks mathematical state at four connected scopes: one fact, a
file or folder, the complete project, and the aggregate dependency graph. A
protected main goal is declared in user QMD; every other qmd-prover fact is an
explicit declaration in ordinary project QMD. Every discovered QMD file is
full semantic mathematics compiled in one pass into one dependency graph and
one ID namespace. Folders organize files; they never form a semantic boundary.

For every selected fact, the inspector exposes three deliberately separate
layers:

- `mechanical` establishes source shape, identity, exact dependency edges,
  reference existence, import scope, cycle freedom, and protected context
  without consulting AI;
- `local_verification` asks an optional AI verifier whether the submitted proof
  follows assuming only the exact conclusions of its direct dependencies; and
- `global_verification` deterministically composes machine validity, the local
  verdict, and the complete upstream dependency closure.

The inspector uses Pandoc JSON as its semantic parser. It extracts dependency
edges only from `@id` references in a definition construction or linked proof.
Ordinary expository prose and bibliographic citations do not enter the graph.

Inspection returns stable schema-v6 JSON by default. The default JSON is lean:
every fact is a compact reference (`id`, `kind`, `status`, `file`, `line`) and
the full dependency graph is emitted only with `--graph`; it is always persisted
to `.qmd-prover/graph.json` regardless. `--print` selects a human-readable report
but must not change selection, diagnostics, verification, graph construction, or
snapshot publication.

The shared project index is built before verifier work. One compilation pass
discovers every QMD source below the project root and registers notes,
protected goals, and explicit declarations in the single namespace.
`.qmd-prover/` holds only derived tool state and is excluded from discovery. A
duplicate ID anywhere in the project is fatal for every inspection and
dependency operation: no verifier call occurs and no snapshot replacement is
published. Other failures remain local to their facts.

Local verification runs for selected facts whose exact target and direct
dependency statements can be materialized. It is not gated by upstream AI
verdicts, and machine scope or cycle findings remain separate diagnostics. The
exact local key covers the target statement or construction, submitted proof
or refutation, exact direct dependency statements, semantic context, external
basis, checker contract, and protocol. It excludes dependency proof text,
dependency verdicts, and the transitive proof closure. Verified, disproved,
and rejected local decisions are reusable. Without a verifier, machine
inspection remains operational and local checks are `not-run`.

### Diagnostics versus QMD source

Inspection diagnostics are structured output, not additions to the
mathematical source format. Their uppercase names occur only in the JSON
`diagnostics[].code` field, its `--print` presentation, and derived diagnostic
or snapshot JSON. The inspector never inserts one into a user note,
`workspace/main-proof.qmd`, or any other QMD file.

The project-level codes introduced by unified inspection are:

| Code | Meaning |
|---|---|
| `DUPLICATE_ID` | One explicit ID is declared more than once anywhere in the project. The single ID namespace is ambiguous, so inspection and dependency analysis stop before verification or snapshot publication. |
| `MAIN_STATEMENT_MUTATED` | A protected main goal's statement no longer matches the identity recorded in `.qmd-prover/statement-locks.json`. The lock is created as soon as the goal's own file is error-free; later drift is reported without rewriting the note. |
| `MAIN_TITLE_MUTATED` | A protected main goal's title drifted from its locked identity. |
| `SOURCE_STALE` | Project sources, protected-goal locks, the external basis, or the checker contract changed while an independent check was running. The result is not accepted or cached, and the run stops. |
| `CACHE_WRITE_FAILED` | An exact decision record could not be written. The run stops rather than ever report an uncached result as verified. |
| `VERIFIER_FAILED` | A configured verifier failed to launch, timed out, or returned malformed output. A structured failure record is written under `.qmd-prover/verification/failures/` and the remaining uncached checks in the run are skipped. |
| `AI_CHECK_FAILED` | One fact's local conditional check ended in an infrastructure error rather than a verdict. The fact keeps its machine status and composes as `unverified`. |
| `AI_CHECK_REJECTED` | Independent review rejected a submitted proof. The diagnostic carries the verifier's explanation and repair hints. |
| `AI_DISPROOF_REJECTED` | Independent review did not confirm a source-marked refutation. The diagnostic carries the verifier's explanation and repair hints. |
| `PROTECTED_MARKER_FORBIDDEN` | A `VERIFIED` or `REVOKED` marker appears somewhere in QMD source. Those strings belong only to tool records; their presence in source is a structural error with no compatibility interpretation. |
| `DEFINITION_DISPROVED_FORBIDDEN` | A definition uses a marker reserved for refuting theorem-like statements. |
| `PARSE_ERROR` | Pandoc could not launch or could not parse a relevant QMD file. This remains distinct from lookup failure. |
| `FACT_UNKNOWN` | Parsing and project indexing completed, but the requested ID does not name a protected goal or explicit declaration. |

More specific compiler and verifier diagnostics follow the same rule: the
code is a stable machine identifier, while the adjacent message, source
location, remediation, and repair hints explain what the user or agent should
do. QMD workflow markers are a separate concept described by the project
contract.

## 1. Inspect a theorem, lemma, or definition

`inspect fact @ID` accepts any protected main-goal or explicit declaration ID.
It resolves the ID in the single project namespace and returns the selected
fact, its check result, source text, its dependency closure as compact
references, blockers, diagnostics, verification counts, and staleness state. The
full dependency subgraph is included only with `--graph` and is always persisted
to `.qmd-prover/graph.json`.

### Select and parse the fact

Selection follows these rules:

- Compile every discovered QMD source in one pass under the complete
  declaration, proof, import, export, and ID contract. `thm-main-*` blocks
  register as protected goals; every other explicit declaration registers as
  an ordinary fact, whatever folder its file lives in.
- Resolve the requested ID through the project-wide namespace. The caller
  never states which file owns it.
- If the ID names a protected goal, read its statement from the user's note
  and select its linked proof overlay, which may live in any project file
  (conventionally `workspace/main-proof.qmd`). The overlay is not a second
  declaration.
- If a protected goal has no linked proof anywhere, report it as `open`.
  That is a status, not an error; no per-goal initialization exists or is
  required before proof work starts.
- If Pandoc cannot launch or parse a relevant file, preserve that parse
  failure instead of falling through to an unknown-fact result.
- If the project compiled completely and no matching fact exists, return a
  structured `FACT_UNKNOWN` diagnostic with exit code 2.

Inspection never scaffolds directories or metadata and never copies or edits a
proof in user QMD.

### Build the mechanical graph

For every selected construction or proof, check that:

- the target declaration exists and is unique in the project namespace;
- the block kind, ID, class, name, date, and body satisfy the project
  contract;
- a theorem-like candidate has one nonempty linked proof;
- each referenced ID resolves in the import scope of the file that cites it;
  for a protected goal, proof-contributed dependencies resolve in the proof
  file's import scope while the statement is still read from the user's note;
- same-file dependencies are local, while cross-file dependencies have a
  matching producer export and exact consumer import;
- an edge into a protected main goal is recorded as a legal citation; the
  citing fact stays globally blocked until that goal verifies;
- dependency edges and cycle membership are reported exactly; and
- the protected-goal statement locks, project sources, external basis, and
  checker contract have not changed during the operation.

Missing and unavailable references remain as explanatory `unresolved` nodes in
the scoped graph so failures can be explained precisely.

Mechanical analysis never asks whether a dependency has been proved, rejected,
or checked by AI. Those labels cannot create, remove, or alter an edge.

### Check one conditional step with AI

When the target and its direct dependency statements are materializable, send
a bounded packet to the optional verifier. The packet supplies the exact
submitted proof and the exact conclusions of only the direct dependencies. It
does not supply dependency proofs, dependency AI states, or a transitive proof
bundle. The verifier must assume those conclusions and judge the proof actually
submitted, rather than solve the theorem by an unrelated route.

For a definition, ask whether the cited local facts and external basis make the
construction meaningful, provide all required objects and operations, and
justify any existence, uniqueness, or well-definedness claim.

For a theorem-like result, ask whether:

- every cited result applies under the stated hypotheses;
- the proof uses each conclusion correctly;
- explicit reasoning covers every case and quantifier;
- external theorems are allowed by the exact basis and used with their
  hypotheses; and
- the proof establishes the exact declaration, especially the protected
  main-goal statement.

If the proof begins with `DISPROVED`, change the verification mode from proof
to refutation. Ask whether the proposed counterexample satisfies every
hypothesis and actually falsifies the exact statement, rather than merely
showing that one proof attempt has a gap. An ordinary proof review may also
discover that the statement itself is false.

The verifier returns a verdict, summary, critical errors, gaps, nonblocking
comments, repair hints, and a refutation field. `correct` with no critical
errors or gaps verifies an ordinary proof. `disproved` with a nonempty
refutation and no critical errors or gaps establishes a disproof. A
source-marked refutation must receive that same conclusive verdict. Missing
configuration produces `not-run`, not an error. A configured verifier that
fails, times out, or returns malformed output produces a structured
infrastructure error and no local conclusion.

### Compose global state and record evidence

For every selected closure, qmd-prover computes global status after the local
checks. A fact is globally `verified` exactly when its mechanical state
passes, its local proof is accepted, and every in-graph dependency is globally
verified; a conclusive local refutation composes to `disproved` under the same
dependency condition. A locally accepted fact with an unconcluded upstream
dependency is `blocked`; a fact whose local check did not run or ended in an
infrastructure error is `unverified`; a locally rejected fact is `rejected`;
a machine-invalid fact is `invalid`. This fold is deterministic and makes no
AI calls.

For current local evidence, qmd-prover:

- builds each verifier packet from the raw source text;
- stores the exact packet and report content-addressed at
  `.qmd-prover/verification/checks/<sha256>.json`, keyed by the packet and
  checker contract under protocol version 6;
- records a decision keyed by the complete verification identity;
- reports local and global fields separately in the manifest and graph;
- atomically publishes a current project snapshot; and
- refreshes `graphs/latest.json` when the operation owns publication.

For a conclusive refutation, the same safe publication path reports
`disproved` and stores structured evidence with the verifier summary,
refutation, source, and exact verification key. The verifier never inserts or
removes `DISPROVED` in QMD.

Verification summaries count local outcomes (`local_verified`,
`local_disproved`, `local_rejected`, `local_errors`, `local_not_run`) separately
from globally composed outcomes (`global_verified`, `global_disproved`,
`global_blocked`, `global_unverified`, `global_rejected`, `global_invalid`).
`ok` reports operational success, not the truth of the selected theorem.

If the verifier rejects the proof, qmd-prover caches the exact rejection and
reports the fact as `rejected` with an `AI_CHECK_REJECTED` diagnostic carrying
the complete repair information. Rejection never changes user QMD. A rejected
source-marked refutation receives `AI_DISPROOF_REJECTED` so it cannot be
confused with either a false statement or an ordinary failed proof.

Inspection writes no `VERIFIED` or `REVOKED` marker, and it accepts none: such
a marker anywhere in source is a structural `PROTECTED_MARKER_FORBIDDEN`
error, with no compatibility reading of older files. The former submission and
revocation command surfaces are removed entirely rather than retained as
aliases; verification state lives only in tool records and snapshots.

### Construct the related dependency graph

With `--graph` (or `--print`), the single-fact dependency graph — always
persisted to `.qmd-prover/graph.json` — contains:

- the selected fact;
- its direct dependencies;
- its complete transitive dependency closure;
- unresolved references needed to explain failures;
- status, kind, origin, ownership, local and global verification, and source location for each node;
- structured disproof evidence on every independently disproved node; and
- edge-level machine existence, scope, and cycle checks.

It deliberately excludes reverse dependencies and unrelated facts. Reverse
dependencies can be queried from the aggregate graph, but they are not part of
the verifier schedule for the selected fact.

Narrow inspection still updates durable state. To avoid degrading unrelated
facts, out-of-scope facts inherit their local and global results from the last
published snapshot when that snapshot's `source_signature` is still current
and the fact identity — statement, proof, and dependency hashes — is
unchanged. Facts that fail those conditions are recomputed or reported
`unverified` rather than trusted.

### `--print` report

With `--print`, display:

- selected ID, kind, source, and composed status;
- mechanical, local-AI, and global-composition results;
- direct and transitive dependencies;
- exact blockers and paths;
- confirmed refutation evidence when the selected statement is disproved;
- relevant diagnostics and verifier repair hints; and
- the scoped graph as a readable tree or edge list.

## 2. Inspect a file or folder

Path inspection scopes selection, never semantics. Every project QMD file
carries the same complete contract, so a path only chooses which facts are
verified; it cannot change how any file compiles or what its references mean.

### Source discovery

- Reject paths outside the project root.
- Reject missing paths and non-QMD files with structured domain diagnostics.
- A file request selects the declarations and proof overlays in that file.
- A folder request recursively selects active QMD below that folder.
- Discovery excludes `.qmd-prover/` derived tool state, rendered output, and
  configured ignored paths.
- A path whose files declare and prove nothing returns an empty successful
  fact result rather than a diagnostic.
- Discovery order is deterministic.

### Aggregate checks

For any selected path:

- compile the whole project once to establish imports, exports, IDs,
  proof links, and cycles;
- select the facts declared or proved in the requested path;
- add each selected fact's transitive dependency closure;
- locally check only that closure in deterministic topological order;
- report selected facts separately from external context nodes; and
- leave unrelated facts outside the verification count, inheriting their
  snapshot results when the `source_signature` and fact identities allow it.

A protected main goal selected through its note or through its proof file is
inspected as one overlay fact. A mutated statement lock remains a structured
failure rather than a silently retargeted goal.

### Aggregate dependency graph

With `--graph`, the path graph contains the selected facts and their dependency
context; it is always persisted to `.qmd-prover/graph.json`. Nodes are marked
`selected` or `external` relative to the path selection. “External” here means outside the selected path but inside the
same project graph; it does not mean an external-basis result.

After a complete narrow check, qmd-prover refreshes the publishable project
snapshot. If any project compilation is incomplete, publication is withheld
rather than replacing a complete snapshot with partial data.

### `--print` report

With `--print`, display:

- selected files and facts;
- counts by kind and status;
- context dependencies outside the selected path;
- missing imports, exports, references, or proofs;
- cycles and blockers in the selected closure; and
- local verification calls, cache hits, local outcomes, global outcomes,
  rejections, and errors.

## 3. Inspect the project

`inspect project` discovers and checks the entire managed project: one unified
compile, machine analysis over every fact, optional local conditional
verification, and deterministic global composition of the results.

### Project discovery

The shared project index classifies every QMD source below the project root
as:

- a user note declaring one or more protected `thm-main-*` goals;
- a source contributing explicit declarations and linked proofs; or
- a source that parses but declares nothing, which stays in the compile
  without adding graph nodes.

Discovery excludes `.qmd-prover/`, rendered output, and configured ignored
paths; everything else is full semantic mathematics under the complete
declaration, proof, import, export, and ID contract. Folders never change
semantics. The plain `workspace/` folder that agents conventionally use for
new proof QMD receives no tool recognition of any kind; its files compile
exactly like every other project file.

No fact requires initialization. A protected goal with no linked proof is
simply `open`. As soon as a goal's own file is error-free, its statement and
title identities are locked in `.qmd-prover/statement-locks.json`; later drift
is reported as `MAIN_STATEMENT_MUTATED` or `MAIN_TITLE_MUTATED` without
rewriting the note.

The index registers every explicit declaration in the single global namespace.
A linked proof of a protected goal is not a declaration. Any duplicate ID is
project-fatal `DUPLICATE_ID` and reports every project-relative declaration
location so the ambiguity can be repaired.

### Project checks

A full project inspection:

- compares every current protected main goal with its statement lock;
- parses every active QMD file under the full contract;
- creates each protected-goal overlay from the user statement and its linked
  proof, wherever that proof lives;
- rejects explicit redeclaration of a protected goal;
- checks imports, exports, cycles, and proof completeness;
- schedules every selected local fact in topological order, independently of
  upstream AI outcomes;
- reuses exact current local verified, disproved, or rejected decisions;
- computes global status over the complete project graph; and
- publishes a schema-v6 project snapshot when compilation is complete.

A malformed source file does not prevent healthy facts elsewhere from being
inspected or included with full results. The top-level result is nevertheless
`ok:false` when any blocking diagnostic remains.

Project success is stricter than “every file parsed.” Every protected main
goal must be locked, unmutated, and covered by a complete inspection that
passes. Here “passes” is operational: sources and machine checks are valid and
any configured verifier ran successfully. It does not mean that every goal is
globally verified; the aggregate summary and each fact's
`global_verification` field state that separately.

### Project dependency graph

The aggregate project graph has one node per globally unique ID and records
origin (`main-goal`, `fact`, or `unresolved`), source, status, identity, and
any confirmed disproof evidence. A current overlay replaces the open main-goal
node. An edge into a protected main goal is published as a legal citation that
composes as globally blocked until the goal verifies. The snapshot also
contains:

- protected goal inventory;
- note paths and their contained goals;
- the aggregate manifest and diagnostics;
- cycle paths; and
- a `source_signature` independent of verifier results.

Snapshots are content-addressed at `.qmd-prover/graphs/<sha>.json`, with
`graphs/latest.json` naming the current one and `manifest.json`, `graph.json`,
and `diagnostics.json` exposing the same schema-v6 state.

The source signature allows dependency analysis to reuse a saved graph only
while sources and context remain current. Local evidence has its own exact
cache identity; global status is recomputed from current graph and local state.

### `--print` report

For project inspection, show:

- notes and protected goals;
- files, facts, kinds, and statuses;
- complete verification totals;
- active proof obligations, blockers, and cycles;
- diagnostics grouped by source and semantic ID;
- snapshot publication identity when refreshed; and
- why the overall project result is or is not complete.

## 4. Analyze and search the dependency graph

Dependency operations use the latest current schema-v6 aggregate snapshot.
They never analyze a snapshot whose `source_signature` no longer matches
current sources; a stale or missing snapshot requires a fresh inspection.

### Dependency queries

For selected facts, support:

- direct and transitive dependencies;
- direct and transitive reverse dependencies;
- shortest and bounded alternative paths;
- impact analysis;
- proof-frontier discovery; and
- graph-aware search filters.

Without a target, support complete-project cycles, findings, unused imports and
exports, isolated facts, unreachable facts, ready-for-AI candidates, and
heavily reused facts. Protected main goals anchor the unreachable and frontier
analyses.

Every target ID is validated against the aggregate graph. Unknown IDs return a
structured lookup diagnostic. A duplicate ID prevents graph analysis
rather than allowing a query to choose one owner arbitrarily.

Impact analysis reports reverse dependents from the machine graph regardless
of their AI state. Changing a dependency proof with the same statement changes
global composition but does not invalidate downstream local AI cache entries;
changing the dependency statement does both. A disproved node remains unusable
as a globally established premise.

### Find the proof frontier

For a selected fact:

1. Traverse its aggregate dependency closure.
2. Find open, candidate, rejected, disproved, stale, missing, malformed, or
   otherwise unusable facts.
3. Remove a blocked fact from the frontier when a lower unresolved dependency
   already explains the block.
4. Return the lowest unresolved claims with paths from the selected result.

The frontier is a useful next-obligation set, not merely every unverified node.

### Additional graph findings

The inspector derives:

- unused imports and exports;
- isolated and unreachable facts;
- unresolved or invalid dependency edges;
- candidates whose dependency closure is otherwise ready for AI;
- heavily reused facts whose change has broad impact; and
- alternative dependency paths to the same target.

Findings cover every fact in the aggregate snapshot, not only the most
recently inspected selection.

### Search

Search matches semantic ID, title, statement or construction text, proof text,
kind, status, source path, and node origin (`main-goal`, `fact`, or
`unresolved`). Graph-aware filters restrict matches to facts used by,
depending on, affected by, or on the frontier of another fact; directness and
cycle participation can be requested.

Search results carry source provenance and can be passed to fact,
path, frontier, or impact operations.

## 5. Check staleness

Staleness checking is a read-only audit of project-level cache records against
current sources, the external basis, and the checker contract. It does not
edit QMD, run the verifier, or publish snapshots.

### Cache accepted identities

An exact local decision records:

- target ID, kind, statement or construction, proof or refutation identity,
  and verification mode;
- every direct dependency's exact statement identity (`statement_hash`);
- normalized semantic and source context;
- external-basis hash and exact verifier packet context;
- checker contract and protocol version 6;
- verifier report and verified, disproved, or rejected outcome; and
- the declaring source file.

Records are content-addressed at `.qmd-prover/verification/checks/<sha256>.json`
and keyed by the exact packet and checker contract. Project snapshots
additionally carry a `source_signature` over active project sources,
protected-goal lock identities, external basis, and checker contract.

### Compare current mathematics with the cache

`check staleness` scans:

- current protected main-goal identities against
  `.qmd-prover/statement-locks.json`;
- active project source fingerprints;
- external-basis identity;
- checker contract;
- the current snapshot `source_signature`; and
- exact cache records.

Every finding carries one structured reason: `cache-invalid`,
`external-basis-changed`, `checker-contract-changed`, `source-changed`, or
`dependency-context-changed`. A cache is unusable when required data is
missing, corrupt, stale, or no longer matches its exact verification key. The
audit reports previous and current evidence when available; it does not guess
a replacement identity.

### Report transitive invalidation

If a direct dependency statement changes, the dependent local cache key no
longer matches (`dependency-context-changed`); that may continue upward
through facts whose direct input statements also changed. If only a dependency
proof or AI verdict changes, downstream local cache keys remain current and
only deterministic global composition changes. The audit reports the affected
sources and cache reasons, and subsequent inspection reuses every unaffected
local decision.

This is logical invalidation, not source mutation. A `VERIFIED` or `REVOKED`
string anywhere in QMD source is a structural `PROTECTED_MARKER_FORBIDDEN`
error, never evidence of status; there is no compatibility mode that reads
old markers as state.

### Atomicity and failure behavior

- Staleness auditing performs no writes.
- Inspection writes each exact cache record atomically; a failed cache write
  is fatal `CACHE_WRITE_FAILED`, and an uncached result is never reported as
  verified.
- After every successful verifier call, the whole project is recompiled and
  fingerprinted before caching; any drift in sources, protected-goal locks,
  external basis, or checker contract is fatal `SOURCE_STALE` and the result
  is not cached.
- One verifier infrastructure failure short-circuits the remaining uncached
  checks in the run; a structured record is written under
  `.qmd-prover/verification/failures/`.
- Snapshot publication is atomic and is refused for duplicate IDs or
  incomplete compilation.
- A failure leaves the previous complete `graphs/latest.json` pointer usable.

### `--print` report

With `--print`, display:

- each changed protected goal, source, basis, checker, or cache;
- previous and current identities when available;
- invalidation entries grouped by structured reason;
- invalid or missing cache records; and
- the facts that require another inspection.

### Agent contract requirement

The project contract requires agents to:

- inspect current global state before relying on verified mathematics or
  reporting a statement as established false;
- never use a disproved statement as a dependency;
- treat missing, corrupt, or stale caches as unverified;
- rerun the narrowest affected inspection after a source or context change;
- never write `VERIFIED` or `REVOKED` into any QMD source;
- never hand-edit derived tool state under `.qmd-prover/`; and
- never confuse a local conditional AI pass with global verification, and
  never bypass mechanical checks or global composition.
