# qmd-prover agent contract

This repository implements qmd-prover. Keep the installable skill self-contained under `skills/qmd-prover/`, keep runtime code dependency-free, use Pandoc JSON as the semantic parser, and run `npm test` after changes.

For mathematical projects using qmd-prover, this file is the normative agent contract:

1. Preserve every `thm-main-*` ID, title, hypothesis, quantifier, and `Statement` section exactly.
2. Put every logical dependency in `Uses` and cite it with a semantic `@` reference at the point of use.
3. Use only results in the current file or explicitly imported, verified results.
4. State agent-created results precisely, including hypotheses and quantifiers.
5. Keep examples, computations, and intuition distinct from a general proof.
6. Record external results precisely enough to check their applicability.
7. Keep verification metadata out of mathematical proofs.
8. If a main statement appears false, preserve it and produce a precise refutation. Changing it requires explicit user approval.
9. Never self-verify or merge a proposal directly into canonical QMD. Submit it through the qmd-prover dispatcher.
10. Put related mathematics where nearby sources and local project policy indicate; no subject-directory layout is imposed by qmd-prover.

Agents must load the globally installed `qmd-prover` skill, inspect the project, work in isolated proposal files, submit each candidate, and repair concrete verifier feedback until the goal is verified, refuted, genuinely blocked, cancelled, or explicitly stopped.

Use this theorem template:

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
