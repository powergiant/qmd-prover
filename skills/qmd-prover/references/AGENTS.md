# Canonical qmd-prover project contract

Copy the managed block below into the root `AGENTS.md` of every mathematical project that uses qmd-prover. Keep the block unchanged. Add project-specific organization, notation, and writing rules outside the managed block.

<!-- qmd-prover-contract:start version=2 -->

## Contents

- [qmd-prover contract](#qmd-prover-contract)
- [Agent workflow](#agent-workflow)
- [Semantic QMD examples](#semantic-qmd-examples)
- [Correct and incorrect behavior](#correct-and-incorrect-behavior)
- [Writing standard](#writing-standard)

## qmd-prover contract

1. Preserve every `thm-main-*` ID, `name`, hypothesis, quantifier, and statement body exactly.
2. Put each proof in a separate `.proof` block whose `of` attribute names exactly one result.
3. Cite every logical dependency with a semantic `@` reference at its point of use in the proof; those references are the dependency declaration.
4. Use only results in the current file or individually imported, verified results. Declare cross-file availability through `qmd-prover.imports` metadata; wildcard imports are forbidden.
5. State agent-created results precisely, including hypotheses and quantifiers.
6. Keep examples, computations, and intuition distinct from a general proof, and record external results precisely enough to check their applicability.
7. Keep verification metadata, worker strategy, and search notes out of mathematical results and proofs.
8. If a main statement appears false, preserve it and produce a precise refutation. Changing it requires explicit user approval.
9. Never self-verify or merge a proposal directly into canonical QMD. Submit it through the qmd-prover dispatcher.
10. Put related mathematics where nearby sources and local project policy indicate; qmd-prover imposes no subject-directory layout.

## Agent workflow

Load the globally installed `qmd-prover` skill before proof work. The user interacts in natural language; translate their request into dispatcher operations rather than requiring them to learn commands.

For each requested goal:

1. Inspect the canonical project and the target theorem.
2. Create or resume its goal workspace and read the protected target snapshot, imports, verified dependency closure, prior proposals, accepted mathematics, and verifier reports.
3. Develop mathematics only in the goal workspace. Never experiment by editing canonical QMD.
4. Inspect the workspace graph and do not treat an open or candidate workspace claim as established.
5. Submit one linked proof, or one new result with its linked proof, through the dispatcher.
6. If rejected, repair every concrete critical error and gap in workspace QMD, then resubmit.
7. Stop only when the goal is verified, precisely refuted, genuinely blocked, cancelled, or explicitly stopped.

Each independent worker must read this project `AGENTS.md`, load the skill, inspect its own target, and preserve useful notes in the goal workspace. Workers may propose mathematics but may not mark it verified or merge it directly.

## Semantic QMD examples

### Open main goal

The absence of a linked proof means the user-supplied obligation is open:

```markdown
::: {#thm-main-uniform-index .theorem .goal name="Uniform index theorem"}
Let \(\pi\colon X\to B\) satisfy the stated hypotheses. There exists an
integer \(I>0\) such that every admissible fiber has total Cartier index
dividing \(I\).
:::
```

Do not alter the ID, `name`, hypotheses, quantifiers, or statement to make the theorem easier.

### Reusable exported result

The result block states the claim. Its linked proof cites dependencies directly:

```markdown
::: {#lem-local-exponent-bound .lemma name="Local exponent bound" export="local-exponent-bound"}
For every admissible point \(x\), the exponent of its local class group
divides the integer \(N\).
:::

::: {.proof of="lem-local-exponent-bound"}
Apply @thm-local-class-group-finite to the group defined in
@def-total-cartier-index, and use the presentation bound established above.
:::
```

### Explicit cross-file import

Import individual exported IDs in QMD front matter:

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

### Candidate main proof

An isolated proposal for an existing theorem contains only its linked proof:

```markdown
::: {.proof of="thm-main-uniform-index"}
Apply @lem-finite-stratification to obtain finitely many strata. On each
stratum, @lem-local-exponent-bound gives an integer bounding every local
exponent. Taking their least common multiple produces the required \(I\).
:::
```

This remains a candidate until an independent verifier accepts it with no critical errors or gaps.

## Correct and incorrect behavior

### Dependencies and imports

Incorrect:

```markdown
::: {.proof of="thm-main-uniform-index"}
Apply @lem-local-exponent-bound.
:::
```

if that lemma is in another file but is not individually imported there. Add the exported ID to the target file's `qmd-prover.imports` metadata. Do not add a second `Uses` list: the proof reference already declares the dependency.

Also incorrect: mention a lemma only in surrounding exposition and assume it becomes a proof dependency. Only references inside the associated proof block create dependency edges.

### Main-statement protection

Incorrect: weaken “for every admissible fiber” to “for a general fiber,” add a missing hypothesis, change a quantifier, rename the `thm-main-*` ID, or silently rewrite its `name`.

Correct: preserve the main result block exactly. If it appears false, develop a precise counterexample or refutation in the workspace and report it to the user.

### Verification boundary

Incorrect: paste a plausible proof directly into canonical QMD and label it verified.

Correct: keep the linked proof in the goal workspace, submit it through qmd-prover, retain canonical QMD unchanged after rejection, and promote it only through the accepted submission path.

### General proof versus evidence

Incorrect: present a numerical example, a computer experiment, or geometric intuition as if it proved a quantified theorem.

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
- Write theorem captions in English and surrounding exposition in Chinese.
- Do not introduce new subject folders without asking the user.
```

Local additions may strengthen organization and writing requirements, but they must not weaken or contradict the managed qmd-prover contract.
