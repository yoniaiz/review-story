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

    expect(events[0]?.type).toBe("story.skeleton");
    expect(events.filter((event) => event.type === "story.chapter")).toHaveLength(3);
    expect(events.at(-1)?.type).toBe("story.ready");
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
