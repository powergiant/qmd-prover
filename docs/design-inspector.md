# Inspector design

## Role

The inspector gives the host agent a semantic view of a QMD project. It checks
the mechanically enforceable part of the discipline, finds proof obligations,
and makes logical dependencies visible.

It is a structural analyzer, not a mathematician. It can establish that a proof
cites an unavailable lemma; it cannot establish that the cited lemma really
implies the next sentence.

## Inputs and outputs

The inspector reads:

- the project's QMD files;
- the root `AGENTS.md` preflight result;
- qmd-prover configuration, when present; and
- retained verification records needed to determine proof status.

Its primary outputs are:

- a deterministic semantic manifest;
- a dependency graph;
- source-located diagnostics;
- a summary of open, candidate, verified, rejected, or revoked results; and
- a bounded context bundle for a selected theorem.

The outputs are machine-readable so that the host agent can reason from them
without scraping prose. A human may also run the same Node utility directly.
This script interface is not a separate CLI product.

### Example project

Consider two mathematical files. `foundations.qmd` exports a definition:

```markdown
::: {#def-even-integer .definition name="Even integer" date="2026-07-12" export="even-integer"}
An integer \(n\) is even if there is an integer \(k\) with \(n=2k\).
:::
```

`main.qmd` imports it and contains an open goal:

```markdown
---
qmd-prover:
  imports:
    - from: foundations.qmd
      use:
        - def-even-integer
---

::: {#thm-main-even-square .theorem .goal name="Even squares" date="2026-07-12"}
For every even integer \(n\), the integer \(n^2\) is divisible by \(4\).
:::
```

The inspector discovers two semantic nodes, resolves the import, and reports
`@thm-main-even-square` as open. No dependency edge exists yet because the open
goal has no associated proof block.

## Parsing model

Pandoc JSON is the semantic parser. The inspector asks Pandoc to parse each QMD
file and walks the resulting abstract syntax tree.

Regular expressions must not be the primary semantic parser. They may be used
for narrowly bounded source-location or source-preservation tasks after the
semantic block has been identified through Pandoc.

The inspector recognizes:

- definitions, lemmas, theorems, propositions, and corollaries;
- `thm-main-*` proof obligations;
- `.proof` blocks linked to results through an `of` attribute;
- ISO introduction dates on semantic statement blocks;
- leading `OPEN` and `REJECTED` proof-control paragraphs;
- qmd-prover import metadata in the QMD front matter;
- exports; and
- semantic `@def-*`, `@lem-*`, `@thm-*`, `@prp-*`, and `@cor-*` references.

Nonsemantic QMD is left alone.

For a definition or result block, the `name` attribute supplies the display
title, `date` records its introduction date, and the block content is the
statement. Quarto natively renders `name` as the caption. A `.proof` block names
its result with `of="semantic-id"`. If its first nonempty paragraph is exactly
`OPEN` or `REJECTED`, the inspector records that control marker separately and
excludes it from mathematical proof identity and verifier input.

A canonical result may have at most one associated, unmarked proof. A workspace
may retain multiple marked proofs for the same result but at most one unmarked
active proof. A missing proof or `OPEN` proof means `open`; a `REJECTED` proof is
inactive; an unmarked proof is a candidate unless an exact verification record
says otherwise. Empty, orphaned, ambiguous, or multiply active proofs are
structural errors. A workspace proof may point through `of` to the protected
canonical target without copying its statement into the working file.

## Inspection pipeline

### 1. Discover sources

The inspector recursively discovers project QMD files while excluding derived
directories such as `.qmd-prover/`. Mathematical folder names are project
policy rather than qmd-prover conventions.

### 2. Extract semantic results

For every recognized result, the inspector records at least:

- semantic ID and kind;
- title;
- introduction date;
- source file and location;
- statement and proof identity;
- whether a proof is present;
- any reserved proof-control marker;
- semantic dependencies cited by the associated proof; and
- export information.

Statement and title identities allow later utilities to protect user-owned
content. Proof identity associates verification with the exact proof that was
checked.

An abbreviated manifest entry for the open goal could look like:

```json
{
  "id": "thm-main-even-square",
  "kind": "theorem",
  "file": "main.qmd",
  "title": "Even squares",
  "date": "2026-07-12",
  "statement_hash": "sha256:...",
  "proof_hash": "sha256:...",
  "proof_present": false,
  "dependencies": [],
  "status": "open"
}
```

Hashes stand for exact normalized identities computed by the implementation;
they are not written into mathematical QMD.

### 3. Resolve scope

A result may use definitions and results in its own file plus individually
imported exports. The inspector resolves every import relative to the importing
file and rejects ambiguous, missing, non-exported, wildcard, or cyclic imports
according to the discipline.

The result is an explicit set of available semantic IDs for each source file.

#### Example: an unresolved import

If `main.qmd` instead contains:

```yaml
qmd-prover:
  imports:
    - from: foundations.qmd
      use:
        - lem-square-of-double
```

but `foundations.qmd` does not define that ID, inspection reports an import
error at `main.qmd`. The inspector does not search the internet, invent a
lemma, or assume that a similarly titled theorem was intended.

### 4. Check dependencies

The inspector associates each `.proof` block with the result named by its `of`
attribute, separates any reserved leading marker, and extracts semantic
references from the remaining mathematical proof. It reports:

- a proof whose `of` target does not exist or is ambiguous;
- a premise that does not exist;
- a cross-file premise that was not imported;
- an imported ID that was not exported; and
- a premise whose verification status is insufficient.

A reference in ordinary exposition is navigational and does not create a proof
dependency. Dependency edges come from the semantic proof context.

