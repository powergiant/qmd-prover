/**
 * Cross-cutting contracts shared by every layer. Domain types live with the code
 * that owns them — the semantic model in `semantic/`, verification verdicts in
 * `verification/`, config in `infrastructure/config.ts`, and so on. Only the
 * genuinely universal vocabulary (JSON values, diagnostics, the operation-result
 * envelope, and the options bag threaded through the pipeline) belongs here.
 */
export {};
