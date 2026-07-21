import { afterEach, describe, expect, it, vi } from "vitest";
import { HarnessClient } from "./harness-client";

afterEach(() => vi.unstubAllGlobals());

describe("HarnessClient", () => {
  it("does not label bodyless chapter mutations as JSON", async () => {
    const request = vi.fn(async (_input: URL | RequestInfo, _init?: RequestInit) => {
      return new Response(JSON.stringify({ id: "session" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", request);
    const client = new HarnessClient({ apiBaseUrl: "http://127.0.0.1:8787" });

    await client.selectChapter("session", "chapter-1");

    expect(request).toHaveBeenCalledOnce();
    const init = request.mock.calls[0]?.[1];
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeUndefined();
    expect(init?.headers).not.toHaveProperty("Content-Type");
  });
});
