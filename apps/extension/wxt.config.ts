import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { defineConfig } from "wxt";

// The manifest is static, so the hosted API origin must be baked in at build
// time from the same VITE_API_BASE_URL the sidepanel uses. Localhost stays
// allowed for development builds.
const envPath = fileURLToPath(new URL("../../.env", import.meta.url));
if (existsSync(envPath)) loadEnvFile(envPath);

const localApiOrigins = ["http://127.0.0.1:8787", "http://localhost:8787"];
const configuredApiOrigin = (() => {
  const base = process.env.VITE_API_BASE_URL;
  if (!base) return undefined;
  try {
    const origin = new URL(base).origin;
    return localApiOrigins.includes(origin) ? undefined : origin;
  } catch {
    throw new Error(`VITE_API_BASE_URL is not a valid URL: ${base}`);
  }
})();
const apiOrigins = [...(configuredApiOrigin ? [configuredApiOrigin] : []), ...localApiOrigins];

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  // WXT's development manifest registers content scripts at runtime through
  // this server. If a second dev process silently chooses another port, an
  // already-loaded extension can keep the old worker and stop receiving page
  // context. Fail the duplicate process instead of creating a stale runtime.
  dev: {
    server: {
      port: 3001,
      strictPort: true,
    },
  },
  vite: () => ({
    envDir: "../..",
  }),
  manifest: ({ command }) => ({
    name: "Primer Review Story",
    description: "An evidence-backed AI review companion for GitHub pull requests.",
    minimum_chrome_version: "116",
    permissions: ["tabs", "storage", "webNavigation", "identity"],
    host_permissions: [
      "https://github.com/*",
      ...apiOrigins.map((origin) => `${origin}/*`),
    ],
    action: {
      default_title: "Open Primer",
    },
    content_security_policy: {
      // Overriding the CSP replaces WXT's dev-server allowances, so the dev
      // server must be re-allowed here: without it in connect-src the
      // background cannot fetch content scripts to register them, and the
      // side panel loses HMR. `wxt dev` pins port 3001 above.
      extension_pages: command === "serve"
        ? `script-src 'self' http://localhost:3001; object-src 'self'; connect-src 'self' ${apiOrigins.join(" ")} http://localhost:3001 ws://localhost:3001`
        : `script-src 'self'; object-src 'self'; connect-src 'self' ${apiOrigins.join(" ")}`,
    },
  }),
});
