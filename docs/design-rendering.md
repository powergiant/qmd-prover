# Rendering design

## Role

Rendering is Quarto's responsibility. qmd-prover recognizes protected main
goals in user notes, compiles every project QMD file into one dependency
graph, and maintains derived inspection data and optional generated Quarto
inputs under `.qmd-prover/`. It never maintains or rewrites project QMD
itself. The project is rendered with the ordinary command:

```bash
quarto render
```

qmd-prover must not implement a parallel HTML site generator or replace
Quarto's document model. Inspection and verification correctness do not depend
on a successful render.

### Example Quarto project

A small website project can use an ordinary `_quarto.yml`:

```yaml
project:
  type: website

website:
  title: "Elementary number theory"
  navbar:
    left:
      - main.qmd
      - .qmd-prover/generated/proof-status.qmd

format:
  html:
    toc: true
```

The user-authored note and an optional generated status page are ordinary
Quarto inputs. Proof files under the conventional `workspace/` folder may be
rendered in a separate preview when the project wants to expose detailed
proof development.

## User-note rendering input

User-authored QMD contains material the user chose to keep in notes:

- exposition and informal derivations;
- protected `thm-main-*` statements;
- equations, figures, tables, and code;
- bibliographic citations; and
- ordinary Quarto cross-references.

qmd-prover does not copy a verified proof, confirmed refutation, or status
marker into these files.
A protected main goal therefore renders as the user's statement even when its
current proof overlay and intermediate development live in other project
files, conventionally under `workspace/`.

### Example user page

```markdown
---
title: "Main questions"
---

We study parity and divisibility.

::: {#thm-main-even-square .theorem .goal name="Even squares" date="2026-07-12"}
For every even integer \(n\), the integer \(n^2\) is divisible by \(4\).
:::
```

The theorem block remains stable and human-readable. Quarto uses the `name`
as its caption. qmd-prover uses the same block as the protected statement and
obtains its proof from the goal's linked overlay, conventionally
`workspace/main-proof.qmd`.

User notes may also contain recognized declarations that are not
`thm-main-*`. Quarto renders them normally, and qmd-prover compiles them into
the same project graph as ordinary facts with origin `fact`. Unrecognized
theorem-like Divs remain ordinary Quarto content.

## Observability

The inspector knows information that need not appear in mathematical prose:

- every goal and fact in the project graph, with its origin (`main-goal`,
  `fact`, or `unresolved`);
- machine state (`candidate`, `open`, `rejected`, `disproof-candidate`,
  `revoked`) and verification state (`verified`, `disproved`, `blocked`,
  `unverified`, `rejected`, `invalid`) for every fact;
- dependency and reverse-dependency paths;
- proof frontiers and cycles;
- source-located diagnostics;
- verifier calls, cache hits, rejections, and failures; and
- staleness of source relative to the published snapshot (`SOURCE_STALE`).

When a project wants this information in rendered output, qmd-prover may
prepare Quarto-compatible inputs such as:

- a generated QMD status page;
- a generated QMD dependency page;
- a dependency SVG referenced by QMD;
- structured report data consumed by a Quarto extension; or
- a future paper-selection manifest.

Quarto still performs rendering. qmd-prover's responsibility ends at producing
valid, reproducible inputs.

### Example generated status page

A generated page can show both protected goals and proof evidence:

```markdown
---
title: "Proof status"
---

| Result | Local AI | Global | Refutation evidence | Source |
|---|---|---|---|---|
| @thm-main-even-square | verified | verified | — | `workspace/main-proof.qmd:6` |
| @lem-false-parity | disproved | disproved | The integer 1 is a counterexample. | `workspace/parity.qmd:18` |
| @thm-main-prime-bound | not-run | unverified | — | `primes.qmd:12` |

The first goal currently depends on @def-even-integer and
@lem-square-of-double, declared in its proof files.
```

Editing this generated table cannot change verification state. The next
render preparation regenerates it from the published project snapshot.

## Proof-development observability

A long development may contain many semantic QMD files under the conventional
`workspace/` folder. Rendering can expose that proof development separately
from user notes. A top-level `workspace/progress.qmd` remains the
conventional human/agent summary; subject folders may add local progress
pages.

For example:

```markdown
---
title: "Proof development: uniform index theorem"
---

## Current frontier

- @lem-finite-stratification: verified
- @lem-local-exponent-bound: candidate
- @lem-completion-preserves-index: open
- @lem-universal-parity: disproved

## Active route

@thm-main-uniform-index depends on @lem-finite-stratification and
@lem-local-exponent-bound. The latter is blocked on
@lem-completion-preserves-index.

## Abandoned route

The uniform-generator route is retained in
local-theory/local-class-groups.qmd as a proof beginning with REJECTED.
```

