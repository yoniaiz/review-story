import { describe, expect, it } from "vitest";
import {
  activeContextFromMessage,
  getPageContext,
  isCommentDraftResult,
  isDiffAnchor,
  isPrimerExtensionMessage,
  isSameGitCommit,
  reconcilePageContext,
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

  it("preserves a head SHA even when no diff line is visible", () => {
    expect(getPageContext(
      "https://github.com/acme/widgets/pull/42/files",
      undefined,
      undefined,
      "abc123def456",
    )).toMatchObject({
      kind: "pull-request",
      headSha: "abc123def456",
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
    expect(isPrimerExtensionMessage({
      type: "primer:navigate-file",
      path: "src/app.tsx",
      line: 24,
      side: "RIGHT",
    })).toBe(true);
    expect(isPrimerExtensionMessage({ type: "primer:navigate-file", path: "" })).toBe(false);
    expect(isPrimerExtensionMessage({ type: "primer:navigate-file", path: "src/app.tsx", line: 0 })).toBe(false);
    expect(isPrimerExtensionMessage({
      type: "primer:navigate-anchor",
      anchor: { path: "src/app.tsx", headSha: "abc1234", line: 24, side: "RIGHT" },
    })).toBe(true);
    expect(isPrimerExtensionMessage({
      type: "primer:navigate-anchor",
      anchor: { path: "src/app.tsx", headSha: "abc1234", line: 0, side: "RIGHT" },
    })).toBe(false);
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

  it("accepts context broadcasts only for the active tab", () => {
    const pullRequest = getPageContext("https://github.com/acme/widgets/pull/42");
    expect(activeContextFromMessage({
      type: "primer:active-context-changed",
      tabId: 12,
      context: pullRequest,
    }, 12)).toEqual(pullRequest);
    expect(activeContextFromMessage({
      type: "primer:active-context-changed",
      tabId: 99,
      context: getPageContext("https://github.com/acme/other"),
    }, 12)).toBeUndefined();
    expect(activeContextFromMessage({
      type: "primer:context-observed",
      context: pullRequest,
    }, 12)).toBeUndefined();
  });

  it("uses the current tab URL when a cached observation belongs to an older GitHub route", () => {
    const cachedRepository = getPageContext("https://github.com/acme/widgets/pulls");
    expect(reconcilePageContext(
      "https://github.com/acme/widgets/pull/42/files",
      cachedRepository,
    )).toMatchObject({
      kind: "pull-request",
      owner: "acme",
      repository: "widgets",
      pullNumber: 42,
    });
  });

  it("preserves DOM evidence when it belongs to the current pull request", () => {
    const observed = getPageContext(
      "https://github.com/acme/widgets/pull/42/files#old-fragment",
      "src/app.ts",
      undefined,
      "abc123def456",
    );
    expect(reconcilePageContext(
      "https://github.com/acme/widgets/pull/42/files#new-fragment",
      observed,
    )).toMatchObject({
      kind: "pull-request",
      pullNumber: 42,
      activeFile: "src/app.ts",
      headSha: "abc123def456",
      url: "https://github.com/acme/widgets/pull/42/files#new-fragment",
    });
  });

  it("validates native comment drafting results", () => {
    expect(isCommentDraftResult({ ok: true, status: "drafted" })).toBe(true);
    expect(isCommentDraftResult({ ok: false, error: "stale-anchor" })).toBe(true);
    expect(isCommentDraftResult({ ok: false, error: "unknown" })).toBe(false);
    expect(isCommentDraftResult({ ok: true, status: "submitted" })).toBe(false);
  });

  it("matches full and abbreviated forms of the same commit", () => {
    expect(isSameGitCommit("09facc1", "09facc1729509f9ca5aaf7468a9a76efafe8714b")).toBe(true);
    expect(isSameGitCommit("09facc1", "abcdef1")).toBe(false);
  });
});
