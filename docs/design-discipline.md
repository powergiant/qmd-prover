# Discipline design

## Role

The discipline defines which QMD is qmd-prover mathematics, what valid
workspace semantic QMD looks like, and which safety boundaries apply to agents
that write it. It does not prescribe a research plan or a fixed order for
proof development. Its canonical agent-facing form is the versioned managed
contract in `skills/qmd-prover/references/AGENTS.md`.

The contract alone cannot establish compliance. The compiler parses Pandoc
JSON, the project index checks project-wide ownership and identity invariants,
the inspector builds scoped and aggregate graphs, and the configured external
verifier judges mathematical sufficiency.

A matching project contract is a prerequisite for proof work. Before changing
mathematics or qmd-prover state, the host agent compares the managed block in
the project's root `AGENTS.md` with the canonical block byte-for-byte. If the
preflight fails, the host stops before mutation and asks whether the user wants
to create, append, or synchronize policy. This is an agent preflight, not a
replacement for compiler and verifier checks.

Normally the user installs the skill and asks an agent in natural language to
initialize a project. `init` may create policy only when intent is sufficiently
clear. When setup discovers existing project material, it inventories that
material and asks before adopting or changing project-owned policy.

## Canonical and local policy

Each project policy has two parts:

1. The **managed block** supplies qmd-prover's shared ownership, statement
   protection, workspace, semantic-QMD, inspection, and verification rules.
   The project copies the versioned block verbatim.
2. **Local policy**, written outside the managed block, supplies rules specific
   to that project, such as notation, language, directory layout, or allowed
   sources.

"Canonical" in this section means the authoritative contract distributed by
the skill. It no longer means that all user QMD is a canonical mathematical
database.

Local rules may strengthen the managed rules but may not weaken them. Because
`AGENTS.md` belongs to the project, qmd-prover asks before creating or
synchronizing it and preserves every byte outside the managed block.

### Example: project-local policy

The managed block is not repeated here. A project can append local policy:

```markdown
<!-- The complete managed qmd-prover contract appears above. -->

## Local project policy

- Use \(\mathbb N=\{0,1,2,\ldots\}\).
- Put shared workspace definitions in `foundations.qmd`.
- Leave `main.qmd` unchanged except at the user's explicit request.
```

These additions choose notation and workspace organization without changing
how protected goals, IDs, proof overlays, or verifier decisions work. A local
rule saying “agents may edit a `thm-main-*` statement” conflicts with statement
protection and is invalid.

**Local-policy scope.**

Local policy can answer questions that qmd-prover deliberately leaves open:

- which notation is preferred;
- which external sources are acceptable in prose;
- how a large goal workspace is divided into subject files;
- which language is used for theorem captions and exposition;
- whether a project wants extra human review before relying on a result; and
- how future paper tooling should select retained workspace material.

Local policy must not redefine semantic block classes, weaken global ID
uniqueness, permit cross-workspace dependencies, treat user-note theorems as
workspace premises, bypass independent verification, or authorize proof writes
into user notes.

## External mathematical basis

The optional project-owned `.qmd-prover/.external.qmd` controls which results
may be taken from outside the project. Its three states are intentional:

- absence permits outside mathematics, provided the agent identifies each
  result precisely and checks its hypotheses;
- a whitespace-only file permits no outside mathematics; and
- nonempty content permits only the stated results or classes of results.

Initialization reports this state but does not create the file. The host reads
it before proof work. The independent verifier receives its exact mode and
content with every candidate.

The v14 model permits the agent to revise the external basis when the user's
request or the proof context genuinely requires a different basis, but the
change must be explicit. It changes the verifier context and therefore makes
affected exact-cache keys miss. A current workspace snapshot includes the
external-basis identity through its source signature.

The external basis is not a namespace. It does not create `@id` nodes and
cannot be used to smuggle in another workspace's lemma or a theorem-like block
from user notes. Local semantic dependencies must still resolve to declarations
inside the same workspace.

## Rule categories

The discipline assigns rules to three enforcement mechanisms. Passing one
mechanism never implies that the other two passed.

| Rule category | Enforced by | What it establishes |
|---|---|---|
| Mechanically enforceable | Compiler, project index, and inspector | Source shape, identity, scope, graph, selection, and snapshot invariants are decidably satisfied. |
| Mathematically judged | Independent external verifier | The exact construction or proof is mathematically sufficient. |
| Agent conduct | Skill and project instructions | The host respects ownership, workspace placement, external basis, and verifier findings. |

The programmatic layer is deliberately conservative. When it cannot establish
a required invariant from Pandoc JSON and protected state, it emits a
diagnostic rather than guessing. The verifier runs only after the selected
fact's mechanical checks pass. Host conduct remains necessary because not all
bad actions are recoverable from the final files.

