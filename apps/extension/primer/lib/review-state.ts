import type { ChapterStatus, ReviewStep, ReviewStepStatus } from "./review-plan";

export function deriveChapterStatus(
  steps: ReviewStep[],
  statuses: Record<string, ReviewStepStatus>,
): ChapterStatus {
  const currentStatuses = steps.map((step) => statuses[step.fileId] ?? step.status);

  if (currentStatuses.some((status) => status === "recheck")) return "recheck";
  if (currentStatuses.length > 0 && currentStatuses.every((status) => status === "reviewed")) return "done";
  return "pending";
}

