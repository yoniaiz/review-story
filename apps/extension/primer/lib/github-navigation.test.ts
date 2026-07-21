import { describe, expect, it } from "vitest";
import { createGitHubDiffFragment, createPullFilesUrl } from "./github-navigation";

describe("GitHub diff navigation", () => {
  it("creates GitHub's per-file SHA-256 fragment with an optional line", async () => {
    const file = await createGitHubDiffFragment("src/app.ts");
    const line = await createGitHubDiffFragment("src/app.ts", 42, "RIGHT");
    expect(file).toMatch(/^diff-[a-f0-9]{64}$/);
    expect(line).toBe(`${file}R42`);
  });

  it("moves any pull-request tab to Files changed while preserving the target", () => {
    expect(createPullFilesUrl(
      "https://github.com/acme/widgets/pull/42?notification_referrer_id=1",
      "diff-abcR9",
    )).toBe("https://github.com/acme/widgets/pull/42/files#diff-abcR9");
    expect(createPullFilesUrl("https://github.com/acme/widgets/issues", "diff-abc")).toBeUndefined();
  });
});
