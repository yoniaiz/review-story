import { StoryArtifactSchema } from "@review-story/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import mockArtifact from "../../../fixtures/mock-artifact.json";
import { OpenAiResponsesChatEngine } from "../src/openai-chat.js";
import { MemoryReviewSessionStore, addChatTurn } from "../src/review-session.js";

afterEach(() => vi.unstubAllGlobals());

describe("OpenAI step chat context", () => {
  it("sends only prior turns from the active step to the model", async () => {
    const session = await new MemoryReviewSessionStore().create({
      owner: "acme",
      repo: "widgets",
      pullNumber: 42,
      headSha: "abc123",
    });
    session.artifact = StoryArtifactSchema.parse(mockArtifact);
    const scope = { chapterId: "ch_schema", stepId: "src/db/schema/session.ts" };
    addChatTurn(session, {
      ...scope,
      role: "assistant",
      content: "Prior answer for this step",
      citations: [],
    });
    addChatTurn(session, {
      chapterId: "ch_api",
      stepId: "src/api/auth/refresh.ts",
      role: "assistant",
      content: "Answer from another step",
      citations: [],
    });
    addChatTurn(session, {
      ...scope,
      role: "user",
      content: "Current question",
      citations: [],
    });

    const request = vi.fn(async (_input: URL | RequestInfo, _init?: RequestInit) => new Response(JSON.stringify({
      id: "response-1",
      output_text: "Scoped answer src/db/schema/session.ts:14-14.",
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", request);

    await new OpenAiResponsesChatEngine("test-key").reply({
      session,
      message: "Current question",
      scope,
    });

    const init = request.mock.calls[0]?.[1] as RequestInit;
    const payload = JSON.parse(String(init.body)) as {
      input: Array<{ content: string }>;
    };
    const context = JSON.parse(payload.input[1]!.content.replace("Session context:\n", "")) as {
      currentChapterId: string;
      currentStepId: string;
      history: Array<{ role: string; content: string }>;
    };
    expect(context).toMatchObject({
      currentChapterId: scope.chapterId,
      currentStepId: scope.stepId,
      history: [{ role: "assistant", content: "Prior answer for this step" }],
    });
  });
});
