import { StaticAnalyzer } from "@review-story/analyzer";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("story API", () => {
  it("serves a schema-valid story", async () => {
    const app = await buildApp({
      analyzer: new StaticAnalyzer({ streamDelayMs: 0 }),
    });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/prs/acme/review-story-demo/pulls/123/story",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().chapters).toHaveLength(3);
  });

  it("rejects an invalid pull request number", async () => {
    const app = await buildApp();
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/prs/acme/review-story-demo/pulls/not-a-number/story",
    });

    expect(response.statusCode).toBe(400);
  });

  it("frames the progressive story as ordered SSE events", async () => {
    const app = await buildApp({
      analyzer: new StaticAnalyzer({ streamDelayMs: 0 }),
    });
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
});
