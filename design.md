# DESIGN.md — qmd-prover

## 1. Purpose

TheoremWeave is a Quarto-based, agentic mathematical prover.

A user creates a project containing one or more conjectures or theorems they want proved. User-supplied goals follow the identifier convention:

```text
thm-main-*
```

Examples:

```text
thm-main-uniform-index
thm-main-matroid-bound
thm-main-asymptotic-limit
```

Codex, Claude, or another coding agent then works through an iterative proof-search workflow. Agents may:

- Inspect the mathematical modules available to the project.
- Search definitions, lemmas, and theorems.
- Decompose goals into intermediate lemmas.
- Attempt constructive and refutational approaches.
- Add candidate lemmas.
- Submit candidate proofs for independent verification.
- Repair rejected proofs.
- Continue until each main theorem is proved, refuted, or explicitly stopped.

The system combines:

1. Human-readable QMD mathematical documents.
2. Explicit theorem imports and dependencies.
3. A compiler-like structural checker.
4. Persistent agent workflows and task state.
5. An independent mathematical verification gate.
6. Interactive theorem navigation and dependency graphs.

The system is an agentic informal prover, not initially a formal proof assistant such as Lean. “Verified” means accepted by the configured verification backend. The architecture should allow a formal backend to be added later.

---

## 2. Design principles

### 2.1 Human-readable mathematics is the canonical source

Definitions, lemmas, theorems, proofs, imports, motivation, examples, and diagrams live in QMD files.

The mathematical project should remain pleasant for humans to read and edit.

### 2.2 A small semantic layer exists inside unrestricted QMD

Authors may use arbitrary Quarto content. Only recognized blocks participate in dependency checking:

- Import blocks.
- Definitions.
- Lemmas.
- Theorems.
- Optionally propositions and corollaries.

Everything else remains visible to readers but is invisible to the semantic checker.

### 2.3 Main theorem statements are user-owned

An agent must never silently alter the statement, hypotheses, or identifier of a `thm-main-*` goal.

The system records a normalized statement hash and rejects unauthorized statement mutations.

### 2.4 Verification controls truth

Agents can propose mathematics, but they cannot mark their own work verified.

Only the verifier may transition a result to `verified`.

### 2.5 Parallel agents must not edit canonical files concurrently

Workers create isolated proposals. Accepted proposals are merged into canonical QMD files through one controlled, atomic write path.

### 2.6 Dependencies must be explicit

If a proof uses another result, it must cite it with a semantic `@` reference.

No proof may rely on assumptions supplied only by surrounding narrative prose.

### 2.7 The system should feel like a compiler

The command:

```bash
tw check
```

should play a role analogous to `tsc`:

- Parse every module.
- Resolve imports.
- Resolve semantic references.
- Build the dependency graph.
- Reject duplicate or missing identifiers.
- Reject cycles.
- Detect malformed semantic blocks.
- Detect illegal mutation of user goals.
- Produce precise, source-located diagnostics.

---

## 3. User experience

A new project should be created with:

```bash
tw init my-math-project
cd my-math-project
```

The user writes several goals:

```text
goals/uniform-index.qmd
goals/matroid-bound.qmd
goals/asymptotic-limit.qmd
```

The user checks the project:

```bash
tw check
tw status
```

The user launches agents:

```bash
tw prove --all --workers 6
```

or launches a single goal:

```bash
tw prove @thm-main-uniform-index --workers 4
```

During the run:

```bash
tw status
tw graph @thm-main-uniform-index
tw report @thm-main-uniform-index
```

When proofs are accepted:

```bash
tw render
```

The rendered website provides:

- Readable mathematical exposition.
- Clickable theorem references.
- Hover previews.
- Goal status.
- Interactive dependency graphs.
- Links from graph nodes to theorem statements.

---

## 4. Project structure

