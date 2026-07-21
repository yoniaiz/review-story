import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { extract } from "tar";

export interface MaterializeWorkspaceOptions {
  root: string;
  repoNodeId: string;
  headOid: string;
  archive: Uint8Array;
  maxExtractedBytes: number;
}

export async function materializeWorkspace(
  options: MaterializeWorkspaceOptions,
): Promise<string> {
  const repoDirectory = createHash("sha256")
    .update(options.repoNodeId)
    .digest("hex")
    .slice(0, 20);
  const target = join(options.root, repoDirectory, safeSegment(options.headOid));
  const marker = join(target, ".review-story-ready");

  try {
    const targetStat = await lstat(target);
    const markerValue = await readFile(marker, "utf8");
    if (
      targetStat.isDirectory() &&
      !targetStat.isSymbolicLink() &&
      markerValue.trim() === options.headOid
    ) {
      return target;
    }
  } catch {
    // A missing marker means the workspace must be built or repaired.
  }

  const parent = dirname(target);
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  const archivePath = `${temporary}.tar.gz`;
  await mkdir(parent, { recursive: true });
  await rm(temporary, { recursive: true, force: true });
  await mkdir(temporary, { recursive: true });
  await writeFile(archivePath, options.archive);

  let extractedBytes = 0;
  try {
    await extract({
      cwd: temporary,
      file: archivePath,
      strip: 1,
      filter: (path, entry) => {
        if (!isSafeArchivePath(path)) return false;
        if (
          "type" in entry &&
          (entry.type === "SymbolicLink" || entry.type === "Link")
        ) {
          return false;
        }
        extractedBytes += entry.size ?? 0;
        if (extractedBytes > options.maxExtractedBytes) {
          throw new Error(
            `Repository expands beyond ${options.maxExtractedBytes} bytes`,
          );
        }
        return true;
      },
    });
    await writeFile(markerFor(temporary), `${options.headOid}\n`, "utf8");
    await rm(target, { recursive: true, force: true });
    await rename(temporary, target);
    return target;
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  } finally {
    await rm(archivePath, { force: true });
  }
}

export async function readWorkspaceFile(
  workspacePath: string,
  repositoryPath: string,
  maxBytes = 512_000,
): Promise<string | null> {
  if (!isSafeRepositoryPath(repositoryPath)) return null;
  const root = await realpath(workspacePath).catch(() => null);
  if (!root) return null;
  const candidate = resolve(root, repositoryPath);
  if (!isWithin(root, candidate)) return null;

  const stat = await lstat(candidate).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) return null;
  const resolvedCandidate = await realpath(candidate).catch(() => null);
  if (!resolvedCandidate || !isWithin(root, resolvedCandidate)) return null;
  const contents = await readFile(resolvedCandidate);
  if (contents.includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(contents);
  } catch {
    return null;
  }
}

export function isSafeRepositoryPath(path: string): boolean {
  if (!path || path.includes("\0") || isAbsolute(path)) return false;
  const normalized = path.replaceAll("\\", "/");
  return !normalized.split("/").some((part) => part === ".." || part === "");
}

function isSafeArchivePath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  return (
    !isAbsolute(path) &&
    !normalized.startsWith("/") &&
    !normalized.split("/").some((part) => part === "..")
  );
}

function isWithin(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot === "" ||
    (!pathFromRoot.startsWith("..") && !pathFromRoot.includes(`..${sep}`))
  );
}

function markerFor(workspacePath: string): string {
  return join(workspacePath, ".review-story-ready");
}

function safeSegment(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9._-]/g, "_");
}
