import type { StoryArtifact } from "@review-story/contracts";
import type {
  ReviewEvidence,
  ReviewPlan,
  ReviewStepStatus,
  Severity,
} from "./review-plan";

export function storyArtifactToReviewPlan(
  artifact: StoryArtifact,
  repo: string,
  completedChapterIds: string[] = [],
): ReviewPlan {
  const completed = new Set(completedChapterIds);
  const severityFor = (level: StoryArtifact["chapters"][number]["attention"]["level"]): Severity => {
    if (level === "DEEP_READ") return "needs-human";
    if (level === "SKIM") return "noise";
    return "standard";
  };
  const statusFor = (chapterId: string): ReviewStepStatus =>
    completed.has(chapterId) ? "reviewed" : "pending";
  const severityRank: Record<Severity, number> = { noise: 0, standard: 1, "needs-human": 2 };
  const chaptersById = new Map(artifact.chapters.map((chapter) => [chapter.id, chapter]));
  const orderedChapterIds = artifact.tracks.flatMap(({ chapter_order }) => chapter_order);
  const orderedChapters = [
    ...orderedChapterIds.map((id) => chaptersById.get(id)).filter((chapter) => chapter !== undefined),
    ...artifact.chapters.filter((chapter) => !orderedChapterIds.includes(chapter.id)),
  ];

  // Per-file signal: files cited by scrutiny claims carry the chapter's full
  // weight, trust-sensitive paths stay at least standard, and everything else
  // in the chapter is low signal — capped by the chapter's own level.
  const fileSeverity = (
    chapter: StoryArtifact["chapters"][number],
    file: StoryArtifact["chapters"][number]["files"][number],
  ): Severity => {
    const chapterSeverity = severityFor(chapter.attention.level);
    if (file.attention_floor === undefined) return chapterSeverity;
    const citedBy = (claims: { evidence: { path: string }[] }[]) =>
      claims.some((claim) => claim.evidence.some((item) => item.path === file.path));
    const citationSeverity: Severity = citedBy(chapter.scrutinize)
      ? "needs-human"
      : citedBy([chapter.summary]) ? "standard" : "noise";
    const floorSeverity = severityFor(file.attention_floor);
    const merged = severityRank[floorSeverity] > severityRank[citationSeverity]
      ? floorSeverity
      : citationSeverity;
    return severityRank[merged] > severityRank[chapterSeverity] ? chapterSeverity : merged;
  };

  const files = orderedChapters.flatMap((chapter) => chapter.files.map((file) => ({
    id: file.path,
    path: file.path,
    chapterId: chapter.id,
    severity: fileSeverity(chapter, file),
    noiseReason: null,
    summary: file.note,
  })));

  const chapters = orderedChapters.map((chapter) => {
    const summaryEntryPoint = chapter.summary.evidence.find((evidence) =>
      chapter.files.some((file) => file.path === evidence.path));
    return {
      id: chapter.id,
      title: chapter.title,
      summary: chapter.summary.text,
      entryPoint: summaryEntryPoint?.path ?? chapter.files[0]!.path,
      fileIds: chapter.files.map(({ path }) => path),
      status: completed.has(chapter.id) ? "done" as const : "pending" as const,
      steps: chapter.files.map((file, index) => {
        const claimAnchor = [chapter.summary, ...chapter.scrutinize]
          .flatMap((claim) => claim.evidence)
          .find((evidence) => evidence.path === file.path);
        const line = claimAnchor?.lines[0] ?? file.anchor_hunks[0]?.[0];
        return {
          fileId: file.path,
          order: index + 1,
          reason: file.note,
          evidence: evidenceForFile(artifact, chapter, file.path),
          ...(line ? { line, side: "RIGHT" as const } : {}),
          status: statusFor(chapter.id),
        };
      }),
    };
  });

  return {
    repo,
    pr: artifact.meta.pr,
    headSha: artifact.meta.head_oid,
    title: artifact.exec_summary.text,
    stats: {
      totalFiles: files.length + artifact.appendix.files.length,
      noiseFiles: artifact.appendix.files.length,
      chapters: chapters.length,
    },
    chapters,
    files,
    graph: buildChapterGraph(orderedChapters, severityFor),
  };
}

function buildChapterGraph(
  orderedChapters: StoryArtifact["chapters"],
  severityFor: (level: StoryArtifact["chapters"][number]["attention"]["level"]) => Severity,
): ReviewPlan["graph"] {
  const graphChapters = orderedChapters.slice(0, 10);
  const nodeIds = new Set(graphChapters.map((chapter) => chapter.id));
  const chapterByFile = new Map(orderedChapters.flatMap((chapter) =>
    chapter.files.map((file) => [file.path, chapter.id] as const)));

  const edgeKeys = new Set<string>();
  const edges: ReviewPlan["graph"]["edges"] = [];
  for (const chapter of graphChapters) {
    for (const file of chapter.files) {
      for (const imported of file.imports_changed_files ?? []) {
        const target = chapterByFile.get(imported);
        if (!target || target === chapter.id || !nodeIds.has(target)) continue;
        const key = `${chapter.id}->${target}`;
        if (edgeKeys.has(key)) continue;
        edgeKeys.add(key);
        edges.push({ source: chapter.id, target, kind: "imports" });
      }
    }
  }

  return {
    nodes: graphChapters.map((chapter) => ({
      id: chapter.id,
      label: chapter.title,
      chapterId: chapter.id,
      severity: severityFor(chapter.attention.level),
      fileIds: chapter.files.map(({ path }) => path),
      changed: true,
    })),
    edges,
  };
}

function evidenceForFile(
  artifact: StoryArtifact,
  chapter: StoryArtifact["chapters"][number],
  path: string,
): ReviewEvidence[] {
  const claims = [chapter.summary, ...chapter.scrutinize];
  const evidence = claims.flatMap((claim) => claim.evidence
    .filter((item) => item.path === path)
    .map((item) => ({
      kind: claim.kind === "inferred" ? "risk" as const : "changed" as const,
      description: `${claim.text} (${item.path}:${item.lines[0]}–${item.lines[1]})`,
      relatedFile: item.path,
    })));
  if (evidence.length > 0) return evidence;

  const fallback = artifact.exec_summary.evidence.find((item) => item.path === path);
  return [{
    kind: "changed",
    description: fallback
      ? `${chapter.summary.text} (${fallback.path}:${fallback.lines[0]}–${fallback.lines[1]})`
      : chapter.summary.text,
    ...(fallback ? { relatedFile: fallback.path } : {}),
  }];
}
