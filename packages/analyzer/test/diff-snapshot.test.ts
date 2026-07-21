import { describe, expect, it } from "vitest";
import { buildDiffSnapshot } from "../src/diff-snapshot.js";

describe("diff snapshot", () => {
  it("sorts stable per-file records and hashes patches", () => {
    const metadata = {
      repoNodeId: "R_repo",
      pullNumber: 9,
      title: "Change",
      body: "",
      baseOid: "base",
      headOid: "head",
    };
    const files = [
      file("z.ts", "@@ -1 +1 @@\n-old\n+new"),
      file("a.ts", "@@ -1 +1 @@\n-a\n+b"),
    ];
    const first = buildDiffSnapshot(metadata, files);
    const second = buildDiffSnapshot(metadata, [...files].reverse());
    expect(first).toEqual(second);
    expect(first.files.map(({ path }) => path)).toEqual(["a.ts", "z.ts"]);
    expect(first.files[0]?.patch_hash).toMatch(/^[a-f0-9]{64}$/);
  });
});

function file(filename: string, patch: string) {
  return {
    filename,
    previousFilename: null,
    status: "modified",
    additions: 1,
    deletions: 1,
    changes: 2,
    patch,
  };
}
