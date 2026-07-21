import Anthropic from "@anthropic-ai/sdk";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create as createTar } from "tar";
import { describe, expect, it } from "vitest";
import { loadAnalyzerConfig } from "../src/config.js";
import { PipelineAnalyzer } from "../src/pipeline.js";

describe("pipeline fallbacks", () => {
  it("builds the tracer artifact without model calls even when a client is configured", async () => {
    let modelCalls = 0;
    const client = {
      messages: {
        parse: async () => {
          modelCalls += 1;
          throw new Error("deterministic mode must not reach the model");
        },
      },
    } as unknown as Anthropic;
    const analyzer = analyzerFor(
      [
        changedFile("src/shop.js"),
        changedFile("package-lock.json"),
        changedFile("src/data/generated/sprite-manifest.json"),
      ],
      300,
      client,
      "deterministic",
    );

    const result = await analyzer.analyze({
      owner: "acme",
      repo: "demo",
      pullNumber: 1,
    });

    expect(modelCalls).toBe(0);
    expect(result.usage).toEqual({
      stages: [],
      total_input_tokens: 0,
      total_output_tokens: 0,
      total_cost_usd: 0,
    });
    expect(result.artifact.chapters).toHaveLength(1);
    expect(result.artifact.chapters[0]?.id).toBe("chapter-all-changes");
    expect(result.artifact.chapters[0]?.files.map(({ path }) => path)).toEqual([
      "src/shop.js",
    ]);
    expect(result.artifact.appendix.files).toEqual([
      "package-lock.json",
      "src/data/generated/sprite-manifest.json",
    ]);
    expect(result.artifact.appendix.reasons).toEqual({
      "package-lock.json": "lockfile",
      "src/data/generated/sprite-manifest.json":
        "generated or mechanical output",
    });
    expect(result.diff_snapshot.files.map(({ path }) => path)).toEqual([
      "package-lock.json",
      "src/data/generated/sprite-manifest.json",
      "src/shop.js",
    ]);
  });

  it("makes no model calls for a PR over the configured file cap", async () => {
    let modelCalls = 0;
    const analyzer = analyzerFor(
      [changedFile("src/a.ts"), changedFile("src/b.ts")],
      1,
      {
        messages: {
          parse: async () => {
            modelCalls += 1;
            throw new Error("oversized PR must not reach the model");
          },
        },
      } as unknown as Anthropic,
    );
    const result = await analyzer.analyze({ owner: "acme", repo: "demo", pullNumber: 1 });

    expect(result.artifact.meta.status).toBe("READY");
    expect(modelCalls).toBe(0);
    expect(result.usage.stages.every((stage) => stage.calls === 0)).toBe(true);
  });

  it("uses one Stage 1 call for model grouping and keeps later stages deterministic", async () => {
    let requestParameters: { model?: string; max_tokens?: number } | undefined;
    let modelCalls = 0;
    const client = {
      messages: {
        parse: async (parameters: { model: string; max_tokens: number }) => {
          requestParameters = parameters;
          modelCalls += 1;
          return {
            parsed_output: { ok: true, output: {
              tracks: [{
                id: "main",
                title: "Main",
                chapter_order: ["backend", "frontend"],
              }],
              chapters: [
                {
                  id: "backend",
                  title: "Backend",
                  track_id: "main",
                  files: ["src/api.ts"],
                },
                {
                  id: "frontend",
                  title: "Frontend",
                  track_id: "main",
                  files: ["src/ui.ts"],
                },
              ],
              appendix: [],
              context_requests: [],
            } },
            usage: { input_tokens: 10, output_tokens: 5 },
          };
        },
      },
    } as unknown as Anthropic;
    const analyzer = analyzerFor(
      [changedFile("src/api.ts"), changedFile("src/ui.ts")],
      300,
      client,
    );
    const result = await analyzer.analyze({ owner: "acme", repo: "demo", pullNumber: 1 });

    expect(modelCalls).toBe(1);
    expect(requestParameters).toMatchObject({
      model: "test-sonnet",
      max_tokens: 4321,
    });
    expect(result.artifact.chapters.map(({ id }) => id)).toEqual([
      "backend",
      "frontend",
    ]);
    expect(result.artifact.chapters[0]?.summary.text).toContain("changes 1 file");
    expect(result.artifact.tracks[0]?.entry_points[0]?.persona).toBe("reviewer");
    expect(result.usage.stages).toEqual([
      expect.objectContaining({
        stage: "stage1",
        model: "test-sonnet",
        calls: 1,
        failures: 0,
        input_tokens: 10,
        output_tokens: 5,
      }),
    ]);
  });

  it("re-prompts incomplete placement, then creates a misc chapter", async () => {
    const prompts: string[] = [];
    let modelCalls = 0;
    const client = {
      messages: {
        parse: async (parameters: { messages: Array<{ content: string }> }) => {
          prompts.push(parameters.messages[0]!.content);
          modelCalls += 1;
          return {
            parsed_output: { ok: true, output: {
              tracks: [{ id: "main", title: "Main", chapter_order: ["api"] }],
              chapters: [{
                id: "api",
                title: "API",
                track_id: "main",
                files: ["src/api.ts"],
              }],
              appendix: [],
              context_requests: [],
            } },
            usage: { input_tokens: 10, output_tokens: 5 },
          };
        },
      },
    } as unknown as Anthropic;
    const analyzer = analyzerFor(
      [changedFile("src/api.ts"), changedFile("src/ui.ts")],
      300,
      client,
    );

    const result = await analyzer.analyze({ owner: "acme", repo: "demo", pullNumber: 1 });

    expect(modelCalls).toBe(2);
    expect(prompts[1]).toContain("missing files: src/ui.ts");
    expect(result.artifact.chapters.map(({ id }) => id)).toEqual([
      "api",
      "chapter-misc",
    ]);
    expect(result.artifact.chapters.flatMap((chapter) =>
      chapter.files.map(({ path }) => path),
    )).toEqual(["src/api.ts", "src/ui.ts"]);
    expect(result.usage.stages[0]).toMatchObject({ calls: 2, failures: 2 });
  });

  it("uses a single-chapter fallback when both Stage 1 attempts fail", async () => {
    let modelCalls = 0;
    const client = {
      messages: {
        parse: async () => {
          modelCalls += 1;
          throw new Error("temporary model failure");
        },
      },
    } as unknown as Anthropic;
    const analyzer = analyzerFor(
      [changedFile("src/api.ts"), changedFile("src/ui.ts")],
      300,
      client,
    );

    const result = await analyzer.analyze({ owner: "acme", repo: "demo", pullNumber: 1 });

    expect(modelCalls).toBe(2);
    expect(result.artifact.chapters).toHaveLength(1);
    expect(result.artifact.chapters[0]?.id).toBe("chapter-all-changes");
    expect(result.usage.stages[0]).toMatchObject({ calls: 2, failures: 2 });
  });

  it("runs Stage 2 under the concurrency cap and emits model chapters as they finish", async () => {
    let active = 0;
    let maximumActive = 0;
    const stage2Prompts = new Map<string, string>();
    const delays: Record<string, number> = {
      "src/a.ts": 30,
      "src/b.ts": 5,
      "src/c.ts": 10,
    };
    const client = {
      messages: {
        parse: async (parameters: {
          model: string;
          messages: Array<{ content: string }>;
        }) => {
          if (parameters.model === "test-sonnet") {
            return modelResponse(stage1Outline([
              ["chapter-a", "src/a.ts"],
              ["chapter-b", "src/b.ts"],
              ["chapter-c", "src/c.ts"],
            ]));
          }
          const prompt = parameters.messages[0]!.content;
          const path = stage2PromptPath(prompt);
          stage2Prompts.set(path, prompt);
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          await new Promise((resolve) => setTimeout(resolve, delays[path]));
          active -= 1;
          return modelResponse(stage2Card(path));
        },
      },
    } as unknown as Anthropic;
    const infoLogs: string[] = [];
    const analyzer = analyzerFor(
      [
        changedFile("src/a.ts", "A_ONLY"),
        changedFile("src/b.ts", "B_ONLY"),
        changedFile("src/c.ts", "C_ONLY"),
      ],
      300,
      client,
      "full",
      2,
      2,
      { info: (message) => infoLogs.push(message), warn: () => undefined },
    );

    const chapterIds: string[] = [];
    let ready = false;
    for await (const event of analyzer.stream({ owner: "acme", repo: "demo", pullNumber: 1 })) {
      if (event.type === "story.chapter") chapterIds.push(event.data.id);
      if (event.type === "story.ready") ready = true;
    }

    expect(maximumActive).toBe(2);
    expect(chapterIds).toEqual(["chapter-b", "chapter-c", "chapter-a"]);
    expect(ready).toBe(true);
    expect(stage2Prompts.get("src/a.ts")).toContain("A_ONLY");
    expect(stage2Prompts.get("src/a.ts")).toContain("src/b.ts");
    expect(stage2Prompts.get("src/a.ts")).toContain("src/c.ts");
    expect(stage2Prompts.get("src/a.ts")).not.toContain("B_ONLY");
    expect(stage2Prompts.get("src/a.ts")).not.toContain("C_ONLY");
    expect(infoLogs).toContain(
      "anchor validation dropped 6 anchors and 3 claims",
    );
  });

  it("retries one failed Stage 2 chapter then returns a valid stats-only fallback", async () => {
    let failedChapterCalls = 0;
    const client = {
      messages: {
        parse: async (parameters: {
          model: string;
          messages: Array<{ content: string }>;
        }) => {
          if (parameters.model === "test-sonnet") {
            return modelResponse(stage1Outline([
              ["api", "src/api.ts"],
              ["ui", "src/ui.ts"],
            ]));
          }
          const prompt = parameters.messages[0]!.content;
          if (stage2PromptPath(prompt) === "src/api.ts") {
            failedChapterCalls += 1;
            throw new Error("chapter model unavailable");
          }
          return modelResponse(stage2Card("src/ui.ts", false));
        },
      },
    } as unknown as Anthropic;
    const analyzer = analyzerFor(
      [changedFile("src/api.ts"), changedFile("src/ui.ts")],
      300,
      client,
      "full",
      2,
    );

    const result = await analyzer.analyze({ owner: "acme", repo: "demo", pullNumber: 1 });
    const api = result.artifact.chapters.find((chapter) => chapter.id === "api")!;
    const ui = result.artifact.chapters.find((chapter) => chapter.id === "ui")!;
    const stage2Usage = result.usage.stages.find((stage) => stage.stage === "stage2");

    expect(failedChapterCalls).toBe(2);
    expect(api.summary.text).toContain("changes 1 file");
    expect(api.scrutinize).toEqual([]);
    expect(ui.summary.text).toBe("Model summary for src/ui.ts");
    expect(stage2Usage).toMatchObject({ calls: 3, failures: 2 });
  });

  it("feeds requested workspace skeletons only to their Stage 2 chapters", async () => {
    const archive = await repositoryArchive({
      "src/api.ts": "export const api = true;\n",
      "src/ui.ts": "export const ui = true;\n",
      "src/shared.ts": [
        "export class SharedService {",
        "  execute(value: string) {",
        "    const INTERNAL_BODY_MARKER = value.trim();",
        "    return INTERNAL_BODY_MARKER;",
        "  }",
        "}",
      ].join("\n"),
    });
    const workspaceRoot = await mkdtemp(join(tmpdir(), "review-story-pipeline-"));
    const prompts = new Map<string, string>();
    const infoLogs: string[] = [];
    const client = {
      messages: {
        parse: async (parameters: {
          model: string;
          messages: Array<{ content: string }>;
        }) => {
          if (parameters.model === "test-sonnet") {
            return modelResponse({
              ...stage1Outline([
                ["api", "src/api.ts"],
                ["ui", "src/ui.ts"],
              ]),
              context_requests: [{
                path: "src/shared.ts",
                chapter_ids: ["api"],
                reason: "shared request handling",
              }],
            });
          }
          const prompt = parameters.messages[0]!.content;
          const path = stage2PromptPath(prompt);
          prompts.set(path, prompt);
          const card = stage2Card(path, false);
          if (path === "src/api.ts") {
            card.summary = {
              text: "The API uses the shared service contract.",
              kind: "observed",
              evidence: [{ path: "src/shared.ts", lines: [1, 99] }],
            };
          }
          return modelResponse(card);
        },
      },
    } as unknown as Anthropic;

    try {
      const analyzer = analyzerFor(
        [changedFile("src/api.ts"), changedFile("src/ui.ts")],
        300,
        client,
        "full",
        2,
        5,
        { info: (message) => infoLogs.push(message), warn: () => undefined },
        archive,
        workspaceRoot,
      );
      const result = await analyzer.analyze({
        owner: "acme",
        repo: "demo",
        pullNumber: 1,
      });
      const api = result.artifact.chapters.find((chapter) => chapter.id === "api")!;

      expect(prompts.get("src/api.ts")).toContain("src/shared.ts");
      expect(prompts.get("src/api.ts")).toContain("SharedService");
      expect(prompts.get("src/api.ts")).not.toContain("INTERNAL_BODY_MARKER");
      expect(prompts.get("src/ui.ts")).not.toContain("SharedService");
      expect(api.summary.evidence).toEqual([
        { path: "src/shared.ts", lines: [1, 6] },
      ]);
      expect(infoLogs).toContain("stage1.5 resolved 1 context file");
      expect(infoLogs).toContain(
        "stage2 api consuming context: src/shared.ts",
      );
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("uses Stage 3 synthesis for authoritative order, entry points, flow, and summary", async () => {
    let stage3Calls = 0;
    const client = {
      messages: {
        parse: async (parameters: { messages: Array<{ content: string }> }) => {
          const prompt = parameters.messages[0]!.content;
          if (prompt.startsWith("Return the review outline")) {
            return modelResponse(stage1Outline([
              ["api", "src/api.ts"],
              ["ui", "src/ui.ts"],
            ]));
          }
          if (prompt.startsWith("Synthesize the final story")) {
            stage3Calls += 1;
            return modelResponse(stage3Synthesis());
          }
          return modelResponse(stage2Card(stage2PromptPath(prompt), false));
        },
      },
    } as unknown as Anthropic;
    const analyzer = analyzerFor(
      [changedFile("src/api.ts"), changedFile("src/ui.ts")],
      300,
      client,
      "full",
      3,
    );

    const result = await analyzer.analyze({ owner: "acme", repo: "demo", pullNumber: 1 });

    expect(stage3Calls).toBe(1);
    expect(result.artifact.exec_summary.text).toBe("The UI now drives the API change.");
    expect(result.artifact.tracks[0]).toMatchObject({
      chapter_order: ["ui", "api"],
      entry_points: [{
        persona: "frontend",
        start_chapter: "ui",
        note: "Start at the caller.",
      }],
      flow: [
        { chapter_id: "ui", label: "UI", kind: "code" },
        { chapter_id: "api", label: "API", kind: "code" },
      ],
    });
    expect(result.usage.stages.find((stage) => stage.stage === "stage3")).toMatchObject({
      calls: 1,
      failures: 0,
    });
  });

  it("retries invalid Stage 3 references then ships the deterministic synthesis", async () => {
    let stage3Calls = 0;
    const client = {
      messages: {
        parse: async (parameters: { messages: Array<{ content: string }> }) => {
          const prompt = parameters.messages[0]!.content;
          if (prompt.startsWith("Return the review outline")) {
            return modelResponse(stage1Outline([
              ["api", "src/api.ts"],
              ["ui", "src/ui.ts"],
            ]));
          }
          if (prompt.startsWith("Synthesize the final story")) {
            stage3Calls += 1;
            const synthesis = stage3Synthesis();
            synthesis.tracks[0]!.entry_points[0]!.start_chapter = "missing-chapter";
            return modelResponse(synthesis);
          }
          return modelResponse(stage2Card(stage2PromptPath(prompt), false));
        },
      },
    } as unknown as Anthropic;
    const analyzer = analyzerFor(
      [changedFile("src/api.ts"), changedFile("src/ui.ts")],
      300,
      client,
      "full",
      3,
    );

    const result = await analyzer.analyze({ owner: "acme", repo: "demo", pullNumber: 1 });

    expect(stage3Calls).toBe(2);
    expect(result.artifact.tracks[0]).toMatchObject({
      chapter_order: ["api", "ui"],
      entry_points: [{ persona: "reviewer", start_chapter: "api" }],
      flow: [
        { chapter_id: "api", kind: "code" },
        { chapter_id: "ui", kind: "code" },
      ],
    });
    expect(result.artifact.exec_summary.text).toContain("changes 2 files");
    expect(result.usage.stages.find((stage) => stage.stage === "stage3")).toMatchObject({
      calls: 2,
      failures: 2,
    });
  });
});

function analyzerFor(
  files: ReturnType<typeof changedFile>[],
  maxFiles: number,
  client: Anthropic,
  mode: "full" | "deterministic" = "full",
  maxModelStage: 1 | 2 | 3 = 1,
  stage2Concurrency = 5,
  logger: { info: (message: string) => void; warn: (message: string) => void } = {
    info: () => undefined,
    warn: () => undefined,
  },
  archive?: Uint8Array,
  workspaceRoot = "/tmp/review-story-pipeline-test",
) {
  const metadata = {
    number: 1,
    title: "Test PR",
    body: "",
    base: { sha: "base", repo: { node_id: "R_test" } },
    head: { sha: "head" },
  };
  const fetchImplementation: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes("/files?")) return Response.json(files);
    if (url.includes("/tarball/")) {
      if (!archive) return new Response("missing", { status: 404 });
      const archiveBody = new Uint8Array(archive.byteLength);
      archiveBody.set(archive);
      return new Response(archiveBody.buffer);
    }
    return Response.json(metadata);
  };
  return new PipelineAnalyzer({
    config: {
      ...loadAnalyzerConfig({}),
      anthropicApiKey: "test-key",
      strongModel: "test-sonnet",
      stage1MaxTokens: 4321,
      stage2Concurrency,
      maxFiles,
      workspaceRoot,
    },
    fetch: fetchImplementation,
    anthropicClient: client,
    logger,
    mode,
    maxModelStage,
  });
}

function changedFile(filename: string, marker = "new") {
  return {
    filename,
    status: "modified",
    additions: 1,
    deletions: 0,
    changes: 1,
    patch: `@@ -1 +1 @@\n-old\n+${marker}`,
  };
}

function modelResponse(output: unknown) {
  return {
    parsed_output: { ok: true, output },
    usage: { input_tokens: 10, output_tokens: 5 },
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

function stage2Card(path: string, includeDroppedClaim = true) {
  return {
    summary: {
      text: `Model summary for ${path}`,
      kind: "observed",
      evidence: [{ path, lines: [1, 50] }],
    },
    files: [{
      path,
      note: `Model note for ${path}`,
      anchor_hunks: [[100, 120], [1, 50]],
    }],
    scrutinize: includeDroppedClaim
      ? [{
          text: "Unsupported concern",
          kind: "inferred",
          evidence: [{ path: "missing.ts", lines: [1, 2] }],
        }]
      : [],
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
      text: "The UI now drives the API change.",
      evidence: [{ path: "src/ui.ts", lines: [1, 1] as [number, number] }],
    },
    tracks: [{
      id: "main",
      rationale: "Read from caller to boundary.",
      chapter_order: ["ui", "api"],
      entry_points: [{
        persona: "frontend",
        start_chapter: "ui",
        note: "Start at the caller.",
      }],
      flow: [
        { chapter_id: "ui", label: "UI", kind: "code" as const, evidence: [] },
        { chapter_id: "api", label: "API", kind: "code" as const, evidence: [] },
      ],
    }],
    cross_chapter_observations: [{
      text: "Both chapters change the same request path.",
      kind: "inferred" as const,
      evidence: [{ path: "src/api.ts", lines: [1, 1] as [number, number] }],
    }],
  };
}

async function repositoryArchive(
  files: Record<string, string>,
): Promise<Uint8Array> {
  const temporary = await mkdtemp(join(tmpdir(), "review-story-archive-"));
  const repository = join(temporary, "repository");
  try {
    for (const [path, contents] of Object.entries(files)) {
      const target = join(repository, path);
      await mkdir(join(target, ".."), { recursive: true });
      await writeFile(target, contents);
    }
    const chunks: Buffer[] = [];
    for await (const chunk of createTar(
      { cwd: temporary, gzip: true },
      ["repository"],
    )) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

function stage2PromptPath(prompt: string): string {
  const payloadText = prompt
    .slice(prompt.indexOf("\n") + 1)
    .split("\n\nCorrection required:", 1)[0]!;
  const payload = JSON.parse(payloadText) as {
    chapter: { files: string[] };
  };
  return payload.chapter.files[0]!;
}
