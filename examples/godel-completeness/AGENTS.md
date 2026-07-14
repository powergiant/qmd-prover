# Mathematical project instructions

<!-- qmd-prover-contract:start version=14 -->

## Contents

- [Project setup](#project-setup)
- [External mathematical basis](#external-mathematical-basis)
- [qmd-prover contract](#qmd-prover-contract)
- [Proof-development workspace](#proof-development-workspace)
- [Verification discipline](#verification-discipline)
- [Agent workflow](#agent-workflow)

## Project setup

The user normally adds the `qmd-prover` skill and asks the agent in natural language to initialize the current project. From the project root, run:

```bash
node "${CODEX_HOME:-$HOME/.codex}/skills/qmd-prover/scripts/qmd-prover.js" init
```

The command reports any existing `AGENTS.md`, QMD sources, Quarto configuration, `.qmd-prover` state, and external-basis mode. If it returns `intent-required`, summarize what exists and ask whether the user wants to adopt those files in place, inspect them first, or leave them unchanged. Run `--adopt-existing` only after the user chooses adoption.

With no existing project content, the command creates a root `AGENTS.md` with the canonical managed block and ensures `.qmd-prover/workspaces/` exists. It is idempotent when the current block is already present. If `AGENTS.md` exists without the block, preserve it and ask before rerunning with `--append-contract`. If it contains an older or different managed block, ask before using `--sync-contract`; synchronization replaces only that block. Put local project rules outside the managed block.

Setup requires no QMD scaffold or initial theorem. `inspect` never initializes a goal workspace and never overwrites an existing workspace's `progress.qmd`. Create a goal workspace only when the user requests proof work for that goal.

## External mathematical basis

Before writing or checking mathematics, read `.qmd-prover/.external.qmd` if it exists. It is project-owned ordinary QMD controlling which results may be taken from outside the project:

| State | Meaning |
|---|---|
| file absent | External results are unrestricted. Identify them precisely and check every hypothesis. |
| file present but whitespace-only | Use no external mathematical results; develop every needed result in the goal workspace. |
| file has content | Use only the external results or classes of results allowed by that content. |

Equivalently: An absent file permits external mathematics subject to precise hypothesis checks; a whitespace-only file permits none; a nonempty file permits only its stated basis.

The agent may revise this file when the user's request or the developing proof context requires a different external basis, but it must make that change explicit. The exact content is verifier context. Any change invalidates affected workspace cache keys and requires the relevant facts to be checked again.

The external basis is the only channel for outside mathematical premises. It does not create semantic graph nodes and does not grant permission to cite facts from user notes, another main goal, or another workspace.

## qmd-prover contract

QMD outside `.qmd-prover/` is user-owned notes and exposition. Registered IDs begin `thm-main-`; every registered goal has exactly the classes `.theorem .goal`, a nonempty human-readable `name`, an ISO `date`, and a nonempty statement. Preserve its ID, `name`, classes, hypotheses, quantifiers, and statement body exactly. Other theorem-like blocks, headings, imports, proofs, and informal notation in user notes are not qmd-prover mathematics and must not be reformatted merely to satisfy this contract.

All agent-created definitions, intermediate results, and proofs belong inside the initialized workspace for a protected main goal. Within that workspace, a semantic declaration is a fenced Div with one stable ID, exactly one kind class, a nonempty `name`, an ISO introduction `date`, and a nonempty body. Its ID prefix must match its kind:

| Block | ID | Discipline |
|---|---|---|
| `.definition` | `def-*` | Introduce a term, object, or notation. The body is its construction; `@id` citations there are construction dependencies. Put any existence, uniqueness, or well-definedness argument in a linked proof. |
| `.lemma` | `lem-*` | State an auxiliary result. A lemma has the same proof standard as every other result. |
| `.proposition` | `prp-*` | State a useful standalone result that is not presented as a principal theorem. The distinction is expository only. |
| `.theorem` | `thm-*` | State a principal workspace result and justify it in a separate linked proof. |
| `.corollary` | `cor-*` | State a consequence, but cite the earlier result explicitly in its linked proof. The label creates no dependency. |
| `.proof` | none | Justify exactly one declaration. Give it no ID; set `of` to the declaration ID and cite every logical dependency with `@id` at its point of use. |

A definition may have a linked proof when its construction needs justification. Every non-definition candidate needs one nonempty linked proof. A declaration and its linked proof normally remain in the same workspace QMD file. The exception is the protected main goal: its declaration stays in the user's note, while the workspace supplies only a proof overlay such as `main-proof.qmd`.

An `@id` citation records a logical dependency but does not make a declaration from another file available. Same-file citations need no scope metadata. Every cross-file dependency inside one workspace requires both of these steps:

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

Every explicit semantic ID is globally unique across protected main goals and all workspaces. A workspace's linked `.proof of="thm-main-ID"` is an overlay for its own protected target and is not a second declaration. Never redeclare that target. A workspace may not cite a fact from another workspace or another protected main goal; adopt the needed claim as a local candidate and prove it, or state the permitted outside premise in `.qmd-prover/.external.qmd`.

For theorem-like workspace declarations, the first nonempty proof paragraph may be one workflow marker. For a definition, the marker belongs instead in the last nonempty declaration paragraph:

| Marker | Meaning |
|---|---|
| `OPEN` | Incomplete active attempt. |
| `REJECTED` | Inactive failed attempt. |
| no marker | Candidate awaiting independent verification. |
| `VERIFIED` | Legacy canonical marker; never add it and never treat it as workspace authority. |
| `REVOKED` | Legacy canonical marker; never add it and never treat it as workspace authority. |

Do not edit or delete an existing legacy marker merely to migrate a project. qmd-prover reports legacy records and markers as read-only compatibility state. Current verification authority is the exact workspace cache and snapshot, expressed as `workspace-verified` or `workspace-rejected`, not a source marker.

## Proof-development workspace

When the user asks to prove an existing `thm-main-*` goal, explicitly create or resume its workspace:

```bash
node "${CODEX_HOME:-$HOME/.codex}/skills/qmd-prover/scripts/qmd-prover.js" workspace init @thm-main-ID
```

Use the returned directory, normally `.qmd-prover/workspaces/<thm-main-ID>/`. Keep the protected target snapshot unchanged. Put every agent-created definition, intermediate result, proof attempt, calculation, example, counterexample, and planning note for the goal inside this workspace; do not scatter working mathematics through user notes.

- Maintain `progress.qmd` with the active route, proved frontier, open dependencies, and abandoned approaches. qmd-prover may create it during explicit initialization but inspection never overwrites it.
- Put semantic definitions and intermediate results with their linked proofs in coherent subject QMD files.
- Put only the linked proof of the protected main goal in `main-proof.qmd`; do not repeat or rewrite the theorem.
- Follow every unproved dependency until it has its own proof. A plan, example, computation, or prose sketch is not a completed proof.
- Keep a failed route when it is useful for future work, but mark it `REJECTED` so it cannot silently become an active premise.

After each coherent batch of semantic-QMD changes, run the narrowest useful inspection:

```bash
node "${CODEX_HOME:-$HOME/.codex}/skills/qmd-prover/scripts/qmd-prover.js" inspect fact @ID
node "${CODEX_HOME:-$HOME/.codex}/skills/qmd-prover/scripts/qmd-prover.js" inspect path PATH
node "${CODEX_HOME:-$HOME/.codex}/skills/qmd-prover/scripts/qmd-prover.js" inspect workspace @thm-main-ID
```

`workspace inspect @thm-main-ID` remains a compatibility alias for `inspect workspace`. Fact and workspace-path inspection verify only the selected facts and their transitive dependencies inside that workspace; they do not verify reverse dependencies or unrelated facts. A full workspace inspection checks every local fact in dependency order.

Verified workspace mathematics remains in the workspace as persistent project state for later inspection and future paper-building. Never copy its proof or a status marker into the user's note.

## Verification discipline

Passing one layer does not imply passing another:

| Layer | Enforced by | Covers |
|---|---|---|
| Mechanical | Compiler, project index, and inspector | Main-goal shape and locks, workspace block shape, dates, IDs, imports, references, proof association, global uniqueness, scope isolation, and snapshot freshness. |
| Mathematical | Independent external verifier | Valid inferences, hypotheses, theorem applicability, complete case coverage, construction well-definedness, and exact proof sufficiency. |
| Agent conduct | This contract | Project ownership, protected goals, workspace-only development, accurate reporting, and response to verification findings. |

Independent verification runs in dependency order and only after the selected fact passes mechanical checks and its workspace dependencies are usable. The verifier receives a bounded packet containing the exact statement or construction, proof, local dependency identities and states, import scope, external basis, checker contract, and protocol. Acceptance requires `verdict: "correct"` with no critical errors or gaps. Exact acceptances and rejections are cached and reused when every key component is unchanged.

A narrow fact or path inspection verifies only the selected facts and their transitive local dependency closure; it never verifies reverse dependencies or unrelated facts.

Apply these rules:

1. State agent-created mathematics precisely: introduce notation, scope variables, include every nontrivial hypothesis, and justify reductions, existence, finiteness, well-definedness, and limit passages.
2. Identify external theorems precisely enough to check applicability. Keep examples, computations, and intuition distinct from a general proof.
3. If a main goal appears false, preserve it and produce a precise refutation. Change it only with explicit user approval.
4. Keep prose mathematical and readable. Except for `OPEN` and `REJECTED`, keep verifier metadata, search notes, and confidence claims out of declarations and proofs.
5. Before relying on a workspace fact, inspect its current scope. Never treat open, candidate, rejected, stale, malformed, missing, or unverified work as established.
6. Repair every mechanical diagnostic and every verifier critical error or gap. If the verifier is unconfigured, missing, failing, or malformed, repair `verification.command` or `QMD_PROVER_VERIFIER`; do not loop and do not declare the result verified yourself.

`inspect project` lists user notes and protected goals, checks every initialized workspace independently, and returns each complete workspace result together with the schema-v3 aggregate facts, graph, findings, staleness, and verification summary. One malformed workspace does not suppress healthy workspace results, but project inspection is successful only when every main goal has a current initialized workspace whose full inspection passes.

`inspect fact @ID` automatically locates a protected main goal or any explicit workspace declaration. For a protected goal, it uses that goal's workspace proof overlay and can produce only workspace status; user notes stay byte-for-byte unchanged. `inspect path` applies the full semantic contract inside a workspace. Outside `.qmd-prover/`, it recognizes only protected main goals; an ordinary note path returns no facts and no semantic-format diagnostics.

Dependency commands use the aggregate graph of every workspace. Cross-workspace edges are forbidden and omitted. If an explicit semantic ID is declared in more than one project scope, every inspect and dependency command stops before verifier invocation and leaves the last aggregate snapshot unchanged until all conflicting declarations are renamed. A duplicate confined to one workspace blocks that workspace's compilation. These conditions are command diagnostics, not source markers, and are never written into QMD.

`check staleness` is read-only. It audits protected main-goal snapshots, workspace sources, the external basis, checker contract, exact caches, and legacy records; it never edits user QMD or markers. `submit proof` and `verification revoke` are retired compatibility commands. They return structured `retired` results and never read or write a proposed destination. Old canonical verification records and markers remain legacy read-only state and are not automatically deleted or migrated.

## Agent workflow

Load the `qmd-prover` skill and let the user work in natural language. qmd-prover does not prescribe a fixed proof strategy: the user may supply one theorem, a family of goals, an existing development, or an idea from which the agent formulates precise definitions and results. Choose the order and granularity of the mathematics from the developing argument.

Before proof work, compare this managed block with the skill's canonical contract and read the external-basis policy. Reuse that successful preflight only while the agent, project, branch, worktree, `AGENTS.md`, and external policy remain unchanged. Every independent agent must perform the preflight for itself.

Use project inspection for deliberate whole-project audits, fact or path inspection for iteration, dependency queries for graph analysis, and rendering for generated status/navigation views. Translate dispatcher JSON into ordinary language; do not require the user to learn the commands.

The safety gates remain mandatory: never edit a protected user statement, never use another workspace or main goal as an implicit premise, never use stale or unverified claims as established, never declare your own work verified, and never bypass exact-cache freshness, independent verification, rejection safety, or atomic snapshot publication.

<!-- qmd-prover-contract:end -->

## Project-specific additions

- For the current goal, work under `.qmd-prover/workspaces/thm-main-godel-completeness/` and leave `completeness.qmd` unchanged.
- Develop Gödel's completeness theorem from explicit foundations of first-order logic: signatures, terms, formulas, substitution, proof calculus, structures, assignments, satisfaction, and semantic consequence.
- State useful intermediate definitions and results as semantic QMD blocks and cite every logical dependency at its point of use.
- Do not assume completeness, compactness, model existence, the Henkin theorem, or any equivalent result as an unproved black box.
