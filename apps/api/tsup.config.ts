import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts"],
  format: ["esm"],
  sourcemap: true,
  clean: true,
  noExternal: ["@review-story/analyzer", "@review-story/contracts"],
  external: ["tree-sitter", "tree-sitter-typescript"],
  banner: {
    // Bundled CJS deps (yaml) dynamically require node builtins, which the
    // ESM output cannot shim on its own.
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});
