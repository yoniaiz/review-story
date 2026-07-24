import type { Chapter } from "@review-story/contracts";

export function upsertGeneratedChapter(
  chapters: Chapter[],
  incoming: Chapter,
): Chapter[] {
  const existingIndex = chapters.findIndex(({ id }) => id === incoming.id);
  if (existingIndex === -1) return [...chapters, incoming];
  return chapters.map((chapter, index) => index === existingIndex ? incoming : chapter);
}
