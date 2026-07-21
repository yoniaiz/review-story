import { afterEach, describe, expect, it, vi } from "vitest";
import { getPageContext } from "./extension-context";
import { sendHarnessChatMessage } from "./harness-client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sendHarnessChatMessage", () => {
  it("creates a SHA-pinned session, waits for evidence, and returns cited chat turns", async () => {
    const assistant = {
      id: "assistant-1",
      role: "assistant" as const,
      content: "Inspect the calendar boundary. src/calendar.ts:10-14",
      citations: [{ path: "src/calendar.ts", lines: [10, 14] as [number, number] }],
      createdAt: "2026-07-21T00:00:00.000Z",
    };
    const user = {
      id: "user-1",
      role: "user" as const,
      content: "What should I inspect?",
      citations: [],
      createdAt: "2026-07-21T00:00:00.000Z",
    };
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/review-sessions")) {
        return Response.json({ id: "session-1" }, { status: 201 });
      }
      if (url.endsWith("/events")) {
        return new Response('event: story.ready\ndata: {"type":"story.ready","data":{}}\n\n');
      }
      return Response.json({ user, assistant });
    }));

    const context = getPageContext(
      "https://github.com/acme/review/pull/7/files",
      "src/calendar.ts",
      {
        path: "src/calendar.ts",
        headSha: "abc1234",
        line: 10,
        side: "RIGHT",
      },
    );
    const response = await sendHarnessChatMessage(context, "What should I inspect?");

    expect(response.assistant).toEqual(assistant);
    expect(calls).toEqual([
      "http://127.0.0.1:8787/api/prs/acme/review/pulls/7/review-sessions",
      "http://127.0.0.1:8787/api/review-sessions/session-1/events",
      "http://127.0.0.1:8787/api/review-sessions/session-1/chat/messages",
    ]);
  });
});
