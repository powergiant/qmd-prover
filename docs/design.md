# qmd-prover design

## Purpose

qmd-prover is a skill and tool set for disciplined mathematical proof
development in Quarto Markdown. It describes the discipline an agent must
follow, provides tools for checking that discipline and discovering logical
dependencies, helps the agent construct and independently verify proof
candidates, and makes proof progress observable through ordinary Quarto
rendering.

A user asks Codex, Claude Code, or another compatible coding agent to use the
skill. The host agent follows the discipline, calls the supplied Node tools,
and edits the QMD project on the user's behalf.

Canonical mathematics remains ordinary, human-readable QMD, and Quarto remains
the renderer.

## Components

The project has four components:

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
Codex / Claude Code                                (outside qmd-prover)
  |
  | loads the skill and runs the loop
  v
+-------------------------------------------------------+
| qmd-prover skill                                      |
|                                                       |
| discipline -> inspector -> agent goal workspace       |
|                  |              |                     |
|                  |              v                     |
|                  +------> proving utilities           |
|                                 | accepted work only   |
|                                 v                     |
|                         canonical QMD project          |
+-------------------------------------------------------+
                                  |
                                  v
                              Quarto render        (outside qmd-prover)
```

Codex or Claude Code is not a qmd-prover component. It decides how to reason,
how long to continue, and whether to use host-provided sub-agents. Quarto is
also not implemented by qmd-prover; it consumes the resulting QMD project.

## Mathematical project model

A qmd-prover project separates the canonical project workspace from one or
more agent workspaces.

The **canonical project workspace** contains the user-given statements and the
mathematics that has passed the project's acceptance rules. It is the ordinary
Quarto project that the user opens and renders. The agent reads it as its source
of truth and does not use it as a scratch directory.

An **agent workspace** is a persistent mathematical area for proof development.
It may serve one goal or a related family of goals. If the agent works on a
difficult theorem for a long time, it may introduce many tentative definitions,
reductions, intermediate theorems, examples, counterexamples, partial proofs,
and repair notes. Those files belong in the agent workspace until the relevant
mathematics is independently verified and accepted into the canonical project.

The separation is about authority, not about whether a file was physically
written by a person or a model:

- canonical QMD is accepted project mathematics;
- workspace QMD is agent-generated working mathematics; and
- generated indexes and reports describe one of those spaces but are not
  mathematics themselves.

### Example: one theorem after prolonged work

Suppose the canonical project gives the agent one open theorem,
`@thm-main-uniform-index`:

```text
uniform-index-project/                     # canonical project workspace
├── AGENTS.md
├── _quarto.yml
├── index.qmd
├── notation.qmd
├── background.qmd
├── uniform-index.qmd                      # contains @thm-main-uniform-index
└── .qmd-prover/
    ├── manifest.json
    ├── graph.json
    ├── verification/                       # accepted canonical records
    └── workspaces/                         # visible working mathematics
        ├── .workspaces/                    # machine-managed workspace state
        │   ├── workspace.json              # target, base hashes, and status
        │   ├── verification/
        │   │   ├── lem-local-exponent-bound.json
        │   │   └── thm-main-uniform-index.json
        │   ├── target.qmd                   # protected snapshot of the goal
        │   └── graph.json                   # workspace dependency graph
        ├── progress.qmd                    # overall plan and proved frontier
        ├── context/
        │   ├── progress.qmd
        │   ├── imported-results.qmd     # bounded canonical context
        │   └── external-results.qmd     # precisely recorded literature
        ├── reductions/
        │   ├── progress.qmd
        │   ├── reduce-to-strata.qmd
        │   ├── generic-fiber.qmd
        │   └── specialization.qmd
        ├── local-theory/
        │   ├── progress.qmd
        │   ├── local-class-groups.qmd
        │   ├── exponent-bounds.qmd
        │   └── completion-comparison.qmd
        ├── global-theory/
        │   ├── progress.qmd
        │   ├── finite-stratification.qmd
        │   ├── constructibility.qmd
        │   └── lcm-argument.qmd
        ├── examples/
        │   ├── progress.qmd
        │   ├── quotient-singularities.qmd
        │   └── possible-counterexamples.qmd
        └── main-proof.qmd
