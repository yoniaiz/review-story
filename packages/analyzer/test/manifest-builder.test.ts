import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  attentionFloor,
  buildManifest,
  classifyNoise,
  classifyRoles,
} from "../src/manifest-builder.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("manifest builder", () => {
  it("classifies noise, roles, and trust-sensitive floors", () => {
    expect(classifyNoise("pnpm-lock.yaml")).toBe("lockfile");
    expect(classifyNoise("src/generated/client.ts")).toContain("generated");
    expect(classifyRoles("src/web/components/Login.tsx")).toContain("frontend");
    expect(classifyRoles("src/api/auth/route.ts")).toContain("backend");
    expect(attentionFloor("src/db/migrations/001.sql")).toBe("STANDARD");
    expect(attentionFloor("src/auth/session.ts")).toBe("STANDARD");
    expect(attentionFloor("src/api/payments/charge.ts")).toBe("STANDARD");
    expect(attentionFloor("src/utils/format.ts")).toBe("SKIM");
  });

  it("extracts symbols/import edges and records textual test references", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "review-story-manifest-"));
    temporaryDirectories.push(workspace);
    await mkdir(join(workspace, "src", "auth"), { recursive: true });
    await mkdir(join(workspace, "src", "shared"), { recursive: true });
    await mkdir(join(workspace, "tests"), { recursive: true });
    await writeFile(
      join(workspace, "src", "auth", "service.ts"),
      'import { token } from "../shared/token";\nexport function rotateToken() {\n  return token + "next";\n}\n',
    );
    await writeFile(
      join(workspace, "src", "shared", "token.ts"),
      'export const token = "base";\n',
    );
    await writeFile(
      join(workspace, "tests", "service.test.ts"),
      'import { rotateToken } from "../src/auth/service";\nrotateToken();\n',
    );

    const manifest = await buildManifest(
      [
        changedFile("src/auth/service.ts", "@@ -3 +3 @@"),
        changedFile("src/shared/token.ts", "@@ -1 +1 @@"),
      ],
      workspace,
    );
    const service = manifest.find((row) => row.path === "src/auth/service.ts")!;
    const token = manifest.find((row) => row.path === "src/shared/token.ts")!;

    expect(service.symbols).toContain("rotateToken");
    expect(service.importsChangedFiles).toEqual(["src/shared/token.ts"]);
    expect(token.importedByChangedFiles).toEqual(["src/auth/service.ts"]);
    expect(service.relatedTests.status).toBe("found");
    expect(service.relatedTests.paths).toEqual(["tests/service.test.ts"]);
  });

  it("builds enriched rows from a workspace fixture", async () => {
    const workspace = new URL("./fixtures/manifest/", import.meta.url).pathname;
    const manifest = await buildManifest(
      [
        changedFile("src/auth/service.ts", "@@ -5 +5 @@"),
        changedFile("src/shared/token.ts", "@@ -1 +1 @@"),
        changedFile("src/ui/Card.jsx", "@@ -2 +2 @@"),
      ],
      workspace,
    );
    const service = manifest.find((row) => row.path === "src/auth/service.ts")!;
    const token = manifest.find((row) => row.path === "src/shared/token.ts")!;
    const card = manifest.find((row) => row.path === "src/ui/Card.jsx")!;

    expect(service.symbols).toEqual(["rotateToken"]);
    expect(card.symbols).toEqual(["Card"]);
    expect(service.importsChangedFiles).toEqual(["src/shared/token.ts"]);
    expect(token.importedByChangedFiles).toEqual(["src/auth/service.ts"]);
    expect(service.relatedTests).toMatchObject({
      status: "found",
      paths: ["tests/service.fixture.ts"],
    });
    expect(service.relatedTests.searchScope).toContain("2/2 readable files searched");
  });
});

function changedFile(filename: string, patch: string) {
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
