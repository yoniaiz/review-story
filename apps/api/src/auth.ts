import type { FastifyReply, FastifyRequest } from "fastify";
import type { GitHubOAuthClient } from "./github-oauth.js";
import type { HarnessUser, UserStore } from "./user-store.js";

export interface RequestAuth {
  /** Set when authenticated via the legacy shared HARNESS_ACCESS_TOKEN. */
  legacy?: boolean;
  user?: HarnessUser;
}

declare module "fastify" {
  interface FastifyRequest {
    auth?: RequestAuth;
  }
}

export class ReauthRequiredError extends Error {
  constructor() {
    super("GitHub authorization expired; sign in again");
    this.name = "ReauthRequiredError";
  }
}

const REFRESH_SKEW_MS = 5 * 60 * 1000;

export class AuthService {
  readonly #users: UserStore;
  readonly #oauth: GitHubOAuthClient | undefined;
  readonly #legacyToken: string | undefined;
  // GitHub rotates the refresh token on every use; serialize refreshes per
  // user so concurrent requests never burn the same refresh token twice.
  readonly #refreshing = new Map<string, Promise<string>>();

  constructor(users: UserStore, oauth?: GitHubOAuthClient, legacyToken = process.env.HARNESS_ACCESS_TOKEN) {
    this.#users = users;
    this.#oauth = oauth;
    this.#legacyToken = legacyToken || undefined;
  }

  get users(): UserStore {
    return this.#users;
  }

  get oauth(): GitHubOAuthClient | undefined {
    return this.#oauth;
  }

  /** Fastify onRequest hook: authenticates every route except /health and /auth. */
  async authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (request.url.startsWith("/health") || request.url.startsWith("/auth/")) return;
    const token = extractToken(request);
    if (!token) {
      await reply.code(401).send({ error: "unauthorized" });
      return;
    }
    if (this.#legacyToken && token === this.#legacyToken) {
      request.auth = { legacy: true };
      return;
    }
    const user = await this.#users.findSessionUser(token);
    if (!user) {
      await reply.code(401).send({ error: "unauthorized" });
      return;
    }
    request.auth = { user };
  }

  /**
   * Decrypted GitHub user-to-server token for API calls made as this user.
   * Refreshes when close to expiry; throws ReauthRequiredError when revoked.
   */
  async getUserGitHubToken(userId: string): Promise<string> {
    const pending = this.#refreshing.get(userId);
    if (pending) return pending;
    const tokens = await this.#users.getTokens(userId);
    if (!tokens) throw new ReauthRequiredError();
    if (new Date(tokens.accessTokenExpiresAt).getTime() - Date.now() > REFRESH_SKEW_MS) {
      return tokens.accessToken;
    }
    if (!this.#oauth) throw new ReauthRequiredError();
    const oauth = this.#oauth;
    const refresh = (async () => {
      try {
        const rotated = await oauth.refresh(tokens.refreshToken);
        await this.#users.saveTokens(userId, rotated);
        return rotated.accessToken;
      } catch (error) {
        await this.#users.clearTokens(userId);
        throw error instanceof ReauthRequiredError ? error : new ReauthRequiredError();
      } finally {
        this.#refreshing.delete(userId);
      }
    })();
    this.#refreshing.set(userId, refresh);
    return refresh;
  }
}

function extractToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (header?.toLowerCase().startsWith("bearer ")) return header.slice(7).trim() || undefined;
  // EventSource cannot set headers, so SSE endpoints accept ?access_token.
  const queryToken = new URL(request.url, "http://localhost").searchParams.get("access_token");
  return queryToken ?? undefined;
}
