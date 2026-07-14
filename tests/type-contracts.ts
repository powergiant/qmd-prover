import type { buildProjectInspectionIndex } from '../skills/qmd-prover/src/lib/inspection/index.js';
import type { inspectWorkspace } from '../skills/qmd-prover/src/lib/workspace/inspect.js';
import type { Compilation, JsonObject, WorkspaceInspectResult } from '../skills/qmd-prover/src/lib/shared/types.js';

type IsAny<T> = 0 extends (1 & T) ? true : false;
type Assert<T extends true> = T;
type ProjectIndex = Awaited<ReturnType<typeof buildProjectInspectionIndex>>;
type WorkspaceInspection = Awaited<ReturnType<typeof inspectWorkspace>>;

// These compile-time contracts prevent broad dynamic types from leaking from
// the shared project index or workspace verifier into public inspection APIs.
type CompilationIsNotAny = Assert<IsAny<ProjectIndex['goalsCompilation']> extends false ? true : false>;
type CompilationIsExact = Assert<ProjectIndex['goalsCompilation'] extends Compilation ? true : false>;
type WorkspaceIsExact = Assert<WorkspaceInspection extends WorkspaceInspectResult ? true : false>;
type JsonBoundaryIsNotAny = Assert<IsAny<JsonObject[string]> extends false ? true : false>;

export type StrictTypeContracts = CompilationIsNotAny | CompilationIsExact | WorkspaceIsExact | JsonBoundaryIsNotAny;
