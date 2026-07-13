import type { inspectCanonicalScope } from '../skills/qmd-prover/src/lib/verification/canonical.js';
import type { Compilation, JsonObject } from '../skills/qmd-prover/src/lib/shared/types.js';

type IsAny<T> = 0 extends (1 & T) ? true : false;
type Assert<T extends true> = T;
type CanonicalInspection = Awaited<ReturnType<typeof inspectCanonicalScope>>;

// These compile-time contracts prevent broad dynamic types from leaking back
// into inspectProject through inspectCanonicalScope.
type CompilationIsNotAny = Assert<IsAny<CanonicalInspection['compilation']> extends false ? true : false>;
type CompilationIsExact = Assert<CanonicalInspection['compilation'] extends Compilation ? true : false>;
type JsonBoundaryIsNotAny = Assert<IsAny<JsonObject[string]> extends false ? true : false>;

export type StrictTypeContracts = CompilationIsNotAny | CompilationIsExact | JsonBoundaryIsNotAny;
