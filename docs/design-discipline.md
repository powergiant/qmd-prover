# Discipline design

## Role

The discipline defines which QMD is qmd-prover mathematics, what valid
semantic QMD looks like in any project file, and which safety boundaries apply
to agents that write it. It does not prescribe a research plan or a fixed order for
proof development. Its canonical agent-facing form is the versioned managed
contract in `skills/qmd-prover/references/AGENTS.md`.

The contract alone cannot establish compliance. The compiler parses Pandoc
JSON, the project index checks project-wide ownership and identity invariants,
the inspector builds the single project graph and its scoped selections, the
optional external verifier judges one local conditional step, and deterministic graph
composition establishes whether the full upstream closure is accepted.

A matching project contract is a prerequisite for proof work. Before changing
mathematics or qmd-prover state, the host agent compares the managed block in
the project's root `AGENTS.md` with the canonical block byte-for-byte. If the
preflight fails, the host stops before mutation and asks whether the user wants
to create, append, or synchronize policy. This is an agent preflight, not a
replacement for machine, local-verifier, and global-composition checks.

Normally the user installs the skill and asks an agent in natural language to
initialize a project. `init` may create policy only when intent is sufficiently
clear. When setup discovers existing project material, it inventories that
material and asks before adopting or changing project-owned policy.

## Canonical and local policy

Each project policy has two parts:

1. The **managed block** supplies qmd-prover's shared ownership, statement
   protection, proof-placement, semantic-QMD, inspection, and verification
   rules. The project copies the versioned block verbatim.
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

- Use $\mathbb N=\{0,1,2,\ldots\}$.
- Organize new proof files by subject under `workspace/`, for example
  `workspace/geometry/` for geometric lemmas.
- Put shared foundational definitions in `workspace/foundations.qmd`.
- Leave `main.qmd` unchanged except at the user's explicit request.
```

These additions choose notation and folder organization without changing
how protected goals, IDs, proof overlays, or verifier decisions work. A local
rule saying “agents may edit a `thm-main-*` statement” conflicts with statement
protection and is invalid.

**Local-policy scope.**

Local policy can answer questions that qmd-prover deliberately leaves open:

- which notation is preferred;
- which external sources are acceptable in prose;
- how proof material under `workspace/` is divided into subject folders and
  files;
- which language is used for theorem captions and exposition;
- whether a project wants extra human review before relying on a result; and
- how future paper tooling should select retained proof material.

Local policy must not redefine semantic block classes, weaken project-wide ID
uniqueness, permit citations outside a file's declared import scope, treat an
unverified protected main goal as an available premise, confuse a local AI
pass with global verification, or authorize unrequested rewrites of
user-authored notes.

## External mathematical basis

The optional project-owned `.qmd-prover/.external.qmd` controls which results
may be taken from outside the project. Its three states are intentional:

- absence permits outside mathematics, provided the agent identifies each
  result precisely and checks its hypotheses;
- a whitespace-only file permits no outside mathematics; and
- nonempty content permits only the stated results or classes of results.

Initialization reports this state but does not create the file. The host reads
it before proof work. The optional local verifier receives its exact mode and
content with every candidate.

The v16 model permits the agent to revise the external basis when the user's
request or the proof context genuinely requires a different basis, but the
change must be explicit. It changes the verifier context and therefore makes
affected exact-cache keys miss. A current project snapshot includes the
external-basis identity through its source signature.

The external basis is not a namespace. It does not create `@id` nodes and
cannot be used to bypass explicit export and import between project files.
Semantic dependencies must still resolve to declarations visible in the citing
file's import scope.

## Rule categories

The discipline assigns rules to four layers. Passing one layer never implies
that the others passed.

| Rule category | Enforced by | What it establishes |
|---|---|---|
| Mechanically enforceable | Compiler, project index, and inspector | Source shape, identity, scope, graph, selection, and snapshot invariants are decidably satisfied. |
| Locally mathematically judged | Optional external verifier | Assuming the exact direct dependency conclusions, the submitted construction, proof, or refutation is sufficient. |
| Globally composed | Inspector graph fold | Machine validity, local acceptance, and the entire upstream closure jointly support the result. |
| Agent conduct | Skill and project instructions | The host respects ownership, the `workspace/` placement convention, external basis, and verifier findings. |

The mechanical layer is deliberately conservative. When it cannot establish a
required invariant from Pandoc JSON and protected state, it emits a diagnostic
rather than guessing. The local verifier is separately eligible when the fact
itself is unbroken and the exact target and direct dependency statements can be
materialized; an upstream AI rejection does not suppress it. An upstream machine
error still blocks global composition even when the local conditional judgment
is available. Host conduct remains necessary because not all bad actions are
recoverable from final files.

### Mechanically enforceable rules

Mechanically enforceable rules include:

- protected `thm-main-*` blocks keep their `.theorem .goal` shape and obey
  the statement and title locks in `.qmd-prover/statement-locks.json`;
- main-goal class, name, statement, and protected snapshot identity;
- declaration shape, ID prefix, class, date, name, and body in every project
  QMD file;
- association of every linked proof with exactly one declaration;
- explicit producer exports and consumer imports for cross-file dependencies;
- duplicate IDs anywhere in the single project namespace (`DUPLICATE_ID`);
- global blocking of every edge into a protected main goal until that goal is
  verified;
- dependency cycles, missing references, malformed imports, and unavailable
  proof premises;
- exact selection of a fact or path and its transitive dependency closure;
- placement of `.disproof` only on the linked proof of a theorem-like result,
  never on a definition;
- an abandoned fact still owns its ID and is still checked for shape, ID, and
  date, but resolves no references, contributes no dependency edges, and is
  never sent to the verifier;
- current project source, protected goal, external basis, checker contract,
  and cache signatures; and
- safe atomic publication of project snapshots under `.qmd-prover/graphs/`.

The project index performs global-identity and scope preflight before any
verifier call. A duplicate ID is project-fatal because the project graph
cannot assign a unique owner or source to that node. A malformed individual
file is diagnosed at its source location so unrelated files can still be
inspected and reported.

#### Example: a mechanically detectable dependency error

This proof cites a result declared in another file:

```markdown
::: {.proof of="thm-uniform-bound"}
By @lem-finite-stratification there are finitely many strata. Apply
@lem-local-exponent-bound on each stratum.
:::
```

If `@lem-local-exponent-bound` is exported from `workspace/exponents.qmd` but
the consumer imports only `@lem-finite-stratification`, the inspector reports
the second citation as out of scope. The consumer repairs the front matter:

```yaml
---
qmd-prover:
  imports:
    - from: workspace/exponents.qmd
      use:
        - lem-local-exponent-bound
