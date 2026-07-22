import { z } from "zod";

const LineRangeSchema = z
  .tuple([z.number().int().positive(), z.number().int().positive()])
  .refine(([start, end]) => start <= end, {
    message: "Line ranges must be ordered from start to end",
  });

export const EvidenceSchema = z.object({
  path: z.string().min(1),
  lines: LineRangeSchema,
}).strict();

export const ClaimKindSchema = z.enum(["observed", "inferred"]);

export const ClaimSchema = z.object({
  text: z.string().min(1),
  kind: ClaimKindSchema,
  evidence: z.array(EvidenceSchema).min(1),
}).strict();

export const AttentionLevelSchema = z.enum([
  "DEEP_READ",
  "STANDARD",
  "SKIM",
]);

export const StoryMetaSchema = z.object({
  repo_node_id: z.string().min(1),
  pr: z.number().int().positive(),
  head_oid: z.string().min(1),
  versions: z.object({
    analyzer: z.number().int().positive(),
    prompt: z.number().int().positive(),
    schema: z.literal(1),
  }),
  status: z.enum(["GENERATING", "READY", "FAILED"]),
  // Degradations that occurred during analysis (e.g. repository workspace
  // unavailable, so notes are diff-only). Surfaced to reviewers in the UI.
  warnings: z.array(z.string().min(1)).optional(),
}).strict();

export const StoryFileSchema = z.object({
  path: z.string().min(1),
  note: z.string().min(1),
  anchor_hunks: z.array(LineRangeSchema),
  attention_floor: AttentionLevelSchema.optional(),
  imports_changed_files: z.array(z.string().min(1)).optional(),
}).strict();

export const RelatedTestsSchema = z.object({
  status: z.enum(["found", "none_found", "not_searched"]),
  note: z.string().min(1),
  search_scope: z.string().min(1),
}).strict();

export const ChapterSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  summary: ClaimSchema,
  files: z.array(StoryFileSchema).min(1),
  scrutinize: z.array(ClaimSchema),
  related_tests: RelatedTestsSchema,
  attention: z.object({
    level: AttentionLevelSchema,
    floor: AttentionLevelSchema,
    reasons: z.array(z.string().min(1)),
  }).strict(),
}).strict();

export const EntryPointSchema = z.object({
  persona: z.string().min(1),
  start_chapter: z.string().min(1),
  note: z.string().min(1),
}).strict();

export const FlowNodeSchema = z.object({
  chapter_id: z.string().min(1).nullable(),
  label: z.string().min(1),
  kind: z.enum(["code", "external"]),
  evidence: z.array(EvidenceSchema).optional(),
}).strict();

export const TrackSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  entry_points: z.array(EntryPointSchema).min(1),
  flow: z.array(FlowNodeSchema).min(1),
  chapter_order: z.array(z.string().min(1)).min(1),
}).strict();

export const AppendixSchema = z.object({
  files: z.array(z.string().min(1)),
  reasons: z.record(z.string(), z.string().min(1)),
}).strict();

