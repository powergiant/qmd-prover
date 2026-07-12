# Rendering design

## Role

Rendering is Quarto's responsibility. qmd-prover produces and maintains
semantic QMD; the project is rendered with the ordinary Quarto command:

```bash
quarto render
```

qmd-prover must not implement a parallel HTML site generator or replace
Quarto's document model.

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
      - proof-status.qmd

format:
  html:
    toc: true
```

The mathematical source `main.qmd` and an optional generated
`proof-status.qmd` are rendered by Quarto in the same way as any other project
page.

## Canonical rendering input

The mathematical QMD files already contain the material Quarto should render:

- exposition;
- definitions and theorem statements;
- proofs;
- equations and figures;
- bibliographic citations; and
- semantic cross-references.

The same QMD is both the canonical mathematical source used by the inspector
and the document source used by Quarto. A proof accepted by the proving
utilities becomes observable through the next normal Quarto render.

### Example canonical page

```markdown
---
title: "Main results"
qmd-prover:
  imports:
    - from: foundations.qmd
      use:
        - def-even-integer
---

We use the parity definition from @def-even-integer.

::: {#thm-main-even-square .theorem .goal name="Even squares"}
For every even integer \(n\), the integer \(n^2\) is divisible by \(4\).
:::

::: {.proof of="thm-main-even-square"}
By @def-even-integer, write \(n=2k\). Then \(n^2=4k^2\).
:::
```

The inspector associates the proof through `of` and derives its dependency
from the semantic reference. Quarto uses `name="Even squares"` as the theorem
caption and renders the proof afterward. There are no theorem-title headings or
`Statement`, `Uses`, and `Proof` section headings polluting the table of
contents or visual hierarchy. qmd-prover does not translate this source into a
separate document format.

## Observability

The inspector knows useful information that is not necessarily written into
the mathematical prose, including:

- open and verified goals;
- rejected or revoked status;
- dependencies cited by proofs;
- reverse dependencies;
- source-located diagnostics; and
- verification summaries.

When the project wants this information in its rendered output, qmd-prover may
prepare Quarto-compatible inputs such as:

- a generated QMD status page;
- a generated QMD dependency page;
- a graph image referenced by QMD;
- structured data consumed by a Quarto extension or filter; or
- attributes that a Quarto extension presents as theorem status.

Quarto still performs the rendering. qmd-prover's responsibility ends at
producing valid inputs for the project's configured Quarto pipeline.

### Example generated status page

The inspector may generate a disposable `proof-status.qmd` like:

```markdown
---
title: "Proof status"
---

| Result | Status | Source |
|---|---|---|
| @thm-main-even-square | verified | `main.qmd` |
| @thm-main-prime-bound | open | `primes.qmd` |

The open goal depends on @lem-finite-primes and @def-prime-counting.
```

This page is a presentation of inspector data. Editing “open” to “verified” in
the generated table cannot change the theorem's actual verification status;
the next inspection regenerates the page from authoritative records.

## Agent-workspace observability

A long-running goal may have many noncanonical QMD files under its agent
workspace. Rendering can expose that workspace separately from the canonical
project. For example, a generated `progress.qmd` may contain:

```markdown
---
title: "Workspace: uniform index theorem"
---

## Current frontier

- @lem-finite-stratification: verified and promoted
- @lem-local-exponent-bound: candidate under verification
- @lem-completion-preserves-index: open workspace dependency

## Active route

@thm-main-uniform-index depends on @lem-finite-stratification and
@lem-local-exponent-bound. The latter is currently blocked on
@lem-completion-preserves-index.

## Abandoned route

The uniform-generator approach is retained in
`dead-ends/uniform-generator-strategy.qmd`.
```

This view describes the agent's working dependency graph; it does not publish
workspace claims as accepted project theorems. A project may render the page in
a separate preview or include a generated summary in its ordinary Quarto site.

## Dependency navigation

Semantic `@` references should become ordinary navigable theorem references in
the rendered document wherever Quarto supports them. Dependency summaries may
link back to the corresponding theorem blocks.

A generated graph is an optional view of the inspector's dependency data, not
an alternative semantic source. Nodes should identify the result and its
status; edges should reflect declared proof dependencies. The graph should link
to rendered theorem locations when the output format permits.

### Example graph inclusion

If an observability step produces `generated/dependencies.svg`, a QMD page can
include it normally:

```markdown
![Proof dependency graph](generated/dependencies.svg){fig-alt="A directed graph from main theorems to the lemmas and definitions they use."}
```

The SVG is derived from the inspector's graph. Quarto decides how the image is
embedded in HTML or converted for another output format.

## Separation of concerns

The rendering boundary is:

```text
QMD mathematics --------------------------+
                                          |
inspector data -> optional QMD/filter data +-> quarto render -> HTML/PDF/etc.
```

The inspector computes facts. The proving utilities change canonical proofs
only after acceptance. Optional integration prepares those facts for Quarto.
Quarto chooses themes, layout, output formats, navigation, and final files.

## Generated material

Generated observability files should be visibly derived and kept separate from
user-authored mathematics. They must not:

- become the authoritative copy of a theorem or proof;
- require users to edit generated status by hand;
- embed verification metadata inside mathematical proof prose; or
- make canonical QMD unusable when the generated files are absent.

Deleting generated rendering inputs must not lose mathematics or verification
records. They should be reproducible by rerunning inspection before
`quarto render`.

## Formats and graceful degradation

Observability should follow Quarto's output capabilities. HTML may support
interactive navigation or hover details, while PDF may use a static graph and
plain dependency list. The underlying theorem text and proof must remain
readable in every supported format.

The design should not make correctness depend on a successful render. Rendering
is how users observe and publish the project; inspection and verification
remain valid independently of presentation.

### Example render commands

Render every configured format:

```bash
quarto render
```

Render only the main page as HTML while editing:

```bash
quarto render main.qmd --to html
```

For an HTML website, theorem links and graph navigation may be interactive. For
PDF output, the same project may show a static dependency image followed by a
plain list of dependencies. Both outputs present the same canonical proof.
