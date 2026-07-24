import type { PrimerContext } from "@review-story/contracts";
import type { ReviewPlan } from "./review-plan";

/**
 * First verification behavior of the context contract: author-declared risk
 * areas raise the matching files to needs-human in the review plan. The
 * author's claim never lowers scrutiny — elevation only — and the note is
 * surfaced as testimony ("author flagged"), not as Primer's own finding.
 */
export function applyAuthorRiskAreas(plan: ReviewPlan, context: PrimerContext): ReviewPlan {
  const riskByPath = new Map(
    (context.risk_areas ?? []).map((area) => [area.path, area.note] as const),
  );
  if (riskByPath.size === 0) return plan;
  return {
    ...plan,
    files: plan.files.map((file) => {
      if (!riskByPath.has(file.path)) return file;
      const note = riskByPath.get(file.path);
      return {
        ...file,
        severity: "needs-human" as const,
        summary: note ? `${file.summary} — author flagged: ${note}` : file.summary,
      };
    }),
  };
}

/** Risk areas whose path matches no changed file — surfaced so a stale or
 * mistyped author claim is visible instead of silently dropped. */
export function unmatchedRiskAreas(plan: ReviewPlan, context: PrimerContext): string[] {
  const changed = new Set(plan.files.map(({ path }) => path));
  return (context.risk_areas ?? [])
    .map(({ path }) => path)
    .filter((path) => !changed.has(path));
}
