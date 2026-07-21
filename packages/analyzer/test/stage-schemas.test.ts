import { describe, expect, it } from "vitest";
import { Stage1OutputSchema } from "../src/stage-schemas.js";

describe("Stage1OutputSchema", () => {
  it("rejects more than ten context requests", () => {
    const output = {
      tracks: [{ id: "main", title: "Main", chapter_order: ["chapter"] }],
      chapters: [{
        id: "chapter",
        title: "Chapter",
        track_id: "main",
        files: ["src/a.ts"],
      }],
      appendix: [],
      context_requests: Array.from({ length: 11 }, (_, index) => ({
        path: `src/context-${index}.ts`,
        chapter_ids: ["chapter"],
        reason: "Needed for context",
      })),
    };

    expect(Stage1OutputSchema.safeParse(output).success).toBe(false);
  });
});
