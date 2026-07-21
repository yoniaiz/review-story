export interface GitHubPullSummary {
  number: number;
  title: string;
  state: "open" | "closed";
  draft: boolean;
  headSha: string;
  updatedAt: string;
  author?: string;
}

export interface GitHubPullReader {
  list(owner: string, repo: string): Promise<GitHubPullSummary[]>;
  get(owner: string, repo: string, pullNumber: number): Promise<GitHubPullSummary>;
}

interface GitHubPullPayload {
  number?: number;
  title?: string;
  state?: string;
  draft?: boolean;
  head?: { sha?: string };
  updated_at?: string;
  user?: { login?: string } | null;
}

export class GitHubRestPullReader implements GitHubPullReader {
  readonly #token: string | undefined;

  constructor(token?: string) {
    this.#token = token ?? process.env.GITHUB_TOKEN ?? process.env.GITHUB_PAT;
  }

  async list(owner: string, repo: string): Promise<GitHubPullSummary[]> {
    const query = new URLSearchParams({
      state: "open",
      sort: "updated",
      direction: "desc",
      per_page: "30",
    });
    const payload = await this.#request<GitHubPullPayload[]>(
      `/repos/${segment(owner)}/${segment(repo)}/pulls?${query}`,
    );
    return payload.map(parsePull);
  }

  async get(owner: string, repo: string, pullNumber: number): Promise<GitHubPullSummary> {
    const payload = await this.#request<GitHubPullPayload>(
      `/repos/${segment(owner)}/${segment(repo)}/pulls/${pullNumber}`,
    );
    return parsePull(payload);
  }

  async #request<T>(path: string): Promise<T> {
    const response = await fetch(new URL(path, "https://api.github.com"), {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2026-03-10",
        ...(this.#token ? { Authorization: `Bearer ${this.#token}` } : {}),
      },
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => undefined) as { message?: string } | undefined;
      throw new GitHubPullReaderError(
        response.status,
        payload?.message ?? `GitHub pull request lookup failed (${response.status})`,
      );
    }
    return response.json() as Promise<T>;
  }
}

export class GitHubPullReaderError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "GitHubPullReaderError";
  }
}

function parsePull(payload: GitHubPullPayload): GitHubPullSummary {
  if (
    !Number.isInteger(payload.number)
    || !payload.number
    || typeof payload.title !== "string"
    || (payload.state !== "open" && payload.state !== "closed")
    || typeof payload.head?.sha !== "string"
    || !payload.head.sha
    || typeof payload.updated_at !== "string"
  ) {
    throw new Error("GitHub returned an invalid pull request payload");
  }
  return {
    number: payload.number,
    title: payload.title,
    state: payload.state,
    draft: payload.draft === true,
    headSha: payload.head.sha,
    updatedAt: payload.updated_at,
    ...(payload.user?.login ? { author: payload.user.login } : {}),
  };
}

function segment(value: string): string {
  return encodeURIComponent(value);
}