---
```

No mathematical judgment is required. The citation already declares the
logical dependency; the metadata controls only cross-file availability.

If the same citation resolves to a protected main goal, an explicit import
still makes the edge legal, but global composition keeps every consumer
blocked until that goal is verified. No import metadata can substitute for
that verification, and `.external.qmd` cannot be used to treat an unverified
project goal as an outside premise.

### Locally mathematically judged rules

Assuming the supplied direct dependency conclusions, the optional verifier
judges whether:

- each inference is valid under the stated hypotheses;
- every cited result actually applies;
- a definition is meaningful, exists when claimed, and is well-defined;
- a reduction covers all cases and preserves all hypotheses;
- an induction covers its base and inductive steps;
- a limit, compactness, choice, finiteness, or maximality argument is justified;
- examples or computations have been mistaken for a universal proof;
- a proposed or independently discovered counterexample satisfies every
  hypothesis and really falsifies the exact quantified statement; and
- the proof establishes the exact protected statement rather than a weakened
  or nearby variant.

The verifier receives no dependency proof text, dependency verdict, or
transitive proof bundle. Its judgment never relaxes mechanical scope checks. A
local conditional pass cannot make an undeclared premise legal or turn a cycle
into a globally valid proof.

#### Example: a mathematically detectable gap

Suppose a candidate contains:

```markdown
Since $ab=ac$, divide by $a$ to obtain $b=c$.
```

The syntax may be valid and there may be no semantic dependencies, but the
inference is invalid unless the hypotheses give $a\ne0$. Detecting the
missing hypothesis belongs to mathematical verification rather than parsing.

Likewise, checking finitely many values of $n$ does not prove a statement
quantified over all integers. A valid verifier response identifies that as a
gap and supplies repair guidance; the host retains the rejection and repairs
the proof.

### Agent conduct rules

The skill instructs the host agent to:

- preserve user-owned main-goal statements exactly;
- place new proof QMD under a plain `workspace/` folder in the project root
  by convention, organizing files inside it freely or as local policy
  suggests;
- maintain a progress note, conventionally `workspace/progress.qmd`, without
  allowing inspection to overwrite it;
- follow unproved dependencies until they are justified;
- distinguish an external theorem from a project semantic fact;
- respond to every verifier critical error and gap;
- keep search notes, confidence claims, and verifier metadata out of proofs;
- mark a proof that is still being written `.draft` so it is not sent to the
  verifier, and remove the mark when it is ready;
- retain useful failed routes under `.abandon` rather than presenting them as
  premises;
- mark a precise refutation with `.disproof` when a protected goal appears
  false, while treating it as a disproof candidate until independent checking;
- leave verified proof development in agent-authored files rather than
  copying it into user notes.

These rules constrain ownership and evidence, not the mathematical strategy.
The `workspace/` placement is contract text only: no tooling recognizes the
folder, and it never forms a semantic boundary.

#### Example: correct behavior when a goal looks false

Assume the user supplied:

```markdown
::: {#thm-main-primes-odd .theorem .goal name="Every prime is odd" date="2026-07-12"}
Every prime number is odd.
:::
```

The agent must not silently change the statement to “Every prime greater than
$2$ is odd.” It preserves the goal and puts the counterexample $2$ in the
goal's linked proof overlay, conventionally `workspace/main-proof.qmd`, on a
proof block marked `.disproof`. It reports the goal as established false only
when verification records `disproved`, and may offer the corrected statement as
a suggestion requiring explicit approval.

## Semantic scope

The source tree has one semantic regime. Every QMD file in every project
folder is full semantic mathematics, compiled in a single pass into one
dependency graph with one project-wide ID namespace. Folders, including the
conventional `workspace/` folder, organize files and never form a semantic
boundary. `.qmd-prover/` holds derived tool state only and contributes no
source.

Within that regime, every recognized declaration and linked proof is semantic
and receives the complete contract. Protected `thm-main-*` blocks
additionally satisfy their narrow goal shape and the statement and title
locks. Unrecognized fenced Divs, imports, headings, proof-like prose,
equations, code cells, figures, and bibliographic citations are ordinary
Quarto content; they do not enter the qmd-prover graph and are not diagnosed
as malformed semantic QMD.

Ordinary prose outside recognized blocks remains ordinary QMD, but references
inside a definition construction or linked proof create dependency edges that
resolve in the containing file's import scope. This gives all project
mathematics one precise, inspectable representation without imposing the
schema on unstructured exposition.

## Recognized block types

Every declaration is a fenced Div with one stable ID and exactly one
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
An integer $n$ is even if $n=2k$ for some integer $k$.
:::
```

### Lemma block

A `.lemma` block states an auxiliary result. “Lemma” describes its role, not a
weaker verification standard.

```markdown
::: {#lem-square-of-double .lemma name="Square of a double" date="2026-07-12"}
If $n=2k$, then $n^2=4k^2$.
:::

::: {.proof of="lem-square-of-double"}
Expand: $n^2=(2k)^2=4k^2$.
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

A `.theorem` states a principal supporting result and uses a `thm-*` ID. It
is not a protected main goal merely because it is important.

```markdown
::: {#thm-even-square .theorem name="Squares of even integers" date="2026-07-12"}
If an integer $n$ is even, then $4\mid n^2$.
:::
```

### Corollary block

A `.corollary` states a consequence. Its proof must cite the source theorem;
the class itself creates no implicit edge.

```markdown
::: {#cor-even-square-mod-four .corollary name="Even squares modulo four" date="2026-07-12"}
An even square is congruent to $0\pmod 4$.
:::

::: {.proof of="cor-even-square-mod-four"}
This is the conclusion of @thm-even-square.
:::
```

### Main-goal theorem block

A main goal is not a sixth result kind. It is a `.theorem .goal` block with a
protected `thm-main-*` ID in user QMD. Its ID, caption, classes, hypotheses,
quantifiers, and statement body originate with the user. No other project
file repeats it.

```markdown
::: {#thm-main-even-product .theorem .goal name="Even product theorem" date="2026-07-12"}
If $a$ is even and $b$ is an integer, then $ab$ is even.
:::
```

The goal's linked proof is an overlay and may live in any project file,
conventionally `workspace/main-proof.qmd`. It participates in the project
graph without becoming a duplicate declaration, and its proof-contributed
dependencies resolve in the proof file's import scope.

### Proof block

A `.proof` has no semantic ID. Its `of` attribute names exactly one
declaration visible in its file's import scope or one protected main goal.
Every `@id` in the proof is a dependency at its point of use.

```markdown
::: {.proof of="thm-main-even-product"}
By @def-even-integer, write $a=2k$. Then $ab=2(kb)$, so
@def-even-integer shows that $ab$ is even.
:::
```

Author intent lives in the proof block's attributes. `.disproof` says the block
is a proposed counterexample or refutation of the exact theorem-like statement.
`.draft` says the proof is deliberately unfinished, so it is never sent to the
verifier and the fact stays `open`. `.abandon` detaches the attempt and keeps it
for history. A proof block with none of these is a proof candidate. A definition
carries `.draft` or `.abandon` on its own declaration, but it may not use
`.disproof`; any challenge to existence, uniqueness, or well-definedness belongs
in a theorem-like claim. An attribute alone does not establish verification or
disproof. There are no body markers: `OPEN`, `REJECTED`, `DISPROVED`, and
`VERIFIED` are ordinary words with no meaning in source.

When `.disproof` is present, the whole proof body is the proposed refutation.
Inspection verifies it independently and records either a confirmed `disproved`
outcome or a rejected-refutation outcome. The verifier may also discover a
counterexample while reviewing an unmarked proof; that decision is retained in
derived state. Inspection then writes the local verdict into a display-only
`status` attribute on the checked div; authors never write that attribute, and
the engine never edits an author attribute.
[Status model design](design-status.md) is the single reference for these
attributes and the status vocabulary.

### Example: semantic and nonsemantic references

Inside a linked proof, this creates a dependency:

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