```text
my-math-project/
├── AGENTS.md
├── theoremweave.yml
├── _quarto.yml
├── README.md
│
├── goals/
│   ├── uniform-index.qmd
│   ├── matroid-bound.qmd
│   └── asymptotic-limit.qmd
│
├── modules/
│   ├── foundations/
│   │   ├── notation.qmd
│   │   └── definitions.qmd
│   ├── lemmas/
│   │   ├── local-finiteness.qmd
│   │   └── determinant-bound.qmd
│   └── results/
│       └── auxiliary-results.qmd
│
├── exposition/
│   ├── introduction.qmd
│   └── examples.qmd
│
├── references/
│   ├── references.bib
│   └── literature-notes.qmd
│
├── generated/
│   ├── graphs/
│   ├── reports/
│   └── indexes/
│
├── .agents/
│   └── skills/
│       ├── inspect-project/
│       │   └── SKILL.md
│       ├── inspect-module/
│       │   └── SKILL.md
│       ├── decompose-goal/
│       │   └── SKILL.md
│       ├── search-mathematics/
│       │   └── SKILL.md
│       ├── construct-examples/
│       │   └── SKILL.md
│       ├── construct-counterexamples/
│       │   └── SKILL.md
│       ├── direct-proving/
│       │   └── SKILL.md
│       ├── submit-proof/
│       │   └── SKILL.md
│       └── repair-proof/
│           └── SKILL.md
│
├── .theoremweave/
│   ├── manifest.json
│   ├── graph.json
│   ├── goal-locks.json
│   ├── events.jsonl
│   ├── tasks/
│   ├── workers/
│   │   ├── worker-1/
│   │   │   ├── TASK.md
│   │   │   ├── local-memory.jsonl
│   │   │   └── logs/
│   │   └── worker-2/
│   ├── proposals/
│   ├── verification/
│   ├── accepted/
│   ├── rejected/
│   ├── dead-ends/
│   └── cache/
│
├── tests/
│   ├── fixtures/
│   └── integration/
│
└── _site/
```

### 4.1 Canonical versus runtime content

Canonical, version-controlled content:

```text
AGENTS.md
theoremweave.yml
goals/
modules/
exposition/
references/
.agents/skills/
```

Generated but potentially publishable:

```text
generated/
_site/
```

Runtime content:

```text
.theoremweave/
```

The runtime directory should normally be ignored by Git, except when a project explicitly wants to preserve proof-search traces.

---

## 5. QMD semantic format

### 5.1 User-supplied goal

```markdown
---
title: "Uniform Cartier Index"
---

This problem asks whether a uniform index exists in the given family.

::: {#thm-main-uniform-index .theorem .goal}
## Uniform index theorem

### Statement

Let \(\pi\colon X\to B\) be a projective family satisfying the stated
hypotheses. There exists an integer \(I>0\) such that the total Cartier
index of every admissible fiber \(X_b\) divides \(I\).

### Proof

:::
```

An empty proof means the goal is open.

The statement is user-owned. Once indexed, its normalized hash is recorded:

```json
{
  "id": "thm-main-uniform-index",
  "statement_hash": "sha256:...",
  "origin": "user",
  "status": "open"
}
```

### 5.2 Definition

```markdown
::: {#def-total-cartier-index .definition export="total-cartier-index"}
## Total Cartier index

### Statement

The total Cartier index of a normal variety \(X\) is the least common
multiple of the Cartier indices of all \(\mathbb Q\)-Cartier Weil
divisors on \(X\).
:::
```

### 5.3 Lemma

```markdown
::: {#lem-local-exponent-bound .lemma export="local-exponent-bound"}
## Local exponent bound

### Uses

- @def-total-cartier-index
- @thm-local-class-group-finite

### Statement

The exponent of the local class group is bounded by \(N\).

### Proof

By @thm-local-class-group-finite, the local class group is finite.
Applying @lem-determinant-bound to its presentation matrix gives the
claimed bound.
:::
```

### 5.4 Proved main theorem

```markdown
::: {#thm-main-uniform-index .theorem .goal}
## Uniform index theorem

### Statement

Let \(\pi\colon X\to B\) be ...

### Uses

- @lem-local-exponent-bound
- @lem-finite-stratification

### Proof

Apply @lem-local-exponent-bound on each stratum supplied by
@lem-finite-stratification, and take the least common multiple of the
finitely many resulting bounds.
:::
```

The presence of a proof makes the block a candidate, not automatically verified.

---

## 6. Imports

```markdown
::: {.theorem-imports}
from: ../modules/foundations/local-groups.qmd
use:
  - @def-local-class-group
  - @thm-local-class-group-finite
:::
```

Aliases may be supported:

```markdown
::: {.theorem-imports}
from: ../modules/foundations/local-groups.qmd
use:
  - ref: @thm-local-class-group-finite
    as: @thm-local-finiteness
:::
```

