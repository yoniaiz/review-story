import { describe, expect, it } from "vitest";
import { getPageContext } from "./extension-context";
import { findRouteIndexByPath, getExtensionReviewRoute, getReviewPlanForContext } from "./extension-review";

describe("extension review adapter", () => {
  it("loads the validated Twenty fixture for its matching pull request", () => {
    const plan = getReviewPlanForContext(getPageContext("https://github.com/twentyhq/twenty/pull/22819"));
    expect(plan?.pr).toBe(22819);
    expect(plan && getExtensionReviewRoute(plan)).toHaveLength(6);
  });

  it("does not leak the fixture into another pull request", () => {
    expect(getReviewPlanForContext(
      getPageContext("https://github.com/twentyhq/twenty/pull/99999"),
    )).toBeUndefined();
  });

  it("finds the matching guided step for a GitHub file path", () => {
    const plan = getReviewPlanForContext(getPageContext("https://github.com/twentyhq/twenty/pull/22819"));
    const route = plan ? getExtensionReviewRoute(plan) : [];
    expect(findRouteIndexByPath(route, route[2]?.file.path)).toBe(2);
    expect(findRouteIndexByPath(route, "missing.ts")).toBe(-1);
  });
});

