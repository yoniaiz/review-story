import type { Analyzer } from "@review-story/contracts";
import { PipelineAnalyzer, type PipelineAnalyzerOptions } from "./pipeline.js";

export * from "./anchor-validator.js";
export * from "./assembler.js";
export * from "./config.js";
export * from "./diff-snapshot.js";
export * from "./manifest-builder.js";
export * from "./pipeline.js";
export * from "./stage-schemas.js";
export * from "./static-analyzer.js";
export * from "./symbol-extractor.js";
export * from "./workspace.js";

export function createAnalyzer(options: PipelineAnalyzerOptions = {}): Analyzer {
  const configuredMode = process.env.ANALYZER_MODE === "deterministic"
    ? "deterministic"
    : undefined;
  return new PipelineAnalyzer({
    ...(configuredMode ? { mode: configuredMode } : {}),
    ...options,
  });
}