### Mechanically enforceable rules

Mechanically enforceable rules include:

- only `thm-main-* .theorem .goal` blocks are registered in user notes;
- main-goal class, name, statement, and protected snapshot identity;
- workspace declaration shape, ID prefix, class, date, name, and body;
- association of every linked proof with exactly one declaration;
- explicit producer exports and consumer imports for cross-file dependencies;
- duplicate IDs within one workspace and across project scopes;
- prohibition of workspace-to-workspace and workspace-to-other-main-goal
  dependencies;
- dependency cycles, missing references, malformed imports, and unavailable
  proof premises;
- exact selection of a fact or path and its transitive local dependency
  closure;
- current workspace source, protected goal, external basis, checker contract,
  and cache signatures; and
- safe atomic publication of workspace and aggregate snapshots.

The project index performs global-identity and scope preflight before any
verifier call. A global duplicate is project-fatal because an aggregate graph
cannot assign a unique owner or source to that node. A malformed individual
workspace stays local so other workspaces can still be inspected and reported.

#### Example: a mechanically detectable dependency error

This workspace proof cites a local result from another file:

```markdown
::: {.proof of="thm-uniform-bound"}
By @lem-finite-stratification there are finitely many strata. Apply
@lem-local-exponent-bound on each stratum.
:::
```

If `@lem-local-exponent-bound` is exported from `local/exponents.qmd` but the
consumer imports only `@lem-finite-stratification`, the inspector reports the
second citation as out of scope. The consumer repairs the front matter:

```yaml
---
qmd-prover:
  imports:
    - from: local/exponents.qmd
      use:
        - lem-local-exponent-bound
---
```

No mathematical judgment is required. The citation already declares the
logical dependency; the metadata controls only cross-file availability.

If the same citation resolves to a declaration in another goal workspace, no
import can repair it. The result must be adopted and proved locally, or the
allowed outside premise must be described in `.external.qmd` without turning
it into a cross-workspace graph node.

### Mathematically judged rules

The independent verifier judges whether:

- each inference is valid under the stated hypotheses;
- every cited result actually applies;
- a definition is meaningful, exists when claimed, and is well-defined;
- a reduction covers all cases and preserves all hypotheses;
- an induction covers its base and inductive steps;
- a limit, compactness, choice, finiteness, or maximality argument is justified;
- examples or computations have been mistaken for a universal proof; and
- the proof establishes the exact protected statement rather than a weakened
  or nearby variant.

The verifier's judgment never relaxes programmatic scope checks. A proof cannot
be accepted merely because the verifier recognizes an unstated theorem that
the workspace was not allowed to use.

#### Example: a mathematically detectable gap

Suppose a candidate contains:

```markdown
Since \(ab=ac\), divide by \(a\) to obtain \(b=c\).
```

The syntax may be valid and there may be no semantic dependencies, but the
inference is invalid unless the hypotheses give \(a\ne0\). Detecting the
missing hypothesis belongs to mathematical verification rather than parsing.

Likewise, checking finitely many values of \(n\) does not prove a statement
quantified over all integers. A valid verifier response identifies that as a
gap and supplies repair guidance; the host retains the rejection and repairs
the workspace proof.

### Agent conduct rules

The skill instructs the host agent to:

- preserve user-owned main-goal statements exactly;
- create or resume `.qmd-prover/workspaces/<thm-main-ID>/` for requested proof
  work and keep all created mathematics there;
- maintain `progress.qmd` without allowing inspection to overwrite it;
- follow unproved dependencies until they are justified;
- distinguish an external theorem from a local semantic fact;
- respond to every verifier critical error and gap;
- keep search notes, confidence claims, and verifier metadata out of proofs;
- retain useful failed routes as `REJECTED` rather than presenting them as
  premises;
- report a precise refutation when a protected goal appears false; and
- leave verified mathematics in the workspace rather than copying it to user
  notes.

These rules constrain ownership and evidence, not the mathematical strategy.

#### Example: correct behavior when a goal looks false

Assume the user supplied:

```markdown
::: {#thm-main-primes-odd .theorem .goal name="Every prime is odd" date="2026-07-12"}
Every prime number is odd.
:::
```

The agent must not silently change the statement to “Every prime greater than
\(2\) is odd.” It preserves the goal, reports the counterexample \(2\), and may
offer the corrected statement as a suggestion requiring explicit approval.

## Semantic scope

The source tree has two semantic regimes.

In the **user-note regime**, QMD remains unrestricted except that protected
`thm-main-*` blocks must satisfy their narrow goal shape and statement locks.
Other fenced Divs, imports, headings, proof-like prose, equations, code cells,
figures, and bibliographic citations are ordinary Quarto content. They do not
enter the qmd-prover graph and are not diagnosed as malformed semantic QMD.

