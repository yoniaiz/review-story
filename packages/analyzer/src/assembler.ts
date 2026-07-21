import {
  StoryArtifactSchema,
  type AttentionLevel,
  type Chapter,
  type StoryArtifact,
  type StoryCacheIdentity,
} from "@review-story/contracts";
import { clampLineRange, validateClaim, validateEvidenceAnchors } from "./anchor-validator.js";
import type {
  Stage1Output,
  Stage2Output,
  Stage3Output,
} from "./stage-schemas.js";
import type {
  ManifestRow,
  OutlineChapter,
  OutlineTrack,
  ResolvedContext,
  StoryOutline,
} from "./types.js";

const attentionRank = { SKIM: 0, STANDARD: 1, DEEP_READ: 2 } as const;

export function stage1PlacementIsComplete(
  output: Stage1Output,
  manifest: ManifestRow[],
): boolean {
  return validateStage1Placement(output, manifest).valid;
}

export function validateStage1Placement(
  output: Stage1Output,
  manifest: ManifestRow[],
): { valid: boolean; feedback: string } {
  const known = new Set(manifest.map((row) => row.path));
  const noise = new Set(
    manifest.filter((row) => row.noiseReason).map((row) => row.path),
  );
  const chapterIds = output.chapters.map((chapter) => chapter.id);
  const trackIds = output.tracks.map((track) => track.id);
  const knownTracks = new Set(trackIds);
  const orderedChapterIds = output.tracks.flatMap((track) => track.chapter_order);
  const counts = new Map<string, number>();
  const unknown = new Set<string>();
  for (const path of [
    ...output.chapters.flatMap((chapter) => chapter.files),
    ...output.appendix.map((file) => file.path),
  ]) {
    if (!known.has(path)) unknown.add(path);
    counts.set(path, (counts.get(path) ?? 0) + 1);
  }
  const appendix = new Set(output.appendix.map((file) => file.path));
  const missing = [...known].filter((path) => !counts.has(path));
  const duplicated = [...known].filter((path) => (counts.get(path) ?? 0) > 1);
  const nonNoiseAppendix = output.appendix
    .map((file) => file.path)
    .filter((path) => known.has(path) && !noise.has(path));
  const missingNoise = [...noise].filter((path) => !appendix.has(path));
  const issues: string[] = [];
  if (unknown.size > 0) issues.push(`unknown files: ${preview(unknown)}`);
  if (missing.length > 0) issues.push(`missing files: ${preview(missing)}`);
  if (duplicated.length > 0) issues.push(`duplicated files: ${preview(duplicated)}`);
  if (nonNoiseAppendix.length > 0) {
    issues.push(`non-noise files placed in appendix: ${preview(nonNoiseAppendix)}`);
  }
  if (missingNoise.length > 0) {
    issues.push(`pre-binned noise missing from appendix: ${preview(missingNoise)}`);
  }
  if (output.tracks.length === 0 || new Set(trackIds).size !== trackIds.length) {
    issues.push("track ids must be present and unique");
  }
  if (new Set(chapterIds).size !== chapterIds.length) {
    issues.push("chapter ids must be unique");
  }
  if (output.chapters.some((chapter) => !knownTracks.has(chapter.track_id))) {
    issues.push("every chapter must reference a known track");
  }
  const chaptersById = new Map(output.chapters.map((chapter) => [chapter.id, chapter]));
  if (
    output.tracks.some((track) =>
      track.chapter_order.some(
        (chapterId) => chaptersById.get(chapterId)?.track_id !== track.id,
      ),
    )
  ) {
    issues.push("each chapter must be ordered under its declared track");
  }
  if (
    orderedChapterIds.length !== chapterIds.length ||
    new Set(orderedChapterIds).size !== orderedChapterIds.length ||
    orderedChapterIds.some((chapterId) => !chapterIds.includes(chapterId))
  ) {
    issues.push("track chapter_order must contain every chapter exactly once");
  }
  if (
    output.context_requests.length > 10 ||
    output.context_requests.some((request) =>
      request.chapter_ids.some((chapterId) => !chapterIds.includes(chapterId)),
    )
  ) {
    issues.push("context requests must reference known chapters and cannot exceed ten");
  }
  return {
    valid: issues.length === 0,
    feedback: issues.join("; "),
  };
}

