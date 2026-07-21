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
    permissions: ["tabs", "storage"],
    host_permissions: [
      "https://github.com/*",
    ],
    action: {
      default_title: "Open Primer",
    },
  },
});
