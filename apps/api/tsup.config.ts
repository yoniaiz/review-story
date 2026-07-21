import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts"],
  format: ["esm"],
  sourcemap: true,
  clean: true,
  noExternal: ["@review-story/analyzer", "@review-story/contracts"],
  external: ["tree-sitter", "tree-sitter-typescript"],
});
