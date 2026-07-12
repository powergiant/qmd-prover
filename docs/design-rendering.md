# Rendering design

## Role

Rendering is Quarto's responsibility. qmd-prover produces and maintains
semantic QMD; the project is rendered with the ordinary Quarto command:

```bash
quarto render
```

qmd-prover must not implement a parallel HTML site generator or replace
Quarto's document model.

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

## Observability

The inspector knows useful information that is not necessarily written into
the mathematical prose, including:

- open and verified goals;
- rejected or revoked status;
- declared dependencies;
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

## Dependency navigation

Semantic `@` references should become ordinary navigable theorem references in
the rendered document wherever Quarto supports them. Dependency summaries may
link back to the corresponding theorem blocks.

A generated graph is an optional view of the inspector's dependency data, not
an alternative semantic source. Nodes should identify the result and its
status; edges should reflect declared proof dependencies. The graph should link
to rendered theorem locations when the output format permits.

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