#### Example: dependency diagnostics

Suppose the candidate in `main.qmd` says:

```markdown
::: {.proof of="thm-main-even-square"}
By @def-even-integer, write \(n=2k\). Then @lem-square-of-double gives
\(n^2=4k^2\).
:::
```

The inspector can return a source-located diagnostic such as:

```json
{
  "severity": "error",
  "code": "DEPENDENCY_UNAVAILABLE",
  "message": "@lem-square-of-double is cited by the proof but is not local or imported",
  "file": "main.qmd",
  "line": 18,
  "id": "thm-main-even-square"
}
```

The repair is to import the exported lemma or place it in the same file. The
proof already declares the dependency through its reference, so no separate
dependency list needs editing.

### 5. Build the graph

Each semantic result becomes a node. Each semantic result cited by its active
proof becomes a directed edge from the dependent result to the premise. Marked
proofs may be inspected as history but do not create active dependency edges.

The graph supports:

- direct-dependency lookup;
- transitive dependency closure;
- reverse-dependency lookup;
- cycle detection; and
- observability material for Quarto rendering.

The graph represents declared project structure. It does not infer hidden
mathematical dependencies from prose.

#### Example: graph construction

For these declarations:

```text
@thm-main-even-square uses @lem-square-of-double
@lem-square-of-double uses @def-even-integer
```

the graph contains:

```json
{
  "nodes": [
    { "id": "thm-main-even-square", "status": "candidate" },
    { "id": "lem-square-of-double", "status": "verified" },
    { "id": "def-even-integer", "status": "verified" }
  ],
  "edges": [
    { "from": "thm-main-even-square", "to": "lem-square-of-double" },
    { "from": "lem-square-of-double", "to": "def-even-integer" }
  ]
}
```

The direct dependency of the main theorem is the lemma. Its transitive closure
also contains the definition. The definition's reverse-dependency closure
contains both results.

### 6. Determine status

Status is derived from the current statement, proof marker, and retained
verification record. Verification applies only when its stored identities still
match the current semantic result.

At minimum, the inspector distinguishes:

- `open`: no proof is present or the proof begins with `OPEN`;
- `candidate`: an unmarked proof is present but not accepted for its current
  identity;
- `verified`: the current statement and proof match an accepted record;
- `rejected`: the proof begins with `REJECTED` or the latest matching candidate
  was rejected while canonical mathematics remained unchanged; and
- `revoked`: prior acceptance was explicitly withdrawn.

Formal-verification and human-review labels are separate metadata, not aliases
for `verified`.

### 7. Produce diagnostics

Diagnostics contain a stable code, severity, explanation, and source location
where available. They should say what invariant failed and what kind of repair
is needed.

Open goals are normal project state, not structural errors. Errors that make
dependency or statement protection unreliable prevent proof submission.

## Theorem context

For one selected theorem, the inspector returns a bounded bundle containing:

- its exact title and statement;
- current proof and status;
- direct dependencies;
- verified dependency closure;
- relevant definitions and statements;
- import origin and source locations; and
- prior verification summaries needed for repair.

The bundle should be sufficient for the host agent to begin focused proof work
without loading the entire repository. It is descriptive context, not a prompt
that attempts to prove the theorem.

### Example theorem bundle

An abbreviated inspection result might be:

```json
{
  "target": {
    "id": "thm-main-even-square",
    "title": "Even squares",
    "file": "main.qmd",
    "status": "open"
  },
  "source": {
    "statement": "For every even integer n, n^2 is divisible by 4.",
    "proof": ""
  },
  "available_results": [
    {
      "id": "def-even-integer",
      "statement": "An integer n is even if n=2k for some integer k.",
      "status": "verified",
      "imported_from": "foundations.qmd"
    }
  ],
  "diagnostics": []
}
```

The host agent can now reason from the exact target and available definition
without reading unrelated QMD chapters.

## Inspecting an agent workspace

Canonical-project inspection excludes `.qmd-prover/`, but the inspector also
supports explicit inspection of the shared mathematical workspace. The two
modes must not be confused:

- canonical inspection reports accepted project mathematics;
- workspace inspection reports provisional agent-generated mathematics plus
  the canonical results imported into that workspace.

A workspace result records its origin and working status. For example:

```json
{
  "id": "lem-local-exponent-bound",
  "origin": "workspace",
  "workspace": ".qmd-prover/workspaces",
  "file": "local-theory/exponent-bounds.qmd",
  "status": "workspace-candidate",
  "dependencies": [
    "thm-canonical-local-class-group-finite",
    "lem-completion-preserves-index"
  ]
}
```

The inspector may find that the first dependency is a verified canonical
result while the second is still an unproved workspace claim. It then exposes
the latter as part of the proof frontier instead of reporting the parent lemma
as established.

The target theorem is a special intentional overlap: each main-proof candidate
uses the canonical target's semantic ID so statement protection can compare it
with the original. Newly introduced intermediate IDs must not collide with
canonical results or with other live workspace results.

Workspace inspection writes protected target state, its graph, and provisional
verification records only under `.qmd-prover/workspaces/.workspaces/`. It may
read top-level and subject-local `progress.qmd` files for resumable context, but
those files are mathematical project notes rather than machine authority. It
never merges workspace files into the canonical manifest merely because they
parse successfully or have plausible proofs.

## Writes and failure behavior

Inspection never changes canonical QMD. It may atomically refresh derived
manifest and graph data under `.qmd-prover/`.

A parse or structural failure must not leave a partially updated index that
appears valid. Either the new derived snapshot is complete, or the inspector
reports failure without publishing it as current.
