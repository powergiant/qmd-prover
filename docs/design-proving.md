# Proving utilities design

## Role

The proving utilities help Codex or Claude Code turn mathematical reasoning
into a checked proof candidate and move an independently accepted candidate
into canonical QMD safely.

They do not form a proving agent. The host agent decides how to reason, which
lemmas to introduce, when to explore examples, and how to repair a proof. The
utilities provide bounded context, mechanical checks, independent verification,
and a protected acceptance path.

## Flexible proof development

The utilities do not prescribe a proof-development loop. The host agent may
start from a theorem, a related family of goals, or an informal idea; introduce
intermediate mathematics in any useful order; and inspect, search, verify, or
render whenever those operations help. Only candidate acceptance is ordered:
mechanical checks run before independent AI verification, and canonical writes
occur only after both pass.

## Mathematical agent workspace

Tentative proof development takes place in persistent goal workspaces, not in
the canonical Quarto sources. Proving `@thm-main-ID` requires
`.qmd-prover/workspaces/thm-main-ID/`; the host may organize its mathematical
contents freely. This matters when one short request expands into a large body
of agent-generated mathematics.

For example, work on `@thm-main-uniform-index` may eventually contain:

```text
.qmd-prover/workspaces/thm-main-uniform-index/
├── workspace.json
├── target.qmd
├── graph.json
├── verification/
│   ├── lem-local-exponent-bound.json
│   └── thm-main-uniform-index.json
├── progress.qmd
├── context/
│   └── imported-results.qmd
├── reductions/
│   ├── reduce-to-strata.qmd
│   └── specialization.qmd
├── local-theory/
│   ├── local-class-groups.qmd
│   └── exponent-bounds.qmd
└── main-proof.qmd
```

The visible QMD files are noncanonical working mathematics. They may contain
definitions, lemmas, theorems, examples, partial proofs, rejected proofs, or
alternative routes. Top-level `progress.qmd` records the overall frontier; a
subject directory may add its own `progress.qmd` for local context.

Within the goal directory, `target.qmd` preserves the assigned statement,
`workspace.json` records the canonical identities on which work began,
`graph.json` records the provisional dependency graph, and `verification/`
retains exact checks of workspace candidates. Accepted canonical records remain
in the project-level `.qmd-prover/verification/` cache.

The inspector maintains a provisional dependency graph for this workspace. A
workspace result may depend on verified canonical results or other workspace
claims, but a conjectural claim cannot silently become an accepted premise.
The agent follows unproved edges until it closes the required dependency
closure, replaces a failed claim, or records a genuine dead end.

The visible directory layout may grow with the proof. It should group coherent
mathematical developments rather than create a file or directory type for every
transient thought. Resuming agents use the nearest `progress.qmd`, the hidden
graph, marked partial or rejected proofs, and verifier reports to recover the
proof frontier.

## Preparing a candidate

The host agent may request bounded context from the inspector whenever useful.
A utility may create a proof scaffold linked to a canonical result by semantic
ID. The statement is not copied beside each proof, so the agent cannot
accidentally rewrite protected content while drafting.

An existing result needs an active `.proof` block with an `of` attribute. A new
intermediate result needs one dated result block and its linked proof. Both live
in ordinary workspace QMD. Submission selects the active semantic unit; there
is no proposal file type or required proposal directory. Supporting
calculations or search notes may accompany the mathematics, but are not
submitted as proof text.

A partial proof begins with a first nonempty paragraph exactly equal to `OPEN`.
A proof retained after rejection begins with `REJECTED`; accepted and revoked
proofs begin with `VERIFIED` and `REVOKED`, respectively. These control
paragraphs are excluded from proof identity and verifier input. A workspace may
retain multiple inactive marked proofs for one result, but only one unmarked
candidate or `VERIFIED` proof may be active. Record-backed markers have no
authority without their exact matching records.

Useful assistance may include:

- showing verified premises available in the theorem's scope;
- searching local semantic results by ID, title, or statement text;
- explaining which import would make a cross-file result available;
- comparing a draft with the protected canonical statement;
- checking every semantic reference in a proof for availability and status;
- retrieving earlier rejected attempts and concrete repair feedback.

These are aids to the host agent. They do not synthesize an autonomous work
plan or maintain a qmd-prover worker model.

### Example candidate

Starting from an open goal, the host agent writes the active proof in an
ordinary workspace file such as `main-proof.qmd`:

```markdown
::: {.proof of="thm-main-even-square"}
Let \(n\) be even. By @def-even-integer, there is an integer \(k\) such
that \(n=2k\). Hence \(n^2=(2k)^2=4k^2\), so \(4\mid n^2\).
:::
```

The utility obtains the exact title and statement from canonical QMD. The
reference to `@def-even-integer` is the proof's dependency declaration. The
selected block becomes eligible for acceptance only after preflight and
independent verification.

## Candidate preflight

Before independent verification, the utility confirms that:

- the selected semantic unit contains exactly one active proof and at most one
  new result;
- the proof's `of` attribute resolves to its canonical or workspace result;
- an existing target's protected result block was not redefined;
- the proof body is nonempty;
- the candidate proof has no `OPEN`, `REJECTED`, `VERIFIED`, or `REVOKED`
  control paragraph;
- every dependency exists and is available through local scope or an explicit
  import; and
- every premise required to support an accepted proof has the required
  verification status.

Preflight establishes that the candidate is eligible for mathematical review.
It does not imply correctness.

