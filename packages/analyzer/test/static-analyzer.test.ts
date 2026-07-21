import {
  AnalyzeResultSchema,
  StorySkeletonSchema,
} from "@review-story/contracts";
import { describe, expect, it } from "vitest";
import { StaticAnalyzer } from "../src/index.js";

describe("StaticAnalyzer", () => {
  it("streams skeleton, chapters, and a ready artifact", async () => {
    const analyzer = new StaticAnalyzer({ streamDelayMs: 0 });
    const events = [];

    for await (const event of analyzer.stream({
      owner: "acme",
      repo: "review-story-demo",
      pullNumber: 123,
    })) {
      events.push(event);
    }

    const skeletonEvent = events[0];
    expect(skeletonEvent?.type).toBe("story.skeleton");
    if (!skeletonEvent || skeletonEvent.type !== "story.skeleton") {
      throw new Error("StaticAnalyzer did not emit a skeleton first");
    }
    expect(StorySkeletonSchema.safeParse(skeletonEvent.data).success).toBe(true);
    expect(skeletonEvent.data.tracks[0]).toEqual({
      id: "trk_refresh",
      title: "Refresh-token rotation",
      chapter_order: ["ch_schema", "ch_api", "ch_login_ui"],
    });
    expect(skeletonEvent.data.tracks[0]).not.toHaveProperty("entry_points");
    expect(skeletonEvent.data.tracks[0]).not.toHaveProperty("flow");
    expect(events.filter((event) => event.type === "story.chapter")).toHaveLength(3);
    expect(events.at(-1)?.type).toBe("story.ready");
  });

  it("returns a complete schema-valid analyzer result", async () => {
    const analyzer = new StaticAnalyzer({ streamDelayMs: 0 });
    const result = await analyzer.analyze({
      owner: "acme",
      repo: "review-story-demo",
      pullNumber: 123,
    });

    expect(AnalyzeResultSchema.safeParse(result).success).toBe(true);
    expect(result.artifact.meta.status).toBe("READY");
    expect(result.diff_snapshot.files).not.toHaveLength(0);
    expect(result.usage).toEqual({
      stages: [],
      total_input_tokens: 0,
      total_output_tokens: 0,
      total_cost_usd: 0,
    });
  });

  it("stops streaming when its consumer aborts", async () => {
    const analyzer = new StaticAnalyzer({ streamDelayMs: 10_000 });
    const abortController = new AbortController();
    const events = analyzer.stream(
      { owner: "acme", repo: "review-story-demo", pullNumber: 123 },
      { signal: abortController.signal },
    )[Symbol.asyncIterator]();

    expect((await events.next()).value?.type).toBe("story.skeleton");
    const pendingChapter = events.next();
    abortController.abort();

    expect((await pendingChapter).done).toBe(true);
  });
});
