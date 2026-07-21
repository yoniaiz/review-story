import { StoryArtifactSchema } from "@review-story/contracts";
import { describe, expect, it } from "vitest";
import artifactFixture from "../../../../fixtures/mock-artifact.json";
import { getExtensionReviewRoute } from "./extension-review";
import { storyArtifactToReviewPlan } from "./story-review-plan";

describe("story artifact review plan adapter", () => {
  it("turns every generated chapter file into a navigable evidence-backed step", () => {
    const artifact = StoryArtifactSchema.parse(artifactFixture);
    const plan = storyArtifactToReviewPlan(artifact, "acme/review-story-demo", ["ch_api"]);
    const route = getExtensionReviewRoute(plan);

    expect(route).toHaveLength(6);
    expect(plan.chapters.find(({ id }) => id === "ch_api")?.status).toBe("done");
    expect(route.find(({ chapter }) => chapter.id === "ch_api")?.step.status).toBe("reviewed");
    expect(route.every(({ step }) => step.evidence.length > 0)).toBe(true);
    expect(plan.headSha).toBe(artifact.meta.head_oid);
  });
});
