# Status model design

This document defines what state a fact is in, how that state is computed, and
how it is named in output and in filters. It is the single reference for the
status vocabulary; other design documents use these names without redefining
them.

The explanation runs in the order the engine itself works: what the author
declared, then whether the fact is well formed, then what the verifier said,
then what follows once dependencies are taken into account. Filters, worked
cases, and the change history come last.

This is the maintainer document, kept under `docs/` and not installed. The
agent-facing version of the same model ships with the skill as
`skills/qmd-prover/references/status.md`; keep the two in step whenever a value,
reason, rule, or set changes here.

## Why the model has four fields

The state of a fact answers four separate questions:

- What did the author declare? (`intent`)
- Is the fact well formed? (`mechanical`)
- What did the AI verifier say about this proof? (`local`)
- What follows once the dependencies are taken into account? (`global`)

These are independent. A fact can be well formed and unproved, or malformed and
abandoned, or proved locally and unusable globally. Earlier drafts folded all
four into one string, which forced overlapping values into a single enum. They
are stored as four fields instead.

`inspect fact @ID` exposes all four. List output shows one string, and that
string is always the `global` field. There is no other projection.

## intent

Declared by the author through div attributes. `.disproof`, `.draft`, and
`.assumed` go on the proof block. `.abandon` goes on the result to retire the
whole fact; on a proof block it detaches that one attempt instead, leaving the
result with no active proof and therefore `open`. A fact with no proof block —
every definition, and a result whose statement is being taken as given — carries
`.draft`, `.assumed`, and `.abandon` on its own div.

| value | source | meaning |
| --- | --- | --- |
| `normal` | no attribute | an ordinary construction or proof |
| `disproof` | `.disproof` | the proof block argues the statement is false |
| `draft` | `.draft` | the proof is deliberately unfinished |
| `assumed` | `.assumed` | the author takes it as given; do not check it |
| `abandoned` | `.abandon` | the fact is kept for memory only |

Two of these combine and two do not. `.abandon` outranks `.draft`, which
outranks `.disproof`: an abandoned attempt is retired whatever else it says, and
a drafted refutation has intent `draft`, is not sent either way, and joins the
`disproof-candidate` set only once the draft mark comes off.

`.assumed` combines with neither `.draft` nor `.disproof`, and each collision is
a mechanical error rather than a silent precedence:

- `.draft` with `.assumed` is `ASSUMED_DRAFT`. The two make opposite claims — "I
  have not finished this" against "I know this is right" — so a fact carrying
  both is telling the reader nothing coherent. The author has to choose, because
  the engine choosing for them would either audit an unfinished proof or trust
  one the author only meant to park.
- `.assumed` with `.disproof` is `ASSUMED_DISPROOF`. An assumption is a premise
  later work rests on, and a refutation is terminal evidence that a statement is
  false; asserting a refutation without an argument is just asserting the
  negated statement, which is written as an ordinary assumed result.

A broken fact is never sent and never composed as a premise, so both collisions
fail closed: the fact is `broken` until the author removes one mark.

### `.draft` and `.assumed` are different claims

Both stop a proof from reaching the verifier, and that is all they share.

`.draft` is how an author says "I know this is not finished". Without it, a
half-written proof would be sent to the verifier on every run and come back
`rejected`, which costs tokens and reads as "the AI found this wrong" about an
argument nobody has finished. Removing `.draft` is the author's signal that the
proof is ready to be checked. A drafted fact is `open`: unfinished work, on the
frontier, blocking everything above it.

`.assumed` is how an author says "I know this is right, do not spend a check on
it". It is a commitment, not a defect. An assumed fact composes exactly as a
verified one does, so nothing above it is blocked and it never reaches the
frontier — but the commitment is recorded, and every fact resting on it reports
the assumption it rests on. See "Assumption footprint" below.

The two must stay distinct because they call for opposite responses. Work
through a draft; audit an assumption. Folding them into one attribute would
either put settled commitments on the todo list or quietly retire real
obligations, and the second failure is the dangerous one.