export const StoryArtifactSchema = z
  .object({
    meta: StoryMetaSchema,
    exec_summary: z.object({
      text: z.string().min(1),
      evidence: z.array(EvidenceSchema).min(1),
    }).strict(),
    tracks: z.array(TrackSchema).min(1),
    chapters: z.array(ChapterSchema).min(1),
    appendix: AppendixSchema,
  })
  .strict()
  .superRefine((artifact, context) => {
    if (artifact.meta.status !== "READY") {
      context.addIssue({
        code: "custom",
        message: "A final story artifact must have READY status",
        path: ["meta", "status"],
      });
    }

    const chapterIds = new Set(artifact.chapters.map((chapter) => chapter.id));
    if (chapterIds.size !== artifact.chapters.length) {
      context.addIssue({
        code: "custom",
        message: "Chapter IDs must be unique",
        path: ["chapters"],
      });
    }

    const seenFilePaths = new Map<string, string>();
    const attentionRank = { SKIM: 0, STANDARD: 1, DEEP_READ: 2 } as const;
    for (const [chapterIndex, chapter] of artifact.chapters.entries()) {
      if (
        attentionRank[chapter.attention.level] <
        attentionRank[chapter.attention.floor]
      ) {
        context.addIssue({
          code: "custom",
          message: "Attention level cannot be lower than its deterministic floor",
          path: ["chapters", chapterIndex, "attention", "level"],
        });
      }

      for (const [fileIndex, file] of chapter.files.entries()) {
        const existingOwner = seenFilePaths.get(file.path);
        if (existingOwner) {
          context.addIssue({
            code: "custom",
            message: `${file.path} already belongs to chapter ${existingOwner}`,
            path: ["chapters", chapterIndex, "files", fileIndex, "path"],
          });
        } else {
          seenFilePaths.set(file.path, chapter.id);
        }
      }
    }

    const seenAppendixFiles = new Set<string>();
    for (const [appendixIndex, file] of artifact.appendix.files.entries()) {
      if (seenAppendixFiles.has(file)) {
        context.addIssue({
          code: "custom",
          message: `${file} appears more than once in the appendix`,
          path: ["appendix", "files", appendixIndex],
        });
      }
      seenAppendixFiles.add(file);
      const existingOwner = seenFilePaths.get(file);
      if (existingOwner) {
        context.addIssue({
          code: "custom",
          message: `${file} cannot be in both chapter ${existingOwner} and the appendix`,
          path: ["appendix", "files", appendixIndex],
        });
      }
      if (!artifact.appendix.reasons[file]) {
        context.addIssue({
          code: "custom",
          message: `Missing appendix reason for ${file}`,
          path: ["appendix", "reasons"],
        });
      }
    }

    for (const [trackIndex, track] of artifact.tracks.entries()) {
      for (const chapterId of track.chapter_order) {
        if (!chapterIds.has(chapterId)) {
          context.addIssue({
            code: "custom",
            message: `Unknown chapter ID: ${chapterId}`,
            path: ["tracks", trackIndex, "chapter_order"],
          });
        }
      }
      for (const [entryIndex, entryPoint] of track.entry_points.entries()) {
        if (!chapterIds.has(entryPoint.start_chapter)) {
          context.addIssue({
            code: "custom",
            message: `Unknown entry-point chapter: ${entryPoint.start_chapter}`,
            path: ["tracks", trackIndex, "entry_points", entryIndex],
          });
        }
      }
      for (const [flowIndex, node] of track.flow.entries()) {
        if (node.chapter_id && !chapterIds.has(node.chapter_id)) {
          context.addIssue({
            code: "custom",
            message: `Unknown flow-node chapter: ${node.chapter_id}`,
            path: ["tracks", trackIndex, "flow", flowIndex, "chapter_id"],
          });
        }
        if (node.kind === "external" && node.chapter_id !== null) {
          context.addIssue({
            code: "custom",
            message: "External flow nodes cannot navigate to a chapter",
            path: ["tracks", trackIndex, "flow", flowIndex, "chapter_id"],
          });
        }
        if (node.kind === "code" && node.chapter_id === null) {
          context.addIssue({
            code: "custom",
            message: "Code flow nodes must navigate to a chapter",
            path: ["tracks", trackIndex, "flow", flowIndex, "chapter_id"],
          });
        }
        if (node.kind === "external" && !node.evidence?.length) {
          context.addIssue({
            code: "custom",
            message: "External flow nodes require evidence",
            path: ["tracks", trackIndex, "flow", flowIndex, "evidence"],
          });
        }
      }
    }
  });

export const StorySkeletonSchema = z
  .object({
    meta: StoryMetaSchema,
    tracks: z.array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(1),
        chapter_order: z.array(z.string().min(1)).min(1),
      }).strict(),
    ),
    chapters: z.array(
      z.object({ id: z.string().min(1), title: z.string().min(1) }).strict(),
    ),
    appendix: AppendixSchema,
  })
  .strict()
  .refine((skeleton) => skeleton.meta.status === "GENERATING", {
    message: "A story skeleton must have GENERATING status",
    path: ["meta", "status"],
  });

export const AnalyzeRequestSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  pullNumber: z.number().int().positive(),
}).strict();

export const DiffFileSnapshotSchema = z.object({
  path: z.string().min(1),
  previous_path: z.string().min(1).nullable(),
  status: z.string().min(1),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  changes: z.number().int().nonnegative(),
  patch: z.string().nullable(),
  patch_hash: z.string().min(1),
}).strict();

