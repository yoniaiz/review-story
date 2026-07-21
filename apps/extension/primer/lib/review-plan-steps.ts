import type { ReviewPlan, ReviewStep } from "./review-plan";
import { validateReviewPlan } from "./review-plan";

function copyStep(step: ReviewStep): ReviewStep {
  return {
    ...step,
    evidence: step.evidence.map((item) => ({ ...item })),
  };
}

export function attachReviewSteps(
  basePlan: ReviewPlan,
  stepsByChapter: Record<string, ReviewStep[]>,
): ReviewPlan {
  const plan: ReviewPlan = {
    ...basePlan,
    chapters: basePlan.chapters.map((chapter) => ({
      ...chapter,
      steps: (stepsByChapter[chapter.id] ?? chapter.steps ?? []).map(copyStep),
    })),
  };
  const errors = validateReviewPlan(plan, { suppliedStepChapterIds: Object.keys(stepsByChapter) });

  if (errors.length > 0) {
    throw new Error(`Invalid review plan:\n${errors.join("\n")}`);
  }

  return plan;
}

