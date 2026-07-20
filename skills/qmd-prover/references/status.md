# Fact status reference

Every declaration in a qmd-prover project — definition, lemma, proposition, theorem, corollary, or
protected main goal — is a **fact**, and every fact carries a state. This file is the complete
vocabulary: every field, every value, every reason, every set, and what to do about each. The
[dispatcher reference](cli.md) says which command reports them; the
[project contract](AGENTS.md) says how an author declares them.

## The four fields

A fact's state answers four separate questions, so it is stored as four fields rather than one
string:

| field | question | values |
|---|---|---|
| `intent` | What did the author declare? | `normal` · `disproof` · `draft` · `abandoned` |
| `mechanical` | Is the fact well formed? | `ok` · `broken` |
| `local_verification` | What did the AI verifier say about *this* proof? | `verified` · `disproved` · `rejected` · `not-run` |
| `global_verification` | What follows once the dependencies are counted? | 8 values, listed below |

They are independent. A fact can be well formed and unproved, malformed and abandoned, or accepted
locally and unusable globally.

`inspect fact @ID` exposes all four. Every list context — `inspect project`, `inspect path`, every
`dependency` query — shows **one** string per fact, and that string is always `global_verification`.
There is no other projection.

**`mechanical` has two spellings, depending on where you read it.** As a *state* — on a graph node,
and in what `--set unbroken` filters — its values are `ok` and `broken`. As a *check result* — inside
`inspect`'s per-fact `mechanical` object, and in the flattened `mechanical` column of a fact row —
the same information is spelled `pass` and `fail`, alongside the `references`, `verification_mode`,
`diagnostics`, and failure `reason` that produced it. They always agree: `pass` ⇔ `ok`.

Do not read `ok` as a mathematical claim. `ok` reports only that the requested operation and the
configured verifier ran without infrastructure errors. A project where every proof was rejected can
still return `ok: true`.

## `intent` — what the author declared

Declared through div attributes, never computed, never overwritten by the engine.

| value | source | meaning |
|---|---|---|
| `normal` | no attribute | an ordinary construction or proof |
| `disproof` | `.disproof` on the proof div | the proof argues that the statement is false |
| `draft` | `.draft` | the proof is deliberately unfinished |
| `abandoned` | `.abandon` | the fact is kept for memory only |

Placement rules:

- `.disproof` and `.draft` go on the **proof** div.
- `.abandon` on a **proof** div detaches that one attempt, leaving the result with no active proof,
  so the result becomes `open`. `.abandon` on a **result** div retires the whole fact.
- A definition has no proof block, so it carries `.draft` and `.abandon` on its own div. A definition
  may never carry `.disproof` (`DEFINITION_DISPROOF_FORBIDDEN`); challenge a definition through a
  theorem-like claim about it.
- `.disproof` on a **result** div is an error (`RESULT_DISPROOF_FORBIDDEN`); it belongs on the proof.

When more than one attribute is present, the first match wins: `.abandon`, then `.draft`, then
`.disproof`. So a drafted refutation has intent `draft` — it is not sent either way, and it joins the
`disproof-candidate` set only once the draft mark comes off.

`.draft` exists so an unfinished proof costs nothing. Without it, a half-written argument is sent to
the verifier on every run and comes back `rejected`, which burns tokens and reads as "the AI found
this wrong" about something nobody has finished. Removing `.draft` is the author's signal that the
proof is ready to be checked.

Intent is separate from the internal `refutation` flag that selects the verifier's mode: a fact
carrying `.disproof` has `refutation` set whatever its intent resolves to.

## `mechanical` — is the fact well formed?

Two values, `ok` and `broken`, computed without any AI verifier.

A fact is `broken` when any of these hold:

- the result or proof block has the wrong shape (missing kind class, two kind classes, missing
  `name`, missing or invalid ISO `date`, empty statement body, legacy `Statement`/`Uses`/`Proof`
  subheadings);
- the ID is missing, malformed, duplicated anywhere in the project, mismatched with its kind prefix,
  or exported under a different name;
- a protected main goal is missing `.goal`/`.theorem`, or its statement or title differs from the
  locked baseline;
- a cited `@ID` resolves to nothing, resolves ambiguously, or resolves to a fact that is not in scope
  for this file;
- the linked proof is missing its `of=`, targets an unknown ID, is one of two live proofs for the
  same target, or sits in a different file than a result that is not a main goal;
- the fact participates in a dependency cycle or an import cycle;
- the file's front-matter imports are malformed, name a missing file or ID, import something never
  exported, or use a forbidden wildcard.

A fact is **not** broken for any of these:

- it has no proof block;
- its proof block is empty (this is the `PROOF_EMPTY` *warning*, not an error);
- its proof block is marked `.draft`;
- a fact it cites is itself broken, rejected, or unproved.

