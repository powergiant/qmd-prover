# Discipline design

## Role

The discipline defines valid semantic QMD and the safety boundaries for agents
that write it. It does not prescribe a research plan or a fixed order for proof
development. Its canonical form is the managed contract in
`skills/qmd-prover/references/AGENTS.md`.

The contract alone cannot establish that a project follows the discipline.
The inspector parses the semantic blocks, checks their invariants, builds the
dependency graph, exposes progress, and invokes independent verification.

A matching project contract is a prerequisite for inspection and proof work.
Before invoking the inspector, the host agent checks that the managed block in
the project's root `AGENTS.md` is present, has the canonical version, and is
unchanged. If that preflight fails, the host agent stops before inspection or
mutation and asks whether the user wants to synchronize the project-owned
contract. This is an agent preflight requirement, not a substitute for the
inspector's source and mathematical checks.

Normally the user installs the skill and asks an agent in natural language to
initialize a project. That request authorizes creation of a missing root
`AGENTS.md` through `init-project` only when no project material is already
present. If setup discovers existing files or state, the agent reports them and
asks the user's intention before adopting, appending, or synchronizing.

## Canonical and local policy

Each project policy has two parts:

1. The **managed block** supplies qmd-prover's shared safety and proof rules.
   The project copies this versioned block into its root `AGENTS.md` verbatim.
2. **Local policy**, written outside the managed block, supplies rules specific
   to that project, such as notation, language, directory layout, or preferred
   sources.

Local rules may add constraints, but they may not change or weaken the managed
rules. Because `AGENTS.md` belongs to the project, qmd-prover must ask the user
before creating or synchronizing it.

### Example: project-local policy

The managed block itself is copied verbatim from the skill and is not repeated
here. A project can append local policy after it:

```markdown
<!-- The complete managed qmd-prover contract appears above. -->

## Local project policy

- Use \(\mathbb N=\{0,1,2,\ldots\}\).
- Put shared definitions in `foundations.qmd`.
```

These additions choose notation and file placement without changing how proofs
are protected or verified. By contrast, a local rule saying “agents may edit a
`thm-main-*` statement” contradicts statement protection and is invalid.

## Rule categories

The discipline assigns rules to three enforcement mechanisms. Passing one
mechanism never implies that the other two have passed.

| Rule category | Enforced by | What it establishes |
|---|---|---|
| Mechanically enforceable | Inspector and proving utilities | The QMD structure, references, records, and writes satisfy decidable invariants. |
| Mathematically judged | Inspector's independent AI verifier | The exact construction or proof is mathematically sufficient. |
| Agent conduct | Host-agent instructions | The agent follows project ownership, goal-workspace, semantic-writing, and acceptance boundaries. |

The first category is checked by code. For the second, the inspector calls the
Codex SDK only after its programmatic checks pass, using a fresh bounded
context independent of the proving agent. The third is not generally decidable
from the final QMD and has no separate automated checker: the skill instructs
the AI host agent to follow it, while the user remains able to identify a
violation.

### Mechanically enforceable rules

The inspector and proving utilities enforce rules whose truth follows from the
project representation, including:

- semantic block shape and unique IDs;
- ISO introduction dates on definitions and result statements;
- protected main-statement identity;
- explicit imports and exports;
- association of every proof with one semantic result;
- recognition of the reserved `OPEN`, `REJECTED`, `VERIFIED`, and `REVOKED`
  control markers;
- availability and status of results cited by proofs;
- selection of one active, unmarked candidate for submission;
- cached-statement checks and transitive stale-verification invalidation; and
- rejection-safe, atomic acceptance.

Mechanical checking is deliberately conservative. If the program cannot
establish a required fact from the semantic representation and protected
records, it reports a diagnostic rather than guessing.

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

The inspector's independent AI verifier calls the Codex SDK to judge whether
the exact construction or proof establishes its declaration, including:

