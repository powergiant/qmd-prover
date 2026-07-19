# Proving utilities design

## Role

The proving utilities help Codex or Claude Code turn mathematical reasoning
into explicit definitions, intermediate results, and proof candidates in
ordinary project QMD, then submit each materializable candidate to an optional
local AI verifier. Globally composed mathematics is recorded in tool state as
`verified`; independently confirmed counterexamples and refutations are
recorded as `disproved` evidence. Both live in `.qmd-prover/` records and
snapshots, never in the QMD source itself.

They do not form a proving agent. The host decides how to reason, which lemmas
to introduce, when to explore examples, and how to repair a proof. The runtime
provides protected goal context, machine-only semantic compilation, bounded
direct-dependency verifier packets, exact local decision caches, deterministic
global composition, feedback, and atomic project snapshots.

Earlier releases treated acceptance as promotion into user QMD. That path is
retired. User QMD now remains notes and protected main-goal storage; verifier
acceptance changes only cache and snapshot state.

## Flexible proof development

The utilities do not prescribe a proof-development loop. The host may start
from one main goal, a related family of goals, an existing body of proof QMD,
or an informal idea that needs precise formulation. It may inspect, search,
verify, render, or reorganize proof files whenever those operations help.

Only the safety gates are ordered:

1. establish current project and external-basis policy;
2. compile and pass project/global preflight;
3. build the selected machine dependency closure without consulting AI state;
4. materialize each selected fact and its direct dependency statements;
5. run the optional local verifier for exact cache misses;
6. recheck source and context freshness after each verifier return;
7. deterministically compose global status over the graph; and
8. publish cache and snapshot state atomically.

These gates do not choose the next mathematical idea.

## Organizing proof development

Tentative and verified proof development takes place in ordinary QMD files.
The compiler gives every project QMD file the same complete semantics in one
pass, and folders never form a semantic boundary, so proof QMD may in
principle live anywhere in the project. By soft convention — contract text
that agents follow, with zero tooling recognition — agents put new proof QMD
under a plain `workspace/` folder in the project root and organize freely
inside it: by theme, by goal, flat, or however the mathematics groups best.
Local policy may suggest organizational principles; the tool enforces none,
and there are no scaffold or metadata files to create.

For example, prolonged work on `@thm-main-uniform-index` may grow into:

