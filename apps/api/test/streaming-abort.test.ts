import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StaticAnalyzer } from "@review-story/analyzer";
import type {
  AnalyzeRequest,
  Analyzer,
  AnalyzerContext,
  StoryCacheIdentity,
  StoryStreamEvent,
} from "@review-story/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { StoryCache } from "../src/story-cache.js";
import { StoryService } from "../src/story-service.js";

const temporaryDirectories: string[] = [];
const apps: Awaited<ReturnType<typeof buildApp>>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true })
    ),
  );
});

describe("story SSE disconnects", () => {
  it("aborts the analyzer when the final streaming client disconnects", async () => {
    const analyzer = new AbortObservingAnalyzer();
    const cacheDirectory = await mkdtemp(join(tmpdir(), "review-story-stream-"));
    temporaryDirectories.push(cacheDirectory);
    const app = await buildApp({ analyzer, cacheDirectory });
    apps.push(app);
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const requestController = new AbortController();

    const response = await fetch(
      `${address}/api/prs/acme/review-story-demo/pulls/123/story/stream`,
      { signal: requestController.signal },
    );
    expect(response.status).toBe(200);

    const firstChunk = await response.body?.getReader().read();
    expect(new TextDecoder().decode(firstChunk?.value)).toContain(
      "event: story.skeleton",
    );

    requestController.abort();

    await expect(analyzer.abortObserved).resolves.toBeUndefined();
  });

  it("aborts the analyzer when a REST client disconnects", async () => {
    const analyzer = new AbortObservingAnalyzer();
    const cacheDirectory = await mkdtemp(join(tmpdir(), "review-story-rest-"));
    temporaryDirectories.push(cacheDirectory);
    const app = await buildApp({ analyzer, cacheDirectory });
    apps.push(app);
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const requestController = new AbortController();

    const response = fetch(
      `${address}/api/prs/acme/review-story-demo/pulls/123/story`,
      { signal: requestController.signal },
    );
    await analyzer.streamStarted;
    requestController.abort();

    await expect(response).rejects.toThrow();
    await expect(analyzer.abortObserved).resolves.toBeUndefined();
  });

  it("does not start generation if the client disconnects during cache lookup", async () => {
    const cacheDirectory = await mkdtemp(join(tmpdir(), "review-story-stream-"));
    temporaryDirectories.push(cacheDirectory);
    const cache = new BlockingCache(cacheDirectory);
    const analyzer = new NeverStartedAnalyzer();
    const stories = new StoryService(analyzer, cache);
    const controller = new AbortController();
    const iterator = stories.stream(
      { owner: "acme", repo: "review-story-demo", pullNumber: 123 },
      controller.signal,
    )[Symbol.asyncIterator]();
    const firstEvent = iterator.next();

    await cache.readStarted;
    controller.abort(new Error("Client disconnected during cache lookup"));
    cache.releaseRead();

    await expect(firstEvent).rejects.toThrow("Client disconnected during cache lookup");
    expect(analyzer.streamCalls).toBe(0);
  });
});

class AbortObservingAnalyzer implements Analyzer {
  readonly #delegate = new StaticAnalyzer({ streamDelayMs: 0 });
  readonly abortObserved: Promise<void>;
  readonly streamStarted: Promise<void>;
  readonly #resolveAbort: () => void;
  readonly #resolveStreamStarted: () => void;

  constructor() {
    let resolveAbort!: () => void;
    let resolveStreamStarted!: () => void;
    this.abortObserved = new Promise<void>((resolve) => {
      resolveAbort = resolve;
    });
    this.streamStarted = new Promise<void>((resolve) => {
      resolveStreamStarted = resolve;
    });
    this.#resolveAbort = resolveAbort;
    this.#resolveStreamStarted = resolveStreamStarted;
  }

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
    this.#resolveStreamStarted();
    const result = await this.#delegate.analyze(request);
    const artifact = result.artifact;
    yield {
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

    if (!context.signal) throw new Error("Expected the API to provide an abort signal");
    await new Promise<void>((resolve) => {
      const abort = () => {
        this.#resolveAbort();
        resolve();
      };
      if (context.signal!.aborted) abort();
      else context.signal!.addEventListener("abort", abort, { once: true });
    });
  }
}

class NeverStartedAnalyzer implements Analyzer {
  readonly #delegate = new StaticAnalyzer({ streamDelayMs: 0 });
  streamCalls = 0;

  identify(request: AnalyzeRequest, context?: AnalyzerContext) {
    return this.#delegate.identify(request, context);
  }

  analyze(request: AnalyzeRequest, context?: AnalyzerContext) {
    return this.#delegate.analyze(request, context);
  }

  stream(request: AnalyzeRequest, context?: AnalyzerContext) {
    this.streamCalls += 1;
    return this.#delegate.stream(request, context);
  }
}

class BlockingCache extends StoryCache {
  readonly readStarted: Promise<void>;
  readonly #markReadStarted: () => void;
  readonly #readReleased: Promise<void>;
  readonly releaseRead: () => void;

  constructor(directory: string) {
    super(directory);
    let markReadStarted!: () => void;
    this.readStarted = new Promise<void>((resolve) => {
      markReadStarted = resolve;
    });
    this.#markReadStarted = markReadStarted;
    let releaseRead!: () => void;
    this.#readReleased = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    this.releaseRead = releaseRead;
  }

  override async read(_identity: StoryCacheIdentity): Promise<null> {
    this.#markReadStarted();
    await this.#readReleased;
    return null;
  }
}
