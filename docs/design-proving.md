# Proving utilities design

## Role

The proving utilities help Codex or Claude Code turn mathematical reasoning
into a checked proof candidate and move an independently accepted candidate
into canonical QMD safely.

They do not form a proving agent. The host agent decides how to reason, which
lemmas to introduce, when to explore examples, and how to repair a proof. The
utilities provide bounded context, mechanical checks, independent verification,
and a protected acceptance path.

## Proof-development loop

The skill instructs the host agent to repeat:

```text
inspect target
    -> reason and draft outside canonical QMD
    -> check candidate structure
    -> independently verify
    -> repair on rejection or accept safely
```

The loop ends when the selected goal is verified, precisely refuted, genuinely
blocked, cancelled, or explicitly stopped by the user.

## Preparing a candidate

The host agent begins from the inspector's bounded theorem context. A utility
may create a proposal scaffold containing the exact canonical ID, title, and
statement so the agent does not reproduce protected content by hand.

A proposal contains exactly one complete semantic result block. It is stored
outside canonical QMD while it is being developed. Supporting calculations or
search notes may accompany it, but they are not part of the mathematical proof
and are not submitted as proof text.

Useful assistance may include:

- showing verified premises available in the theorem's scope;
- searching local semantic results by ID, title, or statement text;
- explaining which import would make a cross-file result available;
- comparing a draft with the protected canonical statement;
- comparing `Uses` with proof citations; and
- retrieving earlier rejected attempts and concrete repair feedback.

These are aids to the host agent. They do not synthesize an autonomous work
plan or maintain a qmd-prover worker model.

## Candidate preflight

Before independent verification, the utility confirms that:

- the proposal contains exactly one semantic result;
- its target exists in canonical QMD;
- its protected title and statement are unchanged;
- its proof is nonempty;
- every cited dependency is declared;
- every declared dependency is cited;
- every dependency exists and is available through local scope or an explicit
  import; and
- every premise required to support an accepted proof has the required
  verification status.

Preflight establishes that the candidate is eligible for mathematical review.
It does not imply correctness.

## Independent verification

The verifier is a bounded facility within the proving utilities. It may run an
external command, a fresh LLM context, a host-provided verification sub-agent,
or a formal checker adapter.

An informal verifier receives a minimal packet containing:

- the exact target statement;
- the candidate proof;
- declared dependencies;
- the statements of cited, verified results;
- relevant definitions and hypotheses; and
- a verification rubric requiring explicit errors and gaps.

It does not receive the proving agent's confidence, private reasoning,
persuasive commentary, or unrelated project narrative. A fresh verifier
context prevents the candidate's author from implicitly self-verifying.

The verifier returns structured results with at least:

- a verdict;
- a short summary;
- critical mathematical errors;
- unfilled gaps; and
- repair guidance.

An informal candidate is accepted only when the verdict is correct and both
the critical-error and gap lists are empty.

LLM verification, formal verification, and human review are separate statuses.
The record must not describe an informal verifier result as formal proof.

## Rejection and repair

On rejection:

- canonical QMD is unchanged;
- the candidate and complete verifier report are retained;
- the host agent reads every critical error and gap;
- repair occurs in a new or updated isolated proposal; and
- the repaired candidate is checked and verified again in a fresh context.

The utility does not hide earlier reports or replace them with a summary that
loses actionable detail.

If the statement appears false, the host agent preserves it and develops a
precise refutation or counterexample for the user. It must not weaken the
statement to manufacture an acceptable proof.

## Safe acceptance

Verification can take time, so acceptance must confirm that the verified
context is still current.

Before verification, the utility records identities for:

- the target statement and existing canonical proof; and
- every dependency statement, proof, and verification status used by the
  candidate.

After a successful verdict, it reinspects the project. If the target or any
dependency changed, the submission is stale and must not be applied.

For a current submission, the utility:

1. acquires the canonical-write lock;
2. replaces only the permitted proof content;
3. records verification for the exact accepted statement and proof;
4. rebuilds and checks the semantic project state; and
5. commits the files atomically, rolling back on any failure.

The host agent cannot bypass this path merely because it authored the proof.

## Records

The proving utilities may retain under `.qmd-prover/`:

- isolated proposals and optional supporting notes;
- the bounded packet sent to the verifier or its stable identity;
- complete verifier reports;
- accepted and rejected submission records; and
- a verification index relating an exact proof to its status.

This is proof provenance, not an agent task database. The core design has no
qmd-prover worker registry, scheduler, or inter-agent message store.

## Invocation model

The utilities are dependency-free Node programs shipped inside the skill. The
skill tells the host agent which script operation to run and how to interpret
its stable JSON result. A human may run the same operation with `node` for
debugging or direct use.

There is no separately installed qmd-prover binary and no independent CLI
architecture. Script command names and JSON schemas are the tool protocol used
by the skill.
