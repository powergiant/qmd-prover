# Canonical qmd-prover project contract

Copy the managed block below into the root `AGENTS.md` of every mathematical project that uses qmd-prover. Keep the block unchanged. Add project-specific organization, notation, and writing rules outside the managed block.

<!-- qmd-prover-contract:start version=4 -->

## Contents

- [qmd-prover contract](#qmd-prover-contract)
- [Verification discipline](#verification-discipline)
- [Agent workflow](#agent-workflow)

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

Use `export` when another file must import a declaration. Import exported IDs individually in the target QMD front matter; wildcards are forbidden:

```yaml
---
qmd-prover:
  imports:
    - from: foundations/local-groups.qmd
      use:
        - def-local-class-group
        - thm-local-class-group-finite
---
```

The references inside a definition construction or linked proof are the dependency declaration; do not add a `Uses` list. References in surrounding prose are navigational, and bibliographic citations such as `[@rudin1976]` remain ordinary Quarto citations.

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

A workspace proposal for an existing declaration contains only its linked `.proof`; do not repeat or edit the declaration. A declaration has at most one active proof. The first nonempty proof paragraph may be one reserved marker:

| Marker | Meaning |
|---|---|
| `OPEN` | Incomplete active attempt. |
| `REJECTED` | Inactive failed attempt. |
| no marker | Candidate awaiting independent verification. |
| `VERIFIED` | Accepted proof backed by matching protected records. |
| `REVOKED` | Previously accepted proof backed by a matching revocation record and reason. |

Never add or restore `VERIFIED` manually. Only qmd-prover may write `VERIFIED` or `REVOKED`. Use only results available in the current file or explicitly imported, and never treat an open, candidate, rejected, revoked, or stale result as established.

## Verification discipline

Passing one layer does not imply passing another:

| Layer | Enforced by | Covers |
|---|---|---|
| Mechanical | Inspector and proving utilities | Block shape, dates, IDs, imports, references, proof association and state, protected statements, staleness, and rejection-safe atomic writes. |
| Mathematical | Independent AI verifier | Valid inferences, hypotheses, theorem applicability, complete case coverage, and proof sufficiency. |
| Agent conduct | This contract | Project ownership, protected goals, workspace-only development, and response to verification findings. |

Apply these rules:

1. State agent-created mathematics precisely: introduce notation, scope variables, include every nontrivial hypothesis, and justify reductions, existence, finiteness, and limit passages.
2. Identify external theorems precisely enough to check their applicability. Keep examples, computations, and intuition distinct from a general proof.
3. If a main goal appears false, preserve it and produce a precise refutation. Change it only with explicit user approval.
4. Keep prose mathematical and readable. Except for reserved markers, keep verifier metadata, worker strategy, search notes, and confidence claims out of declarations and proofs.
5. Before relying on `VERIFIED`, run the staleness check. Let qmd-prover remove stale markers from the changed fact and every direct or transitive dependent, then re-run all checks.
6. Put mathematics where nearby sources and local policy indicate; qmd-prover imposes no subject-directory layout.

## Agent workflow

Load the globally installed `qmd-prover` skill before proof work. The user interacts in natural language; translate their request into dispatcher operations rather than requiring them to learn commands.

For each requested goal:

1. Check staleness, then inspect the canonical project and the target theorem.
2. Create or resume its goal workspace and read the protected target snapshot, imports, verified dependency closure, prior proposals, accepted mathematics, and verifier reports.
3. Develop mathematics only in the goal workspace. Never experiment by editing canonical QMD.
4. Inspect the workspace graph and do not treat an open, candidate, rejected, revoked, or stale workspace claim as established.
5. Inspect one linked proof, or one new definition or result with its linked proof, through qmd-prover. Programmatic reference checks and independent AI sufficiency checks must both pass.
6. If rejected, repair every concrete critical error and gap in workspace QMD, then inspect again.
7. Promote only exact mathematics whose `VERIFIED` marker still matches its current record and dependency snapshot.
8. Stop only when the goal is verified, precisely refuted, genuinely blocked, cancelled, or explicitly stopped.

Each independent worker must read this project `AGENTS.md`, load the skill, inspect its own target, and preserve useful notes in the goal workspace. Workers may propose mathematics but may not add, restore, or preserve `VERIFIED` against a staleness decision, and may not merge mathematics directly.

<!-- qmd-prover-contract:end -->

## Project-specific additions

Add local rules after the managed block without changing it. For example:

```markdown
## Local project policy

- Put algebraic-geometry sources under `geometry/`.
- Use `foundations/notation.qmd` for shared notation.
- Write theorem captions in English and surrounding exposition in Chinese.
- Do not introduce new subject folders without asking the user.
```

Local additions may strengthen organization and writing requirements, but they must not weaken or contradict the managed qmd-prover contract.
