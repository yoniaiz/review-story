import type { CommentDraft, ReviewSession } from "./review-session.js";

export interface PublishedDraft {
  url: string;
}

export interface GitHubPublisher {
  publish(session: ReviewSession, draft: CommentDraft): Promise<PublishedDraft>;
}

export class GitHubPendingReviewPublisher implements GitHubPublisher {
  readonly #token: string | undefined;

  constructor(token?: string) {
    this.#token = token ?? process.env.GITHUB_PAT;
  }

  async publish(session: ReviewSession, draft: CommentDraft): Promise<PublishedDraft> {
    if (!this.#token) throw new Error("GITHUB_PAT is required to publish a draft");
    const response = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(session.owner)}/${encodeURIComponent(session.repo)}/pulls/${session.pullNumber}/reviews`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${this.#token}`,
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2026-03-10",
        },
        // Omitting event creates a GitHub PENDING review. This is the only
        // write path and is called solely from the explicit publish endpoint.
        body: JSON.stringify({
          commit_id: session.headSha,
          comments: [{
            path: draft.path,
            line: draft.line,
            side: draft.side,
            body: draft.body,
          }],
        }),
      },
    );
    if (!response.ok) {
      throw new Error(`GitHub publish failed: ${response.status} ${await response.text()}`);
    }
    const result = await response.json() as { html_url?: string };
    return { url: result.html_url ?? `https://github.com/${session.owner}/${session.repo}/pull/${session.pullNumber}` };
  }
}