Import rules:

1. Imports are explicit.
2. Wildcard imports are initially forbidden.
3. Imported IDs must exist and be exported.
4. Alias collisions are errors.
5. Missing modules are errors.
6. Import cycles are errors.
7. A theorem can depend only on:
   - results in its own module; or
   - explicitly imported results.
8. Imported verified results may be used as premises.
9. Imported open or rejected results may not support a verified proof.

---

## 7. Semantic references

Semantic references use reserved prefixes:

```text
@def-*
@lem-*
@thm-*
@prp-*
@cor-*
```

Inside a semantic block:

```text
@lem-local-bound
```

creates a logical dependency.

Outside a semantic block, the same reference is navigational only and does not create a dependency edge.

This paragraph therefore creates no proof dependency:

```markdown
For historical context, compare @thm-main-uniform-index.
```

This proof does create a dependency:

```markdown
### Proof

Apply @lem-local-bound.
```

Bibliographic citations remain separate:

```markdown
@kollar2016
```

Reserved semantic prefixes prevent ambiguity between theorem references and bibliography keys.

---

## 8. Semantic compiler

The semantic compiler reads QMD through Pandoc’s JSON AST or a Quarto/Pandoc Lua filter.

It must not parse QMD using regular expressions as its primary parser.

The compiler produces:

```text
.theoremweave/manifest.json
.theoremweave/graph.json
```

Example manifest entry:

```json
{
  "id": "thm-main-uniform-index",
  "kind": "theorem",
  "goal": true,
  "origin": "user",
  "file": "goals/uniform-index.qmd",
  "title": "Uniform index theorem",
  "statement": "...",
  "statement_hash": "sha256:...",
  "proof": "...",
  "declared_uses": [
    "lem-local-exponent-bound",
    "lem-finite-stratification"
  ],
  "detected_references": [
    "lem-local-exponent-bound",
    "lem-finite-stratification"
  ],
  "status": "candidate"
}
```

### 8.1 `tw check`

```bash
tw check
```

must validate:

- QMD parseability.
- Semantic block shape.
- Identifier prefixes.
- Duplicate identifiers.
- Missing imports.
- Missing exports.
- Alias collisions.
- Dependency cycles.
- References to unavailable results.
- Dependencies on rejected or revoked results.
- User-goal statement mutation.
- Candidate proofs missing cited dependencies.
- Declared `Uses` entries never used in the proof.
- Semantic references not declared in `Uses`.
- Open goals.
- Candidate proofs awaiting verification.

Example diagnostic:

```text
goals/uniform-index.qmd:41:8 TW1004
Proof references @lem-local-bound, but that result is not imported into
this module.

Suggested fix:
  add @lem-local-bound to a theorem-imports block
```

Open goals are reported but do not necessarily make `tw check` fail. Structural errors must produce a nonzero exit code.

---

## 9. Goal state machine

Each theorem has one of these states:

```text
open
in-progress
candidate
verifying
verified
rejected
refuted
blocked
revoked
```

Transitions:

```text
open
  → in-progress
  → candidate
  → verifying
  → verified

candidate
  → verifying
  → rejected
  → in-progress

open or in-progress
  → refuted

verified
  → revoked
```

Only the verifier or verification service can set:

```text
verified
rejected
```

Only a controlled revocation operation can set:

```text
revoked
```

Agents may propose status changes but cannot write authoritative verification state directly.

---

## 10. Agent architecture

### 10.1 Main agent

The main agent coordinates all goals.

Responsibilities:

- Run `tw check` and `tw status`.
- Inspect every open `thm-main-*` goal.
- Decide which goals can be attempted independently.
- Decompose goals into subgoals.
- Assign workers to different directions.
- Avoid duplicated work.
- Monitor verification outcomes.
- Reassign workers after failures.
- Request final rendering once goals are verified.

The main agent should not directly mark mathematics verified.

### 10.2 Worker agents

Each worker receives:

```text
.theoremweave/workers/<worker-id>/TASK.md
```

Example:

```markdown
# Assignment

Project: uniform-index
Target: @thm-main-uniform-index

Investigate whether the desired uniform bound follows from finiteness of
local class groups. Construct and prove any precise intermediate lemma
needed. Search existing project modules before creating a duplicate result.
```

