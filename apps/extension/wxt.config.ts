import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  vite: () => ({
    envDir: "../..",
  }),
  manifest: {
    name: "Review Story",
    description: "A guided reading order for GitHub pull requests.",
    minimum_chrome_version: "114",
    permissions: ["tabs"],
    host_permissions: [
      "https://github.com/*",
      "http://127.0.0.1:8787/*",
      "http://localhost:8787/*",
    ],
    action: {
      default_title: "Open Review Story",
    },
    content_security_policy: {
      extension_pages:
        "script-src 'self'; object-src 'self'; connect-src 'self' http://127.0.0.1:8787 http://localhost:8787",
    },
  },
});
