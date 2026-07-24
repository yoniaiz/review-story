import type { DiffSide } from "./extension-context";

export async function createGitHubDiffFragment(
  path: string,
  line?: number,
  side: DiffSide = "RIGHT",
): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(path));
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const fileAnchor = `diff-${hash}`;
  return line && Number.isInteger(line) && line > 0
    ? `${fileAnchor}${side === "LEFT" ? "L" : "R"}${line}`
    : fileAnchor;
}

export function createPullFilesUrl(currentUrl: string, fragment: string): string | undefined {
  let url: URL;
  try {
    url = new URL(currentUrl);
  } catch {
    return undefined;
  }
  if (url.hostname !== "github.com") return undefined;
  const pullRoot = url.pathname.match(/^\/[^/]+\/[^/]+\/pull\/\d+/)?.[0];
  if (!pullRoot) return undefined;
  url.pathname = `${pullRoot}/files`;
  url.search = "";
  url.hash = fragment;
  return url.href;
}