Workers use project skills and CLI tools to:

- Inspect the target.
- Inspect relevant modules.
- View dependency closures.
- Search previous attempts and dead ends.
- Construct examples and counterexamples.
- Write isolated proposals.
- Submit proofs.
- Repair rejected submissions.

### 10.3 Verifier agent

The verifier receives a clean, materialized verification bundle:

- Exact theorem statement.
- Candidate proof.
- Imported definitions.
- Statements of cited verified results.
- Source references.
- Declared hypotheses.
- No unrelated narrative content.
- No strategic instructions from the worker.

The verifier returns:

```json
{
  "verdict": "correct",
  "summary": "...",
  "critical_errors": [],
  "gaps": [],
  "repair_hints": ""
}
```

A theorem is accepted only when:

```text
critical_errors is empty
and
gaps is empty
and
verdict is correct
```

The verifier should be instantiated in a fresh context for every submission.

---

## 11. Agent workflow

Each worker follows this loop:

```text
1. Inspect assignment
2. Run structural check
3. View target module
4. Query dependencies and existing results
5. Review previous attempts and dead ends
6. Select a proof strategy
7. Search, calculate, or construct examples
8. Propose intermediate results if necessary
9. Write candidate proof in isolated proposal
10. Run local structural validation
11. Submit to verifier
12. If rejected, repair from concrete feedback
13. If accepted, continue toward parent theorem
14. Stop only when target is verified, refuted, blocked, or cancelled
```

Workers should not restart from zero between sessions. Their local memory and the shared project event log provide continuity.

---

## 12. Skills

Every initialized project contains dedicated skills.

### 12.1 `inspect-project`

Commands:

```bash
tw status
tw goals
tw check
```

Purpose:

- Understand open goals.
- See worker assignments.
- See verified and rejected results.
- Detect structural errors.

### 12.2 `inspect-module`

Commands:

```bash
tw view @thm-main-uniform-index
tw deps @thm-main-uniform-index
tw imports goals/uniform-index.qmd
```

`tw view` should produce a bounded context bundle containing:

- The target statement.
- Relevant definitions.
- Direct dependencies.
- Imported theorem statements.
- Existing proof, if any.
- Verification history.
- Nearby unresolved subgoals.

It should not dump the entire project indiscriminately.

### 12.3 `decompose-goal`

Purpose:

- Generate several materially different proof plans.
- Turn useful subgoals into candidate lemma proposals.
- Record which parent theorem needs each lemma.

### 12.4 `search-mathematics`

Purpose:

- Search local modules first.
- Search trusted external sources if needed.
- Capture exact statements and applicability conditions.
- Record bibliographic metadata.

### 12.5 `construct-examples`

Purpose:

- Test definitions and hypotheses.
- Develop intuition.
- Identify necessary assumptions.

### 12.6 `construct-counterexamples`

Purpose:

- Test whether a user goal or proposed lemma may be false.
- Produce a precise refutation when possible.

### 12.7 `direct-proving`

Purpose:

- Write detailed candidate proofs.
- Cite every semantic dependency explicitly.

### 12.8 `submit-proof`

Commands:

```bash
tw propose <proposal.qmd>
tw submit <proposal-id>
```

Purpose:

- Validate the proposal.
- Materialize dependencies.
- Send it to the verifier.
- Merge only after acceptance.

### 12.9 `repair-proof`

Purpose:

- Read verification errors.
- Determine whether the repair is local or strategic.
- Produce a revised proposal.
- Resubmit without discarding valid progress.

---

## 13. CLI

Required commands:

```bash
tw init <project>
tw check
tw index
tw goals
tw status
tw view <@id>
tw deps <@id>
tw imports <file>
tw graph <@id>
tw task assign <worker> <@id>
tw worker start <worker>
tw worker stop <worker>
tw prove <@id>
tw prove --all
tw propose <file>
tw submit <proposal>
tw verification show <submission>
tw revoke <@id> --reason "..."
tw report <@id>
tw render
```

### 13.1 `tw view`

Example:

```bash
tw view @thm-main-uniform-index
```

Output:

```text
Goal: @thm-main-uniform-index
Status: in-progress
Statement hash: sha256:...
Direct dependencies: 2
Verified dependencies: 1
Open dependencies: 1
Active workers: worker-1, worker-3
Latest rejection: missing justification in the codimension-three case
```

