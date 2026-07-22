import type { StoryArtifact, StorySkeleton } from "@review-story/contracts";

export type ReviewSessionStatus = "NEW" | "GENERATING" | "READY" | "FAILED";

export interface HarnessChatTurn {
  id: string;
  chapterId: string;
  stepId: string;
  role: "user" | "assistant" | "tool";
  content: string;
  citations: Array<{ path: string; lines: [number, number] }>;
  createdAt: string;
}

export interface HarnessDraft {
  id: string;
  body: string;
  path: string;
  line: number;
  side: "LEFT" | "RIGHT";
  createdAt: string;
  publishedAt?: string;
  githubCommentUrl?: string;
}

export interface HarnessSession {
  id: string;
  owner: string;
  repo: string;
  pullNumber: number;
  headSha: string;
  status: ReviewSessionStatus;
  currentChapterId?: string;
  completedChapterIds: string[];
  chatTurns: HarnessChatTurn[];
  drafts: HarnessDraft[];
  artifact?: StoryArtifact;
  skeleton?: StorySkeleton;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface HarnessConfig {
  apiBaseUrl: string;
  accessToken?: string;
}

export interface GitHubPullSummary {
  number: number;
  title: string;
  state: "open" | "closed";
  draft: boolean;
  headSha: string;
  updatedAt: string;
  author?: string;
}

export interface MyPullSummary {
  owner: string;
  repo: string;
  number: number;
  title: string;
  updatedAt: string;
  author?: string;
  role: "review-requested" | "assigned";
}

export interface HarnessViewer {
  login: string;
  avatarUrl?: string;
}

export class HarnessClient {
  readonly #config: HarnessConfig;

  constructor(config: HarnessConfig) {
    this.#config = config;
  }

  async getMe(): Promise<HarnessViewer> {
    return this.#request("/auth/me", { method: "GET" });
  }

  async getMyPulls(): Promise<MyPullSummary[]> {
    const result = await this.#request<{ pulls: MyPullSummary[] }>(
      "/api/github/my-pulls",
      { method: "GET" },
    );
    return result.pulls;
  }

  async listPullRequests(owner: string, repo: string): Promise<GitHubPullSummary[]> {
    const result = await this.#request<{ pulls: GitHubPullSummary[] }>(
      `/api/github/repos/${segment(owner)}/${segment(repo)}/pulls`,
      { method: "GET" },
    );
    return result.pulls;
  }

  async getPullRequest(owner: string, repo: string, pullNumber: number): Promise<GitHubPullSummary> {
    return this.#request(
      `/api/github/repos/${segment(owner)}/${segment(repo)}/pulls/${pullNumber}`,
      { method: "GET" },
    );
  }

  async createOrResume(input: {
    owner: string;
    repo: string;
    pullNumber: number;
    headSha: string;
  }): Promise<HarnessSession> {
    return this.#request(
      `/api/prs/${segment(input.owner)}/${segment(input.repo)}/pulls/${input.pullNumber}/review-sessions`,
      { method: "POST", body: JSON.stringify({ headSha: input.headSha }) },
    );
  }

  async getSession(sessionId: string): Promise<HarnessSession> {
    return this.#request(`/api/review-sessions/${segment(sessionId)}`, { method: "GET" });
  }

  async selectChapter(sessionId: string, chapterId: string): Promise<HarnessSession> {
    return this.#request(
      `/api/review-sessions/${segment(sessionId)}/chapters/${segment(chapterId)}/select`,
      { method: "POST" },
    );
  }

  async completeChapter(sessionId: string, chapterId: string): Promise<HarnessSession> {
    return this.#request(
      `/api/review-sessions/${segment(sessionId)}/chapters/${segment(chapterId)}/complete`,
      { method: "POST" },
    );
  }

  async sendChatMessage(sessionId: string, input: {
    message: string;
    chapterId: string;
    stepId: string;
  }): Promise<{
    user: HarnessChatTurn;
    assistant: HarnessChatTurn;
  }> {
    return this.#request(`/api/review-sessions/${segment(sessionId)}/chat/messages`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async createDraft(sessionId: string, input: {
    body: string;
    path: string;
    line: number;
    side: "LEFT" | "RIGHT";
  }): Promise<HarnessDraft> {
    return this.#request(`/api/review-sessions/${segment(sessionId)}/drafts`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async publishDraft(sessionId: string, draftId: string): Promise<HarnessDraft> {
    return this.#request(
      `/api/review-sessions/${segment(sessionId)}/drafts/${segment(draftId)}/publish`,
      { method: "POST", body: JSON.stringify({ confirm: true }) },
    );
  }

  eventsUrl(sessionId: string): string {
    const url = new URL(`/api/review-sessions/${segment(sessionId)}/events`, this.#config.apiBaseUrl);
    if (this.#config.accessToken) url.searchParams.set("access_token", this.#config.accessToken);
    return url.href;
  }

  async #request<T>(path: string, init: RequestInit): Promise<T> {
    const response = await fetch(new URL(path, this.#config.apiBaseUrl), {
      ...init,
      headers: {
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(this.#config.accessToken
          ? { Authorization: `Bearer ${this.#config.accessToken}` }
          : {}),
        ...init.headers,
      },
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => undefined) as
        | { message?: string; error?: string }
        | undefined;
      throw new Error(payload?.message ?? payload?.error ?? `Harness request failed (${response.status})`);
    }
    return response.json() as Promise<T>;
  }
}

function segment(value: string): string {
  return encodeURIComponent(value);
}