### What `.assumed` means depends on whether a proof is present

The attribute has one meaning — "take this as given" — and the thing taken as
given is whatever the fact would otherwise have had checked.

| placement | the author is claiming | dependencies |
| --- | --- | --- |
| on a proof block with content | this argument is sound | still cited, still composed, still each their own obligation |
| on a result div with no proof block | this statement holds | none; the fact stands alone |

The first is a local guarantee: the reasoning is trusted, but every lemma the
proof cites must still be proved on its own. The second is an axiom in the
ordinary sense — no argument is offered, so there is nothing to depend on.

Nothing distinguishes the two beyond the presence of a proof, so the author
learns one attribute and the engine needs no second rule. Output names them
`assumed-proof` and `assumed-statement` where the distinction matters to a
reader.

Intent is never computed and never overwritten by the engine. It is separate
from `refutation`, the internal flag that selects the verifier's mode; a fact
carrying `.disproof` has `refutation` set whatever its intent resolves to.

## mechanical

Two values: `ok` and `broken`. Computed without any AI verifier.

A fact is `broken` when any of these hold:

- the result or proof block has the wrong shape;
- the ID is missing, malformed, duplicated anywhere in the project, or claimed
  by a file that does not own it;
- the same block carries `.assumed` with `.draft` (`ASSUMED_DRAFT`) or with
  `.disproof` (`ASSUMED_DISPROOF`);
- the introduction date is missing or is not a real calendar date;
- a cited `@ID` resolves to nothing;
- a cited `@ID` resolves to a fact that is not in scope for this file;
- the fact participates in a dependency cycle or an import cycle.

A fact is **not** broken for any of these:

- it has no proof block;
- its proof block is empty;
- its proof block is marked `.draft` or `.assumed`;
- a fact it cites is itself broken, rejected, or unproved.

The second list is the important one. `broken` describes the shape of the fact,
not the state of the mathematics and not the state of anything upstream. Whether
a fact is broken does not change as proofs get written, and one bad fact does not
mark the whole file broken.

An empty proof block is reported as the warning `PROOF_EMPTY` so that a block
emptied by a bad edit is still visible in `check` output, but a warning does not
make the fact broken. It is `open`, like a fact with no proof block at all.

Abandoned facts are still parsed, still own their ID, and are still checked for
shape, ID, and date errors, because an ID hidden inside an abandoned block would
otherwise collide silently with a live one. They are exempt from reference,
scope, and cycle checks, they contribute no edges to cycle detection, and they
are never sent to the verifier.

A dependency cycle makes every participating fact `broken`, so no fact in a cycle
is sent to the verifier. This is a deliberate change from the earlier behaviour,
which sent cycle participants for local conditional checking. The local answer
was real but could not be used for anything, and paying for it on every run was
not worth it. A fact that merely cites a cycle participant is not itself broken;
its reference resolves, so it is checked normally and lands `blocked`.

## local

The AI verifier's answer about this one proof. Four values:

| value | meaning |
| --- | --- |
| `not-run` | no verdict is on record |
| `verified` | the verifier accepted the construction or proof |
| `disproved` | the verifier accepted the refutation |
| `rejected` | the verifier found the argument wrong or incomplete |

Only the verifier produces `verified`, `disproved`, and `rejected`. No mechanical
check may produce them.

The mechanical layer may, however, take a verdict away. A recorded verdict is
discarded when the verification key changes — the statement, the exact statements
of the direct dependencies, the verification mode, the semantic context, the
external basis, the checker contract, or the protocol. The fact is then checked
again in the same run, so what a reader sees is the new verdict, not an
intermediate empty state. This is the only interaction between the two layers,
and it runs in one direction: mechanical state can withhold a verdict, never
grant one.

`not-run` always carries a reason:

