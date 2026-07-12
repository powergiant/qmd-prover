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

## Rule categories

### Mechanically enforceable rules

The inspector and proving utilities enforce rules whose truth follows from the
project representation, including:

- semantic block shape and unique IDs;
- protected main-statement identity;
- explicit imports and exports;
- agreement between `Uses` and proof references;
- availability and status of dependencies;
- isolation of proposals;
- stale-submission checks; and
- rejection-safe, atomic acceptance.

Mechanical enforcement is deliberately conservative. If a required fact
cannot be established from the semantic representation, the utility reports a
diagnostic rather than guessing.

### Mathematically judged rules

The independent verifier judges matters such as:

- whether each inference is valid;
- whether all hypotheses are used correctly;
- whether an external theorem actually applies;
- whether a claimed reduction covers every case; and
- whether examples or computations have been mistaken for a general proof.

The verifier's judgment does not relax mechanical checks.

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

## Semantic scope

QMD remains unrestricted outside recognized semantic blocks. Ordinary prose,
figures, equations, code cells, and bibliographic citations remain Quarto
content. The discipline applies dependency semantics only to recognized
definitions and results.

Within a semantic result, the discipline distinguishes:

- the title and statement, which say what is claimed;
- `Uses`, which declares logical premises; and
- the proof, which cites those premises where they are applied.

For `thm-main-*`, the title and statement originate with the user and are
protected. A nonempty proof is still only a candidate until independently
accepted.

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
