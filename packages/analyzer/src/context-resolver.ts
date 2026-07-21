import type { AnalyzerConfig } from "./config.js";
import { extractSourceSkeleton } from "./symbol-extractor.js";
import type {
  ContextRequest,
  ManifestRow,
  ResolvedContext,
  StoryOutline,
} from "./types.js";
import { isSafeRepositoryPath, readWorkspaceFile } from "./workspace.js";

export async function resolveContextRequests(
  outline: StoryOutline,
  manifest: ManifestRow[],
  workspacePath: string | null,
  config: Pick<
    AnalyzerConfig,
    "maxContextFiles" | "maxContextCharacters"
  >,
): Promise<ResolvedContext[]> {
  if (!workspacePath) return [];
  const changedPaths = new Set(manifest.map((row) => row.path));
  const chapterIds = new Set(outline.chapters.map((chapter) => chapter.id));
  const requests = dedupeRequests(outline.contextRequests)
    .map((request) => ({
      ...request,
      chapterIds: request.chapterIds.filter((id) => chapterIds.has(id)),
    }))
    .filter(
      (request) =>
        request.chapterIds.length > 0 &&
        isSafeRepositoryPath(request.path) &&
        !changedPaths.has(request.path),
    )
    .slice(0, config.maxContextFiles);
  const resolved: ResolvedContext[] = [];
  let remainingCharacters = config.maxContextCharacters;

  for (const request of requests) {
    if (remainingCharacters <= 0) break;
    const source = await readWorkspaceFile(workspacePath, request.path, 1_000_000);
    if (!source) continue;
    const extracted = extractSourceSkeleton(request.path, source);
    if (!extracted) continue;
    const skeleton = truncateWholeLines(extracted, remainingCharacters);
    if (!skeleton) continue;
    remainingCharacters -= skeleton.length;
    resolved.push({
      path: request.path,
      chapterIds: request.chapterIds,
      reason: request.reason,
      skeleton,
      lineCount: Math.max(
        1,
        source.split("\n").length - (source.endsWith("\n") ? 1 : 0),
      ),
    });
  }
  return resolved;
}

function truncateWholeLines(value: string, limit: number): string {
  if (value.length <= limit) return value;
  const clipped = value.slice(0, limit);
  const finalNewline = clipped.lastIndexOf("\n");
  return finalNewline < 0 ? "" : clipped.slice(0, finalNewline);
}

function dedupeRequests(requests: ContextRequest[]): ContextRequest[] {
  const byPath = new Map<string, ContextRequest>();
  for (const request of requests) {
    const existing = byPath.get(request.path);
    if (existing) {
      existing.chapterIds = [
        ...new Set([...existing.chapterIds, ...request.chapterIds]),
      ];
    } else {
      byPath.set(request.path, {
        ...request,
        chapterIds: [...request.chapterIds],
      });
    }
  }
  return [...byPath.values()];
}