This page describes working mathematics and current evidence. It does not
assert that proof-development files have become part of the user's notes.

**Current frontier.**

A generated frontier view should be derived from the published project graph,
not copied from an old progress note. It reports the lowest unresolved
dependencies of a selected goal and gives a path from the goal to each
obligation.

The hand-written `progress.qmd` and generated frontier have complementary
roles. The former records strategy, explanations, and abandoned approaches;
the latter records mechanically current graph state. Inspection never
overwrites the former.

**Active route.**

Active-route presentation can group facts by subject file, dependency depth,
or proof phase. It should display enough source provenance to distinguish:

- the protected main-goal overlay;
- intermediate declarations in proof files;
- context nodes outside a selected path but inside the selection's import
  closure; and
- unresolved or out-of-scope references.

It must not display an unverified protected main goal as an available
premise: the citation edge is legal, but it remains globally blocked until
that goal is verified.

**Abandoned route.**

Rejected or inactive attempts can be rendered for research history, but they
must remain visibly non-authoritative. A generated view may link to the
`REJECTED` proof and its verifier repair hints. It must not use a rejected fact
as a premise or count it as proof progress.

Confirmed refutations are different from rejected proof attempts. A generated
view may show the `disproved` statement together with its verified refutation
evidence and source. It must still present the statement as false, never
count it as a proved dependency, and visibly distinguish an independently
confirmed disproof from a source-only `DISPROVED` candidate or a rejected
refutation.

`VERIFIED` or `REVOKED` markers anywhere in source are structural errors
(`PROTECTED_MARKER_FORBIDDEN`), never renderable status; a generated view
reflects only recorded verification state.

## Dependency navigation

Semantic `@id` references inside project mathematics should become navigable
theorem references where Quarto supports them. Generated dependency summaries
may link to rendered declaration locations and protected main-goal notes.

The project graph is an optional view, not an alternative semantic source.
Each node should identify ID, kind, status, origin (`main-goal`, `fact`, or
`unresolved`), source location, and selected/context scope when relevant. A
confirmed disproof node also carries the verifier summary, refutation,
evidence source, and verification identity; the generated SVG exposes the
refutation in its accessible title. Edges must reflect actual proof
dependencies. Citations outside a consumer's declared import scope are
diagnostics, not published graph edges; a legal edge into an unverified
protected main goal is published but marked blocked.

### Example graph inclusion

If render preparation produces
`.qmd-prover/generated/dependencies.svg`, a QMD page can include it normally:

```markdown
![Proof dependency graph](.qmd-prover/generated/dependencies.svg){fig-alt="A directed graph from protected goals to supporting lemmas and definitions."}
```

The SVG is derived from a published schema-v5 project snapshot. Quarto decides
how it is embedded or converted.

## Separation of concerns

The rendering boundary is:

```text
project QMD (user notes + workspace/ proof files) -+
                                                   |
compile -> inspector -> generated QMD/data --------+-> quarto render
                                                   |
future paper selection ----------------------------+
```

The compiler computes the machine graph, optional local AI changes only local
cache state, and the inspector composes global state. Optional integration
prepares views. Quarto chooses
themes, layout, formats, navigation, and final files.

Future paper tooling may select verified declarations and proofs and may
annotate excluded or false routes with retained disproof evidence. It can
arrange selected mathematics for exposition and generate a separate paper
artifact. That is a new publication workflow, not permission for inspection
to rewrite user notes.

## Generated material

Generated observability files are derived and kept separate from user-authored
notes and proof mathematics. They must not:

- become the authoritative copy of a theorem or proof;
- require users to edit generated status manually;
- embed verifier metadata into proof prose;
- copy proof overlays into protected user-note files;
- treat source markers as current verification; or
- make the underlying project unusable when generated files are absent.

Deleting generated rendering inputs must not lose mathematics, exact verifier
records, published project snapshots, or protected goals. They are
reproducible from project source and derived verification state.

## Formats and graceful degradation

HTML may support interactive graph navigation, filters, or hover details. PDF
may use a static graph and plain dependency list. The protected theorem and
linked proof text must remain readable in every chosen format.

The design must not make correctness depend on rendering. A failed Quarto
build does not invalidate an exact verifier decision; a successful attractive
render does not establish mathematical correctness.

### Example render commands

Prepare qmd-prover observability inputs:

```bash
node "${CODEX_HOME:-$HOME/.codex}/skills/qmd-prover/scripts/qmd-prover.js" render
```

Render every configured format:

```bash
quarto render
```

Render only the generated status page as HTML while editing:

```bash
quarto render .qmd-prover/generated/proof-status.qmd --to html
```
