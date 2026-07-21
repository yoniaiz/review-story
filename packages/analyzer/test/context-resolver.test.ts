import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveContextRequests } from "../src/context-resolver.js";
import type { ManifestRow, StoryOutline } from "../src/types.js";

describe("context resolver", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((path) =>
        rm(path, { recursive: true, force: true })
      ),
    );
  });

  it("resolves deduplicated requests into chapter-scoped signature skeletons", async () => {
    const workspace = await temporaryWorkspace();
    await writeSource(
      workspace,
      "src/shared.ts",
      [
        "export interface SharedRequest { value: string }",
        "export function normalize(value: string) {",
        "  const bodyMustNotLeak = value.trim();",
        "  return bodyMustNotLeak;",
        "}",
        "export const publicDefault = (request: SharedRequest): string => " +
          '"TOP_LEVEL_BODY_MARKER";',
        "export function inlineRequest(request: { value: string }) {",
        '  return "INLINE_FUNCTION_BODY_MARKER";',
        "}",
      ].join("\n"),
    );
    await writeSource(workspace, "src/invalid.ts", "export function broken( {");
    await writeSource(workspace, "src/binary.ts", new Uint8Array([159, 255]));
    await writeSource(workspace, "src/changed.ts", "export const changed = true;\n");

    const resolved = await resolveContextRequests(
      outline([
        { path: "src/shared.ts", chapterIds: ["api"], reason: "shared contract" },
        { path: "src/shared.ts", chapterIds: ["ui"], reason: "same dependency" },
        { path: "src/missing.ts", chapterIds: ["api"], reason: "missing" },
        { path: "src/invalid.ts", chapterIds: ["api"], reason: "invalid" },
        { path: "src/binary.ts", chapterIds: ["api"], reason: "binary" },
        { path: "src/changed.ts", chapterIds: ["api"], reason: "already changed" },
        { path: "../escape.ts", chapterIds: ["api"], reason: "unsafe" },
        { path: "src/shared.ts", chapterIds: ["unknown"], reason: "unknown chapter" },
      ]),
      [manifestRow("src/changed.ts")],
      workspace,
      { maxContextFiles: 10, maxContextCharacters: 80_000 },
    );

    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toMatchObject({
      path: "src/shared.ts",
      chapterIds: ["api", "ui"],
      reason: "shared contract",
      lineCount: 9,
    });
    expect(resolved[0]?.skeleton).toContain("SharedRequest");
    expect(resolved[0]?.skeleton).toContain("normalize");
    expect(resolved[0]?.skeleton).toContain("publicDefault");
    expect(resolved[0]?.skeleton).toContain(
      "publicDefault = (request: SharedRequest): string =>",
    );
    expect(resolved[0]?.skeleton).toContain(
      "inlineRequest(request: { value: string })",
    );
    expect(resolved[0]?.skeleton).not.toContain("bodyMustNotLeak");
    expect(resolved[0]?.skeleton).not.toContain("TOP_LEVEL_BODY_MARKER");
    expect(resolved[0]?.skeleton).not.toContain("INLINE_FUNCTION_BODY_MARKER");
  });

  it("honors both the file cap and the shared character budget", async () => {
    const workspace = await temporaryWorkspace();
    for (let index = 0; index < 3; index += 1) {
      await writeSource(
        workspace,
        `src/context-${index}.ts`,
        `export function context${index}(value: string) {\n  return value;\n}\n`,
      );
    }
    const requests = [0, 1, 2].map((index) => ({
      path: `src/context-${index}.ts`,
      chapterIds: ["api"],
      reason: "dependency",
    }));

    const fileCapped = await resolveContextRequests(
      outline(requests),
      [],
      workspace,
      { maxContextFiles: 2, maxContextCharacters: 80_000 },
    );
    expect(fileCapped.map(({ path }) => path)).toEqual([
      "src/context-0.ts",
      "src/context-1.ts",
    ]);

    const budgetCapped = await resolveContextRequests(
      outline(requests),
      [],
      workspace,
      { maxContextFiles: 10, maxContextCharacters: 50 },
    );
    expect(budgetCapped).toHaveLength(1);
    expect(
      budgetCapped.reduce((sum, item) => sum + item.skeleton.length, 0),
    ).toBeLessThanOrEqual(50);
  });

  async function temporaryWorkspace(): Promise<string> {
    const path = await mkdtemp(join(tmpdir(), "review-story-context-"));
    temporaryDirectories.push(path);
    return path;
  }
});

async function writeSource(
  workspace: string,
  path: string,
  contents: string | Uint8Array,
): Promise<void> {
  const target = join(workspace, path);
  await mkdir(join(target, ".."), { recursive: true });
  await writeFile(target, contents);
}

function outline(contextRequests: StoryOutline["contextRequests"]): StoryOutline {
  return {
    tracks: [{ id: "main", title: "Main", chapterOrder: ["api", "ui"] }],
    chapters: [
      { id: "api", title: "API", trackId: "main", files: ["src/api.ts"] },
      { id: "ui", title: "UI", trackId: "main", files: ["src/ui.ts"] },
    ],
    appendix: { files: [], reasons: {} },
    contextRequests,
  };
}

function manifestRow(path: string): ManifestRow {
  return {
    path,
    previousPath: null,
    status: "modified",
    additions: 1,
    deletions: 0,
    changes: 1,
    patch: "@@ -1 +1 @@",
    lineCount: 1,
    hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1 }],
    noiseReason: null,
    roles: ["shared"],
    attentionFloor: "SKIM",
    symbols: [],
    importsChangedFiles: [],
    importedByChangedFiles: [],
    relatedTests: {
      status: "not_searched",
      paths: [],
      searchScope: "workspace unavailable",
    },
    content: null,
  };
}
