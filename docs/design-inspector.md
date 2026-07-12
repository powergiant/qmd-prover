# Inspector design

## Role

The inspector gives the host agent a semantic view of a QMD project. It checks
the mechanically enforceable part of the discipline, finds proof obligations,
and makes logical dependencies visible.

It is a structural analyzer, not a mathematician. It can establish that a proof
cites an undeclared lemma; it cannot establish that the cited lemma really
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

## Parsing model

Pandoc JSON is the semantic parser. The inspector asks Pandoc to parse each QMD
file and walks the resulting abstract syntax tree.

Regular expressions must not be the primary semantic parser. They may be used
for narrowly bounded source-location or source-preservation tasks after the
semantic block has been identified through Pandoc.

The inspector recognizes:

- definitions, lemmas, theorems, propositions, and corollaries;
- `thm-main-*` proof obligations;
- `Statement`, `Uses`, and `Proof` sections;
- explicit theorem-import blocks;
- exports; and
- semantic `@def-*`, `@lem-*`, `@thm-*`, `@prp-*`, and `@cor-*` references.

Nonsemantic QMD is left alone.

## Inspection pipeline

### 1. Discover sources

The inspector recursively discovers project QMD files while excluding derived
directories such as `.qmd-prover/`. Mathematical folder names are project
policy rather than qmd-prover conventions.

### 2. Extract semantic results

For every recognized result, the inspector records at least:

- semantic ID and kind;
- title;
- source file and location;
- statement and proof identity;
- whether a proof is present;
- declared dependencies;
- proof references; and
- export information.

Statement and title identities allow later utilities to protect user-owned
content. Proof identity associates verification with the exact proof that was
checked.

### 3. Resolve scope

A result may use definitions and results in its own file plus individually
imported exports. The inspector resolves every import relative to the importing
file and rejects ambiguous, missing, non-exported, wildcard, or cyclic imports
according to the discipline.

The result is an explicit set of available semantic IDs for each source file.

### 4. Check dependencies

The inspector compares `Uses` with semantic references appearing in the proof.
It reports:

- a cited premise missing from `Uses`;
- a declared premise never cited in the proof;
- a premise that does not exist;
- a cross-file premise that was not imported;
- an imported ID that was not exported; and
- a premise whose verification status is insufficient.

A reference in ordinary exposition is navigational and does not create a proof
dependency. Dependency edges come from the semantic proof context.

### 5. Build the graph

Each semantic result becomes a node. Each declared and cited logical premise
becomes a directed edge from the dependent result to the premise.

The graph supports:

- direct-dependency lookup;
- transitive dependency closure;
- reverse-dependency lookup;
- cycle detection; and
- observability material for Quarto rendering.

The graph represents declared project structure. It does not infer hidden
mathematical dependencies from prose.

### 6. Determine status

Status is derived from the current statement, proof, and retained verification
record. Verification applies only when its stored identities still match the
current semantic result.

At minimum, the inspector distinguishes:

- `open`: no proof is present;
- `candidate`: a proof is present but not accepted for its current identity;
- `verified`: the current statement and proof match an accepted record;
- `rejected`: the latest relevant candidate was rejected while canonical
  mathematics remained unchanged; and
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

## Writes and failure behavior

Inspection never changes canonical QMD. It may atomically refresh derived
manifest and graph data under `.qmd-prover/`.

A parse or structural failure must not leave a partially updated index that
appears valid. Either the new derived snapshot is complete, or the inspector
reports failure without publishing it as current.
