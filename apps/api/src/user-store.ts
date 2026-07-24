import { randomUUID } from "node:crypto";
import { decryptSecret, encryptSecret, sha256Hex } from "./crypto.js";
import type { GitHubTokenPair, GitHubViewer } from "./github-oauth.js";

export interface HarnessUser {
  id: string;
  githubUserId: number;
  login: string;
  avatarUrl?: string;
}

export interface StoredGitHubTokens extends GitHubTokenPair {}

export interface UserStore {
  upsertUserFromGitHub(viewer: GitHubViewer): Promise<HarnessUser>;
  saveTokens(userId: string, tokens: GitHubTokenPair): Promise<void>;
  getTokens(userId: string): Promise<StoredGitHubTokens | undefined>;
  clearTokens(userId: string): Promise<void>;
  createSession(userId: string, token: string, ttlMs: number): Promise<void>;
  findSessionUser(token: string): Promise<HarnessUser | undefined>;
  deleteSession(token: string): Promise<void>;
  createOauthState(state: string, extensionRedirectUri: string): Promise<void>;
  consumeOauthState(state: string): Promise<string | undefined>;
}

interface MemoryUserRecord extends HarnessUser {
  tokens?: StoredGitHubTokens;
}

export class MemoryUserStore implements UserStore {
  readonly #users = new Map<string, MemoryUserRecord>();
  readonly #sessions = new Map<string, { userId: string; expiresAt: number }>();
  readonly #states = new Map<string, { redirectUri: string; createdAt: number }>();

  async upsertUserFromGitHub(viewer: GitHubViewer): Promise<HarnessUser> {
    const existing = [...this.#users.values()].find((user) => user.githubUserId === viewer.githubUserId);
    const record: MemoryUserRecord = {
      id: existing?.id ?? randomUUID(),
      githubUserId: viewer.githubUserId,
      login: viewer.login,
      ...(viewer.avatarUrl ? { avatarUrl: viewer.avatarUrl } : {}),
      ...(existing?.tokens ? { tokens: existing.tokens } : {}),
    };
    this.#users.set(record.id, record);
    return { id: record.id, githubUserId: record.githubUserId, login: record.login, ...(record.avatarUrl ? { avatarUrl: record.avatarUrl } : {}) };
  }

  async saveTokens(userId: string, tokens: GitHubTokenPair): Promise<void> {
    const user = this.#users.get(userId);
    if (user) user.tokens = tokens;
  }

  async getTokens(userId: string): Promise<StoredGitHubTokens | undefined> {
    return this.#users.get(userId)?.tokens;
  }

  async clearTokens(userId: string): Promise<void> {
    const user = this.#users.get(userId);
    if (user) delete user.tokens;
  }

  async createSession(userId: string, token: string, ttlMs: number): Promise<void> {
    this.#sessions.set(sha256Hex(token), { userId, expiresAt: Date.now() + ttlMs });
  }

  async findSessionUser(token: string): Promise<HarnessUser | undefined> {
    const session = this.#sessions.get(sha256Hex(token));
    if (!session || session.expiresAt < Date.now()) return undefined;
    const user = this.#users.get(session.userId);
    if (!user) return undefined;
    return { id: user.id, githubUserId: user.githubUserId, login: user.login, ...(user.avatarUrl ? { avatarUrl: user.avatarUrl } : {}) };
  }

  async deleteSession(token: string): Promise<void> {
    this.#sessions.delete(sha256Hex(token));
  }

  async createOauthState(state: string, extensionRedirectUri: string): Promise<void> {
    this.#states.set(state, { redirectUri: extensionRedirectUri, createdAt: Date.now() });
  }

  async consumeOauthState(state: string): Promise<string | undefined> {
    const entry = this.#states.get(state);
    this.#states.delete(state);
    if (!entry || Date.now() - entry.createdAt > 10 * 60 * 1000) return undefined;
    return entry.redirectUri;
  }
}

interface UserRow {
  id: string;
  github_user_id: number;
  login: string;
  avatar_url: string | null;
  gh_access_token_enc: string | null;
  gh_access_token_expires_at: string | null;
  gh_refresh_token_enc: string | null;
  gh_refresh_token_expires_at: string | null;
}

/** PostgREST adapter matching supabase/migrations/20260722_auth.sql. */
export class SupabaseUserStore implements UserStore {
  constructor(
    private readonly url: string,
    private readonly secretKey: string,
    private readonly encryptionKey: Buffer,
  ) {}