function preview(values: Iterable<string>): string {
  const items = [...values];
  const shown = items.slice(0, 10).join(", ");
  return items.length > 10 ? `${shown} (+${items.length - 10} more)` : shown;
}

export function buildOutline(
  output: Stage1Output | undefined,
  manifest: ManifestRow[],
  directoryFallback = false,
): StoryOutline {
  const byPath = new Map(manifest.map((row) => [row.path, row]));
  const appendixReasons: Record<string, string> = {};
  for (const row of manifest) {
    if (row.noiseReason) appendixReasons[row.path] = row.noiseReason;
  }
  for (const item of output?.appendix ?? []) {
    if (byPath.get(item.path)?.noiseReason && item.reason.trim()) {
      appendixReasons[item.path] ??= item.reason.trim();
    }
  }
  const appendixFiles = new Set(Object.keys(appendixReasons));
  const usedFiles = new Set<string>();
  const usedChapterIds = new Set<string>();
  const chapters: OutlineChapter[] = [];

  for (const [index, candidate] of (output?.chapters ?? []).entries()) {
    const files = candidate.files.filter(
      (path) => byPath.has(path) && !appendixFiles.has(path) && !usedFiles.has(path),
    );
    if (files.length === 0) continue;
    files.forEach((path) => usedFiles.add(path));
    const id = uniqueId(candidate.id, `chapter-${index + 1}`, usedChapterIds);
    chapters.push({
      id,
      title: nonempty(candidate.title, humanizeId(id)),
      trackId: safeId(candidate.track_id, "main"),
      files,
    });
  }

  const unplaced = manifest.filter(
    (row) => !appendixFiles.has(row.path) && !usedFiles.has(row.path),
  );
  if (unplaced.length > 0) {
    if (directoryFallback && !output) {
      for (const [directory, rows] of groupByDirectory(unplaced)) {
        const id = uniqueId(`chapter-${directory}`, "chapter-root", usedChapterIds);
        chapters.push({
          id,
          title: directory === "root" ? "Root-level changes" : `${directory} changes`,
          trackId: "main",
          files: rows.map((row) => row.path),
        });
      }
    } else {
      chapters.push({
        id: uniqueId(
          output ? "chapter-misc" : "chapter-all-changes",
          "chapter-all-changes",
          usedChapterIds,
        ),
        title: output ? "Other changes" : "All meaningful changes",
        trackId: "main",
        files: unplaced.map((row) => row.path),
      });
    }
  }

  if (chapters.length === 0) {
    const promoted = manifest[0];
    if (!promoted) throw new Error("Cannot build a story for a pull request with no files");
    appendixFiles.delete(promoted.path);
    delete appendixReasons[promoted.path];
    chapters.push({
      id: "chapter-mechanical-changes",
      title: "Mechanical changes",
      trackId: "main",
      files: [promoted.path],
    });
  }

  const tracks = normalizeOutlineTracks(output, chapters);
  const validChapterIds = new Set(chapters.map((chapter) => chapter.id));
  const contextRequests = (output?.context_requests ?? [])
    .slice(0, 10)
    .map((request) => ({
      path: request.path,
      chapterIds: request.chapter_ids.filter((id) => validChapterIds.has(id)),
      reason: request.reason,
    }));

  return {
    tracks,
    chapters,
    appendix: {
      files: [...appendixFiles].sort(),
      reasons: Object.fromEntries(
        [...appendixFiles].sort().map((path) => [path, appendixReasons[path] ?? "mechanical change"]),
      ),
    },
    contextRequests,
  };
}

