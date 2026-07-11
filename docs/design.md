# Design — qmd-prover

## 1. Purpose

qmd-prover is a Quarto-based, agentic mathematical prover operated through
Codex, Claude, or another coding agent.

The user writes facts needing proofs as semantic theorem blocks whose IDs match:

```text
thm-main-*
```

`main` means a user-given top-level proof obligation, not an accepted premise.
The user asks an agent in natural language to prove one goal or all open goals.
The agent reads the project's `AGENTS.md`, loads the centralized
`qmd-prover` skill, and iterates until each target is verified, refuted,
genuinely blocked, cancelled, or explicitly stopped.

Humans do not need to learn internal commands. The system combines:

1. Human-readable QMD mathematics.
2. Explicit imports and semantic dependencies.
3. Compiler-like structural validation.
4. Persistent multi-agent state.
5. Independent verification.
6. Rendered theorem navigation and dependency graphs.

This is initially an agentic informal prover, not a formal proof assistant.
`verified` means accepted by the configured verifier; formal verification may
be added later.

## 2. Design principles

- **Canonical mathematics is readable QMD.** Definitions, results, proofs,
  exposition, and citations remain pleasant for humans to edit.
- **QMD remains unrestricted.** Only recognized semantic blocks and import
  blocks participate in dependency checking.
- **Main statements are user-owned.** Agents must not alter the ID, title,
  hypotheses, quantifiers, or statement of a `thm-main-*` goal.
- **Verification controls truth.** Agents propose work but cannot mark it
  verified.
- **Dependencies are explicit.** Every logical premise is cited with a semantic
  `@` reference and made available by the current file or an import.
- **Parallel work is isolated.** Workers write proposals; accepted changes enter
  canonical QMD through one atomic merge path.
- **Natural language is the user interface.** Deterministic operations are
  handled by one skill-owned Node dispatcher.
- **Project organization is local policy.** `AGENTS.md`, not qmd-prover,
  decides when related mathematics should be grouped into a folder.

## 3. User experience

A project begins with `AGENTS.md` and one or more QMD files. For example:

```text
uniform-index.qmd
matroids/bound.qmd
asymptotics/limit.qmd
```

Each open goal has a `thm-main-*` block with an empty `Proof` section. The
user may say:

```text
Prove all open main theorems. Work in parallel where the goals are independent,
keep every theorem statement unchanged, verify each candidate, and continue
repairing rejected proofs.
```

For one goal:

```text
Prove @thm-main-uniform-index and preserve useful progress for later sessions.
```

The agent interprets the request, runs the centralized project inspection,
coordinates workers, submits candidate proofs, reports verification outcomes,
and renders results when asked.

## 4. Project structure

The only reserved auxiliary directory is `.qmd-prover/`. Mathematical folders
are optional and are created by the agent according to `AGENTS.md`.

```text
my-math-project/
├── AGENTS.md
├── uniform-index.qmd
├── matroids/                    # optional subject folder
│   └── bound.qmd
└── .qmd-prover/
    ├── config.yml
    ├── _quarto.yml
    ├── manifest.json
    ├── graph.json
    ├── goal-locks.json
    ├── events.jsonl
    ├── tasks/
    ├── workers/
    ├── proposals/
    ├── verification/
    ├── accepted/
    ├── rejected/
    ├── dead-ends/
    ├── reports/
    ├── graphs/
    ├── site/
    └── cache/
```

Canonical, version-controlled content consists of `AGENTS.md` and mathematical
sources. Configuration, indexes, worker state, proposals, verification records,
graphs, reports, rendered output, and caches stay under `.qmd-prover/`.

`.qmd-prover/` should normally be ignored by Git unless the project chooses to
preserve search traces or generated artifacts.

## 5. QMD semantic format

### 5.1 Open user goal

```markdown
::: {#thm-main-uniform-index .theorem .goal}
## Uniform index theorem

### Statement

Let \(\pi\colon X\to B\) satisfy the stated hypotheses. There exists an
integer \(I>0\) such that every admissible fiber has total Cartier index
dividing \(I\).

### Proof

:::
```

