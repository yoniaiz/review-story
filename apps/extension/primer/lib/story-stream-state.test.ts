import type { Chapter } from "@review-story/contracts";
import { describe, expect, it } from "vitest";
import { upsertGeneratedChapter } from "./story-stream-state";

describe("upsertGeneratedChapter", () => {
  it("retains chapters as progressive events arrive without duplicating replays", () => {
    const first = chapter("chapter-one");
    const second = chapter("chapter-two");

    const withFirst = upsertGeneratedChapter([], first);
    const withSecond = upsertGeneratedChapter(withFirst, second);
    const replayed = upsertGeneratedChapter(withSecond, first);

    expect(replayed.map(({ id }) => id)).toEqual([first.id, second.id]);
  });
});

function chapter(id: string): Chapter {
  return {
    id,
    title: id,
    summary: {
      kind: "observed",
      text: `${id} summary`,
      evidence: [{ path: "src/app.ts", lines: [1, 1] }],
    },
    files: [{ path: "src/app.ts", note: "Changed app", anchor_hunks: [[1, 1]] }],
    scrutinize: [],
    related_tests: {
      status: "not_searched",
      note: "Not searched",
      search_scope: "test files",
    },
    attention: { level: "STANDARD", floor: "STANDARD", reasons: ["Core behavior"] },
  };
}
