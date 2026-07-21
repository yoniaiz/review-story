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
    expect(route.every(({ step }) => step.line === undefined || step.line > 0)).toBe(true);
    expect(plan.chapters.every(({ entryPoint, fileIds }) => fileIds.includes(entryPoint))).toBe(true);
    expect(plan.headSha).toBe(artifact.meta.head_oid);
  });

  it("uses the contract's track chapter order instead of artifact storage order", () => {
    const artifact = StoryArtifactSchema.parse(artifactFixture);
    const reordered = StoryArtifactSchema.parse({
      ...artifact,
      tracks: [{
        ...artifact.tracks[0]!,
        chapter_order: ["ch_login_ui", "ch_api", "ch_schema"],
      }],
    });

    expect(storyArtifactToReviewPlan(reordered, "acme/review-story-demo").chapters
      .map(({ id }) => id)).toEqual(["ch_login_ui", "ch_api", "ch_schema"]);
  });
});
