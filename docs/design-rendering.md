# Rendering design

## Role

Rendering is Quarto's responsibility. qmd-prover recognizes protected main
goals in user notes and maintains retained workspace mathematics, aggregate
inspection data, and optional generated Quarto inputs. It does not maintain or
rewrite the notes themselves. The project is rendered with the ordinary
command:

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
Quarto inputs. The workspace itself may be rendered in a separate preview when
the project wants to expose detailed proof development.

## User-note rendering input

QMD outside `.qmd-prover/` contains material the user chose to keep in notes:

- exposition and informal derivations;
- protected `thm-main-*` statements;
- equations, figures, tables, and code;
- bibliographic citations; and
- ordinary Quarto cross-references.

qmd-prover does not copy a verified proof or a status marker into these files.
A protected main goal therefore renders as the user's statement even when its
current proof overlay and intermediate development live in a workspace.

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

The theorem block remains stable and human-readable. Quarto uses the `name` as
its caption. qmd-prover uses the same block as the protected statement but
obtains its proof only from
`.qmd-prover/workspaces/thm-main-even-square/main-proof.qmd`.

User notes may also contain theorem-like Divs that are not `thm-main-*`. Quarto
renders them normally. qmd-prover does not force those blocks into the
workspace semantic contract or list them as project facts.

## Observability

The inspector knows information that need not appear in mathematical prose:

- initialized, missing, stale, uninitialized, and orphan workspaces;
- open, candidate, workspace-verified, and workspace-rejected facts;
- dependency and reverse-dependency paths;
- proof frontiers and cycles;
- source-located diagnostics;
- verifier calls, cache hits, rejections, and failures; and
- legacy canonical records or markers that no longer establish current state.

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

A generated page can show both protected goals and workspace evidence:

```markdown
---
title: "Proof status"
---

| Main goal | Workspace | Status | Source |
|---|---|---|---|
| @thm-main-even-square | initialized | workspace-verified | .qmd-prover/workspaces/thm-main-even-square/ |
| @thm-main-prime-bound | missing | open | primes.qmd |

The first goal currently depends on @def-even-integer and
@lem-square-of-double inside its own workspace.
```

Editing this generated table cannot change verification state. The next render
preparation regenerates it from current protected goals and workspace
snapshots.

## Agent-workspace observability

A long development may contain many semantic QMD files under one goal
workspace. Rendering can expose that workspace separately from user notes.
The top-level `progress.qmd` remains the human/agent summary; subject
directories may add local progress pages.

For example:

```markdown
---
title: "Workspace: uniform index theorem"
---

## Current frontier

- @lem-finite-stratification: workspace-verified
- @lem-local-exponent-bound: candidate
- @lem-completion-preserves-index: open

## Active route

@thm-main-uniform-index depends on @lem-finite-stratification and
@lem-local-exponent-bound. The latter is blocked on
@lem-completion-preserves-index.

## Abandoned route

The uniform-generator route is retained in
local-theory/local-class-groups.qmd as a proof beginning with REJECTED.
```

This page describes working mathematics and current evidence. It does not
assert that the workspace has become part of the user's notes.

**Current frontier.**

A generated frontier view should be derived from the current aggregate graph,
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
- intermediate declarations in the same workspace;
- context nodes outside a selected path but inside the workspace; and
- unresolved or forbidden references.

It must not display another workspace's fact as an available premise merely
because that node exists in the aggregate project graph.

**Abandoned route.**

Rejected or inactive attempts can be rendered for research history, but they
must remain visibly non-authoritative. A generated view may link to the
`REJECTED` proof and its verifier repair hints. It must not use a rejected fact
as a premise or count it as proof progress.

Legacy `VERIFIED` or `REVOKED` markers in old user files may be shown as legacy
warnings, not as current workspace status.

## Dependency navigation

Semantic `@id` references inside workspace mathematics should become navigable
theorem references where Quarto supports them. Generated dependency summaries
may link to rendered workspace declaration locations and protected main-goal
notes.

The aggregate graph is an optional view, not an alternative semantic source.
Each node should identify ID, kind, status, workspace or main-goal origin,
source location, and selected/context scope when relevant. Edges must reflect
actual local proof dependencies. Forbidden cross-workspace edges are
diagnostics, not published graph edges.

### Example graph inclusion

If render preparation produces
`.qmd-prover/generated/dependencies.svg`, a QMD page can include it normally:

```markdown
![Proof dependency graph](.qmd-prover/generated/dependencies.svg){fig-alt="A directed graph from protected goals to local workspace lemmas and definitions."}
```

The SVG is derived from a named schema-v3 snapshot. Quarto decides how it is
embedded or converted.

## Separation of concerns

The rendering boundary is:

```text
user-note QMD -----------------------------------+
                                                  |
workspace QMD -> inspector -> generated QMD/data +-> quarto render
                                                  |
future paper selection --------------------------+
```

The compiler and inspector compute facts. Workspace verification changes only
cache and snapshot state. Optional integration prepares views. Quarto chooses
themes, layout, formats, navigation, and final files.

Future paper tooling may select workspace-verified declarations and proofs,
arrange them for exposition, and generate a separate paper artifact. That is a
new publication workflow, not permission for inspection to rewrite user notes.

## Generated material

Generated observability files are derived and kept separate from user-authored
notes and workspace mathematics. They must not:

- become the authoritative copy of a theorem or proof;
- require users to edit generated status manually;
- embed verifier metadata into proof prose;
- copy workspace proofs into protected user-note files;
- treat legacy markers as current verification; or
- make the underlying project unusable when generated files are absent.

Deleting generated rendering inputs must not lose mathematics, exact verifier
records, workspace snapshots, or protected goals. They are reproducible from
the project and workspace state.

## Formats and graceful degradation

HTML may support interactive graph navigation, filters, or hover details. PDF
may use a static graph and plain dependency list. The protected theorem and
workspace proof text must remain readable in every chosen format.

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