The second list is the important one. `broken` describes the shape of the fact, not the state of the
mathematics and not the state of anything upstream. One bad fact does not mark a whole file broken —
but note the exception below.

**File-scoped errors break every fact in the file.** A diagnostic with no `id` is attributed to its
file, so `PARSE_ERROR`, every `IMPORT_*` code, `WILDCARD_IMPORT`, `IMPORT_CYCLE`, and
`PROOF_TARGET_MISSING` mark every fact declared in that file `broken` — including facts that are
themselves fine. Repair the file-level problem first; the fact-level noise usually clears with it.

**A parse error anywhere stops the whole project.** If Pandoc fails on any file, the compilation is
incomplete and every fact in the project is `broken` for that run, even in clean files. Fix the
parse error before reading anything else.

Abandoned facts are still parsed, still own their ID, and are still checked for shape, ID, and date
errors — an ID hidden inside an abandoned block would otherwise collide silently with a live one.
They are exempt from reference, scope, and cycle checks, contribute no edges to cycle detection, and
are never sent to the verifier.

A dependency cycle makes every participating fact `broken`, so no fact in a cycle is sent to the
verifier. A fact that merely *cites* a cycle participant is not itself broken: its reference
resolves, so it is checked normally and lands `blocked`.

## `local_verification` — what the verifier said

The AI verifier's answer about this one proof, judged **conditionally**: it assumes every direct
dependency statement exactly as written and never sees how, or whether, that dependency was proved.

| value | meaning |
|---|---|
| `not-run` | no verdict is on record |
| `verified` | the verifier accepted the construction or proof |
| `disproved` | the verifier accepted the refutation, or independently found the statement false |
| `rejected` | the verifier found the argument wrong or incomplete |

Only the verifier produces `verified`, `disproved`, and `rejected`. No mechanical check may produce
them. The mechanical layer may, however, **take a verdict away**: a recorded verdict is discarded
when its verification key changes — the statement, the exact statements of the direct dependencies,
the verification mode, the semantic context, the external basis, the checker contract, or the
protocol. The fact is then re-checked in the same run, so the intermediate empty state is never
observable. This is the only interaction between the two layers, and it runs one way: mechanical
state can withhold a verdict, never grant one.

### Every `not-run` reason

`not-run` always carries a `reason`, and the reason is what decides the global status.

| reason | cause | detail shown | global |
|---|---|---|---|
| `nothing-to-check` | no proof block, or an empty one | "No proof content is present, so there is nothing to check yet." | `open` |
| `draft` | the proof is marked `.draft` | "The proof is marked .draft: deliberately unfinished, so it is not sent to the verifier." | `open` |
| `not-eligible` | the fact is broken or abandoned | "The fact is broken or abandoned, so it is not sent to the verifier." | `broken` / `abandoned` |
| `out-of-scope` | ready, but outside the selected fact or path closure | "The proof is ready but fell outside the selected fact or path closure." | `unverified` |
| `no-backend` | no verifier is configured | "No verifier is configured; the machine dependency analysis remains available." | `unverified` |
| `verifier-error` | the verifier failed, timed out, or returned an unusable report | "The verifier failed, timed out, or returned an unusable report." | `unverified` |

There is no `stale` reason. A verdict whose key no longer matches is discarded and re-checked in the
same run; if no verifier is available to re-check it, the reason is `no-backend`.

The reason is what distinguishes a project nobody has checked yet (`no-backend`) from a project whose
backend is broken (`verifier-error`) from a fact that this narrow inspection simply did not cover
(`out-of-scope`).

### What gets sent to the verifier

A fact is sent when **all** of these hold:

- `mechanical` is `ok`;
- `intent` is neither `abandoned` nor `draft`;
- it is a definition, or it has a proof block with non-empty content.

This is exactly the `ready` set. A missing, empty, or drafted proof block is never sent, so it never
costs a verifier call.

A definition has no proof block, and that is normal rather than empty. Its verification mode is
`definition-construction`, and it is sent whenever it is otherwise eligible. A definition marked
`.draft` is `open` and is not sent.

### How a verifier report becomes a verdict

| verification mode | report verdict | `local_verification` |
|---|---|---|
| `proof` or `definition-construction` | `correct` | `verified` |
| `refutation` | `correct` | `disproved` |
| any | `incorrect` | `rejected` |
| any | `disproved` | `disproved` |

A **rejected refutation is `rejected`, not `verified`**: failing to refute a statement is not
evidence that it holds.

