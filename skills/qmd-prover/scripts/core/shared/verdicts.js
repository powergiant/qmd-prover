// The verifier result vocabulary: the verdict, report, and run-cost types shared
// across the engine. Semantic results carry these as overlaid status, the
// verification protocol produces them, the graph folds them into global status,
// and the CLI output renders them. They are pure data with no dependency on the
// protocol machinery, so they live in shared where every layer may name them.
export {};
