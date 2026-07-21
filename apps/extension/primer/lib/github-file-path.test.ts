import { describe, expect, it } from "vitest";
import { normalizeGitHubFilePath } from "./github-file-path";

describe("GitHub file path normalization", () => {
  it("removes directional marks added around current diff-header labels", () => {
    expect(normalizeGitHubFilePath(
      "\u200Epackages/twenty-front/src/generated-metadata/graphql.ts\u200E",
    )).toBe("packages/twenty-front/src/generated-metadata/graphql.ts");
  });

  it("preserves ordinary spaces inside file names", () => {
    expect(normalizeGitHubFilePath(" docs/My Guide.md ")).toBe("docs/My Guide.md");
  });
});