| reason | cause | global |
| --- | --- | --- |
| `nothing-to-check` | no proof block, or an empty one | `open` |
| `draft` | the proof is marked `.draft` | `open` |
| `assumed` | the fact is marked `.assumed` | `verified` / `blocked` |
| `not-eligible` | the fact is broken or abandoned | `broken` / `abandoned` |
| `out-of-scope` | ready, but outside the selected fact or path closure | `unverified` |
| `no-backend` | no verifier is configured | `unverified` |
| `verifier-error` | the verifier failed, timed out, or returned an unusable report | `unverified` |

The authored reasons are tested in this order, first match winning:
`not-eligible`, `draft`, `assumed`, `nothing-to-check`. `not-eligible` comes
first, so a fact that carries `.draft` and `.assumed` together is `broken` and
never reaches the later reasons. `assumed` outranks `nothing-to-check`, so an
assumed statement with no proof block is read as taken-as-given rather than as
an empty one. The remaining three reasons describe the run rather than the
source and cannot compete with these.

`assumed` is the only reason whose `global` is not a defect. `local` still
records `not-run`, which is the literal truth — no verifier saw this fact — and
the author's commitment is carried by the reason, not by a verdict. This keeps
the promise that only the verifier produces `verified`, `disproved`, and
`rejected` in the `local` field.

There is no `stale` reason. A verdict whose key no longer matches is discarded,
and the fact is simply re-checked in the same run; if there is no verifier to
re-check it, the reason is `no-backend`. Withholding and re-checking happen
together, so the intermediate state is never observable.

The reason is required, is shown in list output, and is what distinguishes a
project nobody has checked yet from a project whose backend is broken.

### What gets sent

A fact is sent to the verifier when all of the following hold:

- `mechanical` is `ok`;
- `intent` is none of `abandoned`, `draft`, `assumed`;
- it is a definition, or it has a proof block with non-empty content.

This is the set named `ready` below. A missing, empty, drafted, or assumed proof
block is never sent.

A definition has no proof block, and that is normal rather than empty. Its
verification mode is `definition-construction`, and it is sent whenever it is
otherwise eligible. A definition marked `.draft` is `open` and is not sent; one
marked `.assumed` is `verified` and is not sent.

### How a report becomes a verdict

| verification mode | report verdict | local |
| --- | --- | --- |
| `proof` or `definition-construction` | `correct` | `verified` |
| `refutation` | `correct` | `disproved` |
| any | `incorrect` | `rejected` |
| any | `disproved` | `disproved` |

A rejected refutation is `rejected`, not `verified`: failing to refute a statement
is not evidence that it holds.

## global

Deterministic. Computed from the other three fields and from the `global` value of
the direct dependencies. First matching rule wins:

1. `intent` is `abandoned` → **`abandoned`**
2. `mechanical` is `broken` → **`broken`**
3. `local` is `not-run` with reason `nothing-to-check` or `draft` → **`open`**
4. `local` is `rejected` → **`rejected`**
5. `local` is `not-run` with a reason other than `assumed` → **`unverified`**
6. some direct dependency's `global` is not `verified` → **`blocked`**
7. `local` is `verified`, or `not-run` with reason `assumed` → **`verified`**;
   `local` is `disproved` → **`disproved`**

Rule 5 skipping `assumed` is the whole of the change: an assumed fact falls
through to the same two rules a verified one meets, so it is `blocked` while
anything it cites is unproved and `verified` once they are all proved. An
assumed statement with no proof block cites nothing, so rule 6 is vacuous and it
is `verified` immediately.

The values are disjoint, and each one names a different next action:

| value | what it means | what to do |
| --- | --- | --- |
| `open` | nothing to check yet | write a proof, or drop `.draft` |
| `unverified` | something is written, no verdict | run a check, or fix the verifier |
| `rejected` | the verifier found it wrong | repair the proof |
| `blocked` | this proof is fine, upstream is not | fix the upstream fact |
| `broken` | the fact is malformed | fix the shape, ID, date, or reference |
| `abandoned` | kept for memory only | nothing |
| `verified` | proved, and everything it rests on is proved or assumed | check the assumption footprint |
| `disproved` | refuted, and everything the refutation rests on is proved | nothing |

