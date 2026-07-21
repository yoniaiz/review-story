import { randomUUID } from "node:crypto";
import type { ReviewSession, ReviewSessionStore, NewReviewSession } from "./review-session.js";

interface SessionRow {
  id: string;
  owner: string;
  repo: string;
  pull_number: number;
  head_sha: string;
  status: ReviewSession["status"];
  current_chapter_id: string | null;
  artifact: ReviewSession["artifact"] | null;
  skeleton: ReviewSession["skeleton"] | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

/** Minimal PostgREST adapter; it uses the SQL migration in supabase/migrations. */
export class SupabaseReviewSessionStore implements ReviewSessionStore {
  constructor(
    private readonly url: string,
    private readonly serviceRoleKey: string,
  ) {}

  async findCurrent(input: NewReviewSession): Promise<ReviewSession | undefined> {
    const query = new URLSearchParams({
      owner: `eq.${input.owner}`,
      repo: `eq.${input.repo}`,
      pull_number: `eq.${input.pullNumber}`,
      head_sha: `eq.${input.headSha}`,
      select: "*",
      limit: "1",
    });
    const rows = await this.#request<SessionRow[]>(`review_sessions?${query}`);
    return rows[0] ? this.#hydrate(rows[0]) : undefined;
  }

  async create(input: NewReviewSession): Promise<ReviewSession> {
    const now = new Date().toISOString();
    const rows = await this.#request<SessionRow[]>("review_sessions", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        id: randomUUID(),
        owner: input.owner,
        repo: input.repo,
        pull_number: input.pullNumber,
        head_sha: input.headSha,
        status: "NEW",
        created_at: now,
        updated_at: now,
      }),
    });
    const row = rows[0];
    if (!row) throw new Error("Supabase did not return a created review session");
    return this.#hydrate(row);
  }

  async get(id: string): Promise<ReviewSession | undefined> {
    const rows = await this.#request<SessionRow[]>(`review_sessions?id=eq.${encodeURIComponent(id)}&select=*&limit=1`);
    return rows[0] ? this.#hydrate(rows[0]) : undefined;
  }

  async save(session: ReviewSession): Promise<void> {
    const updatedAt = new Date().toISOString();
    session.updatedAt = updatedAt;
    await this.#request(`review_sessions?id=eq.${encodeURIComponent(session.id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        status: session.status,
        current_chapter_id: session.currentChapterId ?? null,
        artifact: session.artifact ?? null,
        skeleton: session.skeleton ?? null,
        error: session.error ?? null,
        updated_at: updatedAt,
      }),
    });
    await Promise.all([
      this.#request(`chapter_progress?session_id=eq.${encodeURIComponent(session.id)}`, { method: "DELETE" }),
      this.#request(`chat_turns?session_id=eq.${encodeURIComponent(session.id)}`, { method: "DELETE" }),
      this.#request(`comment_drafts?session_id=eq.${encodeURIComponent(session.id)}`, { method: "DELETE" }),
    ]);
    await Promise.all([
      session.completedChapters.length
        ? this.#request("chapter_progress", { method: "POST", body: JSON.stringify(session.completedChapters.map((item) => ({ session_id: session.id, chapter_id: item.chapterId, completed_at: item.completedAt }))) })
        : Promise.resolve(),
      session.chatTurns.length
        ? this.#request("chat_turns", { method: "POST", body: JSON.stringify(session.chatTurns.map((item) => ({ id: item.id, session_id: session.id, role: item.role, content: item.content, citations: item.citations, created_at: item.createdAt }))) })
        : Promise.resolve(),
      session.drafts.length
        ? this.#request("comment_drafts", { method: "POST", body: JSON.stringify(session.drafts.map((item) => ({ id: item.id, session_id: session.id, body: item.body, path: item.path, line: item.line, side: item.side, github_comment_url: item.githubCommentUrl ?? null, published_at: item.publishedAt ?? null, created_at: item.createdAt }))) })
        : Promise.resolve(),
    ]);
  }

  async #hydrate(row: SessionRow): Promise<ReviewSession> {
    const [progress, turns, drafts] = await Promise.all([
      this.#request<Array<{ chapter_id: string; completed_at: string }>>(`chapter_progress?session_id=eq.${encodeURIComponent(row.id)}&select=chapter_id,completed_at`),
      this.#request<Array<{ id: string; role: "user" | "assistant" | "tool"; content: string; citations: ReviewSession["chatTurns"][number]["citations"]; created_at: string }>>(`chat_turns?session_id=eq.${encodeURIComponent(row.id)}&select=id,role,content,citations,created_at&order=created_at.asc`),
      this.#request<Array<{ id: string; body: string; path: string; line: number; side: "LEFT" | "RIGHT"; github_comment_url: string | null; published_at: string | null; created_at: string }>>(`comment_drafts?session_id=eq.${encodeURIComponent(row.id)}&select=*&order=created_at.asc`),
    ]);
    return {
      id: row.id, owner: row.owner, repo: row.repo, pullNumber: row.pull_number, headSha: row.head_sha,
      status: row.status, ...(row.current_chapter_id ? { currentChapterId: row.current_chapter_id } : {}),
      completedChapters: progress.map((item) => ({ chapterId: item.chapter_id, completedAt: item.completed_at })),
      chatTurns: turns.map((item) => ({ id: item.id, role: item.role, content: item.content, citations: item.citations, createdAt: item.created_at })),
      drafts: drafts.map((item) => ({ id: item.id, body: item.body, path: item.path, line: item.line, side: item.side, createdAt: item.created_at, ...(item.published_at ? { publishedAt: item.published_at } : {}), ...(item.github_comment_url ? { githubCommentUrl: item.github_comment_url } : {}) })),
      ...(row.artifact ? { artifact: row.artifact } : {}), ...(row.skeleton ? { skeleton: row.skeleton } : {}), ...(row.error ? { error: row.error } : {}),
      createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }

  async #request<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.url.replace(/\/$/, "")}/rest/v1/${path}`, {
      ...init,
      headers: { apikey: this.serviceRoleKey, Authorization: `Bearer ${this.serviceRoleKey}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    });
    if (!response.ok) throw new Error(`Supabase request failed: ${response.status} ${await response.text()}`);
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }
}