export const DiffSnapshotSchema = z.object({
  repo_node_id: z.string().min(1),
  pr: z.number().int().positive(),
  base_oid: z.string().min(1),
  head_oid: z.string().min(1),
  files: z.array(DiffFileSnapshotSchema),
}).strict();

export const StageUsageSchema = z.object({
  stage: z.enum(["stage1", "stage2", "stage3"]),
  model: z.string().min(1),
  calls: z.number().int().nonnegative(),
  failures: z.number().int().nonnegative(),
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  cost_usd: z.number().nonnegative(),
}).strict();

export const UsageSummarySchema = z.object({
  stages: z.array(StageUsageSchema),
  total_input_tokens: z.number().int().nonnegative(),
  total_output_tokens: z.number().int().nonnegative(),
  total_cost_usd: z.number().nonnegative(),
}).strict();

export const AnalyzeResultSchema = z.object({
  artifact: StoryArtifactSchema,
  diff_snapshot: DiffSnapshotSchema,
  usage: UsageSummarySchema,
}).strict().superRefine((result, context) => {
  const pairs: Array<[string, unknown, unknown]> = [
    ["repo_node_id", result.artifact.meta.repo_node_id, result.diff_snapshot.repo_node_id],
    ["pr", result.artifact.meta.pr, result.diff_snapshot.pr],
    ["head_oid", result.artifact.meta.head_oid, result.diff_snapshot.head_oid],
  ];
  for (const [field, artifactValue, snapshotValue] of pairs) {
    if (artifactValue !== snapshotValue) {
      context.addIssue({
        code: "custom",
        message: `Artifact and diff snapshot disagree on ${field}`,
        path: ["diff_snapshot", field],
      });
    }
  }
});

export const StoryCacheIdentitySchema = z.object({
  repo_node_id: z.string().min(1),
  pr: z.number().int().positive(),
  head_oid: z.string().min(1),
  versions: z.object({
    analyzer: z.number().int().positive(),
    prompt: z.number().int().positive(),
    schema: z.number().int().positive(),
  }).strict(),
}).strict();

export const StoryStreamEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("story.skeleton"), data: StorySkeletonSchema }),
  z.object({ type: z.literal("story.chapter"), data: ChapterSchema }),
  z.object({ type: z.literal("story.ready"), data: StoryArtifactSchema }),
  z.object({
    type: z.literal("story.error"),
    data: z.object({ message: z.string().min(1) }),
  }),
]);

export type Evidence = z.infer<typeof EvidenceSchema>;
export type Claim = z.infer<typeof ClaimSchema>;
export type AttentionLevel = z.infer<typeof AttentionLevelSchema>;
export type StoryMeta = z.infer<typeof StoryMetaSchema>;
export type StoryFile = z.infer<typeof StoryFileSchema>;
export type Chapter = z.infer<typeof ChapterSchema>;
export type Track = z.infer<typeof TrackSchema>;
export type StoryArtifact = z.infer<typeof StoryArtifactSchema>;
export type StorySkeleton = z.infer<typeof StorySkeletonSchema>;
export type AnalyzeRequest = z.infer<typeof AnalyzeRequestSchema>;
export type DiffFileSnapshot = z.infer<typeof DiffFileSnapshotSchema>;
export type DiffSnapshot = z.infer<typeof DiffSnapshotSchema>;
export type StageUsage = z.infer<typeof StageUsageSchema>;
export type UsageSummary = z.infer<typeof UsageSummarySchema>;
export type AnalyzeResult = z.infer<typeof AnalyzeResultSchema>;
export type StoryCacheIdentity = z.infer<typeof StoryCacheIdentitySchema>;
export type StoryStreamEvent = z.infer<typeof StoryStreamEventSchema>;

export interface AnalyzerContext {
  signal?: AbortSignal;
  onResult?: (result: AnalyzeResult) => void | Promise<void>;
}

export interface Analyzer {
  identify(
    request: AnalyzeRequest,
    context?: AnalyzerContext,
  ): Promise<StoryCacheIdentity>;
  analyze(request: AnalyzeRequest, context?: AnalyzerContext): Promise<AnalyzeResult>;
  stream(
    request: AnalyzeRequest,
    context?: AnalyzerContext,
  ): AsyncIterable<StoryStreamEvent>;
}
