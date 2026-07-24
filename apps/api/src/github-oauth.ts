export interface GitHubTokenPair {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

export interface GitHubViewer {
  githubUserId: number;
  login: string;
  avatarUrl?: string;
}

interface AccessTokenPayload {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  error?: string;
  error_description?: string;
}

/**
 * GitHub App user-to-server OAuth. The client secret never leaves the server;
 * the extension only ever sees an opaque harness session token.
 */
export class GitHubOAuthClient {
  readonly #clientId: string;
  readonly #clientSecret: string;
  readonly #appSlug: string | undefined;
  readonly #fetch: typeof fetch;

  constructor(options: { clientId?: string; clientSecret?: string; appSlug?: string; fetchImplementation?: typeof fetch } = {}) {
    const clientId = options.clientId ?? process.env.GITHUB_APP_CLIENT_ID;
    const clientSecret = options.clientSecret ?? process.env.GITHUB_APP_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error("GITHUB_APP_CLIENT_ID and GITHUB_APP_CLIENT_SECRET are required for GitHub sign-in");
    }
    this.#clientId = clientId;
    this.#clientSecret = clientSecret;
    this.#appSlug = options.appSlug ?? process.env.GITHUB_APP_SLUG ?? undefined;
    this.#fetch = options.fetchImplementation ?? fetch;
  }

  authorizeUrl(state: string, callbackUrl: string): string {
    // With a slug configured (and "Request user authorization during
    // installation" enabled on the App), send users through the combined
    // install + authorize screen so sign-in also grants repo write access.
    // GitHub passes `state` through and redirects to the App's configured
    // callback URL with a code, exactly like the plain authorize flow.
    if (this.#appSlug) {
      const url = new URL(`https://github.com/apps/${this.#appSlug}/installations/new`);
      url.searchParams.set("state", state);
      return url.toString();
    }
    const url = new URL("https://github.com/login/oauth/authorize");
    url.searchParams.set("client_id", this.#clientId);
    url.searchParams.set("redirect_uri", callbackUrl);
    url.searchParams.set("state", state);
    return url.toString();
  }

  async exchangeCode(code: string): Promise<GitHubTokenPair> {
    return this.#tokenRequest({ code });
  }

  async refresh(refreshToken: string): Promise<GitHubTokenPair> {
    return this.#tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
  }

  async fetchViewer(accessToken: string): Promise<GitHubViewer> {
    const response = await this.#fetch("https://api.github.com/user", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": "review-story-api",
      },
    });
    if (!response.ok) throw new Error(`GitHub viewer lookup failed (${response.status})`);
    const payload = await response.json() as { id?: number; login?: string; avatar_url?: string };
    if (!Number.isInteger(payload.id) || !payload.id || !payload.login) {
      throw new Error("GitHub returned an invalid viewer payload");
    }
    return {
      githubUserId: payload.id,
      login: payload.login,
      ...(payload.avatar_url ? { avatarUrl: payload.avatar_url } : {}),
    };
  }

  async #tokenRequest(params: Record<string, string>): Promise<GitHubTokenPair> {
    const response = await this.#fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: this.#clientId,
        client_secret: this.#clientSecret,
        ...params,
      }),
    });
    if (!response.ok) throw new Error(`GitHub token request failed (${response.status})`);
    const payload = await response.json() as AccessTokenPayload;
    if (payload.error || !payload.access_token || !payload.refresh_token) {
      throw new Error(`GitHub token exchange failed: ${payload.error_description ?? payload.error ?? "missing tokens (is 'Expire user authorization tokens' enabled on the App?)"}`);
    }
    const now = Date.now();
    return {
      accessToken: payload.access_token,
      accessTokenExpiresAt: new Date(now + (payload.expires_in ?? 8 * 3600) * 1000).toISOString(),
      refreshToken: payload.refresh_token,
      refreshTokenExpiresAt: new Date(now + (payload.refresh_token_expires_in ?? 180 * 24 * 3600) * 1000).toISOString(),
    };
  }
}