```

This is an illustrative workspace, not a required list of subject directories.
The visible files under `workspaces/` are ordinary mathematical QMD organized
by the development itself. The hidden `workspaces/.workspaces/` directory is
reserved for machine-managed state: the protected target, base identities,
workspace graph, and workspace verification records. Project-level
`.qmd-prover/verification/` records accepted canonical mathematics, while the
workspace-local verification directory retains checks of provisional work.

A short proof may need only the hidden target snapshot, a top-level
`progress.qmd`, and one mathematical working file. A long proof may grow into a
substantial mathematical development. Top-level `progress.qmd` records the
overall frontier; a subject directory may carry its own `progress.qmd` when a
local frontier is useful. Attempts, abandoned routes, and submission candidates
remain ordinary mathematical QMD; they do not require dedicated file types or
directories. Verification records are the only proof-development artifacts
with a dedicated non-QMD format.

The agent may group several closely related claims, partial proofs, rejected
proofs, and explanatory prose in one QMD file or split a large line of argument
across many files. It should follow the structure already present in the
workspace rather than creating one file for every transient thought.

### Workspace dependency model

The inspector treats the agent workspace as a provisional mathematical
project. Its graph may contain:

- verified results imported from the canonical project;
- new workspace results that have been proved and independently checked;
- conjectural intermediate results still awaiting proof;
- alternative approaches to the same subgoal; and
- a candidate proof of the original main theorem.

For example, the workspace may discover the following chain:

```text
@thm-main-uniform-index
  -> @lem-finite-stratification
  -> @lem-local-exponent-bound
  -> @lem-completion-preserves-index
  -> @thm-canonical-local-class-group-finite
