import { describe, expect, it } from "vitest";
import { createFallbackCommentDraft, parseCommentCommand } from "./comment-draft";

describe("comment drafting", () => {
  it("parses the comment skill and preserves an explicit draft", () => {
    expect(parseCommentCommand("/comment Please add a regression test.")).toEqual({
      kind: "comment",
      instruction: "Please add a regression test.",
    });
    expect(parseCommentCommand("  /COMMENT  ")).toEqual({ kind: "comment" });
    expect(parseCommentCommand("explain this")).toBeUndefined();
  });

  it("uses explicit reviewer text before the deterministic grounded fallback", () => {
    expect(createFallbackCommentDraft("Please rename this.", "ignored")).toBe("Please rename this.");
    expect(createFallbackCommentDraft(undefined, "  Verify the weekly layout branch.  "))
      .toContain("Verify the weekly layout branch.");
  });
});

