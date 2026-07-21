import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  StoryArtifactSchema,
  type AnalyzeRequest,
  type Analyzer,
  type AnalyzerContext,
  type StoryArtifact,
  type StoryStreamEvent,
} from "@review-story/contracts";

const bundledFixturePath = fileURLToPath(
  new URL("../../../fixtures/mock-artifact.json", import.meta.url),
);
const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));

export interface StaticAnalyzerOptions {
  fixturePath?: string;
  streamDelayMs?: number;
}

export class StaticAnalyzer implements Analyzer {
  readonly #fixturePath: string;
  readonly #streamDelayMs: number;

  constructor(options: StaticAnalyzerOptions = {}) {
    this.#fixturePath = options.fixturePath
      ? isAbsolute(options.fixturePath)
        ? options.fixturePath
        : resolve(workspaceRoot, options.fixturePath)
      : bundledFixturePath;
    this.#streamDelayMs = options.streamDelayMs ?? 180;
  }

  async analyze(
    request: AnalyzeRequest,
    _context: AnalyzerContext = {},
  ): Promise<StoryArtifact> {
    const source = await readFile(this.#fixturePath, "utf8");
    const artifact = StoryArtifactSchema.parse(JSON.parse(source));
    if (artifact.meta.pr !== request.pullNumber) {
      throw new Error(
        `Static fixture is for PR #${artifact.meta.pr}, not requested PR #${request.pullNumber}`,
      );
    }
    return artifact;
  }

  async *stream(
    request: AnalyzeRequest,
    context: AnalyzerContext = {},
  ): AsyncIterable<StoryStreamEvent> {
    const artifact = await this.analyze(request, context);
    if (context.signal?.aborted) return;
    const skeleton: StoryStreamEvent = {
      type: "story.skeleton",
      data: {
        meta: { ...artifact.meta, status: "GENERATING" },
        tracks: artifact.tracks,
        chapters: artifact.chapters.map(({ id, title }) => ({ id, title })),
        appendix: artifact.appendix,
      },
    };
    yield skeleton;

    for (const chapter of artifact.chapters) {
      await delay(this.#streamDelayMs, context.signal);
      if (context.signal?.aborted) return;
      yield { type: "story.chapter", data: chapter };
    }

    if (context.signal?.aborted) return;
    yield { type: "story.ready", data: artifact };
  }
}

export function createAnalyzer(): Analyzer {
  const configuredDelay = Number(process.env.STREAM_DELAY_MS ?? "180");
  return new StaticAnalyzer({
    ...(process.env.STORY_FIXTURE_PATH
      ? { fixturePath: process.env.STORY_FIXTURE_PATH }
      : {}),
    streamDelayMs: Number.isFinite(configuredDelay) ? configuredDelay : 180,
  });
}

function delay(durationMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolveDelay) => {
    const timeout = setTimeout(resolveDelay, durationMs);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        resolveDelay();
      },
      { once: true },
    );
  });
}
