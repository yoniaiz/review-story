import { describe, expect, it } from "vitest";
import {
  getPageContext,
  isCommentDraftResult,
  isDiffAnchor,
  isPrimerExtensionMessage,
} from "./extension-context";

describe("getPageContext", () => {
  it("recognizes a GitHub pull request and preserves the visible file", () => {
    expect(getPageContext(
      "https://github.com/twentyhq/twenty/pull/22819/files#diff-example",
      "packages/twenty-front/src/modules/calendar/calendar.tsx",
    )).toMatchObject({
      kind: "pull-request",
      owner: "twentyhq",
      repository: "twenty",
      pullNumber: 22819,
      activeFile: "packages/twenty-front/src/modules/calendar/calendar.tsx",
    });
  });

  it("treats repository pages as GitHub context without inventing a PR", () => {
    expect(getPageContext("https://github.com/twentyhq/twenty/issues")).toMatchObject({
      kind: "github",
      owner: "twentyhq",
      repository: "twenty",
    });
  });

  it("labels other sites and malformed URLs as outside GitHub", () => {
    expect(getPageContext("https://example.com/pull/12").kind).toBe("outside-github");
    expect(getPageContext("not a url").kind).toBe("outside-github");
  });

  it("rejects malformed extension messages at the runtime boundary", () => {
    expect(isPrimerExtensionMessage({ type: "primer:context-observed", context: null })).toBe(false);
    expect(isPrimerExtensionMessage({
      type: "primer:active-context-changed",
      tabId: "12",
      context: getPageContext("https://github.com/twentyhq/twenty/pull/22819"),
    })).toBe(false);
    expect(isPrimerExtensionMessage({ type: "primer:get-active-context" })).toBe(true);
    expect(isPrimerExtensionMessage({ type: "primer:navigate-file", path: "src/app.tsx" })).toBe(true);
    expect(isPrimerExtensionMessage({ type: "primer:navigate-file", path: "" })).toBe(false);
    expect(isPrimerExtensionMessage({
      type: "primer:draft-comment",
      anchor: {
        path: "src/app.tsx",
        headSha: "abc123",
        line: 24,
        side: "RIGHT",
      },
      body: "Could we add a test?",
    })).toBe(true);
    expect(isPrimerExtensionMessage({
      type: "primer:draft-comment",
      anchor: {
        path: "src/app.tsx",
        headSha: "abc123",
        line: 24,
        side: "RIGHT",
      },
      body: "  ",
    })).toBe(false);
  });

  it("accepts only complete, exact diff anchors", () => {
    expect(isDiffAnchor({
      path: "src/app.tsx",
      headSha: "abc123",
      line: 24,
      side: "RIGHT",
      startLine: 21,
      startSide: "RIGHT",
    })).toBe(true);
    expect(isDiffAnchor({ path: "src/app.tsx", headSha: "", line: 24, side: "RIGHT" })).toBe(false);
    expect(isDiffAnchor({ path: "src/app.tsx", headSha: "abc123", line: 0, side: "RIGHT" })).toBe(false);
    expect(isDiffAnchor({ path: "src/app.tsx", headSha: "abc123", line: 24, side: "CENTER" })).toBe(false);
    expect(isDiffAnchor({
      path: "src/app.tsx",
      headSha: "abc123",
      line: 24,
      side: "RIGHT",
      startLine: 21,
    })).toBe(false);
    expect(isDiffAnchor({
      path: "src/app.tsx",
      headSha: "abc123",
      line: 24,
      side: "RIGHT",
      startLine: 21,
      startSide: "LEFT",
    })).toBe(false);
  });

  it("validates native comment drafting results", () => {
    expect(isCommentDraftResult({ ok: true, status: "drafted" })).toBe(true);
    expect(isCommentDraftResult({ ok: false, error: "stale-anchor" })).toBe(true);
    expect(isCommentDraftResult({ ok: false, error: "unknown" })).toBe(false);
    expect(isCommentDraftResult({ ok: true, status: "submitted" })).toBe(false);
  });
});

