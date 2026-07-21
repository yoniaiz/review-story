const GITHUB_DIRECTIONAL_MARKS = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

/**
 * GitHub's React diff header wraps full paths in invisible directional marks.
 * Those marks are presentation metadata and must not participate in matching
 * analyzer paths to mounted diff files.
 */
export function normalizeGitHubFilePath(value?: string | null): string | undefined {
  const normalized = value?.replace(GITHUB_DIRECTIONAL_MARKS, "").trim();
  return normalized || undefined;
}
