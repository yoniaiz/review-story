import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StaticAnalyzer } from "@review-story/analyzer";
import type {
  AnalyzeRequest,
  AnalyzeResult,
  Analyzer,
  AnalyzerContext,
  StoryStreamEvent,
} from "@review-story/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { StoryCache } from "../src/story-cache.js";
import { StoryService } from "../src/story-service.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

describe("story service generation sharing", () => {
  it("keeps a shared generation alive when one of two consumers disconnects", async () => {
    const analyzer = new GatedAnalyzer();
    const service = await fixture(analyzer);
    const firstController = new AbortController();
    const secondController = new AbortController();
    const first = service
      .stream(request, firstController.signal)
      [Symbol.asyncIterator]();
    const second = service
      .stream(request, secondController.signal)
      [Symbol.asyncIterator]();

    const [firstEvent, secondEvent] = await Promise.all([
      first.next(),
      second.next(),
    ]);
    expect(firstEvent.value?.type).toBe("story.skeleton");
    expect(secondEvent.value?.type).toBe("story.skeleton");
    expect(analyzer.streamCalls).toBe(1);

    firstController.abort();
    await first.return?.();
    expect(analyzer.aborted).toBe(false);

    analyzer.release();
    const remaining: StoryStreamEvent[] = [];
    for (;;) {
      const event = await second.next();
      if (event.done) break;
      remaining.push(event.value);
    }
    expect(remaining.map((event) => event.type)).toEqual(["story.ready"]);
    expect(analyzer.aborted).toBe(false);
  });

  it("starts a fresh job when a consumer reconnects during cancellation", async () => {
    const analyzer = new ReconnectingAnalyzer();
    const service = await fixture(analyzer);
    const firstController = new AbortController();
    const first = service
      .stream(request, firstController.signal)
      [Symbol.asyncIterator]();

    expect((await first.next()).value?.type).toBe("story.skeleton");
    firstController.abort();
    await first.return?.();

    const replayed: StoryStreamEvent[] = [];
    for await (const event of service.stream(request)) replayed.push(event);
    expect(analyzer.streamCalls).toBe(2);
    expect(replayed.at(-1)?.type).toBe("story.ready");
  });
});

const request: AnalyzeRequest = {
  owner: "acme",
  repo: "review-story-demo",
  pullNumber: 123,
};

async function fixture(analyzer: Analyzer): Promise<StoryService> {
  const directory = await mkdtemp(join(tmpdir(), "review-story-service-"));
  temporaryDirectories.push(directory);
  return new StoryService(analyzer, new StoryCache(directory));
}

class GatedAnalyzer implements Analyzer {
  readonly #delegate = new StaticAnalyzer({ streamDelayMs: 0 });
  readonly #released: Promise<void>;
  readonly #resolveRelease: () => void;
  streamCalls = 0;
  aborted = false;

  constructor() {
    let resolveRelease!: () => void;
    this.#released = new Promise<void>((resolve) => {
      resolveRelease = resolve;
    });
    this.#resolveRelease = resolveRelease;
  }

  identify(request: AnalyzeRequest, context?: AnalyzerContext) {
    return this.#delegate.identify(request, context);
  }

  analyze(request: AnalyzeRequest, context?: AnalyzerContext) {
    return this.#delegate.analyze(request, context);
  }

  release(): void {
    this.#resolveRelease();
  }

  async *stream(
    request: AnalyzeRequest,
    context: AnalyzerContext = {},
  ): AsyncIterable<StoryStreamEvent> {
    this.streamCalls += 1;
    const result = await this.#delegate.analyze(request);
    yield skeletonFor(result);
    await Promise.race([
      this.#released,
      new Promise<void>((resolve) => {
        const abort = () => {
          this.aborted = true;
          resolve();
        };
        if (context.signal?.aborted) abort();
        else context.signal?.addEventListener("abort", abort, { once: true });
      }),
    ]);
    if (context.signal?.aborted) return;
    await context.onResult?.(result);
    yield { type: "story.ready", data: result.artifact };
  }
}

class ReconnectingAnalyzer implements Analyzer {
  readonly #delegate = new StaticAnalyzer({ streamDelayMs: 0 });
  streamCalls = 0;

  identify(request: AnalyzeRequest, context?: AnalyzerContext) {
    return this.#delegate.identify(request, context);
  }

  analyze(request: AnalyzeRequest, context?: AnalyzerContext) {
    return this.#delegate.analyze(request, context);
  }

  async *stream(
    request: AnalyzeRequest,
    context: AnalyzerContext = {},
  ): AsyncIterable<StoryStreamEvent> {
    this.streamCalls += 1;
    if (this.streamCalls > 1) {
      yield* this.#delegate.stream(request, context);
      return;
    }

    const result = await this.#delegate.analyze(request);
    yield skeletonFor(result);
    await new Promise<void>((resolve) => {
      const abort = () => resolve();
      if (context.signal?.aborted) abort();
      else context.signal?.addEventListener("abort", abort, { once: true });
    });
  }
}

function skeletonFor(result: AnalyzeResult): StoryStreamEvent {
  const artifact = result.artifact;
  return {
    type: "story.skeleton",
    data: {
      meta: { ...artifact.meta, status: "GENERATING" },
      tracks: artifact.tracks.map(({ id, title, chapter_order }) => ({
        id,
        title,
        chapter_order,
      })),
      chapters: artifact.chapters.map(({ id, title }) => ({ id, title })),
      appendix: artifact.appendix,
    },
  };
}
