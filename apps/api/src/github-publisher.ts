import type { CommentDraft, ReviewSession } from "./review-session.js";

export interface PublishedDraft {
  url: string;
}

export interface GitHubPublisher {
  publish(session: ReviewSession, draft: CommentDraft, token?: string): Promise<PublishedDraft>;
}

export class GitHubPendingReviewPublisher implements GitHubPublisher {
  readonly #token: string | undefined;

  constructor(token?: string) {
    this.#token = token ?? process.env.GITHUB_PAT;
  }

  async publish(session: ReviewSession, draft: CommentDraft, token?: string): Promise<PublishedDraft> {
    const effectiveToken = token ?? this.#token;
    if (!effectiveToken) throw new Error("A GitHub token is required to publish a draft");
    const pullUrl = `https://github.com/${session.owner}/${session.repo}/pull/${session.pullNumber}`;
    const response = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(session.owner)}/${encodeURIComponent(session.repo)}/pulls/${session.pullNumber}/reviews`,
      {
        method: "POST",
        headers: this.#headers(effectiveToken),
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
    if (response.status === 422) {
      // GitHub allows one pending review per user per PR; creation fails when
      // one exists. Append the comment to it as a new thread instead.
      const detail = await response.text();
      const appended = await this.#appendToPendingReview(session, draft, effectiveToken);
      if (appended) return { url: pullUrl };
      throw new Error(`GitHub publish failed: 422 ${detail}`);
    }
    if (!response.ok) {
      throw new Error(`GitHub publish failed: ${response.status} ${await response.text()}`);
    }
    const result = await response.json() as { html_url?: string };
    return { url: result.html_url ?? pullUrl };
  }

  /** Adds a thread to the user's existing PENDING review; false when none exists. */
  async #appendToPendingReview(
    session: ReviewSession,
    draft: CommentDraft,
    token: string,
  ): Promise<boolean> {
    const reviewsResponse = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(session.owner)}/${encodeURIComponent(session.repo)}/pulls/${session.pullNumber}/reviews?per_page=100`,
      { headers: this.#headers(token) },
    );
    if (!reviewsResponse.ok) return false;
    const reviews = await reviewsResponse.json() as { state?: string; node_id?: string }[];
    // The REST API only returns PENDING reviews belonging to the token's user.
    const pending = reviews.find((review) => review.state === "PENDING");
    if (!pending?.node_id) return false;

    const graphqlResponse = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: this.#headers(token),
      body: JSON.stringify({
        query: `mutation($input: AddPullRequestReviewThreadInput!) {
          addPullRequestReviewThread(input: $input) { thread { id } }
        }`,
        variables: {
          input: {
            pullRequestReviewId: pending.node_id,
            path: draft.path,
            line: draft.line,
            side: draft.side,
            body: draft.body,
          },
        },
      }),
    });
    if (!graphqlResponse.ok) return false;
    const payload = await graphqlResponse.json() as {
      data?: { addPullRequestReviewThread?: { thread?: { id?: string } | null } | null };
      errors?: { message?: string }[];
    };
    if (payload.errors?.length) {
      throw new Error(`GitHub publish failed: ${payload.errors[0]?.message ?? "GraphQL error"}`);
    }
    return Boolean(payload.data?.addPullRequestReviewThread?.thread?.id);
  }

  #headers(token: string): Record<string, string> {
    return {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "review-story-api",
      "X-GitHub-Api-Version": "2026-03-10",
    };
  }
}