In the **workspace regime**, every recognized declaration and linked proof is
semantic and receives the complete contract. Ordinary prose outside recognized
blocks remains ordinary QMD, but references inside a definition construction
or linked proof create dependency edges.

This distinction prevents qmd-prover from imposing its schema on a user's
research notes while giving agent-created mathematics a precise, inspectable
representation.

## Recognized block types

Every workspace declaration is a fenced Div with one stable ID and exactly one
kind class. The ID prefix must agree with the class: `def-`, `lem-`, `prp-`,
`thm-`, or `cor-`. The `name` is the human-readable caption, `date` is the ISO
introduction date, and optional `export` must equal the semantic ID exactly.

### Definition block

A `.definition` block introduces a term, object, or notation. Its body is the
construction, not a claim copied from a later proof. Citations in that body are
construction dependencies. Existence, uniqueness, or well-definedness may be
justified in a separate linked proof.

```markdown
::: {#def-even-integer .definition name="Even integer" date="2026-07-12" export="def-even-integer"}
An integer \(n\) is even if \(n=2k\) for some integer \(k\).
:::
```

### Lemma block

A `.lemma` block states an auxiliary result. “Lemma” describes its role, not a
weaker verification standard.

```markdown
::: {#lem-square-of-double .lemma name="Square of a double" date="2026-07-12"}
If \(n=2k\), then \(n^2=4k^2\).
:::

::: {.proof of="lem-square-of-double"}
Expand: \(n^2=(2k)^2=4k^2\).
:::
```

### Proposition block

A `.proposition` states a useful standalone result that is not presented as a
principal theorem. It uses the same proof and verifier machinery.

```markdown
::: {#prp-even-sum .proposition name="Sums of even integers" date="2026-07-12"}
The sum of two even integers is even.
:::
```

### Theorem block

A workspace `.theorem` states a principal local result and uses a `thm-*` ID.
It is not a protected main goal merely because it is important.

```markdown
::: {#thm-even-square .theorem name="Squares of even integers" date="2026-07-12"}
If an integer \(n\) is even, then \(4\mid n^2\).
:::
```

### Corollary block

A `.corollary` states a consequence. Its proof must cite the source theorem;
the class itself creates no implicit edge.

```markdown
::: {#cor-even-square-mod-four .corollary name="Even squares modulo four" date="2026-07-12"}
An even square is congruent to \(0\pmod 4\).
:::

::: {.proof of="cor-even-square-mod-four"}
This is the conclusion of @thm-even-square.
:::
```

### Main-goal theorem block

A main goal is not a sixth result kind. It is a `.theorem .goal` block with a
protected `thm-main-*` ID in user QMD. Its ID, caption, classes, hypotheses,
quantifiers, and statement body originate with the user. The workspace does
not repeat it.

```markdown
::: {#thm-main-even-product .theorem .goal name="Even product theorem" date="2026-07-12"}
If \(a\) is even and \(b\) is an integer, then \(ab\) is even.
:::
```

The linked proof in that goal's workspace is an overlay. It participates in
the workspace graph without becoming a duplicate declaration.

### Proof block

A `.proof` has no semantic ID. Its `of` attribute names exactly one local
declaration or the workspace's own protected main goal. Every `@id` in the
proof is a dependency at its point of use.

```markdown
::: {.proof of="thm-main-even-product"}
By @def-even-integer, write \(a=2k\). Then \(ab=2(kb)\), so
@def-even-integer shows that \(ab\) is even.
:::
```

The first nonempty proof paragraph may be `OPEN` for an incomplete active
attempt or `REJECTED` for an inactive failed attempt. No marker means a
candidate. `VERIFIED` and `REVOKED` are recognized only as legacy canonical
markers; agents and current inspection never write them. A source marker alone
does not establish workspace verification.

### Example: semantic and nonsemantic references

Inside a workspace proof, this creates a dependency:

```markdown
::: {.proof of="thm-convergence"}
Apply @lem-compact-subsequence to the bounded sequence.
:::
```

In surrounding exposition, the same reference may be navigational. A
bibliographic citation such as `[@rudin1976]` is always a Quarto citation, not
a theorem dependency.

## Change process

The managed contract is versioned. A discipline change should:

1. state the new or changed invariant;
2. identify whether the compiler, index, inspector, verifier, or host-agent
   instruction enforces it;
3. update the canonical contract without compressing away existing guidance;
4. synchronize every example managed block byte-for-byte;
5. update affected tests, SKILL routing, CLI reference, and component design
   documents; and
6. require explicit synchronization in existing mathematical projects.

This process prevents a runtime release from silently changing the meaning of
an existing project and keeps the human explanation aligned with enforcement.
