import type { AnalyzeRequest, StoryCacheIdentity } from "@review-story/contracts";
import type { AnalyzerConfig } from "./config.js";
import type {
  GitHubChangedFile,
  PreparedPull,
  PullMetadata,
} from "./types.js";
import { materializeWorkspace } from "./workspace.js";

interface GitHubPullResponse {
  number: number;
  title: string;
  body: string | null;
  base: { sha: string; repo: { node_id: string } };
  head: { sha: string };
}

interface GitHubFileResponse {
  filename: string;
  previous_filename?: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
}

export class GitHubFetcher {
  readonly #config: AnalyzerConfig;
  readonly #fetch: typeof fetch;

  constructor(config: AnalyzerConfig, fetchImplementation: typeof fetch = fetch) {
    this.#config = config;
    this.#fetch = fetchImplementation;
  }

  async identify(
    request: AnalyzeRequest,
    signal?: AbortSignal,
    token?: string,
  ): Promise<StoryCacheIdentity> {
    const metadata = await this.#fetchMetadata(request, signal, token);
    return {
      repo_node_id: metadata.repoNodeId,
      pr: metadata.pullNumber,
      head_oid: metadata.headOid,
      versions: this.#config.versions,
    };
  }

  async prepare(
    request: AnalyzeRequest,
    signal?: AbortSignal,
    token?: string,
  ): Promise<PreparedPull> {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const metadataPromise = this.#fetchMetadata(request, signal, token);
      const filesPromise = this.#fetchFiles(request, signal, token);
      const metadata = await metadataPromise;
      const [files, archiveResult] = await Promise.all([
        filesPromise,
        this.#fetchArchive(request, metadata.headOid, signal, token),
      ]);
      const confirmation = await this.#fetchMetadata(request, signal, token);
      if (confirmation.headOid !== metadata.headOid) {
        if (attempt === 2) {
          throw new Error("Pull request head changed repeatedly during preparation");
        }
        continue;
      }

      const warnings: string[] = [];
      let workspacePath: string | null = null;
      if (archiveResult.archive) {
        try {
          workspacePath = await materializeWorkspace({
            root: this.#config.workspaceRoot,
            repoNodeId: metadata.repoNodeId,
            headOid: metadata.headOid,
            archive: archiveResult.archive,
            maxExtractedBytes: this.#config.maxExtractedBytes,
          });
        } catch (error) {
          warnings.push(
            `Workspace skipped: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      } else if (archiveResult.warning) {
        warnings.push(archiveResult.warning);
      }
      return { metadata, files, workspacePath, warnings };
    }
    throw new Error("Pull request preparation failed");
  }

  async #fetchMetadata(
    request: AnalyzeRequest,
    signal?: AbortSignal,
    token?: string,
  ): Promise<PullMetadata> {
    const response = await this.#request(
      `/repos/${encodeURIComponent(request.owner)}/${encodeURIComponent(request.repo)}/pulls/${request.pullNumber}`,
      signal,
      undefined,
      token,
    );
    const pull = (await response.json()) as GitHubPullResponse;
    if (!pull.base?.repo?.node_id || !pull.head?.sha || !pull.base?.sha) {
      throw new Error("GitHub returned incomplete pull request metadata");
    }
    return {
      repoNodeId: pull.base.repo.node_id,
      pullNumber: pull.number,
      title: pull.title,
      body: pull.body ?? "",
      baseOid: pull.base.sha,
      headOid: pull.head.sha,
    };
  }

  async #fetchFiles(
    request: AnalyzeRequest,
    signal?: AbortSignal,
    token?: string,
  ): Promise<GitHubChangedFile[]> {
    const allFiles: GitHubChangedFile[] = [];
    for (let page = 1; page <= 30; page += 1) {
      const response = await this.#request(
        `/repos/${encodeURIComponent(request.owner)}/${encodeURIComponent(request.repo)}/pulls/${request.pullNumber}/files?per_page=100&page=${page}`,
        signal,
        undefined,
        token,
      );
      const pageFiles = (await response.json()) as GitHubFileResponse[];
      allFiles.push(
        ...pageFiles.map((file) => ({
          filename: file.filename,
          previousFilename: file.previous_filename ?? null,
          status: file.status,
          additions: file.additions,
          deletions: file.deletions,
          changes: file.changes,
          patch: file.patch ?? null,
        })),
      );
      if (pageFiles.length < 100) break;
    }
    if (allFiles.length === 0) {
      throw new Error("GitHub returned no changed files for this pull request");
    }
    return allFiles;
  }

  async #fetchArchive(
    request: AnalyzeRequest,
    headOid: string,
    signal?: AbortSignal,
    token?: string,
  ): Promise<{ archive?: Uint8Array; warning?: string }> {
    try {
      const reference = encodeURIComponent(headOid);
      const response = await this.#request(
        `/repos/${encodeURIComponent(request.owner)}/${encodeURIComponent(request.repo)}/tarball/${reference}`,
        signal,
        undefined,
        token,
      );
      const declaredSize = Number(response.headers.get("content-length") ?? "0");
      if (declaredSize > this.#config.maxArchiveBytes) {
        return {
          warning: `Workspace skipped: archive is ${declaredSize} bytes (limit ${this.#config.maxArchiveBytes})`,
        };
      }
      const archive = await readBoundedBody(
        response,
        this.#config.maxArchiveBytes,
        signal,
      );
      return { archive };
    } catch (error) {
      if (signal?.aborted) throw error;
      return {
        warning: `Workspace skipped: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  async #request(
    path: string,
    signal?: AbortSignal,
    accept = "application/vnd.github+json",
    token?: string,
  ): Promise<Response> {
    const effectiveToken = token ?? this.#config.githubToken;
    const response = await this.#fetch(`${this.#config.githubApiBaseUrl}${path}`, {
      headers: {
        Accept: accept,
        "User-Agent": "review-story-analyzer",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(effectiveToken
          ? { Authorization: `Bearer ${effectiveToken}` }
          : {}),
      },
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) {
      throw new Error(
        `GitHub request failed (${response.status} ${response.statusText}) for ${path}`,
      );
    }
    return response;
  }
}

async function readBoundedBody(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      if (signal?.aborted) throw signal.reason ?? new Error("Aborted");
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new Error(`Repository archive exceeds ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}
