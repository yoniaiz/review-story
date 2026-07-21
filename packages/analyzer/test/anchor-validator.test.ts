import { describe, expect, it } from "vitest";
import { validateClaim, validateEvidenceAnchors } from "../src/anchor-validator.js";

describe("anchor validator", () => {
  const lines = new Map([
    ["src/api.ts", 20],
    ["src/context.ts", 8],
  ]);

  it("keeps valid anchors and clamps overshooting ranges", () => {
    expect(
      validateEvidenceAnchors(
        [{ path: "src/api.ts", lines: [5, 50] }],
        lines,
      ).value,
    ).toEqual([{ path: "src/api.ts", lines: [5, 20] }]);
  });

  it("drops unknown anchors and claims left without evidence", () => {
    const result = validateClaim(
      {
        text: "Unknown behavior",
        kind: "inferred",
        evidence: [{ path: "src/missing.ts", lines: [1, 2] }],
      },
      lines,
    );
    expect(result.value).toBeNull();
    expect(result.droppedAnchors).toBe(1);
    expect(result.droppedClaims).toBe(1);
  });

  it("keeps changed and context anchors while dropping misses", () => {
    const result = validateEvidenceAnchors(
      [
        { path: "src/api.ts", lines: [-5, 3] },
        { path: "src/context.ts", lines: [7, 99] },
        { path: "src/api.ts", lines: [30, 40] },
        { path: "src/api.ts", lines: [9, 4] },
      ],
      lines,
    );

    expect(result.value).toEqual([
      { path: "src/api.ts", lines: [1, 3] },
      { path: "src/context.ts", lines: [7, 8] },
    ]);
    expect(result.droppedAnchors).toBe(2);
  });

  it("keeps a claim when at least one anchor survives", () => {
    const result = validateClaim(
      {
        text: "  The API delegates through shared context.  ",
        kind: "inferred",
        evidence: [
          { path: "missing.ts", lines: [1, 2] },
          { path: "src/context.ts", lines: [2, 4] },
        ],
      },
      lines,
    );

    expect(result.value).toEqual({
      text: "The API delegates through shared context.",
      kind: "inferred",
      evidence: [{ path: "src/context.ts", lines: [2, 4] }],
    });
    expect(result.droppedAnchors).toBe(1);
    expect(result.droppedClaims).toBe(0);
  });
});
