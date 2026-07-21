import Anthropic from "@anthropic-ai/sdk";
import { StoryStreamEventSchema } from "@review-story/contracts";
import { describe, expect, it } from "vitest";
import { loadAnalyzerConfig } from "../src/config.js";
import { PipelineAnalyzer } from "../src/pipeline.js";

describe("real pipeline streaming", () => {
  it("emits each stage as it resolves and streams Stage 3's authoritative order", async () => {
    const stage2Gates = {
      "src/a.ts": deferred<void>(),
      "src/b.ts": deferred<void>(),
    };
    const stage2Started = {
      "src/a.ts": deferred<void>(),
      "src/b.ts": deferred<void>(),
    };
    const stage3Gate = deferred<void>();
    const stage3Started = deferred<void>();
    const client = {
      messages: {
        parse: async (parameters: { messages: Array<{ content: string }> }) => {
          const prompt = parameters.messages[0]!.content;
          if (prompt.startsWith("Return the review outline")) {
            return modelResponse(stage1Outline([
              ["chapter-a", "src/a.ts"],
              ["chapter-b", "src/b.ts"],
            ]));
          }
          if (prompt.startsWith("Synthesize the final story")) {
            stage3Started.resolve();
            await stage3Gate.promise;
            return modelResponse(stage3Synthesis());
          }
          const path = stage2PromptPath(prompt) as keyof typeof stage2Gates;
          stage2Started[path].resolve();
          await stage2Gates[path].promise;
          return modelResponse(stage2Card(path));
        },
      },
    } as unknown as Anthropic;
    const analyzer = analyzerFor(
      [changedFile("src/a.ts"), changedFile("src/b.ts")],
      client,
      3,
    );
    const iterator = analyzer.stream({
      owner: "acme",
      repo: "demo",
      pullNumber: 1,
    })[Symbol.asyncIterator]();

    const skeleton = StoryStreamEventSchema.parse((await iterator.next()).value);
    expect(skeleton.type).toBe("story.skeleton");
    if (skeleton.type !== "story.skeleton") {
      throw new Error("Expected the skeleton before any chapter completed");
    }
    expect(skeleton.data.chapters.map(({ id }) => id)).toEqual([
      "chapter-a",
      "chapter-b",
    ]);

    await Promise.all(Object.values(stage2Started).map(({ promise }) => promise));
    stage2Gates["src/b.ts"].resolve();
    const chapterB = StoryStreamEventSchema.parse((await iterator.next()).value);
    expect(chapterB.type === "story.chapter" ? chapterB.data.id : null).toBe(
      "chapter-b",
    );

    stage2Gates["src/a.ts"].resolve();
    const chapterA = StoryStreamEventSchema.parse((await iterator.next()).value);
    expect(chapterA.type === "story.chapter" ? chapterA.data.id : null).toBe(
      "chapter-a",
    );

    await stage3Started.promise;
    const readyPromise = iterator.next();
    let readySettled = false;
    void readyPromise.then(() => { readySettled = true; });
    await Promise.resolve();
    expect(readySettled).toBe(false);

    stage3Gate.resolve();
    const ready = StoryStreamEventSchema.parse((await readyPromise).value);
    expect(ready.type).toBe("story.ready");
    if (ready.type !== "story.ready") throw new Error("Expected the ready event last");
    expect(ready.data.tracks[0]?.chapter_order).toEqual([
      "chapter-b",
      "chapter-a",
    ]);
    expect((await iterator.next()).done).toBe(true);
  });

  it("passes an abort into an in-flight model SDK call", async () => {
    const stage2Started = deferred<void>();
    const abortObserved = deferred<void>();
    let sdkSignal: AbortSignal | undefined;
    const client = {
      messages: {
        parse: async (
          parameters: { messages: Array<{ content: string }> },
          options?: { signal?: AbortSignal },
        ) => {
          const prompt = parameters.messages[0]!.content;
          if (prompt.startsWith("Return the review outline")) {
            return modelResponse(stage1Outline([["chapter-a", "src/a.ts"]]));
          }
          sdkSignal = options?.signal;
          stage2Started.resolve();
          await new Promise<never>((_resolve, reject) => {
            const abort = () => {
              abortObserved.resolve();
              reject(sdkSignal?.reason ?? new Error("Aborted"));
            };
            if (sdkSignal?.aborted) abort();
            else sdkSignal?.addEventListener("abort", abort, { once: true });
          });
        },
      },
    } as unknown as Anthropic;
    const analyzer = analyzerFor([changedFile("src/a.ts")], client, 2);
    const controller = new AbortController();
    const iterator = analyzer.stream(
      { owner: "acme", repo: "demo", pullNumber: 1 },
      { signal: controller.signal },
    )[Symbol.asyncIterator]();

    const skeleton = StoryStreamEventSchema.parse((await iterator.next()).value);
    expect(skeleton.type).toBe("story.skeleton");
    await stage2Started.promise;
    expect(sdkSignal).toBe(controller.signal);

    controller.abort(new Error("Client disconnected"));

    await abortObserved.promise;
    expect((await iterator.next()).done).toBe(true);
  });
});

