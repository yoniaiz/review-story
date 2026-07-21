import { z } from "zod";

const StageIdSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9][a-z0-9_-]*$/);
const NonemptyStringSchema = z.string().trim().min(1);

const StageEvidenceSchema = z.object({
  path: z.string(),
  lines: z.tuple([z.number().int(), z.number().int()]),
}).strict();

const StageClaimSchema = z.object({
  text: z.string(),
  kind: z.enum(["observed", "inferred"]),
  evidence: z.array(StageEvidenceSchema),
}).strict();

export const Stage1OutputSchema = z.object({
  tracks: z.array(
    z.object({
      id: StageIdSchema,
      title: NonemptyStringSchema,
      chapter_order: z.array(StageIdSchema),
    }).strict(),
  ).min(1),
  chapters: z.array(
    z.object({
      id: StageIdSchema,
      title: NonemptyStringSchema,
      track_id: StageIdSchema,
      files: z.array(NonemptyStringSchema).min(1),
    }).strict(),
  ).min(1).max(5),
  appendix: z.array(
    z.object({ path: NonemptyStringSchema, reason: NonemptyStringSchema }).strict(),
  ),
  context_requests: z.array(
    z.object({
      path: NonemptyStringSchema,
      chapter_ids: z.array(StageIdSchema).min(1),
      reason: NonemptyStringSchema,
    }).strict(),
  ).max(10),
}).strict();

export const Stage2OutputSchema = z.object({
  summary: StageClaimSchema,
  files: z.array(
    z.object({
      path: z.string(),
      note: z.string(),
      anchor_hunks: z.array(z.tuple([z.number().int(), z.number().int()])),
    }).strict(),
  ),
  scrutinize: z.array(StageClaimSchema),
  related_tests: z.object({
    status: z.enum(["found", "none_found", "not_searched"]),
    note: z.string(),
    search_scope: z.string(),
  }).strict(),
  attention: z.object({
    level: z.enum(["DEEP_READ", "STANDARD", "SKIM"]),
    reasons: z.array(z.string()),
  }).strict(),
}).strict();

export const Stage3OutputSchema = z.object({
  exec_summary: z.object({
    text: z.string(),
    evidence: z.array(StageEvidenceSchema),
  }).strict(),
  tracks: z.array(
    z.object({
      id: z.string(),
      rationale: z.string(),
      chapter_order: z.array(z.string()),
      entry_points: z.array(
        z.object({
          persona: z.string(),
          start_chapter: z.string(),
          note: z.string(),
        }).strict(),
      ),
      flow: z.array(
        z.object({
          chapter_id: z.string().nullable(),
          label: z.string(),
          kind: z.enum(["code", "external"]),
          evidence: z.array(StageEvidenceSchema),
        }).strict(),
      ),
    }).strict(),
  ),
  cross_chapter_observations: z.array(StageClaimSchema),
}).strict();

export type Stage1Output = z.infer<typeof Stage1OutputSchema>;
export type Stage2Output = z.infer<typeof Stage2OutputSchema>;
export type Stage3Output = z.infer<typeof Stage3OutputSchema>;