### Example preflight failure

If the selected proof links to a nonexistent or misspelled target:

```markdown
::: {.proof of="thm-main-even-squares"}
Let \(n=2k\). Then \(n^2=4k^2\).
:::
```

preflight rejects it because `@thm-main-even-squares` does not exist. The host
agent must link the proof to `thm-main-even-square`. There is no duplicated
statement beside the proof to edit or compare.

## Independent verification

The verifier is a bounded facility within the proving utilities. It may run an
external command, a fresh LLM context, a host-provided verification sub-agent,
or a formal checker adapter.

An informal verifier receives a minimal packet containing:

- the exact target statement;
- the candidate proof;
- dependencies cited in the proof;
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

### Example verifier packet

An abbreviated packet for the candidate above could be:

```json
{
  "target": {
    "id": "thm-main-even-square",
    "statement": "For every even integer n, n^2 is divisible by 4.",
    "proof": "Let n be even. By @def-even-integer ...",
    "cited_dependencies": ["def-even-integer"]
  },
  "dependencies": [
    {
      "id": "def-even-integer",
      "statement": "An integer n is even if n=2k for some integer k.",
      "status": "verified"
    }
  ],
  "verification": {
    "fresh_context": true,
    "require_zero_gaps": true
  }
}
```

It contains the mathematical context needed for judgment, but no statement
that the author is confident or that a previous attempt almost passed.

## Rejection and repair

On rejection:

- canonical QMD is unchanged;
- the candidate is retained with a leading `REJECTED` marker and the complete
  verifier report is retained in workspace verification JSON;
- the host agent reads every critical error and gap;
- repair occurs in ordinary workspace QMD; and
- the repaired candidate is checked and verified again in a fresh context.

The utility does not hide earlier reports or replace them with a summary that
loses actionable detail.

If the statement appears false, the host agent preserves it and develops a
precise refutation or counterexample for the user. It must not weaken the
statement to manufacture an acceptable proof.

### Example rejection and repair

For the claim “the product of two positive numbers is positive,” suppose a
candidate merely says “This is obvious.” A verifier can respond:

```json
{
  "verdict": "incorrect",
  "summary": "The conclusion is asserted without using the ordered-field rule.",
  "critical_errors": [],
  "gaps": ["Justify why a>0 and b>0 imply ab>0."],
  "repair_hints": "Cite the verified positivity-under-multiplication result."
}
```

The host agent then cites the available lemma at the point of application and
resubmits. A successful second report might be:

```json
{
  "verdict": "correct",
  "summary": "The cited ordered-field lemma directly proves the claim.",
  "critical_errors": [],
  "gaps": [],
  "repair_hints": ""
}
```

The first rejection remains recorded; it is not rewritten as a successful
attempt.

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
3. adds `VERIFIED` and records the exact accepted statement, proof or
   construction, dependencies, and graph snapshot;
4. rebuilds and checks the semantic project state; and
5. commits the marker, cache, record, and canonical files atomically, rolling
   back on any failure.

The host agent cannot bypass this path merely because it authored the proof.

### Example stale acceptance

Assume the verifier accepted a proof using `@lem-bound` with statement hash
`sha256:A`. Before the acceptance write, another edit changes that lemma,
producing statement hash `sha256:B`.

Even if the changed lemma remains true, the verifier did not review the
candidate against that exact dependency. The proving utility reports the
submission as stale and leaves canonical QMD unchanged. The host agent must
inspect the new dependency context and submit again.

By contrast, an unrelated prose edit outside all semantic blocks does not
change the target or dependency identities and need not invalidate the
submission.

After acceptance, every inspection compares `VERIFIED` facts with their cached
identities. A changed fact loses `VERIFIED`; the inspector follows reverse
dependencies and removes `VERIFIED` from every result that relied on it. The
historical records remain but are marked stale. Staleness does not add
`REVOKED`, which is reserved for explicit withdrawal with a concrete reason.

## Records

The proving utilities may retain under `.qmd-prover/`:

- a persistent mathematical workspace containing agent-generated QMD;
- goal workspace state under `workspaces/<thm-main-ID>/`;
- the bounded packet sent to the verifier or its stable identity;
- complete workspace verifier reports and accepted or rejected submission
  records under `workspaces/<thm-main-ID>/verification/`; and
- project verification records relating exact canonical proofs to status under
  `.qmd-prover/verification/`.

This is mathematical working state and proof provenance, not an agent runtime.
The core design has no qmd-prover worker registry, scheduler, or inter-agent
message store. Codex or Claude Code owns the running agent; qmd-prover preserves
the mathematical workspace that agent reads and writes.

## Invocation model

The utilities are dependency-free Node programs shipped inside the skill. The
skill tells the host agent which script operation to run and how to interpret
its stable JSON result. A human may run the same operation with `node` for
debugging or direct use.

There is no separately installed qmd-prover binary and no independent CLI
architecture. Script command names and JSON schemas are the tool protocol used
by the skill.

### Example direct invocation

From the mathematical project root, a maintainer can submit the selected
candidate with:

```bash
node "${CODEX_HOME:-$HOME/.codex}/skills/qmd-prover/scripts/qmd-prover.mjs" \
  submit-proof .qmd-prover/workspaces/thm-main-uniform-index/main-proof.qmd
```

A rejected JSON response directs the host agent to the stored report. An
accepted response identifies the exact target and verification record that now
matches canonical QMD.
