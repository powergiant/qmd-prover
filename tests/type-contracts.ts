import type { compileProject } from '../skills/qmd-prover/src/lib/semantic/compiler.js';
import type { verifyFacts } from '../skills/qmd-prover/src/lib/inspection/verify.js';
import type { JsonObject } from '../skills/qmd-prover/src/lib/shared/types.js';
import type { InspectionVerificationSummary } from '../skills/qmd-prover/src/lib/inspection/verify.js';
import type { Compilation } from '../skills/qmd-prover/src/lib/semantic/compiler.js';

type IsAny<T> = 0 extends (1 & T) ? true : false;
type Assert<T extends true> = T;
type CompilationResult = Awaited<ReturnType<typeof compileProject>>;
type VerificationRun = Awaited<ReturnType<typeof verifyFacts>>;

// These compile-time contracts prevent broad dynamic types from leaking from
// the compiler or the verification driver into public inspection APIs.
type CompilationIsNotAny = Assert<IsAny<CompilationResult> extends false ? true : false>;
type CompilationIsExact = Assert<CompilationResult extends Compilation ? true : false>;
type VerificationIsExact = Assert<VerificationRun['verification'] extends InspectionVerificationSummary ? true : false>;
type JsonBoundaryIsNotAny = Assert<IsAny<JsonObject[string]> extends false ? true : false>;

export type StrictTypeContracts = CompilationIsNotAny | CompilationIsExact | VerificationIsExact | JsonBoundaryIsNotAny;
