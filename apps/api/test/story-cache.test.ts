import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StaticAnalyzer } from "@review-story/analyzer";
import { afterEach, describe, expect, it } from "vitest";
import { StoryCache } from "../src/story-cache.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("story cache", () => {
  it("misses, writes, then returns the complete result", async () => {
    const { cache, directory, identity, result } = await fixture();
    expect(await cache.read(identity)).toBeNull();
    await cache.write(identity, result);
    const hit = await cache.read(identity);
    expect(hit?.result).toEqual(result);
    expect(hit?.generatedAt).toBeTruthy();

    const files = await readdir(directory);
    expect(files).toEqual([`${cache.keyFor(identity)}.json`]);
    const persisted = JSON.parse(await readFile(join(directory, files[0]!), "utf8"));
    expect(persisted).toEqual({
      generated_at: hit?.generatedAt,
      result: {
        artifact: result.artifact,
        diff_snapshot: result.diff_snapshot,
        usage: result.usage,
      },
    });
  });

  it("keys on repository, PR, head OID, and every contract version", async () => {
    const { cache, identity } = await fixture();
    const baseKey = cache.keyFor(identity);
    expect(cache.keyFor({ ...identity, repo_node_id: "different" })).not.toBe(baseKey);
    expect(cache.keyFor({ ...identity, pr: identity.pr + 1 })).not.toBe(baseKey);
    expect(cache.keyFor({ ...identity, head_oid: "different" })).not.toBe(baseKey);
    expect(
      cache.keyFor({
        ...identity,
        versions: { ...identity.versions, analyzer: identity.versions.analyzer + 1 },
      }),
    ).not.toBe(baseKey);
    expect(
      cache.keyFor({
        ...identity,
        versions: { ...identity.versions, prompt: identity.versions.prompt + 1 },
      }),
    ).not.toBe(baseKey);
    expect(
      cache.keyFor({
        ...identity,
        versions: { ...identity.versions, schema: identity.versions.schema + 1 },
      }),
    ).not.toBe(baseKey);
  });

  it("deduplicates concurrent cold generators", async () => {
    const { cache, identity, result } = await fixture();
    let calls = 0;
    const generate = async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return result;
    };
    const [first, second] = await Promise.all([
      cache.getOrGenerate(identity, generate),
      cache.getOrGenerate(identity, generate),
    ]);
    expect(calls).toBe(1);
    expect(first).toEqual(result);
    expect(second).toEqual(result);
  });

  it("treats a valid cache file for a different identity as a miss", async () => {
    const { cache, directory, identity, result } = await fixture();
    const mismatchedIdentity = { ...identity, head_oid: "different-head" };
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, `${cache.keyFor(mismatchedIdentity)}.json`),
      JSON.stringify({ generated_at: new Date().toISOString(), result }),
    );

    expect(await cache.read(mismatchedIdentity)).toBeNull();
  });
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "review-story-cache-"));
  temporaryDirectories.push(directory);
  const analyzer = new StaticAnalyzer({ streamDelayMs: 0 });
  const request = { owner: "acme", repo: "review-story-demo", pullNumber: 123 };
  return {
    cache: new StoryCache(directory),
    directory,
    identity: await analyzer.identify(request),
    result: await analyzer.analyze(request),
  };
}
