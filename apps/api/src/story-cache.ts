import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  AnalyzeResultSchema,
  StoryCacheIdentitySchema,
  type AnalyzeResult,
  type StoryCacheIdentity,
} from "@review-story/contracts";
import { z } from "zod";

const CacheEntrySchema = z.object({
  generated_at: z.string().datetime(),
  result: AnalyzeResultSchema,
}).strict();

export interface CacheEntry {
  generatedAt: string;
  result: AnalyzeResult;
}
export class StoryCache {
  readonly #directory: string;
  readonly #inFlight = new Map<string, Promise<AnalyzeResult>>();

  constructor(directory: string) {
    this.#directory = directory;
  }

  keyFor(identity: StoryCacheIdentity): string {
    const parsed = StoryCacheIdentitySchema.parse(identity);
    return createHash("sha256")
      .update(
        JSON.stringify([
          parsed.repo_node_id,
          parsed.pr,
          parsed.head_oid,
          parsed.versions.analyzer,
          parsed.versions.prompt,
          parsed.versions.schema,
        ]),
      )
      .digest("hex");
  }

  async read(identity: StoryCacheIdentity): Promise<CacheEntry | null> {
    const path = this.#path(identity);
    try {
      const entry = CacheEntrySchema.parse(JSON.parse(await readFile(path, "utf8")));
      if (!this.resultMatchesIdentity(identity, entry.result)) return null;
      return { generatedAt: entry.generated_at, result: entry.result };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || error instanceof SyntaxError || error instanceof z.ZodError) {
        return null;
      }
      throw error;
    }
  }

  async write(
    identity: StoryCacheIdentity,
    result: AnalyzeResult,
  ): Promise<CacheEntry> {
    const parsedResult = AnalyzeResultSchema.parse(result);
    this.assertResultMatchesIdentity(identity, parsedResult);
    const generatedAt = new Date().toISOString();
    const path = this.#path(identity);
    const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
    await mkdir(this.#directory, { recursive: true });
    await writeFile(
      temporaryPath,
      `${JSON.stringify({ generated_at: generatedAt, result: parsedResult }, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    await rename(temporaryPath, path);
    return { generatedAt, result: parsedResult };
  }

  async getOrGenerate(
    identity: StoryCacheIdentity,
    generate: () => Promise<AnalyzeResult>,
  ): Promise<AnalyzeResult> {
    const cached = await this.read(identity);
    if (cached) return cached.result;
    const key = this.keyFor(identity);
    const existing = this.#inFlight.get(key);
    if (existing) return existing;
    const job = generate()
      .then(async (result) => (await this.write(identity, result)).result)
      .finally(() => this.#inFlight.delete(key));
    this.#inFlight.set(key, job);
    return job;
  }

  assertResultMatchesIdentity(
    identity: StoryCacheIdentity,
    result: AnalyzeResult,
  ): void {
    if (!this.resultMatchesIdentity(identity, result)) {
      throw new Error(
        "Pull request head changed after cache identification; reconnect to analyze the new head",
      );
    }
  }

  private resultMatchesIdentity(
    identity: StoryCacheIdentity,
    result: AnalyzeResult,
  ): boolean {
    const actual: StoryCacheIdentity = {
      repo_node_id: result.artifact.meta.repo_node_id,
      pr: result.artifact.meta.pr,
      head_oid: result.artifact.meta.head_oid,
      versions: result.artifact.meta.versions,
    };
    return (
      this.keyFor(actual) === this.keyFor(identity) &&
      result.diff_snapshot.repo_node_id === identity.repo_node_id &&
      result.diff_snapshot.pr === identity.pr &&
      result.diff_snapshot.head_oid === identity.head_oid
    );
  }

  #path(identity: StoryCacheIdentity): string {
    return join(this.#directory, `${this.keyFor(identity)}.json`);
  }
}
