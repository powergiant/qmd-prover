import type { buildProjectInspectionIndex } from '../skills/qmd-prover/src/lib/inspection/index.js';
import type { verifyFacts } from '../skills/qmd-prover/src/lib/inspection/verify.js';
import type { Compilation, InspectionVerificationSummary, JsonObject } from '../skills/qmd-prover/src/lib/shared/types.js';

type IsAny<T> = 0 extends (1 & T) ? true : false;
type Assert<T extends true> = T;
type ProjectIndex = Awaited<ReturnType<typeof buildProjectInspectionIndex>>;
type VerificationRun = Awaited<ReturnType<typeof verifyFacts>>;

// These compile-time contracts prevent broad dynamic types from leaking from
// the shared project index or the verification driver into public inspection APIs.
type CompilationIsNotAny = Assert<IsAny<ProjectIndex['compilation']> extends false ? true : false>;
type CompilationIsExact = Assert<ProjectIndex['compilation'] extends Compilation ? true : false>;
type VerificationIsExact = Assert<VerificationRun['verification'] extends InspectionVerificationSummary ? true : false>;
type JsonBoundaryIsNotAny = Assert<IsAny<JsonObject[string]> extends false ? true : false>;

export type StrictTypeContracts = CompilationIsNotAny | CompilationIsExact | VerificationIsExact | JsonBoundaryIsNotAny;