function analyzerFor(
  files: ReturnType<typeof changedFile>[],
  client: Anthropic,
  maxModelStage: 2 | 3,
) {
  const fetchImplementation: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes("/files?")) return Response.json(files);
    if (url.includes("/tarball/")) {
      return new Response("missing", { status: 404 });
    }
    return Response.json({
      number: 1,
      title: "Streaming test",
      body: "",
      base: { sha: "base", repo: { node_id: "R_stream" } },
      head: { sha: "head" },
    });
  };
  return new PipelineAnalyzer({
    config: {
      ...loadAnalyzerConfig({}),
      anthropicApiKey: "test-key",
      strongModel: "test-strong",
      chapterModel: "test-chapter",
      stage2Concurrency: 2,
    },
    fetch: fetchImplementation,
    anthropicClient: client,
    logger: { info: () => undefined, warn: () => undefined },
    maxModelStage,
  });
}

function changedFile(filename: string) {
  return {
    filename,
    status: "modified",
    additions: 1,
    deletions: 0,
    changes: 1,
    patch: "@@ -1 +1 @@\n-old\n+new",
  };
}

function stage1Outline(chapters: Array<[string, string]>) {
  return {
    tracks: [{
      id: "main",
      title: "Main",
      chapter_order: chapters.map(([id]) => id),
    }],
    chapters: chapters.map(([id, path]) => ({
      id,
      title: id,
      track_id: "main",
      files: [path],
    })),
    appendix: [],
    context_requests: [],
  };
}

function stage2Card(path: string) {
  return {
    summary: {
      text: `Summary for ${path}`,
      kind: "observed",
      evidence: [{ path, lines: [1, 1] }],
    },
    files: [{ path, note: `Review ${path}`, anchor_hunks: [[1, 1]] }],
    scrutinize: [],
    related_tests: {
      status: "not_searched",
      note: "No searchable workspace tests were available.",
      search_scope: "workspace unavailable",
    },
    attention: { level: "STANDARD", reasons: ["behavior changed"] },
  };
}

function stage3Synthesis() {
  return {
    exec_summary: {
      text: "Read B before A.",
      evidence: [{ path: "src/b.ts", lines: [1, 1] as [number, number] }],
    },
    tracks: [{
      id: "main",
      rationale: "B is the entry point.",
      chapter_order: ["chapter-b", "chapter-a"],
      entry_points: [{
        persona: "reviewer",
        start_chapter: "chapter-b",
        note: "Start at B.",
      }],
      flow: [
        { chapter_id: "chapter-b", label: "B", kind: "code", evidence: [] },
        { chapter_id: "chapter-a", label: "A", kind: "code", evidence: [] },
      ],
    }],
    cross_chapter_observations: [],
  };
}

function stage2PromptPath(prompt: string): string {
  const payload = JSON.parse(prompt.slice(prompt.indexOf("\n") + 1)) as {
    chapter: { files: string[] };
  };
  return payload.chapter.files[0]!;
}

function modelResponse(output: unknown) {
  return {
    parsed_output: { ok: true, output },
    usage: { input_tokens: 10, output_tokens: 5 },
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
