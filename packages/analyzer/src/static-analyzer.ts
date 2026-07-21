import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AnalyzeResultSchema,
  StoryArtifactSchema,
  StorySkeletonSchema,
  type AnalyzeRequest,
  type AnalyzeResult,
  type Analyzer,
  type AnalyzerContext,
  type StoryArtifact,
  type StoryCacheIdentity,
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

  async identify(
    request: AnalyzeRequest,
    context: AnalyzerContext = {},
  ): Promise<StoryCacheIdentity> {
    const artifact = await this.#artifact(request, context);
    return {
      repo_node_id: artifact.meta.repo_node_id,
      pr: artifact.meta.pr,
      head_oid: artifact.meta.head_oid,
      versions: artifact.meta.versions,
    };
  }

  async analyze(
    request: AnalyzeRequest,
    context: AnalyzerContext = {},
  ): Promise<AnalyzeResult> {
    const artifact = await this.#artifact(request, context);
    const paths = [
      ...artifact.chapters.flatMap((chapter) => chapter.files.map((file) => file.path)),
      ...artifact.appendix.files,
    ];
    const result = AnalyzeResultSchema.parse({
      artifact,
      diff_snapshot: {
        repo_node_id: artifact.meta.repo_node_id,
        pr: artifact.meta.pr,
        base_oid: artifact.meta.head_oid,
        head_oid: artifact.meta.head_oid,
        files: paths.map((path) => ({
          path,
          previous_path: null,
          status: "modified",
          additions: 0,
          deletions: 0,
          changes: 0,
          patch: null,
          patch_hash: createHash("sha256").update(path).digest("hex"),
        })),
      },
      usage: {
        stages: [],
        total_input_tokens: 0,
        total_output_tokens: 0,
        total_cost_usd: 0,
      },
    });
    await context.onResult?.(result);
    return result;
  }

  async *stream(
    request: AnalyzeRequest,
    context: AnalyzerContext = {},
  ): AsyncIterable<StoryStreamEvent> {
    const result = await this.analyze(request, context);
    const artifact = result.artifact;
    if (context.signal?.aborted) return;
    const skeleton = StorySkeletonSchema.parse({
      meta: { ...artifact.meta, status: "GENERATING" },
      tracks: artifact.tracks.map(({ id, title, chapter_order }) => ({
        id,
        title,
        chapter_order,
      })),
      chapters: artifact.chapters.map(({ id, title }) => ({ id, title })),
      appendix: artifact.appendix,
    });
    yield {
      type: "story.skeleton",
      data: skeleton,
    };
    for (const chapter of artifact.chapters) {
      await delay(this.#streamDelayMs, context.signal);
      if (context.signal?.aborted) return;
      yield { type: "story.chapter", data: chapter };
    }
    if (!context.signal?.aborted) yield { type: "story.ready", data: artifact };
  }

  async #artifact(
    request: AnalyzeRequest,
    context: AnalyzerContext,
  ): Promise<StoryArtifact> {
    if (context.signal?.aborted) throw context.signal.reason ?? new Error("Aborted");
    const source = await readFile(this.#fixturePath, "utf8");
    const artifact = StoryArtifactSchema.parse(JSON.parse(source));
    if (artifact.meta.pr !== request.pullNumber) {
      throw new Error(
        `Static fixture is for PR #${artifact.meta.pr}, not requested PR #${request.pullNumber}`,
      );
    }
    return artifact;
  }
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
