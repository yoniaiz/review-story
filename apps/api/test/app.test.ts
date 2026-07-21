import { StaticAnalyzer } from "@review-story/analyzer";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AnalyzeRequest, Analyzer, AnalyzerContext } from "@review-story/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import type { GitHubPullReader } from "../src/github-pulls.js";

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("story API", () => {
  it("lists repository pull requests for the extension launcher", async () => {
    const githubPullReader = fakePullReader();
    const app = await buildApp({ githubPullReader });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/github/repos/acme/widgets/pulls",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().pulls).toEqual([
      expect.objectContaining({ number: 42, title: "Improve widgets", headSha: "abc123def456" }),
    ]);
  });

  it("resolves the current pull request head for DOM-independent startup", async () => {
    const githubPullReader = fakePullReader();
    const app = await buildApp({ githubPullReader });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/github/repos/acme/widgets/pulls/42",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      number: 42,
      headSha: "abc123def456",
    });
  });

  it("serves a schema-valid story", async () => {
    const app = await testApp(new StaticAnalyzer({ streamDelayMs: 0 }));
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/prs/acme/review-story-demo/pulls/123/story",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().chapters).toHaveLength(3);
  });

  it("rejects an invalid pull request number", async () => {
    const app = await testApp();
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/prs/acme/review-story-demo/pulls/not-a-number/story",
    });

    expect(response.statusCode).toBe(400);
  });

  it("frames the progressive story as ordered SSE events", async () => {
    const app = await testApp(new StaticAnalyzer({ streamDelayMs: 0 }));
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/prs/acme/review-story-demo/pulls/123/story/stream",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    const eventNames = [...response.payload.matchAll(/^event: (.+)$/gm)].map(
      (match) => match[1],
    );
    expect(eventNames).toEqual([
      "story.skeleton",
      "story.chapter",
      "story.chapter",
      "story.chapter",
      "story.ready",
    ]);
  });

  it("creates a head-scoped session and streams analysis only after start", async () => {
    const app = await buildApp({
      analyzer: new StaticAnalyzer({ streamDelayMs: 0 }),
    });
    apps.push(app);

    const created = await app.inject({
      method: "POST",
      url: "/api/prs/acme/review-story-demo/pulls/123/review-sessions",
      payload: { headSha: "8b7b7e55f69a26d3c249f9ddba8f1c8c26f986aa" },
    });
    expect(created.statusCode).toBe(201);
    const session = created.json() as { id: string; status: string };
    expect(session.status).toBe("NEW");

    const stream = await app.inject({
      method: "GET",
      url: `/api/review-sessions/${session.id}/events`,
    });
    expect(stream.statusCode).toBe(200);
    expect(stream.payload).toContain("event: story.ready");

    const current = await app.inject({
      method: "GET",
      url: "/api/prs/acme/review-story-demo/pulls/123/review-sessions/current?headSha=8b7b7e55f69a26d3c249f9ddba8f1c8c26f986aa",
    });
    expect(current.statusCode).toBe(200);
    expect(current.json().status).toBe("READY");
  });

  it("requires a valid step scope and stores chat turns against that step", async () => {
    const app = await buildApp({
      analyzer: new StaticAnalyzer({ streamDelayMs: 0 }),
      chatEngine: {
        async reply({ scope }) {
          return { text: `Reply for ${scope.stepId}`, citations: [] };
        },
      },
    });
    apps.push(app);

    const created = await app.inject({
      method: "POST",
      url: "/api/prs/acme/review-story-demo/pulls/123/review-sessions",
      payload: { headSha: "8b7b7e55f69a26d3c249f9ddba8f1c8c26f986aa" },
    });
    const sessionId = created.json().id as string;
    await app.inject({ method: "GET", url: `/api/review-sessions/${sessionId}/events` });
    const ready = await app.inject({ method: "GET", url: `/api/review-sessions/${sessionId}` });
    const chapter = ready.json().artifact.chapters[0] as {
      id: string;
      files: Array<{ path: string }>;
    };
    const scope = { chapterId: chapter.id, stepId: chapter.files[0]!.path };

    const unscoped = await app.inject({
      method: "POST",
      url: `/api/review-sessions/${sessionId}/chat/messages`,
      payload: { message: "What matters here?" },
    });
    expect(unscoped.statusCode).toBe(400);
    expect(unscoped.json().error).toBe("chat_scope_required");

    const invalid = await app.inject({
      method: "POST",
      url: `/api/review-sessions/${sessionId}/chat/messages`,
      payload: { message: "What matters here?", chapterId: chapter.id, stepId: "src/not-a-step.ts" },
    });
    expect(invalid.statusCode).toBe(409);
    expect(invalid.json().error).toBe("step_not_ready");

    const response = await app.inject({
      method: "POST",
      url: `/api/review-sessions/${sessionId}/chat/messages`,
      payload: { message: "What matters here?", ...scope },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      user: scope,
      assistant: { ...scope, content: `Reply for ${scope.stepId}` },
    });

    const updated = await app.inject({ method: "GET", url: `/api/review-sessions/${sessionId}` });
    expect(updated.json().chatTurns).toEqual([
      expect.objectContaining({ ...scope, role: "user" }),
      expect.objectContaining({ ...scope, role: "assistant" }),
    ]);
  });

  it("deduplicates concurrent cold streams and serves the next open from cache", async () => {
    const analyzer = new CountingAnalyzer();
    const app = await testApp(analyzer);
    apps.push(app);
    const request = {
      method: "GET" as const,
      url: "/api/prs/acme/review-story-demo/pulls/123/story/stream",
    };
    const [first, second] = await Promise.all([app.inject(request), app.inject(request)]);
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(analyzer.streamCalls).toBe(1);

    const warmStartedAt = performance.now();
    const warm = await app.inject(request);
    const warmDurationMs = performance.now() - warmStartedAt;
    expect(warm.statusCode).toBe(200);
    expect(analyzer.streamCalls).toBe(1);
    expect(warmDurationMs).toBeLessThan(1_000);
  });

  it("shares one cold generation between REST and SSE consumers", async () => {
    const analyzer = new CountingAnalyzer();
    const app = await testApp(analyzer);
    apps.push(app);

    const [rest, stream] = await Promise.all([
      app.inject({
        method: "GET",
        url: "/api/prs/acme/review-story-demo/pulls/123/story",
      }),
      app.inject({
        method: "GET",
        url: "/api/prs/acme/review-story-demo/pulls/123/story/stream",
      }),
    ]);

    expect(rest.statusCode).toBe(200);
    expect(rest.json().chapters).toHaveLength(3);
    expect(stream.statusCode).toBe(200);
    expect(stream.payload).toContain("event: story.ready");
    expect(analyzer.streamCalls).toBe(1);
  });

  it("does not cache or publish ready when the head changes after identification", async () => {
    const app = await testApp(new MismatchedIdentityAnalyzer());
    apps.push(app);
    const response = await app.inject({
      method: "GET",
      url: "/api/prs/acme/review-story-demo/pulls/123/story/stream",
    });
    const eventNames = [...response.payload.matchAll(/^event: (.+)$/gm)].map(
      (match) => match[1],
    );
    expect(eventNames).toEqual(["story.error"]);
    expect(response.payload).toContain("head changed after cache identification");
  });
});

async function testApp(analyzer?: Analyzer) {
  const cacheDirectory = await mkdtemp(join(tmpdir(), "review-story-api-"));
  temporaryDirectories.push(cacheDirectory);
  return buildApp({ ...(analyzer ? { analyzer } : {}), cacheDirectory });
}

class CountingAnalyzer implements Analyzer {
  readonly #delegate = new StaticAnalyzer({ streamDelayMs: 20 });
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

class MismatchedIdentityAnalyzer extends CountingAnalyzer {
  override async identify(request: AnalyzeRequest, context?: AnalyzerContext) {
    const identity = await super.identify(request, context);
    return { ...identity, head_oid: "stale-head" };
  }
}

function fakePullReader(): GitHubPullReader {
  const pull = {
    number: 42,
    title: "Improve widgets",
    state: "open" as const,
    draft: false,
    headSha: "abc123def456",
    updatedAt: "2026-07-22T00:00:00Z",
    author: "octocat",
  };
  return {
    async list() {
      return [pull];
    },
    async get(_owner, _repo, pullNumber) {
      if (pullNumber !== pull.number) throw new Error("not found");
      return pull;
    },
  };
}