Rule 6 applies to disproofs as well as proofs. A refutation resting on an
unproved lemma is `blocked`, not `disproved`: the refutation is only as good as
what it cites.

A cited fact that is `abandoned` is not `verified`, so citing an abandoned fact
blocks the citing fact. This is intended — an abandoned proof is not a premise.

Rule 2 makes cycles impossible in rules 6 and 7, so the composition always
terminates.

`verified` is composed AI evidence. It is not formal proof, not human review,
never inferred from an agent's confidence, and never written as a source marker.

## Assumption footprint

`.assumed` buys silence from the verifier, not silence from the report. Every
`global_verification` carries a fifth field beside `status`, `blockers`, and
`reason`:

```
assumptions: string[]
```

It lists, sorted, every fact in the closure of this one — the fact itself
included — whose `local` reason is `assumed`. It is computed in the same
topological pass that computes `blockers`:

```
assumptions(f) = (f is assumed ? {f} : {}) ∪ ⋃ { assumptions(d) : d ∈ deps(f) }
```

The field is always present and is empty for a fact that rests on nothing
assumed. It is the answer to "what is this proof actually resting on", and it is
the reason a project can use `.assumed` freely without losing track of what it
has committed to.

**A non-empty footprint must never be printed as a bare `verified`.** Wherever a
status is rendered for such a fact, the count comes with it:

```
@thm-main-goal [verified modulo 4 assumptions]
```

The `global` value really is `verified` — filters, sets, and composition all
treat it as verified, because the project has decided the statement holds. The
rendering rule exists so that no reader ever concludes "proved" from a line that
means "proved from four things nobody checked".

`--set assumed` selects facts whose `intent` is `assumed`, which is the list of
commitments themselves rather than the facts resting on them.
`dependency assumptions @ID` reports one fact's footprint with a path to each
assumption, and is the query to run before believing a goal.

### Refusing assumptions

`verification.assumptions` takes `allow` (default) or `forbid`. Under `forbid`,
a protected main goal whose footprint is non-empty raises the `GOAL_ASSUMED`
error and `check` fails, naming every assumption in the closure.

This is a project setting rather than a command-line flag on purpose. Whether a
project is willing to stand on assumptions is a property of the project, it
belongs in `config.yml` where it is reviewed and versioned, and it must not be
something a single invocation can quietly turn off.

`.assumed` and the frontier do not interact. An assumed fact is `verified` or
`blocked`, and neither reaches the frontier. The two lists a project reads are
therefore disjoint and together complete: the frontier is what is left to do,
and the footprint is what has been decided not to do.

## missing

`missing` is not a fact state. It is the placeholder node the graph creates for a
cited `@ID` that resolves to nothing, so that dependency queries can report the
dangling edge instead of dropping it. A placeholder has no intent, no mechanical
state, and no verdict. Every fact citing one is `broken` by rule 2.

Because `missing` appears where a fact would appear in list output, it is listed
alongside the status values in the filter vocabulary, but nothing else in this
document applies to it.

## The `status` attribute written back to source

After a run the engine writes a display-only `status` attribute onto the source
div of each freshly checked fact — the linked proof div for a theorem-like
result, the result div for a definition. It carries the `local` verdict, not the
`global` status, and only the three conclusive values:

```
status="verified"   status="disproved"   status="rejected"
```

An assumed fact is never conclusively checked, so it never carries a written-back
`status`. The engine must not project `.assumed` into `status="verified"`: the
attribute reports what a verifier concluded, and no verifier saw the fact. A
reader sees `.assumed` on the div, which already says everything there is to say.

A fact that was not conclusively checked has any prior attribute cleared. The
attribute is excluded from every content hash, the verifier packet, the cache
key, and the snapshot identity, and is never read back, so writing it can never
invalidate a cached decision. It exists so a reader of the QMD sees the last
verdict without running the tool.

