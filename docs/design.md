# Design overview — qmd-prover

## Purpose

qmd-prover is an installable skill for developing mathematical proofs in
Quarto Markdown. A user loads the skill in Codex, Claude Code, or another
compatible coding agent. That host agent reads the project's mathematical
discipline, calls the supplied Node utilities when it needs structured
information or independent verification, and edits the QMD project on the
user's behalf.

qmd-prover is not an autonomous proving service. It does not provide a
dedicated proving agent, worker pool, scheduler, or background loop. The host
agent already supplies the reasoning loop and, when useful, its own sub-agent
facilities. qmd-prover supplies the discipline and bounded utilities needed to
make that loop safe and observable.

Canonical mathematics remains ordinary, human-readable QMD. Quarto remains the
renderer.

## Components

The design has four components:

1. [Discipline](design-discipline.md) defines the rules for mathematical QMD
   and for agents working on it.
2. [Inspector](design-inspector.md) parses the project, checks the mechanically
   enforceable discipline, and exposes theorem dependencies and status.
3. [Proving utilities](design-proving.md) help the host agent prepare,
   independently verify, repair, and safely accept a proof.
4. [Rendering](design-rendering.md) uses Quarto to present the QMD project and
   any generated observability material.

The skill ties these components together. Node is an execution mechanism for
the utilities, not a separately designed user-facing CLI. A person may run a
script with `node`, but the normal interaction is to ask Codex or Claude Code
in natural language.

## System boundary

```text
user
  |
  v
Codex / Claude Code                 outside qmd-prover
  |
  | loads the skill and runs the loop
  v
+-------------------------------------------------------+
| qmd-prover skill                                      |
|                                                       |
| discipline -> inspector -> proving utilities          |
|                        |                              |
|                        +----> QMD project              |
+-------------------------------------------------------+
                                  |
                                  v
                              Quarto render              outside qmd-prover
```

Codex or Claude Code is not a qmd-prover component. It decides how to reason,
how long to continue, and whether to use host-provided sub-agents. Quarto is
also not implemented by qmd-prover; it consumes the resulting QMD project.

## How proof work proceeds

For a typical request, the host agent follows this loop:

1. Load the qmd-prover skill.
2. Read the project's `AGENTS.md` and confirm that its managed qmd-prover
   contract matches the canonical contract shipped with the skill.
3. Ask the inspector for the project state and the selected theorem's bounded
   context.
4. Stop on structural errors that make proof work unsafe, such as a changed
   protected statement or an unresolved dependency.
5. Reason about the theorem and write an isolated candidate proof.
6. Use the proving utilities to check the candidate's structure and declared
   dependencies.
7. Send the candidate and its bounded mathematical context to an independent
   verifier, which may itself be implemented with a fresh sub-agent.
8. If rejected, use the verifier's concrete feedback to repair the candidate
   and repeat.
9. If accepted, recheck that the statement and dependencies are current and
   apply the proof to canonical QMD atomically.
10. Run `quarto render` when the user wants a rendered document or project
    view.

This is a loop performed by the host agent under skill instructions. It is not
a loop implemented by a qmd-prover daemon or coordinator.

## Data ownership

The mathematical project's QMD files and its `AGENTS.md` are canonical.
Definitions, statements, proofs, exposition, citations, and semantic
references live there.

`.qmd-prover/` may contain derived or temporary artifacts such as:

- a semantic manifest and dependency graph;
- isolated proof proposals;
- independent verification reports;
- the verification record associated with an accepted proof; and
- generated QMD or data used for observability.

These artifacts support the skill but do not replace the mathematical source.
Generated indexes and rendered output must be reproducible from canonical QMD
and retained verification records.

## Core invariants

Every component preserves the following invariants:

- A `thm-main-*` ID, title, hypotheses, quantifiers, and statement are
  user-owned and protected.
- Every logical dependency is explicit and available in the theorem's scope.
- A proof candidate is not accepted merely because its author considers it
  correct.
- Independent verification is based on the exact statement, candidate, and
  relevant dependencies.
- Rejection never changes canonical mathematics.
- Acceptance is rejected as stale if the target or a dependency changed during
  verification.
- Canonical proof updates are atomic.
- QMD remains readable and renderable by Quarto without qmd-prover becoming a
  second document system.

## Non-goals

qmd-prover does not define:

- a dedicated autonomous agent;
- a persistent worker or task model;
- a scheduling or messaging system for sub-agents;
- a public CLI product separate from the skill's Node utilities;
- a custom HTML, PDF, or website renderer; or
- a replacement for formal proof assistants.

An independent LLM verifier establishes only the configured verification
status. Formal verification and human review remain distinct claims.
