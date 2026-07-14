# Proving utilities design

## Role

The proving utilities help Codex or Claude Code turn mathematical reasoning
into explicit workspace definitions, intermediate results, and proof
candidates, then submit each mechanically ready candidate to an independent
verifier. Accepted mathematics remains in its goal workspace as
`workspace-verified` state.

They do not form a proving agent. The host decides how to reason, which lemmas
to introduce, when to explore examples, and how to repair a proof. The runtime
provides protected goal context, semantic compilation, dependency ordering,
bounded verifier packets, exact decision caches, rejection feedback, and
atomic workspace/project snapshots.

Earlier releases treated acceptance as promotion into user QMD. That path is
retired. User QMD now remains notes and protected main-goal storage; verifier
acceptance changes only workspace cache and snapshot state.

## Flexible proof development

The utilities do not prescribe a proof-development loop. The host may start
from one main goal, a related family of goals, an existing workspace, or an
informal idea that needs precise formulation. It may inspect, search, verify,
render, or reorganize the workspace whenever those operations help.

Only the safety gates are ordered:

1. establish current project and external-basis policy;
2. compile and pass project/global preflight;
3. pass the selected fact's mechanical checks;
4. verify dependencies before dependents;
5. run the independent verifier for exact cache misses;
6. recheck source and context freshness after the verifier returns; and
7. publish cache and snapshot state atomically.

These gates do not choose the next mathematical idea.

## Mathematical agent workspace

Tentative and verified proof development takes place in persistent goal
workspaces, not in user Quarto sources. Proving `@thm-main-ID` requires
`.qmd-prover/workspaces/thm-main-ID/`.

For example, prolonged work on `@thm-main-uniform-index` may contain:

```text
.qmd-prover/workspaces/thm-main-uniform-index/
├── workspace.json
├── target.qmd
├── manifest.json
├── graph.json
├── latest.json
├── snapshots/
├── verification/
│   ├── checks/
│   └── failures/
├── progress.qmd
├── reductions/
│   ├── reduce-to-strata.qmd
│   └── specialization.qmd
├── local-theory/
│   ├── local-class-groups.qmd
│   └── exponent-bounds.qmd
├── examples/
│   └── possible-counterexamples.qmd
└── main-proof.qmd
```

The layout is illustrative, not mandatory. `workspace.json` records the
protected target identity. `target.qmd` preserves the initialization snapshot
but is excluded from active workspace semantic discovery. `progress.qmd` is
user/agent-maintained context; inspection never overwrites it. Subject QMD
contains complete semantic declarations and linked proofs.

`main-proof.qmd` contains only a linked proof overlay for the protected main
goal. It must not repeat the theorem. The overlay becomes a workspace graph
node with the protected statement from user QMD and the proof identity from the
workspace.

The visible QMD may contain definitions, lemmas, propositions, theorems,
corollaries, calculations, examples, partial proofs, rejected attempts, and
alternative routes. The agent groups coherent mathematics rather than creating
one file for every transient thought.

The workspace graph is isolated. A local result may depend on another
declaration in the same workspace, subject to same-file or explicit cross-file
scope. It may not cite a different goal workspace or another protected main
goal. Outside mathematics is supplied through the exact external basis, not as
an implicit graph fact.

## Preparing a candidate

A candidate is an ordinary semantic declaration and linked proof in active
workspace QMD. There is no proposal file type and no required proposal
directory.

An intermediate theorem-like result contains one dated declaration and one
linked proof. A definition's construction lives in its declaration body and
may have a linked proof for existence, uniqueness, or well-definedness. The
protected main-goal candidate contains only the linked proof.

A partial theorem-like proof begins with `OPEN`. A failed attempt retained for
history begins with `REJECTED`. An unmarked complete proof is a candidate.
Current workspace verification does not write `VERIFIED` or `REVOKED` markers.
Those strings are recognized only as legacy state and are forbidden in new
workspace mathematics.

Useful preparation assistance includes:

- inspecting the selected fact and its exact local dependency closure;
- showing missing exports or imports;
- searching existing declarations by ID, title, text, kind, or status;
- calculating the proof frontier;
- comparing the current protected goal with `workspace.json`;
- reading exact prior rejections and repair hints; and
- checking whether the external basis permits a claimed outside theorem.

These are tools for the host agent, not an autonomous worker scheduler.

### Example candidate

Starting from an open protected goal, the host writes:

```markdown
::: {.proof of="thm-main-even-square"}
Let \(n\) be even. By @def-even-integer, there is an integer \(k\) such
that \(n=2k\). Hence \(n^2=(2k)^2=4k^2\), so \(4\mid n^2\).
:::
```

The protected statement comes from user QMD. The reference to
`@def-even-integer` is the proof's dependency declaration and must resolve to
a current local workspace definition.

## Candidate preflight

Before independent verification, the inspector confirms that:

- the selected ID resolves globally to one protected goal or workspace
  declaration;
- the owning workspace is initialized, current, and not orphaned;
- no global duplicate ID makes ownership ambiguous;
- the workspace result block has the correct ID prefix, class, name, date, and
  nonempty body;
- an intermediate result has exactly one appropriate linked proof;
- the protected target is supplied only through a proof overlay and was not
  redeclared;
- the proof is not `OPEN`, `REJECTED`, `VERIFIED`, or `REVOKED`;
- every local dependency exists, is unique, and is in scope;
- every cross-file dependency has an exact producer export and consumer import;
- no dependency crosses a workspace or main-goal boundary;
- the selected dependency closure is cycle-free; and
- every dependency needed by the candidate has current usable workspace state.

Preflight establishes eligibility for mathematical review, not correctness.

### Example preflight failure

If the proof links to a misspelled target:

```markdown
::: {.proof of="thm-main-even-squares"}
Let \(n=2k\). Then \(n^2=4k^2\).
:::
```

the inspector does not guess the nearby ID. It reports that the proof target is
unknown or invalid. The host repairs `of` to name the exact protected target.

Similarly, a proof that cites `@lem-square-of-double` from another workspace is
not repaired by adding an import. The claim must be established locally or
represented as a permitted external premise without a cross-workspace ID edge.

## Independent verification

The verifier is a bounded external facility. It may be an LLM command, a fresh
review context, or a formal-checker adapter that implements the protocol.

An informal verifier packet contains:

- exact target ID, kind, title, statement or construction, and proof;
- identities and current states of cited local dependencies;
- their exact semantic text;
- normalized workspace imports and source association;
- protected-goal context for an overlay;
- exact external-basis mode and content;
- checker contract and verifier protocol; and
- an instruction to report errors and gaps independently.

It does not contain the author's confidence, hidden chain of thought,
persuasive commentary, or unrelated project narrative.

The verifier returns a verdict, summary, critical errors, gaps, nonblocking
comments, and repair hints. Informal acceptance requires `correct` and empty
critical-error and gap lists. The cache record preserves the full packet and
report so a later run can validate exact reuse.

### Example verifier packet

An abbreviated packet can look like:

```json
{
  "target": {
    "id": "thm-main-even-square",
    "statement": "For every even integer n, 4 divides n^2.",
    "proof": "Let n be even. By @def-even-integer ...",
    "cited_dependencies": ["def-even-integer"],
    "workspace": "thm-main-even-square"
  },
  "dependencies": [
    {
      "id": "def-even-integer",
      "statement": "n is even iff n=2k for some integer k.",
      "status": "workspace-verified",
      "origin": "workspace"
    }
  ],
  "external_basis": {
    "mode": "none",
    "content": ""
  },
  "verification": {
    "fresh_context": true,
    "require_zero_gaps": true
  }
}
```

## Rejection and repair

On mathematical rejection:

- user QMD is unchanged;
- the exact rejection is cached in the goal workspace;
- the fact is reported as `workspace-rejected` for that snapshot;
- the full critical-error, gap, and repair information remains available;
- the host repairs ordinary workspace QMD; and
- a changed candidate receives a new exact verification key.