An empty proof means `open`. On first inspection, the normalized statement is
hashed:

```json
{
  "id": "thm-main-uniform-index",
  "origin": "user",
  "statement_hash": "sha256:...",
  "status": "open"
}
```

### 5.2 Reusable result

```markdown
::: {#lem-local-exponent-bound .lemma export="local-exponent-bound"}
## Local exponent bound

### Uses

- @def-total-cartier-index
- @thm-local-class-group-finite

### Statement

The exponent of the local class group is bounded by \(N\).

### Proof

Apply @thm-local-class-group-finite and the presentation estimate from
@lem-determinant-bound.
:::
```

Definitions, propositions, corollaries, and ordinary theorems use the same
shape with the appropriate semantic class and ID prefix.

### 5.3 Candidate main proof

```markdown
::: {#thm-main-uniform-index .theorem .goal}
## Uniform index theorem

### Statement

The original user-owned statement appears here unchanged.

### Uses

- @lem-local-exponent-bound
- @lem-finite-stratification

### Proof

Apply @lem-local-exponent-bound on each stratum supplied by
@lem-finite-stratification, then take the least common multiple.
:::
```

A nonempty proof is a candidate, not automatically verified.

## 6. Imports and semantic references

Cross-file dependencies are explicit:

```markdown
::: {.theorem-imports}
from: foundations/local-groups.qmd
use:
  - @def-local-class-group
  - @thm-local-class-group-finite
:::
```

Initial import rules:

1. Imported IDs must exist and be exported.
2. Wildcard imports are forbidden.
3. Missing files, collisions, and import cycles are errors.
4. A proof may use results in its file or explicitly imported results.
5. Only verified results may support a verified proof.

Reserved semantic prefixes are `@def-*`, `@lem-*`, `@thm-*`, `@prp-*`,
and `@cor-*`. A semantic reference inside a proof creates a dependency edge.
The same reference in ordinary exposition is navigational only. Bibliographic
citations remain separate.

## 7. Semantic compiler

The compiler reads QMD through Pandoc's JSON AST or a Quarto/Pandoc Lua filter;
regular expressions must not be the primary parser. It writes:

```text
.qmd-prover/manifest.json
.qmd-prover/graph.json
```

Project inspection validates:

- QMD parseability and semantic block shape.
- ID prefixes, uniqueness, and statement hashes.
- Imports, exports, aliases, and dependency cycles.
- Availability and verification status of referenced results.
- Agreement between `Uses` and references appearing in proofs.
- Open goals and candidates awaiting verification.

Diagnostics are source-located and actionable. Open goals do not make
inspection fail; structural errors produce a nonzero dispatcher exit code.

## 8. Goal state and verification

States:

```text
open → in-progress → candidate → verifying → verified
                         ↘ rejected → in-progress
open or in-progress → refuted
verified → revoked
open or in-progress → blocked
```

Only the verifier can set `verified` or `rejected`. Revocation uses a
controlled operation with a recorded reason.

For every submission, a fresh verifier receives only:

- The exact target statement and candidate proof.
- Imported definitions and cited verified statements.
- Declared hypotheses and source references.
- No unrelated narrative or worker strategy.

It returns:

```json
{
  "verdict": "correct",
  "summary": "...",
  "critical_errors": [],
  "gaps": [],
  "repair_hints": ""
}
```

Acceptance requires `verdict: correct` with empty `critical_errors` and
`gaps`.

## 9. Agent workflow

The main agent:

- Reads `AGENTS.md` and loads the `qmd-prover` skill.
- Inspects all open `thm-main-*` goals.
- Identifies independent goals and assigns workers without duplicating work.
- Monitors proposals and verification results.
- Preserves progress across sessions.
- Never marks mathematics verified directly.

Each worker receives `.qmd-prover/workers/<worker-id>/TASK.md` and follows:

```text
1. Read AGENTS.md and the assignment.
2. Run inspect-project.
3. Inspect the target and its dependency context.
4. Review accepted mathematics, previous attempts, and verifier reports.
5. Develop the mathematics and write an isolated proposal.
6. Run submit-proof.
7. Revise rejected work from concrete feedback and resubmit.
8. Stop only when verified, refuted, genuinely blocked, cancelled, or stopped.
```

