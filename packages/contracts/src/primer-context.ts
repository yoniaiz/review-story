import { parse as parseYaml } from "yaml";
import { z } from "zod";

/**
 * The Primer context contract (docs/context-contract-prd.md): a structured
 * block the author (or their agent) emits at PR-creation time. Everything in
 * it is author testimony — parsed, displayed as claims, and verified against
 * the diff, but never merged into Primer's own evidence.
 */

export const PrimerContextDecisionSchema = z.object({
  choice: z.string().min(1),
  rejected: z.string().min(1).optional(),
  why: z.string().min(1).optional(),
}).strict();

export const PrimerContextRiskAreaSchema = z.object({
  path: z.string().min(1),
  note: z.string().min(1).optional(),
}).strict();

export const PrimerContextSchema = z.object({
  schema: z.literal(1),
  intent: z.string().min(1),
  decisions: z.array(PrimerContextDecisionSchema).optional(),
  risk_areas: z.array(PrimerContextRiskAreaSchema).optional(),
  verification: z.object({
    tested: z.array(z.string().min(1)).optional(),
    untested: z.array(z.string().min(1)).optional(),
  }).strict().optional(),
  provenance: z.enum(["agent", "human", "mixed", "inferred"]).optional(),
  alignment: z.object({
    roadmap_items: z.array(z.string().min(1)).optional(),
  }).strict().optional(),
}).strict();

export type PrimerContext = z.infer<typeof PrimerContextSchema>;

export type PrimerContextParseResult =
  | { status: "absent" }
  | { status: "invalid"; reason: string }
  | { status: "ok"; context: PrimerContext };

const FENCE_PATTERN = /```primer-context\s*\n([\s\S]*?)```/;
// A hostile PR body should never turn into a parser DoS (deeply nested YAML
// can overflow the stack); bound the input before it reaches the parser.
const MAX_BLOCK_BYTES = 16_384;

/** Extracts and validates the ```primer-context``` block from a PR body. */
export function parsePrimerContext(body: string | null | undefined): PrimerContextParseResult {
  if (!body) return { status: "absent" };
  const match = body.match(FENCE_PATTERN);
  if (!match?.[1]) return { status: "absent" };
  if (match[1].length > MAX_BLOCK_BYTES) {
    return { status: "invalid", reason: "context block exceeds the size limit" };
  }
  let raw: unknown;
  try {
    raw = parseYaml(match[1], { maxAliasCount: 10 });
  } catch (error) {
    return { status: "invalid", reason: error instanceof Error ? error.message : "unparseable YAML" };
  }
  const parsed = PrimerContextSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      status: "invalid",
      reason: issue ? `${issue.path.join(".") || "block"}: ${issue.message}` : "invalid context block",
    };
  }
  return { status: "ok", context: parsed.data };
}