It should optionally emit a machine-readable JSON bundle:

```bash
tw view @thm-main-uniform-index --json
```

### 13.2 `tw graph`

```bash
tw graph @thm-main-uniform-index
```

must compute the theorem’s transitive dependency closure and generate:

```text
generated/graphs/thm-main-uniform-index.qmd
```

---

## 14. Proposal and merge system

Workers must not directly edit canonical verified modules during parallel work.

A proposal contains:

```text
.theoremweave/proposals/<proposal-id>/
├── proposal.qmd
├── metadata.json
└── supporting-notes.md
```

Example metadata:

```json
{
  "proposal_id": "proposal-20260711-0012",
  "worker": "worker-3",
  "target": "thm-main-uniform-index",
  "kind": "proof",
  "statement_hash": "sha256:...",
  "dependencies": [
    "lem-local-exponent-bound"
  ]
}
```

Submission flow:

```text
Worker proposal
    ↓
Structural checker
    ↓
Dependency materializer
    ↓
Fresh verifier
    ↓
Accepted or rejected
```

On acceptance:

- Existing theorem proof: atomically replace only the proof section.
- New lemma: create an appropriately named canonical QMD module.
- Record verification metadata separately.
- Rebuild the manifest and dependency graph.
- Preserve the user-owned statement exactly.

On rejection:

- Preserve the proposal.
- Store the verifier report.
- Return repair hints.
- Do not modify canonical mathematics.

---

## 15. Concurrency

Multiple workers may operate simultaneously, but:

- Each worker has a private workspace.
- Each proposal has a unique identifier.
- Canonical writes use file locks.
- Accepted results merge through one controlled path.
- A worker must re-run `tw check` against the latest project state before submission.
- If a dependency changed after the proposal was created, submission is rejected as stale.
- Every state transition is appended to:

```text
.theoremweave/events.jsonl
```

---

## 16. Dependency graphs and navigation

The rendered project must provide three connected views:

```text
Narrative exposition
        ↕
Definitions, lemmas, and theorems
        ↕
Interactive dependency graph
```

Ordinary references such as:

```markdown
@lem-local-bound
```

must use Quarto’s standard clickable cross-reference behavior.

For generated dependency graphs:

- Definitions, lemmas, and theorems use distinct node styles.
- Verified, candidate, rejected, and open nodes use distinct status styles.
- Clicking a node navigates to its semantic block.
- Hovering shows:
  - kind;
  - title;
  - statement;
  - status;
  - source module.
- HTML math should render in the popup when practical.
- Non-HTML formats receive a readable static graph and dependency list.

Do not assume Mermaid or Graphviz automatically turns `@thm-*` text into Quarto cross-references. The generator must emit explicit links and a stable project-owned hover implementation.

---

## 17. Configuration

Example `theoremweave.yml`:

```yaml
project:
  name: uniform-index
  source-dirs:
    - goals
    - modules
    - exposition

goals:
  id-prefix: thm-main-
  protect-statements: true

semantic:
  definitions:
    - def-
  lemmas:
    - lem-
  theorems:
    - thm-
  propositions:
    - prp-
  corollaries:
    - cor-
  wildcard-imports: false
  require-declared-uses: true

verification:
  backend: codex
  model: configurable
  effort: high
  fresh-context: true
  require-zero-gaps: true

workers:
  default-count: 4
  round-timeout-seconds: 14400
  max-consecutive-failures: 5

render:
  graph-engine: graphviz
  hover-previews: true
  output-dir: _site
```

Do not hardcode model names. Codex and Claude backends must be configurable.

---

## 18. `AGENTS.md` contract

Every project’s `AGENTS.md` should tell agents:

1. Run `tw status` and `tw check` before working.
2. Read the assigned goal through `tw view`.
3. Never modify a `thm-main-*` statement.
4. Never mark a theorem verified.
5. Use semantic blocks for every reusable mathematical result.
6. Cite every logical dependency with an `@def-*`, `@lem-*`, or `@thm-*` reference.
7. Do not rely on ordinary prose as a mathematical premise.
8. Search existing modules before creating a new lemma.
9. Write new work as an isolated proposal.
10. Submit through `tw submit`.
11. Repair rejected proofs from verifier feedback.
12. Record meaningful failed approaches so other workers do not repeat them.
13. Continue until the assigned goal is verified, refuted, blocked, or explicitly stopped.