- whether each inference is valid;
- whether all hypotheses are used correctly;
- whether an external theorem actually applies;
- whether a claimed reduction covers every case; and
- whether examples or computations have been mistaken for a general proof.

The verifier's judgment does not relax the inspector's mechanical checks.

#### Example: a mathematically detectable gap

Suppose a candidate contains:

```markdown
Since \(ab=ac\), divide by \(a\) to obtain \(b=c\).
```

The syntax may be perfectly valid and the proof may have no semantic
dependencies. Nevertheless, the inference is invalid unless the hypotheses
give \(a\ne0\). Detecting the missing hypothesis belongs to the inspector's AI
verification stage rather than its programmatic stage.

Likewise, checking finitely many values of \(n\) does not prove a statement
quantified over all integers. The discipline requires the verifier and host
agent to keep computation or evidence distinct from a general proof.

### Agent conduct rules

The host agent may work from one theorem, a family of results, or an idea that
needs formulation. It may introduce and order intermediate mathematics however
the argument requires. The skill instructs it to:

- preserve user-owned statements;
- create or resume `.qmd-prover/workspaces/<thm-main-ID>/` when asked to prove a
  protected main goal;
- keep canonical QMD read-only during development and put every tentative
  definition, result, proof, example, and progress note in that goal workspace;
- maintain an explicit dependency-linked development rather than stopping at a
  plan or prose sketch;
- call an unverified main proof a candidate, never complete or accepted merely
  from the proving agent's own judgment;
- state the ambient logic and metatheory when a request asks for development
  “from foundations,” and do not hide requested foundations behind “standard”
  or “usual” shorthand;
- introduce precise intermediate results only when useful;
- keep proof attempts outside canonical QMD until accepted;
- respond to every concrete verification gap;
- produce a precise refutation when a statement appears false; and
- keep search notes, confidence claims, and verifier metadata out of proofs,
  except for reserved qmd-prover control markers.

These rules constrain representation, file placement, and acceptance, not the
agent's mathematical strategy.

#### Example: correct behavior when a goal looks false

Assume the user supplied:

```markdown
::: {#thm-main-primes-odd .theorem .goal name="Every prime is odd" date="2026-07-12"}
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

## Recognized block types

Every semantic declaration is a fenced Div with one stable ID and exactly one
kind class. The ID prefix must agree with the class: `def-` for `.definition`,
`lem-` for `.lemma`, `prp-` for `.proposition`, `thm-` for `.theorem`, and
`cor-` for `.corollary`. The `name` is the human-readable title, `date` records
the ISO introduction date, and `export` is optional unless another file must
import the declaration. These common attributes do not make the five result
kinds interchangeable; the kind communicates the declaration's mathematical
role to readers and to dependency search.

### Definition block

A `.definition` block introduces a term, object, or piece of notation. Its body
is the construction rather than a claim copied from a later proof. Semantic
references in that body are construction dependencies, so every referenced
fact must be local or explicitly imported. When well-definedness, existence,
or uniqueness needs justification, put that argument in a separate linked
proof block.

```markdown
::: {#def-even-integer .definition name="Even integer" date="2026-07-12" export="even-integer"}
An integer \(n\) is **even** if there exists an integer \(k\) such that
\(n=2k\).
:::

::: {.proof of="def-even-integer"}
This predicate is a well-formed property of an integer \(n\).
:::
```

### Lemma block

A `.lemma` block states an auxiliary result intended to support later results.
The label describes its role in the development, not a weaker verification
standard: a lemma must be checked as rigorously as a theorem.

```markdown
::: {#lem-square-of-double .lemma name="Square of a double" date="2026-07-12" export="square-of-double"}
If \(n=2k\) for integers \(n,k\), then \(n^2=4k^2\).
:::

::: {.proof of="lem-square-of-double"}
Expanding the product gives \(n^2=(2k)^2=4k^2\).
:::
```

### Proposition block

A `.proposition` block states a result that is useful in its own right but is
not presented as one of the development's principal theorems. This distinction
is expository; propositions use the same proof and verification machinery as
lemmas and theorems.

```markdown
::: {#prp-even-sum .proposition name="Sums of even integers" date="2026-07-12"}
The sum of two even integers is even.
:::

::: {.proof of="prp-even-sum"}
By @def-even-integer, write \(a=2r\) and \(b=2s\). Then
\(a+b=2(r+s)\), so @def-even-integer applies again.
:::
```

### Theorem block

A `.theorem` block states a principal result. An ordinary theorem uses a
`thm-` ID and can be introduced by the project or by an agent in its workspace.
Its proof remains separate, just like the proof of a lemma or proposition.

```markdown
::: {#thm-even-square .theorem name="Squares of even integers" date="2026-07-12" export="even-square"}
If an integer \(n\) is even, then \(n^2\) is divisible by \(4\).
:::

::: {.proof of="thm-even-square"}
By @def-even-integer, write \(n=2k\). Now @lem-square-of-double gives
\(n^2=4k^2\).
:::
```

### Corollary block

A `.corollary` block states a result that follows quickly from an earlier
result. The linked proof must still cite the result from which it follows;
calling a statement a corollary does not create an implicit dependency.

```markdown
::: {#cor-even-square-not-two-mod-four .corollary name="Even squares modulo four" date="2026-07-12"}
The square of an even integer is not congruent to \(2\pmod 4\).
:::

::: {.proof of="cor-even-square-not-two-mod-four"}
By @thm-even-square, the square is congruent to \(0\pmod 4\), not
\(2\pmod 4\).
:::
```

### Main-goal theorem block

A main goal is not a sixth result kind. It is a `.theorem` block refined by the
`.goal` class and a protected `thm-main-*` ID. Its ID, `name`, hypotheses,
quantifiers, and statement body originate with the user and must not be changed
without explicit approval. With no linked proof, it is an open goal.

```markdown
::: {#thm-main-even-product .theorem .goal name="Even product theorem" date="2026-07-12"}
If \(a\) is an even integer and \(b\) is an integer, then \(ab\) is even.
:::
```

A workspace proposal for this goal contains only a linked `.proof` block; it
does not repeat or edit the protected theorem block.

### Proof block

A `.proof` block supplies the construction or proof for exactly one semantic
declaration. It has no semantic ID of its own. Instead, its `of` attribute must
equal the target declaration's ID. Every `@id` inside the proof declares a
logical dependency at its point of use.

```markdown
::: {.proof of="thm-main-even-product"}
By @def-even-integer, write \(a=2k\). Then \(ab=2(kb)\), and \(kb\) is an
integer, so @def-even-integer shows that \(ab\) is even.
:::
```

The first nonempty paragraph may instead be one reserved control marker:

```markdown
::: {.proof of="thm-main-even-product"}
OPEN

It remains to show that the chosen witness is an integer.
:::
```

`OPEN` marks an incomplete attempt, and `REJECTED` retains an inactive failed
attempt. `VERIFIED` and `REVOKED` are valid only when qmd-prover has matching
protected records. These words are proof-state markers, not additional block
types, and an agent must never add or restore `VERIFIED` manually.

Within semantic QMD, the declaration block records the definition or claim,
while its linked proof block records the justification. A declaration has at
most one active linked proof. Definitions may declare dependencies in their
construction bodies; other result dependencies come from references in their
linked proofs.

For `thm-main-*`, the title and statement originate with the user and are
protected. The introduction date is informational and does not alter statement
identity. The absence of a linked proof, or a proof whose first nonempty
paragraph is `OPEN`, means the result is open. A proof beginning with `REJECTED`
is inactive. An unmarked proof is still only a candidate until independently
checked. `VERIFIED` is valid only with a matching record for the current
statement, proof or construction, and dependency snapshot. `REVOKED` is valid
only with a matching revocation record and concrete reason. Before relying on
`VERIFIED`, the inspector checks the cached identities and removes stale
markers transitively along reverse-dependency edges.

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