export function buildChapterCard(
  outlineChapter: OutlineChapter,
  manifest: ManifestRow[],
  context: ResolvedContext[],
  output?: Stage2Output,
): { chapter: Chapter; droppedAnchors: number; droppedClaims: number } {
  const rows = outlineChapter.files
    .map((path) => manifest.find((row) => row.path === path))
    .filter((row): row is ManifestRow => Boolean(row));
  if (rows.length === 0) throw new Error(`Chapter ${outlineChapter.id} has no files`);
  const lineCounts = new Map(rows.map((row) => [row.path, row.lineCount]));
  for (const item of context) lineCounts.set(item.path, item.lineCount);
  let droppedAnchors = 0;
  let droppedClaims = 0;

  const fallbackSummary = deterministicSummary(outlineChapter, rows);
  const checkedSummary = output
    ? validateClaim(output.summary, lineCounts)
    : { value: null, droppedAnchors: 0, droppedClaims: 0 };
  droppedAnchors += checkedSummary.droppedAnchors;
  droppedClaims += checkedSummary.droppedClaims;
  const summary = checkedSummary.value ?? fallbackSummary;

  const notes = new Map(output?.files.map((file) => [file.path, file]) ?? []);
  const storyFiles = rows.map((row) => {
    const modelFile = notes.get(row.path);
    const anchors: [number, number][] = [];
    for (const candidate of modelFile?.anchor_hunks ?? []) {
      const range = clampLineRange(candidate, row.lineCount);
      if (range) anchors.push(range);
      else droppedAnchors += 1;
    }
    return {
      path: row.path,
      note:
        modelFile && anchors.length > 0
          ? nonempty(modelFile.note, deterministicFileNote(row))
          : deterministicFileNote(row),
      anchor_hunks: anchors.length > 0 ? anchors : fallbackHunks(row),
    };
  });

  const scrutinize = [];
  for (const claim of output?.scrutinize ?? []) {
    const checked = validateClaim(claim, lineCounts);
    droppedAnchors += checked.droppedAnchors;
    droppedClaims += checked.droppedClaims;
    if (checked.value) scrutinize.push(checked.value);
  }

  const floor = highestAttention(rows.map((row) => row.attentionFloor));
  const requestedLevel = output?.attention.level ?? floor;
  const level =
    attentionRank[requestedLevel] < attentionRank[floor] ? floor : requestedLevel;
  const deterministicReasons = rows
    .filter((row) => row.attentionFloor === "STANDARD")
    .map((row) => `trust-sensitive path: ${row.path}`);
  const reasons = [
    ...new Set(
      [...(output?.attention.reasons ?? []), ...deterministicReasons]
        .map((reason) => reason.trim())
        .filter(Boolean),
    ),
  ];

  return {
    chapter: {
      id: outlineChapter.id,
      title: outlineChapter.title,
      summary,
      files: storyFiles,
      scrutinize,
      related_tests: deterministicRelatedTests(rows),
      attention: {
        level,
        floor,
        reasons: reasons.length > 0 ? reasons : ["changed code"],
      },
    },
    droppedAnchors,
    droppedClaims,
  };
}