A proof is accepted only with no critical errors and no gaps that the configured rigor treats as
blocking. Wrong, circular, or misapplied steps are `critical_errors` and always block, at every
rigor level; only `rigor: strict` (or `rigor-disprove: strict` in refutation mode) makes reported
gaps block as well. See [the configuration reference](config.md#verification).

Each check also records its wall-clock duration and, when the backend reports them, its token counts,
as `local_verification.metrics`. A cache hit contributes no new work but still surfaces the originally
recorded cost, flagged `cached`.

## `global_verification` — what follows from the dependencies

Deterministic, computed from the other three fields and from the `global` value of the direct
dependencies. **First matching rule wins:**

1. `intent` is `abandoned` → **`abandoned`**
2. `mechanical` is `broken` → **`broken`**
3. `local` is `not-run` with reason `nothing-to-check` or `draft` → **`open`**
4. `local` is `rejected` → **`rejected`**
5. `local` is `not-run` for any other reason → **`unverified`**
6. some direct dependency's `global` is not `verified` → **`blocked`**
7. `local` is `verified` → **`verified`**; `local` is `disproved` → **`disproved`**

Rule order matters in two places that surprise people:

- An accepted **refutation** resting on an unproved lemma is `blocked`, not `disproved`. A refutation
  is only as good as what it cites.
- Citing an **abandoned** fact blocks the citer, because an abandoned proof is not a premise.

Rule 2 makes cycles impossible in rules 6 and 7, so composition always terminates.

### The eight global values

| value | what it means | what to do |
|---|---|---|
| `open` | nothing to check yet: no proof block, an empty one, or a `.draft` proof | write the proof, or drop `.draft` |
| `unverified` | a proof is ready but carries no verdict: no verifier configured, the verifier failed, or the fact was outside the checked selection | run an inspection, or repair the verifier |
| `rejected` | the verifier found the proof or refutation wrong or incomplete | repair the argument, using `repair_hints` |
| `blocked` | this proof was accepted, but some dependency is not globally verified | fix the upstream facts named in `blockers` |
| `broken` | the mechanical layer failed: shape, ID, date, reference, scope, or cycle | repair the fact, or the file-level error above it |
| `abandoned` | the fact carries `.abandon` and is kept for memory only | nothing |
| `verified` | the proof was accepted **and** the whole dependency closure is globally verified | nothing — this is the only usable premise |
| `disproved` | a refutation was accepted **and** the whole dependency closure is globally verified | nothing; the statement is false |

`verified` is composed AI evidence. It is not formal proof, not human review, never inferred from an
agent's confidence, and never written by hand into a source file.

A **definition** is discharged by its own body rather than a proof block, so it is never `open` for
want of a proof and it can never be `disproved`.

## `missing`

`missing` is **not** a fact state. It is the placeholder node the graph creates for a cited `@ID`
that resolves to nothing, so dependency queries can report the dangling edge instead of dropping it.
A placeholder has no intent, no mechanical state, and no verdict. Every fact citing one is `broken`
by rule 2.

Because `missing` occupies the same column as a status in list output, it is accepted by `--status`.
Nothing else in this file applies to it.

## The `status` attribute written back to source

After a run the engine writes a display-only `status` attribute onto the source div of each freshly
checked fact — the linked proof div for a theorem-like result, the result div for a definition:

```
status="verified"   status="disproved"   status="rejected"
```

Four properties matter:

- It carries the **local** verdict, not the global status, and only the three conclusive values.
- A fact that was not conclusively checked has any prior attribute **cleared**.
- It is excluded from every content hash, the verifier packet, the cache key, and the snapshot
  identity, and is never read back — so writing it can never change what is checked or invalidate a
  cached decision.
- `disproved` is written rather than `verified` for an accepted refutation: the attribute describes
  what the verifier concluded about the *statement*, so a statement shown false must not read
  `verified`.

Never hand-write it. Read global state from a command instead.

There are no body markers anywhere in QMD source: `OPEN`, `REJECTED`, `DISPROVED`, `VERIFIED`, and
`REVOKED` are ordinary English words with no meaning to the tool. All author intent lives in div
attributes.

## Filter vocabulary

### `--status` — one composed global value

```
open  unverified  rejected  blocked  broken  abandoned  verified  disproved  missing
```

Exactly the `global_verification` values plus `missing`. They are disjoint: every fact holds exactly
one.

### `--set` — four overlapping groupings

These cut across `status` and overlap each other, so they cannot be status values.

| set | definition | typical question |
|---|---|---|
| `candidate` | `intent` is not `abandoned` | "everything the project still stands behind" |
| `disproof-candidate` | `intent` is `disproof` | "which statements are we claiming are false?" |
| `ready` | eligible to be sent to the verifier: `status` is none of `open`, `broken`, `abandoned`, `missing` | "what could be checked at all" |
| `unbroken` | `mechanical` is `ok` | "which facts are well formed" |

`--set ready` is the query for "what can the AI work on now" — not `--set candidate`. The four
not-ready statuses are exactly the four reasons a fact is never sent (nothing written, malformed,
kept for memory, not a fact at all), so `ready` is answerable even on a graph compiled without any
verifier run. A `ready` fact carrying no verdict is exactly an `unverified` one, which is what the
`candidate_ready_for_ai` finding and `dependency ready` report.

`unbroken` is only a filter; it is never printed as a status, because every unbroken fact has a more
specific global value to show.

`--status` and `--set` combine, and both narrow the same result list.

## How to ask for each state

```bash
qmd-prover inspect fact @ID                        # all four fields for one fact
qmd-prover inspect project --print                 # every fact, human-readable
qmd-prover dependency search --status rejected     # every fact in one global state
qmd-prover dependency search --set ready           # everything sendable to the verifier
qmd-prover dependency search --set disproof-candidate   # every proposed refutation
qmd-prover dependency ready                        # the ready-and-unverified work list
qmd-prover dependency frontier @ID                 # the lowest unverified facts under @ID
qmd-prover check staleness                         # which cached verdicts no longer apply
```

## Worked cases

| fact | `intent` | `mechanical` | `local` | `global` |
|---|---|---|---|---|
| theorem, no proof block | `normal` | `ok` | `not-run` / `nothing-to-check` | `open` |
| theorem, empty proof block | `normal` | `ok` | `not-run` / `nothing-to-check` | `open` |
| theorem, proof marked `.draft` | `draft` | `ok` | `not-run` / `draft` | `open` |
| theorem, proof written, no verifier configured | `normal` | `ok` | `not-run` / `no-backend` | `unverified` |
| theorem, proof written, backend down | `normal` | `ok` | `not-run` / `verifier-error` | `unverified` |
| theorem outside the inspected closure | `normal` | `ok` | `not-run` / `out-of-scope` | `unverified` |
| theorem, proof accepted, lemma unproved | `normal` | `ok` | `verified` | `blocked` |
| theorem, proof accepted, lemma proved | `normal` | `ok` | `verified` | `verified` |
| theorem, proof found wrong | `normal` | `ok` | `rejected` | `rejected` |
| theorem, proof accepted, cited lemma abandoned | `normal` | `ok` | `verified` | `blocked` |
| theorem citing a typo'd `@ID` | `normal` | `broken` | `not-run` / `not-eligible` | `broken` |
| theorem inside a dependency cycle | `normal` | `broken` | `not-run` / `not-eligible` | `broken` |
| theorem citing a cycle participant | `normal` | `ok` | `verified` | `blocked` |
| theorem in a file with a bad import | `normal` | `broken` | `not-run` / `not-eligible` | `broken` |
| definition, in scope, checked | `normal` | `ok` | `verified` | `verified` |
| definition marked `.draft` | `draft` | `ok` | `not-run` / `draft` | `open` |
| refutation accepted, premises proved | `disproof` | `ok` | `disproved` | `disproved` |
| refutation accepted, a premise unproved | `disproof` | `ok` | `disproved` | `blocked` |
| refutation found wrong | `disproof` | `ok` | `rejected` | `rejected` |
| refutation still marked `.draft` | `draft` | `ok` | `not-run` / `draft` | `open` |
| ordinary proof the verifier found false | `normal` | `ok` | `disproved` | `disproved` |
| any fact marked `.abandon` | `abandoned` | `ok` | `not-run` / `not-eligible` | `abandoned` |
| a duplicate ID inside an abandoned block | `abandoned` | `broken` | `not-run` / `not-eligible` | `abandoned` |

The last row shows the precedence: `abandoned` outranks `broken` in the composed status, but the
`mechanical` field still records the duplicate, and the project-wide `DUPLICATE_ID` diagnostic still
fires.

## Verification counters

`inspect` returns a `verification` summary alongside the facts. Its counters use the same vocabulary:

| counter | meaning |
|---|---|
| `available` | whether a verifier was configured and executable |
| `eligible` | facts in the `ready` set for this run |
| `stopped_after` | the fact ID a fatal verifier error stopped the run after, or `null` |
| `verifier_calls` / `cache_hits` / `cache_misses` | fresh calls versus reused decisions |
| `unusable_cache_entries` | cached records that could not be read or no longer match |
| `verifier_duration_ms` / `verifier_tokens` | run cost summed over fresh calls |
| `local_verified` / `local_disproved` / `local_rejected` / `local_not_run` | the `local` tally |
| `global_verified` / `global_disproved` / `global_rejected` / `global_blocked` / `global_unverified` / `global_open` / `global_broken` / `global_abandoned` | the `global` tally |

## Reporting rules

- Report a result as established only when its `global_verification.status` is `verified`.
- Report a refutation as established only when its `global_verification.status` is `disproved`; a
  local disproof with blocked dependencies is conditional evidence, not a conclusion.
- Never describe `ok: true` as verification.
- Never describe verifier output as formal verification, proof checking, or human review.
- A `disproved` fact is evidence about a false statement, never a usable dependency.
