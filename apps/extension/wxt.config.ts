import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  vite: () => ({
    envDir: "../..",
  }),
  manifest: {
    name: "Primer Review Story",
    description: "An evidence-backed AI review companion for GitHub pull requests.",
    minimum_chrome_version: "116",
    permissions: ["tabs", "storage", "scripting"],
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
