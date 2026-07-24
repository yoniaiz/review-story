import { describe, expect, it } from "vitest";
import type { PrimerContext } from "@review-story/contracts";
import type { ReviewPlan } from "./review-plan";
import { applyAuthorRiskAreas, unmatchedRiskAreas } from "./author-context";

const plan = {
  repo: "acme/demo",
  pr: 1,
  headSha: "abc",
  title: "t",
  stats: { totalFiles: 2, noiseFiles: 0, chapters: 1 },
  chapters: [],
  files: [
    { id: "a.ts", path: "a.ts", chapterId: "ch1", severity: "noise", noiseReason: null, summary: "adds a" },
    { id: "b.ts", path: "b.ts", chapterId: "ch1", severity: "standard", noiseReason: null, summary: "adds b" },
  ],
  graph: { nodes: [], edges: [] },
} as unknown as ReviewPlan;

const context: PrimerContext = {
  schema: 1,
  intent: "x",
  risk_areas: [
    { path: "a.ts", note: "concurrency" },
    { path: "missing.ts" },
  ],
};

describe("applyAuthorRiskAreas", () => {
  it("elevates matching files to needs-human and appends the author note", () => {
    const merged = applyAuthorRiskAreas(plan, context);
    const a = merged.files.find(({ path }) => path === "a.ts");
    expect(a?.severity).toBe("needs-human");
    expect(a?.summary).toContain("author flagged: concurrency");
    expect(merged.files.find(({ path }) => path === "b.ts")?.severity).toBe("standard");
  });

  it("returns the plan unchanged without risk areas", () => {
    expect(applyAuthorRiskAreas(plan, { schema: 1, intent: "x" })).toBe(plan);
  });
});

describe("unmatchedRiskAreas", () => {
  it("reports risk paths that match no changed file", () => {
    expect(unmatchedRiskAreas(plan, context)).toEqual(["missing.ts"]);
  });
});