The runtime does not erase an earlier rejection because a later candidate
passes. Exact decisions remain evidence keyed to their exact packet.

If the protected statement appears false, the host preserves it and develops a
counterexample or precise refutation for the user. It must not weaken the
statement to manufacture acceptance.

### Example rejection and repair

For “the product of two positive numbers is positive,” suppose a proof says
only “This is obvious.” The verifier may return:

```json
{
  "verdict": "incorrect",
  "summary": "The ordered-field step is not justified.",
  "critical_errors": [],
  "gaps": ["Justify why a>0 and b>0 imply ab>0."],
  "repair_hints": "Cite or prove positivity under multiplication."
}
```

The host supplies the missing argument or local lemma and reinspects the
affected closure. Unrelated workspace facts remain outside that verifier
schedule.

## Safe acceptance

“Acceptance” now means acceptance into current workspace evidence, not
promotion into user QMD.

Before invoking the verifier, inspection records:

- active workspace source fingerprint;
- protected main-goal identity;
- target statement or construction and proof identity;
- local dependency identities and verification keys;
- import scope;
- external-basis hash and content; and
- checker contract.

After a successful verifier result, inspection recomputes workspace sources,
protected goal context, and external basis. If anything changed, it reports
stale workspace source context and does not cache the result as accepted.

For current context, inspection:

1. writes the exact decision record atomically;
2. updates the selected fact to `workspace-verified` in the in-memory result;
3. constructs a complete schema-v3 workspace manifest and graph;
4. merges current outcomes for unchanged facts outside a narrow selection;
5. atomically publishes the workspace snapshot; and
6. refreshes the aggregate project snapshot when publication is safe.

The host cannot bypass this path merely because it authored the proof. No step
writes proof text or a status marker into the user's note.

### Example stale acceptance

Assume the verifier accepted a proof using `@lem-bound` under verification key
`sha256:A`. Before the cache write, the lemma proof changes, producing key
`sha256:B`.

Even if the new lemma is true, the verifier did not review the original
candidate against that exact dependency state. Inspection reports stale source
context and leaves the result unverified. The host reruns the affected closure.

An unrelated edit to user-note prose outside a protected main goal does not
change workspace mathematical identity. A change to the external basis or
checker contract does.

## Records

qmd-prover may retain under `.qmd-prover/`:

- protected workspace metadata and target snapshots;
- persistent mathematical workspace QMD;
- exact accepted and rejected verifier records;
- verifier infrastructure failure reports;
- workspace manifests, graphs, and immutable snapshots;
- the aggregate project manifest, graph, diagnostics, and snapshots;
- statement locks for protected main goals; and
- old project verification records as legacy read-only state.

This is mathematical working state and proof provenance, not an agent runtime.
qmd-prover has no worker registry, scheduler, or inter-agent message store.

## Invocation model

The utilities are dependency-free Node programs shipped inside the skill. The
skill tells the host which operation to run and how to interpret stable JSON. A
human may run the same command for debugging.

There is no separately installed binary. The dispatcher and schema are the
tool protocol.

### Example direct invocation

Inspect one candidate and its dependency closure:

```bash
node "${CODEX_HOME:-$HOME/.codex}/skills/qmd-prover/scripts/qmd-prover.js" \
  inspect fact @thm-main-uniform-index
```

Inspect the complete goal workspace:

```bash
node "${CODEX_HOME:-$HOME/.codex}/skills/qmd-prover/scripts/qmd-prover.js" \
  inspect workspace @thm-main-uniform-index
```

The old submission command remains parseable for compatibility:

```bash
node "${CODEX_HOME:-$HOME/.codex}/skills/qmd-prover/scripts/qmd-prover.js" \
  submit proof .qmd-prover/workspaces/thm-main-uniform-index/main-proof.qmd
```

It returns `status: "retired"` and changes no file. Current proof verification
is performed by `inspect fact`, `inspect path`, or `inspect workspace`.
