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

  it("aggregates file import facts into chapter-level dependency edges", () => {
    const artifact = StoryArtifactSchema.parse(artifactFixture);
    const plan = storyArtifactToReviewPlan(artifact, "acme/review-story-demo");

    expect(plan.graph.edges).toEqual([
      { source: "ch_api", target: "ch_schema", kind: "imports" },
      { source: "ch_login_ui", target: "ch_api", kind: "imports" },
    ]);
  });

  it("derives per-file severity from citations and attention floors, capped by the chapter", () => {
    const artifact = StoryArtifactSchema.parse(artifactFixture);
    const plan = storyArtifactToReviewPlan(artifact, "acme/review-story-demo");
    const severityOf = (path: string) => plan.files.find((file) => file.path === path)?.severity;

    expect(severityOf("src/api/auth/refresh.ts")).toBe("needs-human");
    expect(severityOf("src/api/auth/client.ts")).toBe("noise");
    expect(severityOf("src/db/schema/session.ts")).toBe("standard");
    expect(severityOf("src/db/migrations/024_refresh_tokens.sql")).toBe("standard");
    expect(severityOf("src/web/auth/session-client.ts")).toBe("standard");
    expect(severityOf("src/web/login/LoginPage.tsx")).toBe("noise");
  });

  it("falls back to chapter-level severity for artifacts without file attention floors", () => {
    const artifact = StoryArtifactSchema.parse(artifactFixture);
    const legacy = StoryArtifactSchema.parse({
      ...artifact,
      chapters: artifact.chapters.map((chapter) => ({
        ...chapter,
        files: chapter.files.map(({ attention_floor, imports_changed_files, ...file }) => file),
      })),
    });
    const plan = storyArtifactToReviewPlan(legacy, "acme/review-story-demo");

    expect(plan.files.filter(({ chapterId }) => chapterId === "ch_api")
      .every(({ severity }) => severity === "needs-human")).toBe(true);
    expect(plan.graph.edges).toEqual([]);
  });

  it("sums per-file churn into chapter totals, omitting them when the artifact has none", () => {
    const artifact = StoryArtifactSchema.parse(artifactFixture);
    const plan = storyArtifactToReviewPlan(artifact, "acme/review-story-demo");
    const chapterOf = (id: string) => plan.chapters.find((chapter) => chapter.id === id);

    expect(chapterOf("ch_api")?.additions).toBe(128 + 24);
    expect(chapterOf("ch_api")?.deletions).toBe(17 + 3);
    expect(chapterOf("ch_schema")?.additions).toBeUndefined();
    expect(chapterOf("ch_schema")?.deletions).toBeUndefined();
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
