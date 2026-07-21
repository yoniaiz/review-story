import reviewPlanFixture from "../data/review-plan.twenty-22819.json";
import { reviewStepsByChapter } from "../data/review-steps.twenty-22819";
import type { GitHubPageContext } from "./extension-context";
import type { ReviewChapter, ReviewFile, ReviewPlan, ReviewStep } from "./review-plan";
import { attachReviewSteps } from "./review-plan-steps";

export interface ExtensionReviewRouteStep {
  chapter: ReviewChapter;
  file: ReviewFile;
  step: ReviewStep;
}

const twentyReviewPlan = attachReviewSteps(
  reviewPlanFixture as ReviewPlan,
  reviewStepsByChapter,
);

export function getReviewPlanForContext(context: GitHubPageContext): ReviewPlan | undefined {
  const repository = context.owner && context.repository
    ? `${context.owner}/${context.repository}`.toLowerCase()
    : "";
  if (repository === twentyReviewPlan.repo.toLowerCase() && context.pullNumber === twentyReviewPlan.pr) {
    return twentyReviewPlan;
  }
  return undefined;
}

export function getExtensionReviewRoute(plan: ReviewPlan): ExtensionReviewRouteStep[] {
  const filesById = new Map(plan.files.map((file) => [file.id, file]));
  return plan.chapters.flatMap((chapter) => (chapter.steps ?? [])
    .map((step) => {
      const file = filesById.get(step.fileId);
      return file ? { chapter, file, step } : undefined;
    })
    .filter((item): item is ExtensionReviewRouteStep => item !== undefined));
}

export function findRouteIndexByPath(route: ExtensionReviewRouteStep[], path?: string): number {
  if (!path) return -1;
  return route.findIndex((item) => item.file.path === path);
}

