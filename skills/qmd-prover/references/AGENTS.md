# Canonical qmd-prover project contract

Copy the managed block below into the root `AGENTS.md` of every mathematical project that uses qmd-prover. Keep the block unchanged. Add project-specific organization, notation, and writing rules outside the managed block.

<!-- qmd-prover-contract:start version=1 -->

## Contents

- [qmd-prover contract](#qmd-prover-contract)
- [Agent workflow](#agent-workflow)
- [Semantic QMD examples](#semantic-qmd-examples)
- [Correct and incorrect behavior](#correct-and-incorrect-behavior)
- [Writing standard](#writing-standard)

## qmd-prover contract

1. Preserve every `thm-main-*` ID, title, hypothesis, quantifier, and `Statement` section exactly.
2. Put every logical dependency in `Uses` and cite it with a semantic `@` reference at the point of use.
3. Use only results in the current file or explicitly imported, verified results.
4. State agent-created results precisely, including hypotheses and quantifiers.
5. Keep examples, computations, and intuition distinct from a general proof.
6. Record external results precisely enough to check their applicability.
7. Keep verification metadata out of mathematical proofs.
8. If a main statement appears false, preserve it and produce a precise refutation. Changing it requires explicit user approval.
9. Never self-verify or merge a proposal directly into canonical QMD. Submit it through the qmd-prover dispatcher.
10. Put related mathematics where nearby sources and local project policy indicate; qmd-prover imposes no subject-directory layout.

## Agent workflow

Load the globally installed `qmd-prover` skill before proof work. The user interacts in natural language; translate their request into dispatcher operations rather than requiring them to learn commands.

For each requested goal:

1. Inspect the project and the target theorem.
2. Read its imports, verified dependency closure, earlier proposals, accepted mathematics, and verifier reports.
3. Work in an isolated proposal file. Never experiment by editing canonical QMD.
4. Submit every candidate through the dispatcher.
5. If rejected, repair every concrete critical error and gap, then resubmit.
6. Stop only when the goal is verified, precisely refuted, genuinely blocked, cancelled, or explicitly stopped.

Each independent worker must read this project `AGENTS.md`, load the skill, inspect its own target, and preserve useful notes for later sessions. Workers may propose mathematics but may not mark it verified or merge it directly.

## Semantic QMD examples

### Open main goal

An empty `Proof` section means the user has supplied a top-level obligation that remains open:

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

Do not alter the ID, title, hypotheses, quantifiers, or statement to make the theorem easier.

### Reusable exported result

State agent-created lemmas precisely, declare their dependencies, cite those dependencies in the proof, and export only results intended for cross-file use:

```markdown
::: {#lem-local-exponent-bound .lemma export="local-exponent-bound"}
## Local exponent bound

### Uses

- @def-total-cartier-index
- @thm-local-class-group-finite

### Statement

For every admissible point \(x\), the exponent of its local class group
divides the integer \(N\).

### Proof

Apply @thm-local-class-group-finite to the group defined in
@def-total-cartier-index, and use the presentation bound established above.
:::
```

### Explicit cross-file import

Import individual exported IDs. Do not use wildcard imports or assume that a result elsewhere in the repository is automatically available:

```markdown
::: {.theorem-imports}
from: foundations/local-groups.qmd
use:
  - @def-local-class-group
  - @thm-local-class-group-finite
:::
```

### Candidate main proof

Keep the user-owned parts unchanged, declare every premise, and cite each premise where it is applied:

```markdown
::: {#thm-main-uniform-index .theorem .goal}
## Uniform index theorem

### Statement

Let \(\pi\colon X\to B\) satisfy the stated hypotheses. There exists an
integer \(I>0\) such that every admissible fiber has total Cartier index
dividing \(I\).

### Uses

- @lem-local-exponent-bound
- @lem-finite-stratification

### Proof

Apply @lem-finite-stratification to obtain finitely many strata. On each
stratum, @lem-local-exponent-bound gives an integer bounding every local
exponent. Taking the least common multiple of these finitely many integers
produces the required \(I\).
:::
```

This is a candidate until an independent verifier accepts it with no critical errors or gaps.

## Correct and incorrect behavior

### Dependency declarations

Incorrect:

```markdown
### Uses

- @lem-finite-stratification

### Proof

Apply @lem-local-exponent-bound and @lem-finite-stratification.
```

The proof cites an undeclared premise. Add `@lem-local-exponent-bound` to `Uses`, and ensure it is local or explicitly imported and verified.

Also incorrect:

```markdown
### Uses

- @lem-local-exponent-bound
- @lem-unused

### Proof

Apply @lem-local-exponent-bound.
```

Do not list a logical dependency without citing it where used. Remove `@lem-unused` or justify and cite its actual role.

### Main-statement protection

Incorrect: weaken “for every admissible fiber” to “for a general fiber,” add a missing hypothesis, change a quantifier, rename the `thm-main-*` ID, or silently rewrite the title.

Correct: preserve the main statement exactly. If it appears false, develop a precise counterexample or refutation while leaving the canonical statement untouched, then report the issue to the user.

### Verification boundary

Incorrect: paste a plausible proof directly into canonical QMD and label it verified.

Correct: write an isolated proposal, submit it through qmd-prover, retain canonical QMD unchanged after rejection, and merge only through the accepted submission path.

### General proof versus evidence

Incorrect: present a numerical example, a computer experiment, or geometric intuition as if it proved the general theorem.

Correct: label such material as evidence or intuition, then give a complete argument covering every hypothesis and quantified case.

## Writing standard

- Introduce notation before using it.
- State the scope of quantified variables and all nontrivial hypotheses.
- Justify reductions, existence claims, finiteness claims, and limit passages.
- Identify external theorems precisely enough to check their hypotheses.
- Keep prose readable and mathematical; do not insert verifier metadata, worker strategy, search logs, or confidence claims into proofs.
- Prefer a small reusable lemma when it clarifies a genuine intermediate result, not merely to fragment an argument.

<!-- qmd-prover-contract:end -->

## Project-specific additions

Add local rules after the managed block without changing it. For example:

```markdown
## Local project policy

- Put algebraic-geometry sources under `geometry/`.
- Use `foundations/notation.qmd` for shared notation.
- Write theorem titles in English and surrounding exposition in Chinese.
- Do not introduce new subject folders without asking the user.
```

Local additions may strengthen organization and writing requirements, but they must not weaken or contradict the managed qmd-prover contract.
