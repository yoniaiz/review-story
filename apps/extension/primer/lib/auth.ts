import { browser } from "wxt/browser";

export interface StoredAuth {
  sessionToken: string;
  login: string;
}

const STORAGE_KEY = "primer:auth";

export async function getStoredAuth(): Promise<StoredAuth | undefined> {
  const items = await browser.storage.local.get(STORAGE_KEY);
  const value = items[STORAGE_KEY] as StoredAuth | undefined;
  return value?.sessionToken && value.login ? value : undefined;
}

export async function signOut(apiBaseUrl: string, auth?: StoredAuth): Promise<void> {
  if (auth) {
    await fetch(new URL("/auth/logout", apiBaseUrl), {
      method: "POST",
      headers: { Authorization: `Bearer ${auth.sessionToken}` },
    }).catch(() => undefined);
  }
  await browser.storage.local.remove(STORAGE_KEY);
}

export async function clearStoredAuth(): Promise<void> {
  await browser.storage.local.remove(STORAGE_KEY);
}

/**
 * GitHub App sign-in. The API performs the OAuth dance server-side and
 * redirects back to this extension's chromiumapp.org URL with an opaque
 * harness session token in the fragment — no GitHub secret ever reaches
 * the extension.
 */
export async function signIn(apiBaseUrl: string): Promise<StoredAuth> {
  const redirectUri = browser.identity.getRedirectURL("github");
  const startUrl = new URL("/auth/github/start", apiBaseUrl);
  startUrl.searchParams.set("redirect_uri", redirectUri);
  const responseUrl = await browser.identity.launchWebAuthFlow({
    url: startUrl.href,
    interactive: true,
  });
  if (!responseUrl) throw new Error("Sign-in was cancelled");
  const fragment = new URL(responseUrl).hash.replace(/^#/, "");
  const params = new URLSearchParams(fragment);
  const sessionToken = params.get("session_token");
  const login = params.get("login");
  if (!sessionToken || !login) throw new Error("Sign-in did not return a session");
  const auth: StoredAuth = { sessionToken, login };
  await browser.storage.local.set({ [STORAGE_KEY]: auth });
  return auth;
}
