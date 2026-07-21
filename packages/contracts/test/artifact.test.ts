import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { StoryArtifactSchema } from "../src/index.js";

describe("mock artifact", () => {
  it("matches the frozen v1 contract", async () => {
    const fixturePath = fileURLToPath(
      new URL("../../../fixtures/mock-artifact.json", import.meta.url),
    );
    const fixture = JSON.parse(await readFile(fixturePath, "utf8"));

    expect(() => StoryArtifactSchema.parse(fixture)).not.toThrow();
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
});
