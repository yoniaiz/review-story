import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AuthService, ReauthRequiredError } from "../src/auth.js";
import { registerAuthRoutes } from "../src/auth-routes.js";
import { decryptSecret, encryptSecret, sha256Hex } from "../src/crypto.js";
import { GitHubOAuthClient, type GitHubTokenPair } from "../src/github-oauth.js";
import { MemoryUserStore } from "../src/user-store.js";
import Fastify from "fastify";

const EXTENSION_ID = "abcdefghijklmnopabcdefghijklmnop";
const REDIRECT_URI = `https://${EXTENSION_ID}.chromiumapp.org/github`;

function tokenPair(overrides: Partial<GitHubTokenPair> = {}): GitHubTokenPair {
  return {
    accessToken: "ghu_access",
    accessTokenExpiresAt: new Date(Date.now() + 8 * 3600 * 1000).toISOString(),
    refreshToken: "ghr_refresh",
    refreshTokenExpiresAt: new Date(Date.now() + 180 * 24 * 3600 * 1000).toISOString(),
    ...overrides,
  };
}

function fakeOAuth(): GitHubOAuthClient {
  const fetchImplementation: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("login/oauth/access_token")) {
      const body = JSON.parse(String(init?.body)) as { grant_type?: string };
      const suffix = body.grant_type === "refresh_token" ? "-rotated" : "";
      return Response.json({
        access_token: `ghu_access${suffix}`,
        expires_in: 8 * 3600,
        refresh_token: `ghr_refresh${suffix}`,
        refresh_token_expires_in: 180 * 24 * 3600,
      });
    }
    if (url.includes("api.github.com/user")) {
      return Response.json({ id: 7, login: "octocat", avatar_url: "https://avatars.test/7" });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  return new GitHubOAuthClient({
    clientId: "Iv1.test",
    clientSecret: "secret",
    fetchImplementation,
  });
}

describe("crypto", () => {
  it("round-trips secrets and hashes tokens deterministically", () => {
    const key = randomBytes(32);
    const encrypted = encryptSecret("ghu_token", key);
    expect(encrypted).not.toContain("ghu_token");
    expect(decryptSecret(encrypted, key)).toBe("ghu_token");
    expect(sha256Hex("abc")).toBe(sha256Hex("abc"));
    expect(sha256Hex("abc")).not.toBe(sha256Hex("abd"));
  });
});

describe("AuthService", () => {
  it("authenticates harness sessions and rejects unknown tokens", async () => {
    const users = new MemoryUserStore();
    const user = await users.upsertUserFromGitHub({ githubUserId: 7, login: "octocat" });
    await users.createSession(user.id, "session-token", 60_000);
    const auth = new AuthService(users, undefined);

    const app = Fastify();
    app.addHook("onRequest", (request, reply) => auth.authenticate(request, reply));
    app.get("/whoami", async (request) => ({ login: request.auth?.user?.login ?? null }));

    const ok = await app.inject({
      method: "GET",
      url: "/whoami",
      headers: { authorization: "Bearer session-token" },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ login: "octocat" });

    const bad = await app.inject({
      method: "GET",
      url: "/whoami",
      headers: { authorization: "Bearer wrong" },
    });
    expect(bad.statusCode).toBe(401);
    await app.close();
  });


  it("returns fresh tokens and refreshes expiring ones exactly once", async () => {
    const users = new MemoryUserStore();
    const user = await users.upsertUserFromGitHub({ githubUserId: 7, login: "octocat" });
    const auth = new AuthService(users, fakeOAuth());

    await users.saveTokens(user.id, tokenPair());
    expect(await auth.getUserGitHubToken(user.id)).toBe("ghu_access");

    await users.saveTokens(user.id, tokenPair({
      accessTokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    }));
    const [first, second] = await Promise.all([
      auth.getUserGitHubToken(user.id),
      auth.getUserGitHubToken(user.id),
    ]);
    expect(first).toBe("ghu_access-rotated");
    expect(second).toBe("ghu_access-rotated");
    const stored = await users.getTokens(user.id);
    expect(stored?.refreshToken).toBe("ghr_refresh-rotated");
  });

  it("demands re-auth when no tokens are stored", async () => {
    const users = new MemoryUserStore();
    const user = await users.upsertUserFromGitHub({ githubUserId: 7, login: "octocat" });
    const auth = new AuthService(users, fakeOAuth());
    await expect(auth.getUserGitHubToken(user.id)).rejects.toBeInstanceOf(ReauthRequiredError);
  });
});

describe("auth routes", () => {
  it("runs the full sign-in flow and serves /auth/me", async () => {
    const users = new MemoryUserStore();
    const auth = new AuthService(users, fakeOAuth());
    const app = Fastify();
    registerAuthRoutes(app, auth, {
      publicBaseUrl: "https://api.example.com",
      extensionIds: [EXTENSION_ID],
    });

    const start = await app.inject({
      method: "GET",
      url: `/auth/github/start?redirect_uri=${encodeURIComponent(REDIRECT_URI)}`,
    });
    expect(start.statusCode).toBe(302);
    const authorizeUrl = new URL(start.headers.location as string);
    expect(authorizeUrl.origin + authorizeUrl.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(authorizeUrl.searchParams.get("redirect_uri")).toBe("https://api.example.com/auth/github/callback");
    const state = authorizeUrl.searchParams.get("state");
    expect(state).toBeTruthy();

    const callback = await app.inject({
      method: "GET",
      url: `/auth/github/callback?code=abc&state=${state}`,
    });
    expect(callback.statusCode).toBe(302);
    const target = new URL(callback.headers.location as string);
    expect(target.origin).toBe(`https://${EXTENSION_ID}.chromiumapp.org`);
    const fragment = new URLSearchParams(target.hash.replace(/^#/, ""));
    const sessionToken = fragment.get("session_token");
    expect(sessionToken).toBeTruthy();
    expect(fragment.get("login")).toBe("octocat");

    const me = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ login: "octocat" });

    const logout = await app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    expect(logout.statusCode).toBe(204);
    const afterLogout = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    expect(afterLogout.statusCode).toBe(401);
    await app.close();
  });

  it("rejects redirect URIs outside the extension allowlist", async () => {
    const auth = new AuthService(new MemoryUserStore(), fakeOAuth());
    const app = Fastify();
    registerAuthRoutes(app, auth, {
      publicBaseUrl: "https://api.example.com",
      extensionIds: [EXTENSION_ID],
    });
    const response = await app.inject({
      method: "GET",
      url: `/auth/github/start?redirect_uri=${encodeURIComponent("https://evil.example.com/cb")}`,
    });
    expect(response.statusCode).toBe(400);
    const reused = await app.inject({
      method: "GET",
      url: "/auth/github/callback?code=abc&state=unknown",
    });
    expect(reused.statusCode).toBe(400);
    await app.close();
  });
});