Worker memory and `.qmd-prover/events.jsonl` provide continuity.

## 10. Centralized skill and command

qmd-prover is delivered as one standard Codex skill outside the project:

```text
~/.codex/skills/qmd-prover/
├── SKILL.md
├── agents/
│   └── openai.yaml
└── scripts/
    └── qmd-prover.mjs
```

The invocation form is:

```bash
node ~/.codex/skills/qmd-prover/scripts/qmd-prover.mjs <subcommand> [arguments]
```

The initial top-level subcommands are:

```bash
node ~/.codex/skills/qmd-prover/scripts/qmd-prover.mjs inspect-project
node ~/.codex/skills/qmd-prover/scripts/qmd-prover.mjs inspect-theorem @thm-main-ID
node ~/.codex/skills/qmd-prover/scripts/qmd-prover.mjs submit-proof PROPOSAL_FILE
node ~/.codex/skills/qmd-prover/scripts/qmd-prover.mjs verification show SUBMISSION_ID
node ~/.codex/skills/qmd-prover/scripts/qmd-prover.mjs render
```

- `inspect-project`: discover QMD recursively, rebuild indexes, validate
  structure, and return goal and verification status.
- `inspect-theorem`: return a bounded bundle containing the statement,
  imports, dependency closure, current proof, and verification history.
- `submit-proof`: validate and materialize a proposal, invoke a fresh verifier,
  and merge only an accepted result.
- `verification show`: return a stored verifier report.
- `render`: write reports, graphs, and the Quarto site under `.qmd-prover/`.

Controlled revocation remains under the `verification` namespace:

```bash
node ~/.codex/skills/qmd-prover/scripts/qmd-prover.mjs verification revoke @thm-ID --reason "..."
```

There is no separate `check`, `status`, `goals`, `deps`, `graph`,
worker, or `prove` command. Those behaviors are folded into the operations
above or remain agent responsibilities.

The dispatcher runs from the project root, accepts explicit arguments, emits
stable JSON where appropriate, writes diagnostics to standard error, returns
meaningful exit codes, protects main statements, and writes project-owned
auxiliary output only under `.qmd-prover/`.

## 11. Proposals and concurrency

A proposal is isolated:

```text
.qmd-prover/proposals/<proposal-id>/
├── proposal.qmd
├── metadata.json
└── supporting-notes.md
```

Submission flow:

```text
proposal → structural validation → dependency materialization
         → fresh verifier → accepted or rejected
```

On acceptance, the merge path:

- Replaces only the proof section of an existing theorem.
- Places a new lemma according to `AGENTS.md` and nearby mathematics.
- Preserves the user-owned main statement.
- Records verification metadata and rebuilds indexes atomically.

On rejection, canonical mathematics is unchanged; the proposal and verifier
report remain available for repair.

Concurrent workers use private workspaces and unique proposal IDs. Canonical
writes are locked. Submission reruns project inspection and rejects stale
dependencies. Every state transition is appended to
`.qmd-prover/events.jsonl`.

## 12. Rendering and navigation

Rendering connects:

```text
narrative exposition ↔ semantic results ↔ dependency graph
```

The rendered site provides clickable theorem references, hover previews, goal
status, proof reports, and dependency graphs. Graph nodes distinguish semantic
kind and verification state; clicking navigates to the source block.

The generator must create explicit links rather than assuming Mermaid or
Graphviz understands Quarto cross-references. Non-HTML formats receive a static
graph and readable dependency list. All output stays under
`.qmd-prover/site/`, `.qmd-prover/graphs/`, or `.qmd-prover/reports/`.

## 13. Configuration

Example `.qmd-prover/config.yml`:

```yaml
project:
  name: uniform-index
  root: ..
  discover-qmd-recursively: true
  exclude: [.qmd-prover]

organization:
  source: AGENTS.md
  fixed-content-directories: false

goals:
  id-prefix: thm-main-
  protect-statements: true

semantic:
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
  max-consecutive-failures: 5

render:
  graph-engine: graphviz
  hover-previews: true
  output-dir: .qmd-prover/site
```