`disproved` is written rather than `verified` for an accepted refutation. The
attribute describes what the verifier concluded about the statement, so a
statement shown to be false must not carry the word `verified`.

## Filter vocabulary

`--status` takes exactly the values of the `global` field, plus `missing`:

```
open  unverified  rejected  blocked  broken  abandoned  verified  disproved  missing
```

Five further sets are useful and are not `global` values, because they overlap
each other and cut across the field. They are selected with `--set`:

| set | definition |
| --- | --- |
| `candidate` | `intent` is not `abandoned` — every fact the project still stands behind |
| `disproof-candidate` | `intent` is `disproof` |
| `assumed` | `intent` is `assumed` — every commitment the project has made |
| `ready` | eligible to be sent to the verifier: `status` is none of `open`, `broken`, `abandoned`, `missing`, and `intent` is not `assumed` |
| `unbroken` | `mechanical` is `ok` |

`assumed` has to be a set rather than a status because an assumed fact already
has a `global` value to show — `verified` or `blocked` — and that value is the
one composition uses.

`ready` is the set that was previously called `candidate`. Queries that ask "what
can the AI work on now" want `--set ready`, not `--set candidate`.

`unbroken` is exposed only as a filter. It is never printed as a status, because
every unbroken fact has a more specific `global` value to show instead.

Four of the five reasons a fact is never sent are readable from `status` alone —
nothing written (`open`, which covers `.draft` too), malformed (`broken`), kept
for memory (`abandoned`), or not a fact at all (`missing`). The fifth is
`.assumed`, which is deliberately invisible in `status` because an assumed fact
composes as a verified one, so `ready` reads `intent` for that one exclusion.
Both fields are on every node, so `ready` is still answerable from the graph
alone, even when it was compiled without any verifier. A `ready` fact carrying
no verdict is exactly an `unverified` one, which is what the
`candidate_ready_for_ai` finding reports.

`--status` and `--set` may be combined, and both narrow the same result list.

## Worked cases

| fact | intent | mechanical | local | global |
| --- | --- | --- | --- | --- |
| theorem, no proof block | `normal` | `ok` | `not-run` / `nothing-to-check` | `open` |
| theorem, empty proof block | `normal` | `ok` | `not-run` / `nothing-to-check` | `open` |
| theorem, proof marked `.draft` | `draft` | `ok` | `not-run` / `draft` | `open` |
| theorem, proof marked `.assumed`, lemma proved | `assumed` | `ok` | `not-run` / `assumed` | `verified` |
| theorem, proof marked `.assumed`, lemma unproved | `assumed` | `ok` | `not-run` / `assumed` | `blocked` |
| theorem, no proof block, result marked `.assumed` | `assumed` | `ok` | `not-run` / `assumed` | `verified` |
| theorem, proof marked both `.draft` and `.assumed` | `draft` | `broken` | `not-run` / `not-eligible` | `broken` |
| theorem, proof marked both `.assumed` and `.disproof` | `assumed` | `broken` | `not-run` / `not-eligible` | `broken` |
| theorem, proof written, no verifier configured | `normal` | `ok` | `not-run` / `no-backend` | `unverified` |
| theorem, proof written, backend down | `normal` | `ok` | `not-run` / `verifier-error` | `unverified` |
| theorem outside the inspected closure | `normal` | `ok` | `not-run` / `out-of-scope` | `unverified` |
| theorem, proof accepted, lemma unproved | `normal` | `ok` | `verified` | `blocked` |
| theorem, proof accepted, lemma proved | `normal` | `ok` | `verified` | `verified` |
| theorem, proof found wrong | `normal` | `ok` | `rejected` | `rejected` |
| theorem citing a typo'd `@ID` | `normal` | `broken` | `not-run` / `not-eligible` | `broken` |
| theorem inside a dependency cycle | `normal` | `broken` | `not-run` / `not-eligible` | `broken` |
| theorem citing a cycle participant | `normal` | `ok` | `verified` | `blocked` |
| definition, in scope, checked | `normal` | `ok` | `verified` | `verified` |
| definition marked `.draft` | `draft` | `ok` | `not-run` / `draft` | `open` |
| definition marked `.assumed` | `assumed` | `ok` | `not-run` / `assumed` | `verified` |
| refutation accepted, premises proved | `disproof` | `ok` | `disproved` | `disproved` |
| refutation accepted, a premise unproved | `disproof` | `ok` | `disproved` | `blocked` |
| refutation found wrong | `disproof` | `ok` | `rejected` | `rejected` |
| any fact marked `.abandon` | `abandoned` | `ok` | `not-run` / `not-eligible` | `abandoned` |
| a duplicate ID inside an abandoned block | `abandoned` | `broken` | `not-run` / `not-eligible` | `abandoned` |