```text
workspace/
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

The layout is illustrative, not mandatory. Every file shown is plain semantic
QMD; nothing in the folder is machine state, and inspection never rewrites any
of it. `progress.qmd` is user/agent-maintained context like any other note.
Subject QMD contains complete semantic declarations and linked proofs.

`workspace/main-proof.qmd` conventionally contains the linked
`.proof of="thm-main-ID"` overlay for the protected main goal, although the
overlay may live in any project file. It must not repeat the theorem. The
overlay becomes a graph node with the protected statement read from the user's
note and the proof identity taken from the proof file. Dependencies
contributed by the proof resolve in the proof file's own import scope.

The visible QMD may contain definitions, lemmas, propositions, theorems,
corollaries, calculations, examples, partial proofs, rejected attempts, and
alternative routes. The agent groups coherent mathematics rather than creating
one file for every transient thought.

There is no isolated subgraph. A result may cite any declaration in the
project, subject to same-file scope or explicit cross-file export and import.
Citing a protected main goal is a legal edge that composes as globally blocked
until that goal verifies. Outside mathematics is supplied through the exact
external basis, not as an implicit graph fact.

## Preparing a candidate

A candidate is an ordinary semantic declaration and linked proof in active
project QMD. There is no proposal file type and no required proposal
directory.

An intermediate theorem-like result contains one dated declaration and one
linked proof. A definition's construction lives in its declaration body and
may have a linked proof for existence, uniqueness, or well-definedness. The
protected main-goal candidate contains only the linked proof.

A partial theorem-like proof begins with `OPEN`. A failed attempt retained for
history begins with `REJECTED`. A proposed counterexample or refutation begins
with `DISPROVED`; it is still a candidate until independently checked. An
unmarked complete proof is a proof candidate. Definitions cannot use
`DISPROVED`.

Current verification does not write `VERIFIED` or `REVOKED` markers. Those
strings are structural errors wherever they appear in source
(`PROTECTED_MARKER_FORBIDDEN`); there is no legacy-marker compatibility.

Useful preparation assistance includes:

- inspecting the selected fact and its exact dependency closure;
- showing missing exports or imports;
- searching existing declarations by ID, title, text, kind, or status;
- calculating the proof frontier;
- comparing the current protected goal with its statement lock;
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
a current definition in the proof file's import scope.

## Candidate preflight

Before independent verification, the inspector confirms that:

- the selected ID resolves in the single project namespace to one protected
  goal or explicit declaration;
- no duplicate ID makes ownership ambiguous;
- a protected goal's statement and title match its lock in
  `.qmd-prover/statement-locks.json`;
- the result block has the correct ID prefix, class, name, date, and
  nonempty body;
- an intermediate result has exactly one appropriate linked proof;
- the protected target is supplied only through a proof overlay and was not
  redeclared;
- the proof is either an unmarked proof candidate or a theorem-like
  `DISPROVED` refutation candidate, and is not `OPEN` or `REJECTED`;
- no `VERIFIED` or `REVOKED` marker appears anywhere in the sources;
- every dependency exists, is unique, and is in scope;
- every cross-file dependency has an exact producer export and consumer import;
- cycle membership is recorded as a machine finding; and
- every direct dependency statement needed for a local AI packet can be
  materialized exactly.

Preflight establishes machine validity and packet availability, not
mathematical correctness. A scope error or cycle can make global state invalid
while a separately materializable local conditional check still runs; the two
outcomes remain visibly separate.

### Example preflight failure

If the proof links to a misspelled target:

```markdown
::: {.proof of="thm-main-even-squares"}
Let \(n=2k\). Then \(n^2=4k^2\).
:::
```

the inspector does not guess the nearby ID. It reports that the proof target is
unknown or invalid. The host repairs `of` to name the exact protected target.

Similarly, a proof that cites `@lem-square-of-double` from a file that never
exports it is not repaired by inventing an import. The producing file must
export the ID and the citing file must import it explicitly, or the claim must
be represented as a permitted external premise instead.

## Local conditional verification

The verifier is an optional bounded external facility. It may be an LLM command, a fresh
review context, or a formal-checker adapter that implements the protocol.

An informal verifier packet contains:

- exact target ID, kind, title, statement or construction, proof or proposed
  refutation, and verification mode;
- the IDs and exact statements of cited direct dependencies, each carried
  with its `statement_hash` identity;
- the declaring `source_file` and the `direct_dependency_ids` frontier, with
  the definition-kind dependencies serving as the semantic context;
- exact external-basis mode and content;
- checker contract and verifier protocol version 6; and
- an instruction to report errors and gaps independently.

It does not contain dependency proofs, dependency verification states, the
transitive proof closure, the author's confidence, hidden chain of thought,
persuasive commentary, unrelated project narrative, or any scope fields beyond
`type`, `source_file`, and `direct_dependency_ids`. The
verifier assumes the supplied direct statements and checks the exact submitted
proof. It does not decide whether those direct premises have themselves been
established.

The verifier returns a verdict, summary, critical errors, gaps, nonblocking
comments, repair hints, and a refutation field. An ordinary proof is verified
only by `correct` with empty critical-error and gap lists. A false theorem-like
statement is recorded as disproved only with a nonempty, independently
checkable refutation and empty critical-error and gap lists. The cache record
preserves the full packet, outcome, and report so a later run can validate
exact reuse.

### Example verifier packet

An abbreviated packet can look like:

```json
{
  "type": "local-conditional-check",
  "protocol": 6,
  "source_file": "workspace/main-proof.qmd",
  "target": {
    "id": "thm-main-even-square",
    "statement": "For every even integer n, 4 divides n^2.",
    "proof": "Let n be even. By @def-even-integer ...",
    "verification_mode": "proof"
  },
  "direct_dependency_ids": ["def-even-integer"],
  "dependencies": [
    {
      "id": "def-even-integer",
      "statement": "n is even iff n=2k for some integer k.",
      "identity": { "statement_hash": "sha256:..." }
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

### Refutation candidates and discovered counterexamples

If the host has a counterexample, it preserves the statement and makes the
linked proof explicit:

```markdown
::: {.proof of="thm-main-primes-odd"}
DISPROVED

The number \(2\) is prime, because its only positive divisors are \(1\) and
\(2\), but \(2\) is not odd. Hence it falsifies the universal statement.
:::
```

The marker selects `refutation` mode; it is not a verifier decision. A
successful independent check records the local outcome `disproved` and
structured evidence containing the summary, exact refutation, source, and
verification identity. A failed proposed refutation records an
`AI_DISPROOF_REJECTED` diagnostic and repair information. The verifier may
instead discover a counterexample while checking an unmarked proof and return
the same conclusive disproved outcome.
Neither route edits the source marker.

A globally disproved fact is terminal evidence about a false statement, not a
premise. Its machine dependency edges remain intact, while global composition
blocks dependent facts and frontier analysis exposes it as the lowest relevant
obstruction. A merely local disproof is conditional until all of its direct
dependencies are globally verified.

## Rejection and repair

On mathematical rejection:

- user QMD is unchanged;
- the exact rejection is cached content-addressed under
  `.qmd-prover/verification/checks/`;
- the fact is reported as `rejected` for that snapshot, with an
  `AI_CHECK_REJECTED` diagnostic;
- the full critical-error, gap, and repair information remains available;
- the host repairs ordinary proof QMD; and
- a changed candidate receives a new exact verification key.

The runtime does not erase an earlier rejection because a later candidate
passes. Exact decisions remain evidence keyed to their exact packet.

If the protected statement appears false, the host preserves it and develops a
counterexample or precise `DISPROVED` refutation for independent checking. It
must not weaken the statement to manufacture acceptance.

### Example rejection and repair

For “the product of two positive numbers is positive,” suppose a proof says
only “This is obvious.” The verifier may return:

```json
{
  "verdict": "incorrect",
  "summary": "The ordered-field step is not justified.",
  "critical_errors": [],
  "gaps": ["Justify why a>0 and b>0 imply ab>0."],
  "refutation": "",
  "repair_hints": "Cite or prove positivity under multiplication."
}
```

The host supplies the missing argument or local lemma and reinspects the
affected closure. Unrelated project facts remain outside that verifier
schedule.

## Safe acceptance

“Acceptance” means acceptance into current verification evidence, not
promotion into user QMD.

Before invoking the verifier, inspection records:

- the active project source fingerprint;
- protected main-goal lock identity;
- target statement or construction and proof identity;
- exact direct dependency statement identities;
- semantic source context and import declarations;
- external-basis hash and content; and
- checker contract.

After a conclusive local verifier result, inspection recompiles the whole
project and refingerprints sources, protected-goal locks, and the external
basis. If anything changed, the run stops with fatal `SOURCE_STALE` and the
result is not cached as accepted.

For current context, inspection:

1. writes the exact decision record atomically to
   `.qmd-prover/verification/checks/<sha256>.json` — a failed write is fatal
   `CACHE_WRITE_FAILED` and the result is never reported as verified;
2. records the result under `local_verification` without changing any machine
   edge or upstream state;
3. computes `global_verification` deterministically over the project graph;
4. constructs a complete schema-v6 project manifest and graph;
5. lets facts outside a narrow selection inherit their prior snapshot results
   when the `source_signature` and fact identities are unchanged;
6. atomically publishes the content-addressed snapshot under
   `.qmd-prover/graphs/`; and
7. refreshes `graphs/latest.json`, `manifest.json`, `graph.json`, and
   `diagnostics.json` when publication is safe.

The host cannot bypass this path merely because it authored the proof. No step
writes proof text or a status marker into the user's note.

### Example stale acceptance

Assume the verifier accepted a proof using the exact statement of `@lem-bound`
under verification key `sha256:A`. Before the cache write, that statement
changes, producing key `sha256:B`. Inspection reports fatal `SOURCE_STALE` and
does not cache the local result because the assumed direct conclusion changed.

If only the proof of `@lem-bound` changes while its statement remains byte-for-
byte semantically identical, the dependent local decision remains reusable.
The lemma's own local decision is rechecked and the dependent's global status
is recomputed. This separation prevents upstream review mechanics from leaking
into the meaning of a local implication check.

An edit to note prose outside any declaration or linked proof does not change
a fact's exact verification identity, although any source drift during a
verifier call is still fatal `SOURCE_STALE` for that call. A change to the
external basis or checker contract changes every identity.

## Records

qmd-prover may retain under `.qmd-prover/`:

- statement locks for protected main goals (`statement-locks.json`);
- exact verified, disproved, and rejected verifier records under
  `verification/checks/`;
- verifier infrastructure failure reports under `verification/failures/`;
- content-addressed schema-v6 graph snapshots under `graphs/`, with
  `graphs/latest.json` naming the current one; and
- the project `manifest.json`, `graph.json`, and `diagnostics.json`.

Everything under `.qmd-prover/` is derived tool state. It is excluded from
source discovery and never contains user mathematics; proof QMD itself lives
in ordinary project folders such as the conventional `workspace/` folder.

This is mathematical working state and proof provenance, not an agent runtime.
qmd-prover has no worker registry, scheduler, or inter-agent message store.

## Invocation model

The engine is the `qmd-prover` command — a dependency-free Node program installed
once on the host's `PATH`. The skill tells the host which operation to run and how
to interpret stable JSON. A human may run the same command for debugging.

The `qmd-prover` command is the separately installed binary; the skill is only
documentation. The dispatcher and its stable JSON schema are the tool protocol.

### Example direct invocation

Inspect one candidate and its dependency closure:

```bash
qmd-prover inspect fact @thm-main-uniform-index
```

Inspect the complete project:

```bash
qmd-prover inspect project
```

Inspect one proof file and its closure:

```bash
qmd-prover inspect path workspace/main-proof.qmd
```

The former per-goal initialization, submission, and revocation commands are
removed entirely, with no compatibility alias. The remaining surface is
`doctor`, `init`, `inspect project`, `inspect fact`, `inspect path`,
`dependency *`, `check staleness`, `verification list`, `verification show`,
and `render`. Current proof verification is performed by `inspect fact`,
`inspect path`, or `inspect project`.