The initialized `AGENTS.md` should be complete enough that a fresh Codex or Claude session can operate the project correctly.

---

## 19. Correctness and trust

The system must distinguish:

```text
structurally valid
mathematically candidate
LLM-verified
formally verified
human-reviewed
```

These statuses must never be conflated.

Suggested verification metadata:

```json
{
  "structural_status": "valid",
  "proof_status": "verified",
  "verification_backend": "codex",
  "formal_backend": null,
  "human_review": false
}
```

A future Lean or other formal backend should be able to upgrade a result without redesigning the QMD module system.

---

## 20. Testing requirements

Implement tests for:

- Semantic AST extraction.
- Ignoring arbitrary non-semantic QMD.
- User goal discovery through `thm-main-*`.
- Empty goal proof detection.
- User statement mutation detection.
- Definition, lemma, and theorem extraction.
- Same-file references.
- Cross-file imports.
- Import aliases.
- Missing imports.
- Duplicate IDs.
- Alias collisions.
- Import cycles.
- Theorem dependency cycles.
- Logical references inside semantic blocks.
- Navigational references outside semantic blocks.
- Manifest determinism.
- Goal state transitions.
- Proposal isolation.
- Atomic accepted-proof merge.
- Rejected proposals not modifying canonical files.
- Concurrent proposal submission.
- Stale dependency rejection.
- Transitive graph generation.
- Clickable graph nodes.
- Hover-preview metadata.
- HTML escaping.
- Agent workflow from open goal to accepted proof.

Provide a complete end-to-end fixture with:

- At least three QMD modules.
- At least two `thm-main-*` goals.
- Shared definitions.
- Several intermediate lemmas.
- One accepted proof.
- One rejected proof followed by a repair.
- A generated interactive graph.
- A rendered Quarto website.

---

## 21. Implementation phases

### Phase 1: Semantic compiler

Implement:

- Structured QMD parsing.
- Semantic blocks.
- Imports.
- Reference resolution.
- Manifest.
- Dependency graph.
- `tw check`, `tw view`, and `tw graph`.

### Phase 2: Proposal and verification system

Implement:

- Proposal directories.
- Submission.
- Verification backend interface.
- Fresh verifier sessions.
- Accepted and rejected result storage.
- Atomic merge.
- Goal state machine.

### Phase 3: Agent workflow

Implement:

- Project `AGENTS.md`.
- Skills.
- Worker workspaces.
- Task assignment.
- Persistent local and shared state.
- Multi-worker orchestration.

### Phase 4: Quarto interface

Implement:

- Rendered theorem navigation.
- Dependency-graph pages.
- Clickable nodes.
- Full hover previews.
- Status styling.
- Reports.

### Phase 5: Hardening

Implement:

- Concurrency locks.
- Stale proposal detection.
- Revocation.
- Dependency invalidation.
- Security checks.
- Formal-verifier extension point.

---

## 22. Acceptance criteria

The implementation is complete when a user can:

1. Initialize a project.
2. Add several empty `thm-main-*` theorem blocks.
3. Run `tw check`.
4. Launch multiple Codex or Claude workers.
5. Have workers inspect modules through project skills.
6. Have workers create intermediate lemmas and candidate proofs.
7. Submit those proofs to an independent verifier.
8. Merge only accepted mathematics.
9. Continue proof search across fresh agent sessions.
10. Render a Quarto website.
11. Click and hover theorem references.
12. Explore the dependency graph of any main theorem.
13. Clearly distinguish open, candidate, verified, rejected, and refuted results.

---

## 23. Instructions to the implementation agent

Inspect the existing repository before making architectural changes. Reuse existing conventions where appropriate.

Implement the system rather than only describing it.

Prioritize:

1. Correct semantic parsing.
2. Protected user goals.
3. Deterministic dependency checking.
4. Safe proposal and verification workflow.
5. Useful agent skills.
6. Multi-agent resumability.
7. Readable Quarto output.
8. Interactive dependency navigation.

After implementation:

- Run all tests.
- Create the demonstration project.
- Launch at least one complete proof workflow using a test or mock verifier.
- Render the site.
- Verify graph clicking and hovering in a browser.
- Document installation and usage.
- Report remaining limitations honestly.
