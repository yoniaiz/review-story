import { describe, expect, it } from "vitest";
import {
  MemoryReviewSessionStore,
  addChatTurn,
  chatTurnsForStep,
} from "../src/review-session.js";

describe("step-scoped review chat", () => {
  it("keeps each step's history isolated inside the review session", async () => {
    const store = new MemoryReviewSessionStore();
    const session = await store.create({
      owner: "acme",
      repo: "widgets",
      pullNumber: 42,
      headSha: "abc123",
    });

    addChatTurn(session, {
      chapterId: "chapter-auth",
      stepId: "src/auth/session.ts",
      role: "user",
      content: "Explain this check",
      citations: [],
    });
    addChatTurn(session, {
      chapterId: "chapter-auth",
      stepId: "src/auth/token.ts",
      role: "user",
      content: "Explain token rotation",
      citations: [],
    });

    expect(chatTurnsForStep(session, {
      chapterId: "chapter-auth",
      stepId: "src/auth/session.ts",
    }).map(({ content }) => content)).toEqual(["Explain this check"]);
    expect(chatTurnsForStep(session, {
      chapterId: "chapter-auth",
      stepId: "src/auth/token.ts",
    }).map(({ content }) => content)).toEqual(["Explain token rotation"]);
  });
});
