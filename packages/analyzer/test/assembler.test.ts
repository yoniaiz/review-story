import { describe, expect, it } from "vitest";
import { StoryArtifactSchema } from "@review-story/contracts";
import {
  assembleArtifact,
  buildChapterCard,
  buildOutline,
  validateStage1Placement,
} from "../src/assembler.js";
import type { ManifestRow } from "../src/types.js";

describe("assembler", () => {
  it("builds two to five coherent fallback chapters when model grouping is unavailable", () => {
    const manifest = [
      row("server/api.js", "STANDARD"),
      row("src/data/catalog.js", "SKIM"),
      row("src/game/rewards.js", "STANDARD"),
      row("src/store/wallet.js", "STANDARD"),
      row("src/ui/Shop.jsx", "STANDARD"),
      row("src/utils/money.js", "SKIM"),
      row("vite.config.js", "SKIM"),
    ];

    const outline = buildOutline(undefined, manifest, true);

    expect(outline.chapters).toHaveLength(5);
    expect(outline.chapters.flatMap(({ files }) => files).sort()).toEqual(
      manifest.map(({ path }) => path).sort(),
    );
  });

  it("rejects outlines with more than five chapters", () => {
    const manifest = Array.from({ length: 6 }, (_, index) => row(`src/file-${index}.ts`, "SKIM"));
    const chapters = manifest.map((item, index) => ({
      id: `chapter-${index}`,
      title: `Chapter ${index}`,
      track_id: "main",
      files: [item.path],
    }));
    const validation = validateStage1Placement({
      tracks: [{ id: "main", title: "Main", chapter_order: chapters.map(({ id }) => id) }],
      chapters,
      appendix: [],
      context_requests: [],
    }, manifest);

    expect(validation.valid).toBe(false);
    expect(validation.feedback).toContain("at most five chapters");
  });

  it("rejects chapters ordered under a different track", () => {
    const manifest = [row("src/api.ts", "SKIM"), row("src/ui.ts", "SKIM")];
    const validation = validateStage1Placement(
      {
        tracks: [
          { id: "backend", title: "Backend", chapter_order: ["ui"] },
          { id: "frontend", title: "Frontend", chapter_order: ["api"] },
        ],
        chapters: [
          {
            id: "api",
            title: "API",
            track_id: "backend",
            files: ["src/api.ts"],
          },
          {
            id: "ui",
            title: "UI",
            track_id: "frontend",
            files: ["src/ui.ts"],
          },
        ],
        appendix: [],
        context_requests: [],
      },
      manifest,
    );

    expect(validation.valid).toBe(false);
    expect(validation.feedback).toContain("ordered under its declared track");
  });

  it("places residual files in misc and keeps attention at its floor", () => {
    const manifest = [row("src/auth/api.ts", "STANDARD"), row("src/ui.ts", "SKIM")];
    const outline = buildOutline(
      {
        tracks: [{ id: "main", title: "Main", chapter_order: ["api"] }],
        chapters: [
          { id: "api", title: "API", track_id: "main", files: ["src/auth/api.ts"] },
        ],
        appendix: [],
        context_requests: [],
      },
      manifest,
    );
    expect(outline.chapters.map((chapter) => chapter.id)).toEqual([
      "api",
      "chapter-misc",
    ]);

    const built = buildChapterCard(outline.chapters[0]!, manifest, [], {
      summary: {
        text: "bad citation",
        kind: "observed",
        evidence: [{ path: "missing.ts", lines: [1, 2] }],
      },
      files: [
        {
          path: "src/auth/api.ts",
          note: "unsupported model note",
          anchor_hunks: [[100, 120]],
        },
      ],
      scrutinize: [],
      related_tests: {
        status: "none_found",
        note: "ignored",
        search_scope: "ignored",
      },
      attention: { level: "SKIM", reasons: [] },
    });
    expect(built.chapter.attention.level).toBe("STANDARD");
    expect(built.chapter.summary.text).toContain("changes 1 file");
    expect(built.chapter.files[0]?.note).not.toContain("unsupported");
    expect(built.droppedAnchors).toBe(2);
    expect(built.droppedClaims).toBe(1);
  });

  it("keeps supported model content and grounds related-test facts", () => {
    const manifest = [row("src/api.ts", "SKIM")];
    const outline = buildOutline(undefined, manifest);
    const built = buildChapterCard(outline.chapters[0]!, manifest, [], {
      summary: {
        text: "The API now normalizes the request.",
        kind: "observed",
        evidence: [{ path: "src/api.ts", lines: [1, 50] }],
      },
      files: [{
        path: "src/api.ts",
        note: "Normalizes the incoming value.",
        anchor_hunks: [[1, 50]],
      }],
      scrutinize: [{
        text: "Check callers that pass an empty value.",
        kind: "inferred",
        evidence: [{ path: "src/api.ts", lines: [1, 2] }],
      }],
      related_tests: {
        status: "none_found",
        note: "All behavior is fully covered by tests.",
        search_scope: "tests/**",
      },
      attention: { level: "DEEP_READ", reasons: ["request boundary changed"] },
    });

    expect(built.chapter.summary.text).toBe("The API now normalizes the request.");
    expect(built.chapter.summary.evidence[0]?.lines).toEqual([1, 10]);
    expect(built.chapter.files[0]).toMatchObject({
      note: "Normalizes the incoming value.",
      anchor_hunks: [[1, 10]],
    });
    expect(built.chapter.scrutinize).toHaveLength(1);
    expect(built.chapter.attention.level).toBe("DEEP_READ");
    expect(built.chapter.related_tests.note).toBe(
      "Text search found no test-file references to the extracted changed symbols.",
    );
    expect(built.droppedAnchors).toBe(0);
    expect(built.droppedClaims).toBe(0);
  });

  it("anchors deleted-file fallbacks to real removed-line ranges", () => {
    const deleted = {
      ...row("src/legacy.ts", "SKIM"),
      status: "removed",
      lineCount: 7,
      hunks: [{ oldStart: 5, oldLines: 3, newStart: 0, newLines: 0 }],
      content: null,
    };
    const outline = buildOutline(undefined, [deleted]);
    const chapter = buildChapterCard(outline.chapters[0]!, [deleted], []).chapter;

    expect(chapter.summary.evidence).toEqual([
      { path: "src/legacy.ts", lines: [5, 7] },
    ]);
    expect(chapter.files[0]?.anchor_hunks).toEqual([[5, 7]]);
  });

  it("builds stats-only chapters and deterministic synthesis fallbacks", () => {
    const manifest = [row("src/api.ts", "SKIM"), row("src/ui.ts", "SKIM")];
    const outline = buildOutline(undefined, manifest);
    const chapters = outline.chapters.map(
      (chapter) => buildChapterCard(chapter, manifest, []).chapter,
    );
    const artifact = assembleArtifact(
      {
        repo_node_id: "R_test",
        pr: 7,
        head_oid: "abc123",
        versions: { analyzer: 1, prompt: 1, schema: 1 },
      },
      outline,
      chapters,
      manifest,
      [],
      {
        exec_summary: {
          text: "Unsupported executive claim",
          evidence: [{ path: "missing.ts", lines: [1, 2] }],
        },
        tracks: [],
        cross_chapter_observations: [],
      },
    );
    expect(StoryArtifactSchema.safeParse(artifact).success).toBe(true);
    expect(artifact.tracks[0]?.entry_points[0]?.persona).toBe("reviewer");
    expect(artifact.tracks[0]?.flow).toHaveLength(chapters.length);
    expect(artifact.exec_summary.text).not.toContain("Unsupported");
  });
});

function row(path: string, floor: "SKIM" | "STANDARD"): ManifestRow {
  return {
    path,
    previousPath: null,
    status: "modified",
    additions: 2,
    deletions: 1,
    changes: 3,
    patch: "@@ -1 +1 @@",
    lineCount: 10,
    hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1 }],
    noiseReason: null,
    roles: ["shared"],
    attentionFloor: floor,
    symbols: [],
    importsChangedFiles: [],
    importedByChangedFiles: [],
    relatedTests: {
      status: "none_found",
      paths: [],
      searchScope: "tests/**",
    },
    content: "export const value = 1;\n",
  };
}
