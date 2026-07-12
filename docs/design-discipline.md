# Discipline design

## Role

The discipline defines what a valid qmd-prover mathematical project looks like
and how a host agent must work on it. Its canonical form is the managed contract
in `skills/qmd-prover/references/AGENTS.md`.

This document describes the role and enforcement model of that contract. It
does not duplicate the contract's normative text.

## Why the discipline is separate

Mathematical proof work combines rules of different kinds:

- source-format rules that a program can decide;
- mathematical requirements that require judgment; and
- behavioral constraints on the agent editing the project.

Keeping them in one visible project discipline gives the user, the host agent,
the inspector, and the verifier a shared contract. Separating the discipline
from the utilities also prevents implementation details from silently becoming
mathematical policy.

## Canonical and local policy

The skill ships one versioned managed contract. A mathematical project copies
that managed block into its root `AGENTS.md` without modification. The project
may add local rules outside the block for matters such as:

- notation and terminology;
- language and writing style;
- subject-directory organization;
- preferred foundational sources; and
- restrictions on introducing new definitions or files.

Local policy may strengthen the managed discipline but cannot weaken it.

Before proof work, the host agent compares the project's managed block with the
canonical copy. A missing, changed, or incompatible contract is a preflight
failure. Synchronizing the project contract requires the user's approval
because `AGENTS.md` is project-owned policy.

### Example: project-local policy

The managed block itself is copied verbatim from the skill and is not repeated
here. A project can append local policy after it:

```markdown
<!-- The complete managed qmd-prover contract appears above. -->

## Local project policy

- Put shared algebra definitions in `algebra/foundations.qmd`.
- Use \(\mathbb N=\{0,1,2,\ldots\}\).
- State theorem titles in English and write proofs in Chinese.
- Ask before introducing a new axiom or external theorem.
```

The directory and writing rules strengthen the project discipline without
changing the managed contract. A local rule such as “agents may edit a
`thm-main-*` statement when convenient” would conflict with the managed
contract and must be rejected.

## Rule categories

### Mechanically enforceable rules

The inspector and proving utilities enforce rules whose truth follows from the
project representation, including:

- semantic block shape and unique IDs;
- protected main-statement identity;
- explicit imports and exports;
- association of every proof with one semantic result;
- availability and status of results cited by proofs;
- isolation of proposals;
- stale-submission checks; and
- rejection-safe, atomic acceptance.

Mechanical enforcement is deliberately conservative. If a required fact
cannot be established from the semantic representation, the utility reports a
diagnostic rather than guessing.

#### Example: a mechanically detectable dependency error

This proof cites a result that is neither local nor imported:

```markdown
::: {.proof of="thm-main-even-square"}
By @lem-factor-even, write \(n=2k\). Applying @lem-square-of-double gives
\(n^2=4k^2\).
:::
```

If only `@lem-factor-even` is available, the inspector reports
`@lem-square-of-double` as unavailable. The file can import the exported lemma
through its Quarto metadata:

```yaml
qmd-prover:
  imports:
    - from: foundations/parity.qmd
      use:
        - lem-square-of-double
```

No mathematical judgment is required for this diagnostic. The reference in the
proof is already the dependency declaration; no second `Uses` list is needed.

### Mathematically judged rules

The independent verifier judges matters such as:

- whether each inference is valid;
- whether all hypotheses are used correctly;
- whether an external theorem actually applies;
- whether a claimed reduction covers every case; and
- whether examples or computations have been mistaken for a general proof.

The verifier's judgment does not relax mechanical checks.

#### Example: a mathematically detectable gap

Suppose a candidate contains:

```markdown
Since \(ab=ac\), divide by \(a\) to obtain \(b=c\).
```

The syntax may be perfectly valid and the proof may have no semantic
dependencies. Nevertheless, the inference is invalid unless the hypotheses
give \(a\ne0\). Detecting the missing hypothesis is the verifier's job rather
than the inspector's.

Likewise, checking finitely many values of \(n\) does not prove a statement
quantified over all integers. The discipline requires the verifier and host
agent to keep computation or evidence distinct from a general proof.

### Agent conduct rules

The skill instructs the host agent to:

- preserve user-owned statements;
- introduce precise intermediate results only when useful;
- keep proof attempts outside canonical QMD until accepted;
- respond to every concrete verification gap;
- produce a precise refutation when a statement appears false; and
- keep search notes, confidence claims, and verifier metadata out of proofs.

These rules shape the reasoning loop even when they are not completely
machine-decidable.

#### Example: correct behavior when a goal looks false

Assume the user supplied:

```markdown
::: {#thm-main-primes-odd .theorem .goal name="Every prime is odd"}
Every prime number is odd.
:::
```

The host agent must not silently change the statement to “Every prime greater
than \(2\) is odd.” It should preserve the goal and report the counterexample
\(2\), together with the corrected statement as a suggestion that requires
the user's approval.

## Semantic scope

QMD remains unrestricted outside recognized semantic blocks. Ordinary prose,
figures, equations, code cells, and bibliographic citations remain Quarto
content. The discipline applies dependency semantics only to recognized
definitions and results.

Within a semantic result, the discipline distinguishes:

- the result block, whose `name` attribute and body say what is claimed; and
- a linked proof block, whose semantic references declare the logical premises
  at their points of use.

For `thm-main-*`, the title and statement originate with the user and are
protected. The absence of a linked proof block means the result is open. A
present proof block is still only a candidate until independently accepted.

### Example: semantic and nonsemantic references

In a semantic proof, the reference below creates a logical dependency:

```markdown
::: {.proof of="thm-main-convergence"}
Apply @lem-compact-subsequence to the bounded sequence.
:::
```

In surrounding exposition, the same reference can be navigational:

```markdown
The geometric motivation for @lem-compact-subsequence is discussed next.
```

The second sentence does not claim that an enclosing proof uses the lemma. A
bibliographic citation such as `[@rudin1976]` remains a Quarto citation and is
not interpreted as a semantic theorem dependency.

## Change process

The managed contract is versioned. A discipline change should therefore:

1. state the new or changed invariant;
2. identify whether it is enforced by the inspector, proving utilities,
   verifier, or host-agent instructions;
3. update the canonical contract;
4. update affected tests and component documentation; and
5. require explicit synchronization in existing projects.

This prevents a utility release from silently changing the meaning of an
existing mathematical project.