Verifier backends and model names are configurable, not hardcoded.

## 14. `AGENTS.md` contract

`AGENTS.md` is the normative, version-controlled instruction file. It defines:

- The `thm-main-*` convention and immutable statement boundary.
- Where related mathematical files should live.
- The QMD proof format and semantic reference rules.
- The centralized skill and workflow.
- The prohibition on self-verification and direct canonical merges.

It must include a template:

```markdown
::: {#thm-main-example .theorem .goal}
## Theorem title

### Statement

The user-owned statement. Do not edit this section.

### Uses

- @def-required-definition
- @lem-required-lemma

### Proof

Write a complete argument. Introduce notation before use, justify nontrivial
steps, and cite every logical dependency.
:::
```

Required writing rules:

1. Preserve every `thm-main-*` ID, title, hypotheses, and statement.
2. Put logical dependencies in `Uses` and cite them where applied.
3. State agent-created results precisely, including hypotheses and quantifiers.
4. Use only declared imports and verified results as premises.
5. Distinguish general proof from examples, computation, or intuition.
6. Record external results precisely enough to check their applicability.
7. Keep verification metadata outside mathematical proofs.
8. If a main statement appears false, preserve it and submit a precise
   refutation; changing it requires explicit user approval.

`AGENTS.md` tells agents—not humans—to use the globally installed
`qmd-prover` skill and its dispatcher. Agents translate command output
into natural-language status and requests.

## 15. Correctness and testing

The system distinguishes:

```text
structurally valid
mathematically candidate
LLM-verified
formally verified
human-reviewed
```

These states must never be conflated. Verification metadata records the backend,
formal status, and human-review status separately.

Tests cover:

- AST extraction and arbitrary nonsemantic QMD.
- Recursive discovery under arbitrary subject folders.
- Main-goal discovery, empty proofs, and statement mutation.
- Imports, aliases, duplicates, cycles, and semantic references.
- Deterministic manifests and goal-state transitions.
- Proposal isolation, rejection safety, atomic merge, and stale submissions.
- Concurrent workers and event persistence.
- Fresh-context verification and repair after rejection.
- Graph generation, links, hover metadata, and HTML escaping.
- Natural-language triggering of the centralized skill.
- Dispatcher behavior and containment of all auxiliary writes in
  `.qmd-prover/`.

An end-to-end fixture includes several QMD files in a project-specific layout,
at least two main goals, shared definitions, intermediate lemmas, one accepted
proof, one rejected-and-repaired proof, and a rendered site.

## 16. Implementation and acceptance

Implementation order:

1. AST parsing, semantic blocks, imports, manifest, and graph.
2. Centralized `qmd-prover` skill with `qmd-prover.mjs`.
3. Proposal storage, fresh verification, atomic merge, and state machine.
4. `AGENTS.md`, worker state, event persistence, and concurrency.
5. Rendering, navigation, reports, hardening, and formal-verifier extension.

The implementation is complete when a user can:

1. Open a project containing `AGENTS.md` and mathematical QMD files.
2. Add several empty `thm-main-*` goals in any sensible organization.
3. Ask an agent in natural language to prove one goal or all goals.
4. Have the agent inspect, coordinate, prove, verify, and repair without
   requiring command knowledge.
5. Preserve user statements and merge only verified mathematics.
6. Resume across sessions and parallel workers without losing progress.
7. Ask naturally for status, reports, graphs, or rendering.
8. Read the rendered site and distinguish open, candidate, verified, rejected,
   refuted, blocked, revoked, and human-reviewed states.

The implementation agent must inspect the repository, run all tests, exercise a
complete proof workflow with a test or mock verifier, render the site, verify
navigation in a browser, and report limitations honestly.

## 17. Future directions

Future versions may add optional proof-guidance tools:

- `decompose-goal` and `search-mathematics` for planning and literature search.
- `construct-examples` and `construct-counterexamples` for testing claims.
- `direct-proving` and `repair-proof` for drafting or revising arguments.

They are not part of the initial command interface or project structure and
should be considered only after the centralized core is reliable.
