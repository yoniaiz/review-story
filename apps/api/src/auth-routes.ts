import type { FastifyInstance } from "fastify";
import type { AuthService } from "./auth.js";
import { randomToken } from "./crypto.js";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface AuthRouteOptions {
  /** Public base URL of this API, e.g. https://api.example.com */
  publicBaseUrl?: string;
  /** Chrome extension IDs allowed as launchWebAuthFlow redirect targets. */
  extensionIds?: string[];
}

export function registerAuthRoutes(
  app: FastifyInstance,
  auth: AuthService,
  options: AuthRouteOptions = {},
): void {
  const publicBaseUrl = options.publicBaseUrl ?? process.env.API_PUBLIC_BASE_URL;
  const extensionIds = options.extensionIds
    ?? process.env.EXTENSION_IDS?.split(",").map((id) => id.trim()).filter(Boolean)
    ?? [];

  app.get<{ Querystring: { redirect_uri?: string } }>(
    "/auth/github/start",
    async (request, reply) => {
      const oauth = auth.oauth;
      if (!oauth) return reply.code(503).send({ error: "github_sign_in_not_configured" });
      const redirectUri = request.query.redirect_uri;
      if (!redirectUri || !isAllowedExtensionRedirect(redirectUri, extensionIds)) {
        return reply.code(400).send({ error: "invalid_redirect_uri" });
      }
      const state = randomToken(16);
      await auth.users.createOauthState(state, redirectUri);
      const callbackUrl = `${(publicBaseUrl ?? requestOrigin(request.headers.host)).replace(/\/$/, "")}/auth/github/callback`;
      return reply.redirect(oauth.authorizeUrl(state, callbackUrl));
    },
  );

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    "/auth/github/callback",
    async (request, reply) => {
      const oauth = auth.oauth;
      if (!oauth) return reply.code(503).send({ error: "github_sign_in_not_configured" });
      const { code, state } = request.query;
      if (!code || !state) {
        return reply.code(400).send({ error: "invalid_callback", message: request.query.error ?? "missing code or state" });
      }
      const redirectUri = await auth.users.consumeOauthState(state);
      if (!redirectUri) return reply.code(400).send({ error: "invalid_state" });
      const tokens = await oauth.exchangeCode(code);
      const viewer = await oauth.fetchViewer(tokens.accessToken);
      const user = await auth.users.upsertUserFromGitHub(viewer);
      await auth.users.saveTokens(user.id, tokens);
      const sessionToken = randomToken();
      await auth.users.createSession(user.id, sessionToken, SESSION_TTL_MS);
      const target = new URL(redirectUri);
      target.hash = new URLSearchParams({ session_token: sessionToken, login: user.login }).toString();
      return reply.redirect(target.toString());
    },
  );

  app.get("/auth/me", async (request, reply) => {
    const token = bearerToken(request.headers.authorization);
    const user = token ? await auth.users.findSessionUser(token) : undefined;
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    return { login: user.login, ...(user.avatarUrl ? { avatarUrl: user.avatarUrl } : {}) };
  });

  app.post("/auth/logout", async (request, reply) => {
    const token = bearerToken(request.headers.authorization);
    if (token) await auth.users.deleteSession(token);
    return reply.code(204).send();
  });
}

function bearerToken(header: string | undefined): string | undefined {
  if (!header?.toLowerCase().startsWith("bearer ")) return undefined;
  return header.slice(7).trim() || undefined;
}

function isAllowedExtensionRedirect(redirectUri: string, extensionIds: string[]): boolean {
  try {
    const url = new URL(redirectUri);
    if (url.protocol !== "https:") return false;
    return extensionIds.some((id) => url.hostname === `${id}.chromiumapp.org`);
  } catch {
    return false;
  }
}

function requestOrigin(host: string | undefined): string {
  if (!host) throw new Error("Cannot determine callback URL: set API_PUBLIC_BASE_URL");
  const isLocal = host.startsWith("127.0.0.1") || host.startsWith("localhost");
  return `${isLocal ? "http" : "https"}://${host}`;
}
