import { describe, expect, it } from "vitest";
import { createDiffAnchor, normalizeDiffSide, parseDiffCellId } from "./github-diff-anchor";

describe("GitHub diff anchors", () => {
  it("normalizes GitHub left and right side labels", () => {
    expect(normalizeDiffSide("left")).toBe("LEFT");
    expect(normalizeDiffSide("R")).toBe("RIGHT");
    expect(normalizeDiffSide("deletion")).toBe("LEFT");
    expect(normalizeDiffSide("addition")).toBe("RIGHT");
    expect(normalizeDiffSide("context")).toBeUndefined();
  });

  it("reads classic GitHub diff cell ids", () => {
    expect(parseDiffCellId("diff-deadbeefL42")).toEqual({ line: 42, side: "LEFT" });
    expect(parseDiffCellId("diff-deadbeefR107")).toEqual({ line: 107, side: "RIGHT" });
    expect(parseDiffCellId("diff-deadbeef")).toBeUndefined();
  });

  it("creates a normalized same-side multiline anchor", () => {
    expect(createDiffAnchor({
      headSha: "abc123",
      selectionStart: { path: "src/app.ts", line: 15, side: "RIGHT" },
      point: { path: "src/app.ts", line: 11, side: "RIGHT" },
      selectedText: "  const value = true;  ",
      excerpt: "  11 + const value = true;  ",
    })).toEqual({
      path: "src/app.ts",
      headSha: "abc123",
      startLine: 11,
      line: 15,
      startSide: "RIGHT",
      side: "RIGHT",
      selectedText: "const value = true;",
      excerpt: "11 + const value = true;",
    });
  });

  it("does not create an invalid cross-side or cross-file range", () => {
    expect(createDiffAnchor({
      headSha: "abc123",
      selectionStart: { path: "src/old.ts", line: 4, side: "LEFT" },
      point: { path: "src/new.ts", line: 8, side: "RIGHT" },
    })).toEqual({ path: "src/new.ts", headSha: "abc123", line: 8, side: "RIGHT" });
  });
});