export function assembleArtifact(
  identity: StoryCacheIdentity,
  outline: StoryOutline,
  chapters: Chapter[],
  manifest: ManifestRow[],
  context: ResolvedContext[],
  output?: Stage3Output,
): StoryArtifact {
  const chapterIds = new Set(chapters.map((chapter) => chapter.id));
  const lineCounts = new Map(manifest.map((row) => [row.path, row.lineCount]));
  for (const item of context) lineCounts.set(item.path, item.lineCount);
  const stageTracks = new Map(output?.tracks.map((track) => [track.id, track]) ?? []);
  const tracks = outline.tracks.map((outlineTrack) => {
    const candidate = stageTracks.get(outlineTrack.id);
    const allowed = new Set(outlineTrack.chapterOrder);
    const order = uniqueStrings(candidate?.chapter_order ?? []).filter(
      (id) => allowed.has(id) && chapterIds.has(id),
    );
    for (const id of outlineTrack.chapterOrder) {
      if (chapterIds.has(id) && !order.includes(id)) order.push(id);
    }
    const entryPoints = (candidate?.entry_points ?? [])
      .filter(
        (entry) =>
          entry.persona.trim() &&
          entry.note.trim() &&
          allowed.has(entry.start_chapter) &&
          chapterIds.has(entry.start_chapter),
      )
      .map((entry) => ({
        persona: entry.persona.trim(),
        start_chapter: entry.start_chapter,
        note: entry.note.trim(),
      }));
    const flow: StoryArtifact["tracks"][number]["flow"] = [];
    for (const node of candidate?.flow ?? []) {
      if (node.kind === "code") {
        if (
          !node.chapter_id ||
          !allowed.has(node.chapter_id) ||
          !chapterIds.has(node.chapter_id)
        ) continue;
        flow.push({
          chapter_id: node.chapter_id,
          label: nonempty(node.label, "Code"),
          kind: "code",
        });
        continue;
      }
      if (node.chapter_id !== null) continue;
      const checked = validateEvidenceAnchors(node.evidence, lineCounts);
      if (checked.value.length === 0) continue;
      flow.push({
        chapter_id: null,
        label: nonempty(node.label, "External system"),
        kind: "external",
        evidence: checked.value,
      });
    }
    const finalOrder = order.length > 0 ? order : chapters.map((chapter) => chapter.id);
    return {
      id: outlineTrack.id,
      title: outlineTrack.title,
      entry_points:
        entryPoints.length > 0
          ? entryPoints
          : [{
              persona: "reviewer",
              start_chapter: finalOrder[0] ?? chapters[0]!.id,
              note: candidate?.rationale.trim() || "Read the change in dependency order.",
            }],
      flow:
        flow.length > 0
          ? flow
          : finalOrder.map((id) => ({
              chapter_id: id,
              label: chapters.find((chapter) => chapter.id === id)?.title ?? id,
              kind: "code" as const,
            })),
      chapter_order: finalOrder,
    };
  });

  const execEvidence = output
    ? validateEvidenceAnchors(output.exec_summary.evidence, lineCounts).value
    : [];
  const fallbackEvidence = chapters.flatMap((chapter) => chapter.summary.evidence).slice(0, 6);
  const modelSummaryIsSupported = Boolean(
    output?.exec_summary.text.trim() && execEvidence.length > 0,
  );
  const exec_summary = {
    text: modelSummaryIsSupported
      ? output!.exec_summary.text.trim()
      : `This pull request changes ${manifest.length} files across ${chapters.length} review chapters.`,
    evidence: modelSummaryIsSupported ? execEvidence : fallbackEvidence,
  };

  return StoryArtifactSchema.parse({
    meta: {
      repo_node_id: identity.repo_node_id,
      pr: identity.pr,
      head_oid: identity.head_oid,
      versions: identity.versions,
      status: "READY",
    },
    exec_summary,
    tracks,
    chapters,
    appendix: outline.appendix,
  });
}

function normalizeOutlineTracks(
  output: Stage1Output | undefined,
  chapters: OutlineChapter[],
): OutlineTrack[] {
  const tracks: OutlineTrack[] = [];
  const usedIds = new Set<string>();
  const assignedChapters = new Set<string>();
  for (const [index, candidate] of (output?.tracks ?? []).entries()) {
    const id = uniqueId(candidate.id, `track-${index + 1}`, usedIds);
    const order = uniqueStrings(candidate.chapter_order).filter((chapterId) => {
      const chapter = chapters.find((item) => item.id === chapterId);
      return chapter && !assignedChapters.has(chapterId);
    });
    for (const chapter of chapters) {
      if (chapter.trackId === id && !order.includes(chapter.id) && !assignedChapters.has(chapter.id)) {
        order.push(chapter.id);
      }
    }
    if (order.length === 0) continue;
    order.forEach((chapterId) => assignedChapters.add(chapterId));
    tracks.push({ id, title: nonempty(candidate.title, humanizeId(id)), chapterOrder: order });
  }
  const residual = chapters
    .map((chapter) => chapter.id)
    .filter((id) => !assignedChapters.has(id));
  if (tracks.length === 0) {
    tracks.push({ id: "main", title: "Pull request changes", chapterOrder: residual });
  } else if (residual.length > 0) {
    tracks[0]!.chapterOrder.push(...residual);
  }
  return tracks;
}