```

The agent can work backward from an unproved dependency, replace a failed
intermediate claim, or preserve a dead end without disturbing canonical QMD.
The workspace graph makes the current proof frontier explicit after many
sessions.

### Promotion into the canonical project

Workspace files are not automatically part of the user's Quarto project. A
workspace result crosses the boundary only through the proving utilities:

1. Select one complete new result or one proof candidate from the workspace.
2. Check it against the discipline and the dependencies cited in its proof.
3. Verify it independently.
4. Reject it without changing canonical QMD, or accept it atomically.
5. Place an accepted new lemma in the canonical project according to project
   policy, or apply an accepted proof to its existing canonical theorem.
6. Reinspect both spaces so the workspace can depend on the newly accepted
   canonical result.

Not every workspace theorem needs promotion. Auxiliary experiments, abandoned
claims, and lemmas that are eventually inlined may remain in the workspace.
Every dependency cited by the final canonical proof, however, must also be
available in the canonical project and have the required verification status.

The files have different ownership:

- `AGENTS.md` is project-owned policy. It contains the unchanged managed
  qmd-prover contract plus optional local rules.
- QMD files outside `.qmd-prover/` are canonical mathematics and exposition.
- `_quarto.yml` is the project's normal Quarto configuration.
- `.qmd-prover/workspaces/` contains persistent but noncanonical mathematical
  work, with machine state isolated under its `.workspaces/` child.
- Project verification JSON records accepted canonical results; workspace
  verification JSON retains accepted and rejected checks of provisional work.
- Other `.qmd-prover/` files contain derived indexes and caches.

## Semantic QMD

qmd-prover pays attention only to recognized semantic blocks. The rest of QMD
remains ordinary Quarto content, including prose, equations, figures, code
cells, and bibliographic citations.

The semantic format follows the way a mathematical document is normally read:

- a result block contains its title and statement;
- a proof block contains its proof; and
- semantic references in the proof identify its logical dependencies.

There are no `Statement`, `Uses`, or `Proof` subheadings. In particular,
dependencies are not written twice in a separate list and then again in the
argument. The inspector derives proof dependencies directly from semantic
references at their points of use.

The format has six structural rules:

1. A definition or result block has a semantic ID, semantic class, a `name`
   attribute, an ISO `date="YYYY-MM-DD"` recording when the statement was
   introduced, and the statement as its body. The date is informational: it is
   not a truth-status label and does not affect statement or proof identity.
   Quarto renders `name` as the caption.
2. A proof is a `.proof` block whose `of` attribute names the result it proves.
3. The first nonempty paragraph of a workspace proof may be exactly `OPEN` or
   `REJECTED`. This reserved control paragraph is not part of the mathematical
   proof and is excluded from proof identity and verifier input.
4. A missing proof or a proof beginning with `OPEN` means an open result. A
   proof beginning with `REJECTED` is an inactive rejected attempt. An
   unmarked proof is a candidate until an exact accepted verification record
   establishes it as verified. Source QMD has no `VERIFIED` marker.
5. A workspace may retain multiple marked proof attempts for one result, but
   at most one unmarked proof may be active. Canonical QMD may contain only its
   one accepted, unmarked proof.
6. Cross-file availability is declared in QMD front matter, while actual proof
   dependencies are the semantic references found in the proof body.

### Open main goal

A user creates a top-level proof obligation with a protected `thm-main-*` ID.
The result block itself is the statement. The absence of an associated proof
block means that the goal is open:

```markdown
::: {#thm-main-even-square .theorem .goal name="Even squares" date="2026-07-12"}
For every even integer \(n\), the integer \(n^2\) is divisible by \(4\).
:::
```

The ID, title, hypotheses, quantifiers, and statement are user-owned. The host
agent may supply a proof but may not make the goal easier by changing any of
those protected parts.

### Reusable result

Definitions, lemmas, propositions, theorems, and corollaries use corresponding
semantic classes and ID prefixes. A proof is a separate block linked to its
result by `of`. Each semantic reference inside the proof becomes a dependency:

```markdown
::: {#lem-square-of-double .lemma name="Square of a double" date="2026-07-12" export="square-of-double"}
If \(n=2k\) for integers \(n,k\), then \(n^2=4k^2\).
:::

::: {.proof of="lem-square-of-double"}
Using the representation from @def-even-integer, calculate
\(n^2=(2k)^2=4k^2\).
:::
```

The `export` attribute makes the result eligible for explicit use from another
file. The proof's reference to `@def-even-integer` is both readable mathematics
and the dependency declaration. Results in the same file are locally available
without an import. Definitions use the same introduction-date attribute, but
are accepted or provisional declarations rather than proved propositions.

### Cross-file dependency

A QMD file imports individual exported results through ordinary Quarto
front-matter metadata. The metadata is visible in the source but does not
become document content when rendered:

```markdown
---
title: "Parity results"
qmd-prover:
  imports:
    - from: foundations.qmd
      use:
        - def-even-integer
        - lem-square-of-double
---
```

Wildcard imports are not part of the semantic model. An imported ID must exist
in the named file and must be exported there. Import metadata controls which
results are available; references in proofs determine which available results
are actually used.

### Candidate proof

A candidate for an existing main goal needs only a linked proof block. The
protected statement is read from canonical QMD instead of being copied into
every attempt:

```markdown
::: {.proof of="thm-main-even-square"}
Let \(n\) be even. By @def-even-integer, write \(n=2k\) for an integer
\(k\). Then @lem-square-of-double gives \(n^2=4k^2\), so \(4\) divides
\(n^2\).
:::
```

The two semantic references are the candidate's direct dependencies. This text
is still only a candidate. Acceptance requires a separate verification step.
On acceptance, the proof block is placed next to the protected theorem block in
canonical QMD.

### Partial and rejected proofs

A partial workspace proof begins with the reserved `OPEN` paragraph:

```markdown
::: {#proof-even-square-0001 .proof of="thm-main-even-square"}
OPEN

It remains to justify that the chosen representation is available uniformly.
:::
```

The inspector retains the mathematical text but does not treat this block as a
complete candidate. A proof retained after rejection begins with `REJECTED`:

```markdown
::: {#proof-even-square-0002 .proof of="thm-main-even-square"}
REJECTED

Choose \(k=n/2\), then conclude that \(n^2\) is divisible by \(4\).
:::
```

The complete dispatcher-owned verification report remains authoritative. The
marker is a readable, conservative annotation: adding it cannot establish a
claim, and removing it cannot erase a matching rejection record. Repairing the
mathematical proof changes its identity; the repaired, unmarked proof is then a
new candidate.

### New result candidate

When the agent develops a new intermediate result, the mathematical QMD
contains the new result block followed by its proof block:

```markdown
::: {#lem-product-positive .lemma name="Product of positive elements" date="2026-07-12"}
If \(a>0\) and \(b>0\) in an ordered field, then \(ab>0\).
:::

::: {.proof of="lem-product-positive"}
Apply @thm-ordered-field-positive-product to \(a\) and \(b\).
:::
```

No proposal file type or directory is required. Submission selects this active
semantic result and proof. The result block can be promoted into canonical QMD
only together with an accepted proof and valid dependencies.

## Dependencies

A logical dependency must satisfy all of the following:

1. It is cited with a semantic `@` reference at the point of use in the proof.
2. It is defined in the same file or individually imported through QMD
   metadata.
3. A proof being accepted relies only on dependencies with an acceptable
   verification status.

The inspector reads references only from the proof block associated through
`of`. It checks their availability and status, then constructs a directed
graph. An edge from theorem A to lemma B means that A's proof cites B. From
this graph the inspector can provide both the dependency closure needed to
understand A and the reverse dependencies that may be affected if B changes.

Semantic references in ordinary exposition are navigational rather than
logical dependencies. Bibliographic citations remain Quarto citations and are
not confused with theorem IDs.

## Result status

Status is derived from the current QMD, the two conservative proof-control
markers, and retained verification records. Neither marker can assert success.

- `open` means no proof is present or the retained proof begins with `OPEN`.
- `candidate` means an unmarked proof is present but has not been accepted for
  its current identity.
- `rejected` means the retained proof begins with `REJECTED` or an independently
  checked candidate has a matching rejection record; canonical QMD was not
  changed by that rejected submission.
- `verified` means the current statement and proof match an accepted
  verification record.
- `revoked` means an earlier acceptance was explicitly withdrawn with a
  recorded reason.

Formal verification and human review are recorded independently. An informal
LLM verdict must not be described as formal verification.

## How proof work proceeds

For a typical request, the host agent follows this loop:

1. Load the qmd-prover skill.
2. Read the project's `AGENTS.md` and confirm that its managed qmd-prover
   contract matches the canonical contract shipped with the skill.
3. Ask the inspector for the project state and the selected theorem's bounded
   context.
4. Stop on structural errors that make proof work unsafe, such as a changed
   protected statement or an unresolved dependency.
5. Create or resume the workspace for the selected goal, recording the exact
   canonical target and dependency snapshot.
6. Develop the argument in workspace QMD. Introduce intermediate results,
   examples, alternative approaches, and notes as needed.
7. Inspect the workspace graph to identify the next unproved dependency and to
   avoid treating conjectural workspace claims as established premises.
8. Select a complete workspace result or proof and use the proving utilities
   to check its structure and cited dependencies.
9. Send that result and its bounded mathematical context to an independent
   verifier, which may itself be implemented with a fresh sub-agent.
10. If rejected, preserve the report in verification JSON, retain the rejected
    proof with its `REJECTED` marker when useful, repair the result, and repeat.
11. If accepted, recheck that the target and dependencies are current and
    promote the result or proof into canonical QMD atomically.
12. Continue until the original main theorem is accepted or the work reaches
    another legitimate stopping condition.
13. Run `quarto render` when the user wants a rendered document or project
    view.

This is a loop performed by the host agent under skill instructions. It is not
a loop implemented by a qmd-prover daemon or coordinator.

## Installation and requirements

The skill and runtime are self-contained under `skills/qmd-prover/`. The
runtime has no third-party Node dependencies.

The expected environment provides:

- Node.js 20 or later;
- Pandoc on `PATH`, or `QMD_PROVER_PANDOC` pointing to a compatible executable;
- Quarto when rendered output is wanted; and
- an independent verifier configured through `QMD_PROVER_VERIFIER` or the
  project's qmd-prover configuration.

From a source checkout, install the skill with:

```bash
npm run install:skill
```

This copies `skills/qmd-prover/` to
`${CODEX_HOME:-~/.codex}/skills/qmd-prover`. The installed skill contains its
instructions, canonical discipline reference, and Node utilities.

## Starting a mathematical project

To use qmd-prover in a Quarto project:

1. Create or choose the project's root `AGENTS.md`.
2. Copy the managed block from the installed skill's
   `references/AGENTS.md` into the project file unchanged.
3. Add any project-specific notation, writing, or organization rules outside
   the managed block.
4. Write one or more QMD files containing semantic definitions, results, and
   open `thm-main-*` goals.
5. Configure an independent verifier before asking for proof acceptance.

The host agent checks the contract before it mutates QMD or qmd-prover state.
If the contract is absent or different, it explains the mismatch and asks for
permission before creating or synchronizing project policy.

## Using qmd-prover through Codex or Claude Code

Natural language is the normal interface. Once the skill is installed and the
mathematical project is open, a user can ask:

```text
Use qmd-prover to inspect this project and prove @thm-main-even-square.
Preserve the statement, verify the candidate independently, and repair any
concrete gaps before accepting it.
```

For project status:

```text
Use qmd-prover to show the open goals and the dependency context of
@thm-main-even-square.
```

For presentation:

```text
Render the Quarto project and show me the current proof progress.
```

The host agent loads `SKILL.md`, performs the contract preflight, invokes the
Node utilities, interprets their JSON, writes mathematical workspace QMD, and
explains the result in ordinary language. The user does not need to memorize
script operations.

The host may use its own sub-agent mechanism for independent verification or
parallel mathematical exploration when the user requests it. Those sub-agents
belong to the host environment; qmd-prover does not maintain a worker runtime.

## Using the Node utilities directly

A user or maintainer may invoke the same operations directly with Node. From
the mathematical project root, let the installed skill path be:

```bash
QMD_PROVER_ROOT="${CODEX_HOME:-$HOME/.codex}/skills/qmd-prover"
```

Inspect the project:

```bash
node "$QMD_PROVER_ROOT/scripts/qmd-prover.mjs" inspect-project
```

Inspect one theorem and its bounded dependency context:

```bash
node "$QMD_PROVER_ROOT/scripts/qmd-prover.mjs" \
  inspect-theorem @thm-main-even-square
```

Submit the selected candidate from workspace QMD:

```bash
node "$QMD_PROVER_ROOT/scripts/qmd-prover.mjs" \
  submit-proof .qmd-prover/workspaces/main-proof.qmd
```

Read a stored verification report:

```bash
node "$QMD_PROVER_ROOT/scripts/qmd-prover.mjs" \
  verification show SUBMISSION_ID
```

Revoke an accepted verification only with a concrete reason:

```bash
node "$QMD_PROVER_ROOT/scripts/qmd-prover.mjs" \
  verification revoke @thm-main-even-square --reason "The dependency was invalidated"
```

These operations expose the skill's tool protocol; they are not a separately
designed interactive CLI. Their JSON output is stable so a host agent can call
them reliably. Structural diagnostics use a nonzero exit status.

Submitting a candidate is intentionally stronger than copying its proof into a
canonical QMD file: it checks structure and dependencies, invokes the
independent verifier, rejects stale work, and performs the canonical update
only after acceptance. "Proposal" names this submission action, not a distinct
file type.

## Rendering with Quarto

Render the mathematical project with its normal Quarto configuration:

```bash
quarto render
```

qmd-prover does not render an alternative site. The canonical theorem blocks,
proofs, equations, and cross-references remain part of the QMD documents that
Quarto reads.

When additional observability is desired, inspector data may be exposed as
generated QMD, a dependency-graph asset, or data consumed by a Quarto
extension. These are inputs to the same `quarto render` pipeline. HTML may
provide richer navigation than PDF, but correctness and verification do not
depend on rendering.

## Data ownership

The mathematical project's QMD files and its `AGENTS.md` are canonical.
Definitions, statements, proofs, exposition, citations, and semantic
references live there.

`.qmd-prover/` may contain persistent agent work and derived artifacts such as:

- a shared mathematical workspace containing partial, candidate, and rejected
  proofs, with protected state under `workspaces/.workspaces/`;
- a semantic manifest and dependency graph;
- dispatcher-owned verification JSON retaining accepted and rejected reports,
  exact semantic identities, and review dates; and
- generated QMD or data used for observability.

Agent workspaces are valuable resumable state, but they are not canonical
project mathematics. Generated indexes and rendered output must be
reproducible from canonical QMD, retained workspaces, and verification records.

## Verification and acceptance in detail

Before verification, the proving utilities validate the candidate and record
the identities of the target and every dependency. The verifier receives only
the exact statement, candidate proof, relevant definitions, and statements of
cited verified dependencies. It does not receive the proving agent's
confidence or unrelated narrative.

A typical informal verifier response contains:

```json
{
  "verdict": "correct",
  "summary": "The proof covers the quantified case.",
  "critical_errors": [],
  "gaps": [],
  "repair_hints": ""
}
```

Acceptance requires `verdict: correct` together with empty `critical_errors`
and `gaps`. Any other response is a rejection.

Verification JSON is the only dedicated auxiliary proof-development file type.
Workspace records retain checks of provisional mathematics; project records
identify exact mathematics accepted into canonical QMD. Both act as caches and
ledgers for statements, proofs, dependencies, verdicts, gaps, repair guidance,
and submission and review dates. They are fail-closed: a missing, corrupt,
stale, or nonmatching record never makes a result verified. Only the dispatcher
may write an accepted record or promote a workspace record to project scope.

After an accepting verdict, the proving utilities inspect the project again.
If the protected target or any dependency changed while verification was
running, the candidate is stale and is not applied. Otherwise, only the
permitted proof content and its matching verification record are written. A
post-write inspection must confirm the accepted state; failure rolls the
canonical source back.

This mechanism separates authorship from judgment while keeping the host agent
responsible for the proof-development loop.

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

## Further design documents

- [Discipline design](design-discipline.md) explains policy ownership,
  categories of rules, and contract evolution.
- [Inspector design](design-inspector.md) explains Pandoc parsing, scope
  resolution, dependency construction, diagnostics, and theorem bundles.
- [Proving utilities design](design-proving.md) explains candidate submission,
  independent verification, rejection, stale checks, and atomic acceptance.
- [Rendering design](design-rendering.md) explains how observability integrates
  with the ordinary Quarto pipeline.