The last row shows the precedence: `abandoned` outranks `broken` in the projected
status, but the `mechanical` field still records the duplicate, and the
project-wide `DUPLICATE_ID` diagnostic still fires.

## Changes from the previous model

| before | after |
| --- | --- |
| `invalid` | renamed `broken` |
| `candidate` as a status | removed; the set is `--set ready` |
| `disproof-candidate` as a status | removed; the set is `--set disproof-candidate` |
| `open` meant no proof or an `OPEN` body marker | means no proof content to check |
| `unverified` meant any missing verdict | means a proof exists but has no verdict |
| `revoked` | removed; a discarded verdict is simply re-checked |
| no way to mark an unfinished proof | `.draft` on the proof block |
| `.draft` also used to mean "trust this, do not check it" | `.assumed`, with its own intent, `not-run` reason, and footprint; `.draft` with `.assumed` is now the `ASSUMED_DRAFT` error |
| no record of what a proof was taken on faith | `global_verification.assumptions`, `--set assumed`, `dependency assumptions @ID` |
| nothing refused an unproved premise under a goal | `verification.assumptions: forbid` and the `GOAL_ASSUMED` error |
| `PROOF_EMPTY` was an error | a warning; the fact is `open` |
| cycle participants were checked locally | cycle participants are `broken` and are not sent |
| `local_verification` was `status` plus `outcome` | one `status` field plus a required `reason` |
| written-back `status=` was `verified` or `rejected` | `verified`, `disproved`, or `rejected` |
| counters `global_invalid`, `local_errors` | `global_broken`, `global_open`, `global_abandoned`; `local_errors` folded into `local_not_run` |
| counter `invalid_cache_entries` | `unusable_cache_entries` |
| finding `invalid_evidence_dependents`, filter `--stale-affected-by` | removed; both were driven by diagnostics no code ever emitted |
| `verified` `disproved` `rejected` `blocked` `abandoned` `missing` | unchanged |

The output schema version moves from 6 to 7 and the project contract from 24 to
25. Published snapshots written under schema 6 are discarded and recomputed.
Cached verifier verdicts survive: the verdicts themselves did not change, only
the composition around them, so no re-verification is triggered.

`.assumed` is designed here and not yet built. Until it is,
`skills/qmd-prover/references/status.md` and `references/config.md` stay silent
about it on purpose: the shipped skill describes what the engine does, and it
must not tell an agent to write an attribute the engine ignores. Sync both files
in the same change that implements this section.

Adding `.assumed` moves the output schema from 7 to 8, for the new `intent`
value, the new `not-run` reason, the `assumptions` field on
`global_verification`, and the new `--set assumed`. The project contract moves
from 27 to 28, because a project written against the old contract may use
`.draft` for both meanings and its author has to be told the two have separated.
Cached verdicts again survive untouched: no fact that was sent before is sent
differently, and `.assumed` only ever removes a fact from what is sent.

There are no body markers. `OPEN`, `REJECTED`, `DISPROVED`, `VERIFIED`, and
`REVOKED` have no meaning anywhere in QMD source; they are ordinary words. All
author intent lives in div attributes.