function deterministicSummary(
  chapter: OutlineChapter,
  rows: ManifestRow[],
): Chapter["summary"] {
  const first = rows[0]!;
  return {
    text: `${chapter.title} changes ${rows.length} file${rows.length === 1 ? "" : "s"} with ${rows.reduce((sum, row) => sum + row.additions, 0)} additions and ${rows.reduce((sum, row) => sum + row.deletions, 0)} deletions.`,
    kind: "observed",
    evidence: [{ path: first.path, lines: fallbackHunks(first)[0]! }],
  };
}

function deterministicFileNote(row: ManifestRow): string {
  return `${row.status} with ${row.additions} additions and ${row.deletions} deletions`;
}

function fallbackHunks(row: ManifestRow): [number, number][] {
  const ranges = row.hunks
    .map((hunk) => {
      const useRemovedLines = row.status === "removed" || hunk.newLines === 0;
      const start = useRemovedLines ? hunk.oldStart : hunk.newStart;
      const count = useRemovedLines ? hunk.oldLines : hunk.newLines;
      return clampLineRange(
        [start, start + Math.max(0, count - 1)],
        row.lineCount,
      );
    })
    .filter((range): range is [number, number] => Boolean(range));
  return ranges.length > 0 ? ranges : [[1, 1]];
}

function deterministicRelatedTests(rows: ManifestRow[]): Chapter["related_tests"] {
  const foundPaths = uniqueStrings(rows.flatMap((row) => row.relatedTests.paths));
  const searched = rows.filter((row) => row.relatedTests.status !== "not_searched");
  const searchScope = uniqueStrings(rows.map((row) => row.relatedTests.searchScope)).join("; ");
  if (foundPaths.length > 0) {
    return {
      status: "found",
      note: `Text search found changed-symbol references in ${foundPaths.join(", ")}.`,
      search_scope: searchScope || "workspace test files",
    };
  }
  if (searched.length > 0) {
    return {
      status: "none_found",
      note: "Text search found no test-file references to the extracted changed symbols.",
      search_scope: searchScope || "workspace test files",
    };
  }
  return {
    status: "not_searched",
    note: "No changed symbols or workspace test files were available for text search.",
    search_scope: searchScope || "workspace unavailable",
  };
}

function highestAttention(levels: AttentionLevel[]): AttentionLevel {
  return levels.reduce<AttentionLevel>(
    (highest, level) =>
      attentionRank[level] > attentionRank[highest] ? level : highest,
    "SKIM",
  );
}

function groupByDirectory(rows: ManifestRow[]): Map<string, ManifestRow[]> {
  const groups = new Map<string, ManifestRow[]>();
  for (const row of rows) {
    const directory = row.path.includes("/") ? row.path.split("/")[0]! : "root";
    const group = groups.get(directory) ?? [];
    group.push(row);
    groups.set(directory, group);
  }
  return groups;
}

function uniqueId(value: string, fallback: string, used: Set<string>): string {
  const base = safeId(value, fallback);
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) candidate = `${base}-${suffix++}`;
  used.add(candidate);
  return candidate;
}

function safeId(value: string, fallback: string): string {
  return value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9_-]+/g, "-")
    .replaceAll(/^-+|-+$/g, "") || fallback;
}

function nonempty(value: string | undefined, fallback: string): string {
  return value?.trim() || fallback;
}

function humanizeId(value: string): string {
  const text = value.replaceAll(/[-_]+/g, " ").trim();
  return text ? text[0]!.toUpperCase() + text.slice(1) : "Changes";
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
