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
  const chaptersById = new Map(artifact.chapters.map((chapter) => [chapter.id, chapter]));
  const orderedChapterIds = artifact.tracks.flatMap(({ chapter_order }) => chapter_order);
  const orderedChapters = [
    ...orderedChapterIds.map((id) => chaptersById.get(id)).filter((chapter) => chapter !== undefined),
    ...artifact.chapters.filter((chapter) => !orderedChapterIds.includes(chapter.id)),
  ];

  const files = orderedChapters.flatMap((chapter) => chapter.files.map((file) => ({
    id: file.path,
    path: file.path,
    chapterId: chapter.id,
    severity: severityFor(chapter.attention.level),
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
    graph: {
      nodes: chapters.slice(0, 10).map((chapter) => ({
        id: chapter.id,
        label: chapter.title,
        chapterId: chapter.id,
        severity: files.find((file) => file.chapterId === chapter.id)?.severity ?? "standard",
        fileIds: chapter.fileIds,
        changed: true,
      })),
      edges: [],
    },
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
