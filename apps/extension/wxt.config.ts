import { defineConfig } from "wxt";

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
  manifest: {
    name: "Primer Review Story",
    description: "An evidence-backed AI review companion for GitHub pull requests.",
    minimum_chrome_version: "116",
    permissions: ["tabs", "storage", "webNavigation"],
    host_permissions: [
      "https://github.com/*",
      "http://127.0.0.1:8787/*",
      "http://localhost:8787/*",
    ],
    action: {
      default_title: "Open Primer",
    },
    content_security_policy: {
      extension_pages:
        "script-src 'self'; object-src 'self'; connect-src 'self' http://127.0.0.1:8787 http://localhost:8787",
    },
  },
});
