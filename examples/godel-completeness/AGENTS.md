# Mathematical project instructions

<!-- qmd-prover-contract:start version=20 -->

## Contents

- [Project setup](#project-setup)
- [External mathematical basis](#external-mathematical-basis)
- [qmd-prover contract](#qmd-prover-contract)
- [Proof development in the project](#proof-development-in-the-project)
- [Verification discipline](#verification-discipline)
- [Agent workflow](#agent-workflow)

## Project setup

The user normally adds the `qmd-prover` skill and asks the agent in natural language to initialize the current project. From the project root, run:

```bash
node "${CODEX_HOME:-$HOME/.codex}/skills/qmd-prover/scripts/qmd-prover.js" init
```

The command reports any existing `AGENTS.md`, QMD sources, Quarto configuration, `.qmd-prover` state, and external-basis mode. If it returns `intent-required`, summarize what exists and ask whether the user wants to adopt those files in place, inspect them first, or leave them unchanged. Run `--adopt-existing` only after the user chooses adoption.

With no existing project content, the command creates a root `AGENTS.md` with the canonical managed block. It is idempotent when the current block is already present. If `AGENTS.md` exists without the block, preserve it and ask before rerunning with `--append-contract`. If it contains an older or different managed block, ask before using `--sync-contract`; synchronization replaces only that block. Put local project rules outside the managed block.

Setup requires no QMD scaffold or initial theorem, and proving a goal requires no per-goal setup either: a protected goal with no proof yet is simply open.

## External mathematical basis

Before writing or checking mathematics, read `.qmd-prover/.external.qmd` if it exists. It is project-owned ordinary QMD controlling which results may be taken from outside the project:

| State | Meaning |
|---|---|
| file absent | External results are unrestricted. Identify them precisely and check every hypothesis. |
| file present but whitespace-only | Use no external mathematical results; develop every needed result in the project. |
| file has content | Use only the external results or classes of results allowed by that content. |

Equivalently: An absent file permits external mathematics subject to precise hypothesis checks; a whitespace-only file permits none; a nonempty file permits only its stated basis.

The agent may revise this file when the user's request or the developing proof context requires a different external basis, but it must make that change explicit. The exact content is verifier context. Any change invalidates affected verification cache keys and requires the relevant facts to be checked again.

The external basis is the only channel for outside mathematical premises. It does not create semantic graph nodes; every in-project premise is instead an ordinary `@id` dependency subject to import scope.

## qmd-prover contract

Every QMD file in the project is semantic mathematics compiled into one dependency graph; `.qmd-prover/` holds only derived tool state. Protected goal IDs begin `thm-main-`; every registered goal has exactly the classes `.theorem .goal`, a nonempty human-readable `name`, an ISO `date`, and a nonempty statement. Preserve its ID, `name`, classes, hypotheses, quantifiers, and statement body exactly. Edit pre-existing user files cautiously and only as the developing mathematics requires; never reformat prose that carries no semantic block.

A semantic declaration is a fenced Div with one stable ID, exactly one kind class, a nonempty `name`, an ISO introduction `date`, and a nonempty body. Its ID prefix must match its kind:

| Block | ID | Discipline |
|---|---|---|
| `.definition` | `def-*` | Introduce a term, object, or notation. The body is its construction; `@id` citations there are construction dependencies. Put any existence, uniqueness, or well-definedness argument in a linked proof. |
| `.lemma` | `lem-*` | State an auxiliary result. A lemma has the same proof standard as every other result. |
| `.proposition` | `prp-*` | State a useful standalone result that is not presented as a principal theorem. The distinction is expository only. |
| `.theorem` | `thm-*` | State a principal result and justify it in a separate linked proof. |
| `.corollary` | `cor-*` | State a consequence, but cite the earlier result explicitly in its linked proof. The label creates no dependency. |
| `.proof` | none | Justify exactly one declaration. Give it no ID; set `of` to the declaration ID and cite every logical dependency with `@id` at its point of use. |

A definition may have a linked proof when its construction needs justification. Every non-definition candidate needs one nonempty linked proof. A declaration and its linked proof normally remain in the same QMD file. The exception is a protected main goal: its declaration stays in the user's note, while its linked proof may live in any project file, such as `workspace/main-proof.qmd`.

Cite the defining declaration of any specialized term at its first load-bearing use. When a definition body or a linked proof relies on a term, object, or notation that is not standard mathematical vocabulary, cite its `@def-id` — or the `@id` of whatever result fixes it — at that point, so the dependency is recorded and the verifier can resolve the term against the cited construction. Standard vocabulary needs no citation, and the verifier is the authority on what counts as standard: the `verification.citations` setting (`lenient`, `standard`, or `strict`) governs how aggressively it scrutinizes terms and reports an uncited non-standard term as a gap, while the separate `verification.rigor` setting governs how completely each proof step must be spelled out.

An `@id` citation records a logical dependency but does not make a declaration from another file available. Same-file citations need no scope metadata. Every cross-file dependency requires both of these steps:

1. In the producer file, export the declaration under its exact semantic ID:

```markdown
::: {#lem-local-class-group-finite .lemma name="Local class group is finite" date="2026-07-12" export="lem-local-class-group-finite"}
The local class group is finite.
:::

::: {.proof of="lem-local-class-group-finite"}
Give the proof here.
:::
```

2. In the consumer file, import that exact ID in the front matter:

```yaml
---
qmd-prover:
  imports:
    - from: foundations/local-groups.qmd
      use:
        - lem-local-class-group-finite
---
```

`from` is relative to the importing QMD file. Each `use` entry is one semantic ID, the producer must set `export` to that same ID, and wildcard or implicit imports are forbidden. Importing grants scope but does not itself declare a logical dependency: cite the imported result at its point of use. Do not add a separate `Uses` list. References in surrounding prose are navigational, and bibliographic citations such as `[@rudin1976]` remain ordinary Quarto citations.

In schematic form, the producer uses `export="<same-ID>"`, and the consumer imports that exact ID; `from` is relative to the consumer file.

Every explicit semantic ID is globally unique across the project. A linked `.proof of="thm-main-ID"` is an overlay for the protected target and is not a second declaration; never redeclare that target. Any fact may cite any other project fact, including a protected main goal, subject to the import scope rules above; global composition keeps dependents blocked until every cited fact is itself globally verified.

For theorem-like declarations, the first nonempty proof paragraph may be one workflow marker. For a definition, only `OPEN` or `REJECTED` may appear, in the last nonempty declaration paragraph. A definition may not be marked `DISPROVED`; challenge an existence, uniqueness, or well-definedness claim in the linked theorem-like result that states it.

| Marker | Meaning |
|---|---|
| `OPEN` | Incomplete active attempt. |
| `REJECTED` | Inactive failed attempt. |
| `DISPROVED` | Proposed counterexample or refutation of the exact theorem-like statement. It remains conditional evidence until locally checked and globally composed. |
| no marker | Candidate awaiting local conditional verification. |
| `VERIFIED` | Reserved. Never write it; a source file claiming verification is a structural error. |
| `REVOKED` | Reserved. Never write it; verification is never revoked through QMD source. |

The body following `DISPROVED` must give the actual counterexample or refutation, check the hypotheses, and explain why the stated conclusion fails. The verifier checks it conditionally on the exact direct dependency statements. A locally accepted refutation is conditional evidence; it becomes globally disproved only when machine analysis also establishes that its complete dependency closure is globally verified. A failed refutation is locally rejected. The verifier may also discover and report a counterexample while checking an ordinary candidate, without changing its QMD source.

Verification state lives in the project's exact verification cache and published snapshot as separate mechanical, local conditional, and global fields, never in a source marker.

## Proof development in the project

Any file in any folder of the project is part of the same unified mathematics; folders are organizational structure for humans and agents, never a semantic boundary. By convention, put new agent-created definitions, intermediate results, proof attempts, calculations, examples, counterexamples, and planning notes under a `workspace/` folder in the project root, and organize files inside it however best serves the argument — by theme, by goal, or flat. Local project policy may suggest folder principles; imports and citations work identically across any layout.

- Maintain a progress note with the active route, proved frontier, open dependencies, and abandoned approaches when the development is large enough to need one.
- Put semantic definitions and intermediate results with their linked proofs in coherent subject QMD files.
- Put only the linked proof of a protected main goal in its proof overlay file, such as `workspace/main-proof.qmd`; do not repeat or rewrite the theorem.
- Follow every unproved dependency until it has its own proof. A plan, example, computation, or prose sketch is not a completed proof.
- Keep a failed route when it is useful for future work, but mark it `REJECTED` so it cannot silently become an active premise.
- When a precise counterexample or refutation shows that a theorem-like statement is false, keep the statement unchanged, mark its linked proof `DISPROVED`, and submit the refutation to inspection.

After each coherent batch of semantic-QMD changes, run the narrowest useful inspection:

```bash
node "${CODEX_HOME:-$HOME/.codex}/skills/qmd-prover/scripts/qmd-prover.js" inspect fact @ID
node "${CODEX_HOME:-$HOME/.codex}/skills/qmd-prover/scripts/qmd-prover.js" inspect path PATH
node "${CODEX_HOME:-$HOME/.codex}/skills/qmd-prover/scripts/qmd-prover.js" inspect project
```

Fact and path inspection select the facts needed for the requested global result: the selected facts and their transitive local dependency closure. Every selected fact receives an independent local check when its exact target, proof, and direct dependency statements can be materialized. Reverse dependencies and unrelated facts are not checked. A full project inspection checks every fact.

Local verifier decisions, globally composed results, and refutation evidence remain under `.qmd-prover/` as persistent project state for later inspection and future paper-building. Never copy a proof, refutation, or status marker into a protected statement.

## Verification discipline

Passing one layer does not imply passing another:

| Layer | Enforced by | Covers |
|---|---|---|
| Mechanical | Compiler, project index, and inspector | Main-goal shape and locks, declaration shape, dates, IDs, imports, references, proof association, global uniqueness, dependency cycles, and snapshot freshness. This layer never reads an AI verdict. |
| Local conditional | Independent external verifier | Assuming the exact direct dependency statements are true, whether the submitted proof establishes the exact target, or whether the submitted refutation defeats it. The verifier does not inspect dependency proofs or states. |
| Global composition | Inspector over the dependency graph | A result is globally verified only when its mechanical layer passes, its local proof is accepted, and every direct dependency is globally verified. Cycles and invalid edges prevent global verification. |
| Agent conduct | This contract | Project ownership, protected goals, the `workspace/` layout convention, accurate reporting, and response to verification findings. |

Machine dependency analysis and local AI verification have separate state. Machine analysis always builds the available graph and reports existence, scope, import/export, cycle, and source diagnostics without consulting AI. Local verification assumes only the supplied direct dependency conclusions and checks the proof that is actually stored; an unverified or rejected upstream proof does not suppress this local check. A local proof is accepted only with `verdict: "correct"` and no critical errors or gaps. A local refutation is accepted only with `verdict: "disproved"`, a nonempty independently checkable refutation, and no critical errors or gaps.

The local cache key contains the target statement or construction, submitted proof or refutation, exact direct dependency statements, semantic context, external basis, checker contract, and protocol. It does not contain dependency proof text, dependency verification state, or a transitive proof closure. Changing an upstream proof while preserving its statement therefore recomputes global state without invalidating unchanged downstream local decisions. Changing a direct dependency statement invalidates the affected local decisions.

Global composition is deterministic. A mechanically valid result with a locally accepted proof is globally verified exactly when every direct dependency is globally verified. A locally conclusive result with an unverified, rejected, disproved, invalid, or cyclic dependency is blocked. Without a configured verifier, machine inspection still succeeds when its own inputs are valid, every local result is `not-run`, and every mathematical result remains globally unverified. `ok` reports whether the requested inspection operation and configured verifier execution completed without machine or verifier-infrastructure errors; read `global_verification`, not `ok`, as the mathematical status.

A narrow fact or path inspection verifies only the selected facts and their transitive local dependency closure; it never verifies reverse dependencies or unrelated facts.

Apply these rules:

1. State agent-created mathematics precisely: introduce notation, scope variables, include every nontrivial hypothesis, and justify reductions, existence, finiteness, well-definedness, and limit passages.
2. Identify external theorems precisely enough to check applicability. Keep examples, computations, and intuition distinct from a general proof.
3. If a main goal appears false, preserve it, place a precise `DISPROVED` refutation in its proof overlay, and run inspection. Report the refutation as globally established only when `global_verification.status` is `disproved`; a local disproof with blocked dependencies remains conditional. Change the protected statement only with explicit user approval.
4. Keep prose mathematical and readable. Apart from a permitted first-paragraph workflow marker, keep verifier metadata, search notes, and confidence claims out of declarations and proofs.
5. Before relying on a fact, inspect its global state. Use it as an established premise only when `global_verification.status` is `verified`. A local conditional pass is not enough, and a globally disproved fact is evidence about the false statement, not a usable dependency.
6. Repair every mechanical diagnostic and every local verifier critical error or gap. An unconfigured verifier is a supported machine-only mode and leaves local/global verification incomplete. If the user requests AI verification and the verifier is missing, failing, or malformed, repair `verification.command` or `QMD_PROVER_VERIFIER`; do not loop and do not declare the result verified yourself.

`inspect project` compiles every project QMD file into one graph, runs machine analysis and optional local conditional verification for every fact, and returns a lean schema-v6 view: a summary, the goals, one compact status row per fact, finding counts, and verification totals. Pass `--graph` for the full dependency graph, which is also written to `.qmd-prover/graph.json`. One malformed file does not suppress results elsewhere. Operational success does not imply that every goal is globally verified; inspect each goal's global field and blockers.

`inspect fact @ID` locates any explicit declaration, including a protected main goal; for a goal it uses the goal's linked proof overlay and user notes stay byte-for-byte unchanged. `inspect path` applies the full semantic contract to the facts declared under any project file or folder.

Dependency commands use the published project graph. If an explicit semantic ID is declared more than once, dependency analysis stops until the conflicting declarations are renamed. These conditions are command diagnostics, not source markers, and are never written into QMD.

`check staleness` is read-only. It audits the exact verification caches against current sources, the external basis, and the checker contract; it never edits user QMD or markers.

## Agent workflow

Load the `qmd-prover` skill and let the user work in natural language. qmd-prover does not prescribe a fixed proof strategy: the user may supply one theorem, a family of goals, an existing development, or an idea from which the agent formulates precise definitions and results. Choose the order and granularity of the mathematics from the developing argument.

Before proof work, compare this managed block with the skill's canonical contract and read the external-basis policy. Reuse that successful preflight only while the agent, project, branch, worktree, `AGENTS.md`, and external policy remain unchanged. Every independent agent must perform the preflight for itself.

Use project inspection for deliberate whole-project audits, fact or path inspection for iteration, dependency queries for graph analysis, and rendering for generated status/navigation views. Translate dispatcher JSON into ordinary language; do not require the user to learn the commands.

The safety gates remain mandatory: never edit a protected user statement, never use a merely local, stale, blocked, or unverified claim as established, never describe AI review as formal truth, and never bypass exact-cache freshness, local verification integrity, deterministic global composition, rejection safety, or atomic snapshot publication.

<!-- qmd-prover-contract:end -->

## Project-specific additions

- For the current goal, put new proof QMD under `workspace/` and leave `completeness.qmd` unchanged.
- Develop Gödel's completeness theorem from explicit foundations of first-order logic: signatures, terms, formulas, substitution, proof calculus, structures, assignments, satisfaction, and semantic consequence.
- State useful intermediate definitions and results as semantic QMD blocks and cite every logical dependency at its point of use.
- Do not assume completeness, compactness, model existence, the Henkin theorem, or any equivalent result as an unproved black box.
