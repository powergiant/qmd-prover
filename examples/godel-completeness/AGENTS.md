# Mathematical project instructions

<!-- qmd-prover-contract:start version=13 -->

## Contents

- [qmd-prover contract](#qmd-prover-contract)
- [Project setup](#project-setup)
- [External mathematical basis](#external-mathematical-basis)
- [Proof-development workspace](#proof-development-workspace)
- [Verification discipline](#verification-discipline)
- [Agent workflow](#agent-workflow)

## Project setup

The user normally adds the `qmd-prover` skill and asks the agent in natural language to initialize the current project. From the project root, run:

```bash
node "${CODEX_HOME:-$HOME/.codex}/skills/qmd-prover/scripts/qmd-prover.js" init
```

The command reports any existing `AGENTS.md`, QMD sources, Quarto configuration, and `.qmd-prover` state. If it returns `intent-required`, summarize what exists and ask whether the user wants to adopt those files in place, inspect them first, or leave them unchanged. Run `--adopt-existing` only after the user chooses adoption.

With no existing project content, the command creates a root `AGENTS.md` with the canonical managed block and ensures `.qmd-prover/workspaces/` exists. It is idempotent when the current block is already present; report that state and ask what the user wants to do next. If `AGENTS.md` exists without the block, preserve it and ask before rerunning with `--append-contract`. If it contains an older or different managed block, ask before using `--sync-contract`; synchronization replaces only that block. Put local project rules outside the managed block.

Setup requires no QMD scaffold or initial theorem. Afterward, the user may provide one or more theorems, existing QMD, or an idea for the agent to formulate.

## External mathematical basis

Before writing mathematics, read `.qmd-prover/.external.qmd` if it exists. It is project-owned ordinary QMD describing which external mathematical results may be used:

| State | Meaning |
|---|---|
| file absent | External results are unrestricted. Identify them precisely and check their hypotheses. |
| file present but whitespace-only | Use no external mathematical results; develop every needed result inside the project. |
| file has content | Use only the external results or classes of results allowed by that content. |

Do not create or change this file unless the user asks to set or revise the project's external basis. Its contents constrain external results, not semantic dependencies already defined in project QMD.

## qmd-prover contract

QMD outside recognized semantic blocks remains ordinary Quarto content. A semantic declaration is a fenced Div with one stable ID, exactly one kind class, a human-readable `name`, and an ISO introduction `date`. Its ID prefix must match its kind:

| Block | ID | Discipline |
|---|---|---|
| `.definition` | `def-*` | Introduce a term, object, or notation. The body is its construction; `@id` references there are construction dependencies. Put any well-definedness, existence, or uniqueness argument in a linked proof. |
| `.lemma` | `lem-*` | State an auxiliary result. A lemma has the same proof standard as every other result. |
| `.proposition` | `prp-*` | State a useful standalone result that is not presented as a principal theorem. The distinction is expository only. |
| `.theorem` | `thm-*` | State a principal result and justify it in a separate linked proof. |
| `.corollary` | `cor-*` | State a quick consequence, but cite the earlier result explicitly in its linked proof. The label creates no dependency. |
| `.theorem .goal` | `thm-main-*` | Record a user-owned main goal. Preserve its ID, `name`, hypotheses, quantifiers, and statement body exactly; without a linked proof it is open. The `.goal` class refines `.theorem`, not a sixth kind. |
| `.proof` | none | Justify exactly one declaration. Give it no ID; set `of` to the declaration ID and cite every logical dependency with `@id` at its point of use. |

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

2. In the consumer file, import that ID explicitly in the front matter:

```yaml
---
qmd-prover:
  imports:
    - from: foundations/local-groups.qmd
      use:
        - lem-local-class-group-finite
---
```

`from` is relative to the importing QMD file. Each `use` entry is a semantic ID, each producer must set `export` to that same ID, and wildcard imports are forbidden. Importing grants scope but does not itself declare a logical dependency: cite the imported result with `@id` at its point of use in the definition construction or linked proof. Do not add a `Uses` list. References in surrounding prose are navigational, and bibliographic citations such as `[@rudin1976]` remain ordinary Quarto citations.

Use this shape for declarations and linked proofs:

```markdown
::: {#thm-main-uniform-index .theorem .goal name="Uniform index theorem" date="2026-07-12"}
Let \(\pi\colon X\to B\) satisfy the stated hypotheses. There exists an
integer \(I>0\) such that every admissible fiber has total Cartier index
dividing \(I\).
:::

::: {.proof of="thm-main-uniform-index"}
By @lem-finite-stratification there are finitely many strata. Apply
@lem-local-exponent-bound on each stratum and take the least common multiple.
:::
```

A workspace proposal for an existing declaration contains only its linked `.proof`; do not repeat or edit the declaration. A declaration has at most one active proof. For theorem-like declarations, the first nonempty proof paragraph may be one reserved marker. For a definition, the marker belongs instead in the last nonempty paragraph of the definition block and is not part of the construction identity:

| Marker | Meaning |
|---|---|
| `OPEN` | Incomplete active attempt. |
| `REJECTED` | Inactive failed attempt. |
| no marker | Candidate awaiting independent verification. |
| `VERIFIED` | Accepted construction or proof backed by matching protected records. |
| `REVOKED` | Previously accepted construction or proof backed by a matching revocation record and reason. |

Never add or restore `VERIFIED` manually. Only qmd-prover may write `VERIFIED` or `REVOKED`. Use only results available in the current file or explicitly imported, and never treat an open, candidate, rejected, revoked, or stale result as established.

## Proof-development workspace

When the user asks to prove an existing `thm-main-*` goal, create or resume its workspace with `workspace init @thm-main-ID`. Use the returned directory, normally:

```text
.qmd-prover/workspaces/<thm-main-ID>/
```

Treat canonical QMD as read-only during proof development. Put every agent-created definition, intermediate result, proof attempt, calculation, example, counterexample, and planning note for the goal inside its workspace; do not scatter working mathematics elsewhere in the repository.

- Keep the protected target snapshot unchanged.
- Use `progress.qmd` to record the active route, proved frontier, open dependencies, and abandoned approaches.
- Put semantic definitions and intermediate results with their linked proofs in subject QMD files.
- Put the candidate proof of the protected main goal in `main-proof.qmd` as a `.proof` block only; do not repeat or rewrite the main theorem block.
- Follow every unproved dependency until it has its own proof. A plan, example, computation, or prose sketch is not a completed proof.

`workspace inspect @thm-main-ID` independently checks the active workspace in dependency order and caches exact verdicts. A `workspace-verified` result is established only inside that provisional workspace snapshot; it is not canonical `VERIFIED` mathematics and must still pass protected submission and promotion before canonical use.

After each coherent batch of semantic-QMD changes, and always before reporting a proof candidate ready, run `workspace inspect @thm-main-ID`. Repair every mechanical diagnostic, including missing exports, imports, and unavailable dependencies. If the independent verifier is unavailable or fails, report that infrastructure failure and leave the affected facts unverified; never bypass the inspection or write protected markers manually.

The order of mathematical exploration is flexible; this workspace boundary is not. Move mathematics into canonical QMD only through qmd-prover's accepted promotion path.

## Verification discipline

Passing one layer does not imply passing another:

| Layer | Enforced by | Covers |
|---|---|---|
| Mechanical | Inspector and proving utilities | Block shape, dates, IDs, imports, references, proof association and state, protected statements, staleness, and rejection-safe atomic writes. |
| Mathematical | Inspector's independent AI verifier | Valid inferences, hypotheses, theorem applicability, complete case coverage, and proof sufficiency. |
| Agent conduct | This contract | Project ownership, protected goals, workspace-only development, and response to verification findings. |

Every `inspect *` command first checks staleness and removes stale record-backed markers transitively. It then calls the configured external independent verifier in a fresh bounded context for each mechanically eligible fact whose exact verification key is not already cached. The key covers the construction or statement, proof, dependency identities and states, import scope, external basis, checker contract, and verifier protocol. Acceptance requires a correct verdict with no critical errors or gaps. A cached exact acceptance or rejection must be reused without another verifier call.

Prefer `inspect fact` or `inspect path` while iterating and use `inspect project` for deliberate project-wide audits. Do not loop on an inspection whose report says the verifier command is unconfigured, missing, failing, or malformed: repair `verification.command` or `QMD_PROVER_VERIFIER`, then rerun the narrowest relevant inspection. Until then every affected fact remains unverified; never compensate by writing a marker manually.

Apply these rules:

1. State agent-created mathematics precisely: introduce notation, scope variables, include every nontrivial hypothesis, and justify reductions, existence, finiteness, and limit passages.
2. Identify external theorems precisely enough to check their applicability. Keep examples, computations, and intuition distinct from a general proof.
3. If a main goal appears false, preserve it and produce a precise refutation. Change it only with explicit user approval.
4. Keep prose mathematical and readable. Except for reserved markers, keep verifier metadata, worker strategy, search notes, and confidence claims out of declarations and proofs.
5. Before relying on `VERIFIED`, inspect the relevant fact or scope; inspection runs staleness checking first. The standalone staleness command may be used when only invalidation is wanted. Let qmd-prover remove stale markers from the changed fact and every direct or transitive dependent, then re-run all checks.
6. Put mathematics where nearby sources and local policy indicate; qmd-prover imposes no subject-directory layout.

## Agent workflow

Load the `qmd-prover` skill and let the user work in natural language. qmd-prover does not prescribe a fixed proof workflow: the user may supply one theorem, a family of goals, or an idea from which the agent formulates precise definitions and results. Choose the order and granularity of the mathematics from the developing argument.

Whenever writing semantic QMD, follow this contract. Introduce useful intermediate results, revise rejected arguments, and continue a development for as long as the user's request requires. For a proof request, the proof-development workspace section is mandatory; flexibility concerns mathematical strategy, not file placement.

This contract tells agents how to write; it does not establish compliance by itself. Use the skill's inspector and other infrastructure to initialize or compare project policy, enforce semantic structure, check references and staleness, analyze dependencies, view frontiers and progress, verify candidates, retain feedback, promote accepted mathematics safely, and render project views. Always complete the required workspace inspection before reporting a proof candidate ready. These tools support the work; they do not determine the mathematical plan.

The safety gates remain mandatory: do not use stale or unverified claims as established, do not edit protected user statements, respond to every critical verification error or gap, and accept canonical mathematics only through qmd-prover's checked atomic path. Each independent worker must load the skill, read this project `AGENTS.md`, and obey the same block discipline and verification boundary.

<!-- qmd-prover-contract:end -->

## Project-specific additions

- For the current goal, work under `.qmd-prover/workspaces/thm-main-godel-completeness/` and leave `completeness.qmd` unchanged.
- Develop Gödel's completeness theorem from explicit foundations of first-order logic: signatures, terms, formulas, substitution, proof calculus, structures, assignments, satisfaction, and semantic consequence.
- State useful intermediate definitions and results as semantic QMD blocks and cite every logical dependency at its point of use.
- Do not assume completeness, compactness, model existence, the Henkin theorem, or any equivalent result as an unproved black box.