  async upsertUserFromGitHub(viewer: GitHubViewer): Promise<HarnessUser> {
    const rows = await this.#request<UserRow[]>("harness_users?on_conflict=github_user_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({
        id: randomUUID(),
        github_user_id: viewer.githubUserId,
        login: viewer.login,
        avatar_url: viewer.avatarUrl ?? null,
        updated_at: new Date().toISOString(),
      }),
    });
    const row = rows[0];
    if (!row) throw new Error("Supabase did not return the upserted user");
    return hydrateUser(row);
  }

  async saveTokens(userId: string, tokens: GitHubTokenPair): Promise<void> {
    await this.#request(`harness_users?id=eq.${encodeURIComponent(userId)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        gh_access_token_enc: encryptSecret(tokens.accessToken, this.encryptionKey),
        gh_access_token_expires_at: tokens.accessTokenExpiresAt,
        gh_refresh_token_enc: encryptSecret(tokens.refreshToken, this.encryptionKey),
        gh_refresh_token_expires_at: tokens.refreshTokenExpiresAt,
        updated_at: new Date().toISOString(),
      }),
    });
  }

  async getTokens(userId: string): Promise<StoredGitHubTokens | undefined> {
    const rows = await this.#request<UserRow[]>(`harness_users?id=eq.${encodeURIComponent(userId)}&select=*&limit=1`);
    const row = rows[0];
    if (!row?.gh_access_token_enc || !row.gh_refresh_token_enc || !row.gh_access_token_expires_at || !row.gh_refresh_token_expires_at) {
      return undefined;
    }
    return {
      accessToken: decryptSecret(row.gh_access_token_enc, this.encryptionKey),
      accessTokenExpiresAt: row.gh_access_token_expires_at,
      refreshToken: decryptSecret(row.gh_refresh_token_enc, this.encryptionKey),
      refreshTokenExpiresAt: row.gh_refresh_token_expires_at,
    };
  }

  async clearTokens(userId: string): Promise<void> {
    await this.#request(`harness_users?id=eq.${encodeURIComponent(userId)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        gh_access_token_enc: null,
        gh_access_token_expires_at: null,
        gh_refresh_token_enc: null,
        gh_refresh_token_expires_at: null,
        updated_at: new Date().toISOString(),
      }),
    });
  }

  async createSession(userId: string, token: string, ttlMs: number): Promise<void> {
    await this.#request("harness_sessions", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        token_hash: sha256Hex(token),
        user_id: userId,
        expires_at: new Date(Date.now() + ttlMs).toISOString(),
      }),
    });
  }

  async findSessionUser(token: string): Promise<HarnessUser | undefined> {
    const hash = sha256Hex(token);
    const rows = await this.#request<Array<{ expires_at: string; harness_users: UserRow | null }>>(
      `harness_sessions?token_hash=eq.${encodeURIComponent(hash)}&select=expires_at,harness_users(*)&limit=1`,
    );
    const row = rows[0];
    if (!row?.harness_users || new Date(row.expires_at).getTime() < Date.now()) return undefined;
    return hydrateUser(row.harness_users);
  }

  async deleteSession(token: string): Promise<void> {
    await this.#request(`harness_sessions?token_hash=eq.${encodeURIComponent(sha256Hex(token))}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
  }

  async createOauthState(state: string, extensionRedirectUri: string): Promise<void> {
    await this.#request("oauth_states", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ state, extension_redirect_uri: extensionRedirectUri }),
    });
  }

  async consumeOauthState(state: string): Promise<string | undefined> {
    const rows = await this.#request<Array<{ extension_redirect_uri: string; created_at: string }>>(
      `oauth_states?state=eq.${encodeURIComponent(state)}&select=*`,
      { method: "DELETE", headers: { Prefer: "return=representation" } },
    );
    const row = rows?.[0];
    if (!row || Date.now() - new Date(row.created_at).getTime() > 10 * 60 * 1000) return undefined;
    return row.extension_redirect_uri;
  }

  async #request<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.url.replace(/\/$/, "")}/rest/v1/${path}`, {
      ...init,
      // Same as SupabaseReviewSessionStore: opaque sb_secret_… keys go in `apikey`.
      headers: { apikey: this.secretKey, "Content-Type": "application/json", ...(init.headers ?? {}) },
    });
    if (!response.ok) throw new Error(`Supabase request failed: ${response.status} ${await response.text()}`);
    if (response.status === 204) return undefined as T;
    const body = await response.text();
    if (!body.trim()) return undefined as T;
    return JSON.parse(body) as T;
  }
}

function hydrateUser(row: UserRow): HarnessUser {
  return {
    id: row.id,
    githubUserId: row.github_user_id,
    login: row.login,
    ...(row.avatar_url ? { avatarUrl: row.avatar_url } : {}),
  };
}
