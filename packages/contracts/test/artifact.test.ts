import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AnalyzeResultSchema,
  StoryArtifactSchema,
  StorySkeletonSchema,
} from "../src/index.js";

describe("mock artifact", () => {
  it("matches the frozen v1 contract", async () => {
    const fixturePath = fileURLToPath(
      new URL("../../../fixtures/mock-artifact.json", import.meta.url),
    );
    const fixture = JSON.parse(await readFile(fixturePath, "utf8"));

    expect(StoryArtifactSchema.parse(fixture)).toEqual(fixture);
  });

  it("rejects semantic contract violations", async () => {
    const fixturePath = fileURLToPath(
      new URL("../../../fixtures/mock-artifact.json", import.meta.url),
    );
    const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
    fixture.chapters[0].attention.level = "SKIM";
    fixture.chapters[0].attention.floor = "DEEP_READ";
    fixture.tracks[0].flow[0].chapter_id = "missing_chapter";
    fixture.chapters[0].summary.evidence[0].lines = [41, 14];

    expect(StoryArtifactSchema.safeParse(fixture).success).toBe(false);
  });

  it("accepts an honest provisional skeleton without entry points or flow", async () => {
    const fixturePath = fileURLToPath(
      new URL("../../../fixtures/mock-artifact.json", import.meta.url),
    );
    const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
    const skeleton = {
      meta: { ...fixture.meta, status: "GENERATING" },
      tracks: fixture.tracks.map(
        ({ id, title, chapter_order }: Record<string, unknown>) => ({
          id,
          title,
          chapter_order,
        }),
      ),
      chapters: fixture.chapters.map(
        ({ id, title }: Record<string, unknown>) => ({ id, title }),
      ),
      appendix: fixture.appendix,
    };

    expect(StorySkeletonSchema.safeParse(skeleton).success).toBe(true);
    expect(
      StorySkeletonSchema.safeParse({
        ...skeleton,
        tracks: fixture.tracks,
      }).success,
    ).toBe(false);
  });

  it("exports the complete analyzer result contract", async () => {
    const fixturePath = fileURLToPath(
      new URL("../../../fixtures/mock-artifact.json", import.meta.url),
    );
    const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
    const result = {
      artifact: fixture,
      diff_snapshot: {
        repo_node_id: fixture.meta.repo_node_id,
        pr: fixture.meta.pr,
        base_oid: "base-oid",
        head_oid: fixture.meta.head_oid,
        files: [
          {
            path: "src/api/auth/refresh.ts",
            previous_path: null,
            status: "modified",
            additions: 23,
            deletions: 7,
            changes: 30,
            patch: "@@ -38,7 +38,23 @@",
            patch_hash: "sha256:fixture-patch",
          },
        ],
      },
      usage: {
        stages: [
          {
            stage: "stage1",
            model: "fixture-model",
            calls: 1,
            failures: 0,
            input_tokens: 100,
            output_tokens: 20,
            cost_usd: 0.001,
          },
        ],
        total_input_tokens: 100,
        total_output_tokens: 20,
        total_cost_usd: 0.001,
      },
    };

    expect(AnalyzeResultSchema.parse(result)).toEqual(result);
    expect(
      AnalyzeResultSchema.safeParse({ artifact: fixture }).success,
    ).toBe(false);
  });
});
