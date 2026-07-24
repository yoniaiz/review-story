import { readdir } from "node:fs/promises";
import { posix } from "node:path";
import type { AttentionLevel } from "@review-story/contracts";
import type { GitHubChangedFile, ManifestRow, DiffHunk } from "./types.js";
import { extractChangedSymbols } from "./symbol-extractor.js";
import { readWorkspaceFile } from "./workspace.js";

const testPathPattern =
  /(?:^|\/)(?:test|tests|__tests__)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/i;

export async function buildManifest(
  files: GitHubChangedFile[],
  workspacePath: string | null,
): Promise<ManifestRow[]> {
  const baseRows = await Promise.all(
    files.map(async (file): Promise<ManifestRow> => {
      const content = workspacePath
        ? await readWorkspaceFile(workspacePath, file.filename)
        : null;
      const hunks = parseDiffHunks(file.patch);
      return {
        path: file.filename,
        previousPath: file.previousFilename,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        changes: file.changes,
        patch: file.patch,
        lineCount: content
          ? countSourceLines(content)
          : maxPatchLine(hunks, file.status),
        hunks,
        noiseReason: classifyNoise(file.filename),
        roles: classifyRoles(file.filename),
        attentionFloor: attentionFloor(file.filename),
        symbols: content ? extractChangedSymbols(file.filename, content, hunks) : [],
        importsChangedFiles: [],
        importedByChangedFiles: [],
        relatedTests: {
          status: "not_searched",
          paths: [],
          searchScope: "workspace unavailable",
        },
        content,
      };
    }),
  );

  addChangedImportEdges(baseRows);
  await addRelatedTestFacts(baseRows, workspacePath);
  return baseRows.sort((left, right) => left.path.localeCompare(right.path));
}

export function classifyNoise(path: string): string | null {
  const normalized = path.toLowerCase();
  const basename = posix.basename(normalized);
  if (
    [
      "package-lock.json",
      "pnpm-lock.yaml",
      "yarn.lock",
      "bun.lock",
      "bun.lockb",
      "cargo.lock",
      "poetry.lock",
      "composer.lock",
      "gemfile.lock",
    ].includes(basename)
  ) {
    return "lockfile";
  }
  if (
    /(?:^|\/)(?:generated|__generated__|dist|build|coverage|vendor)(?:\/|$)/.test(
      normalized,
    ) ||
    /(?:\.generated\.|\.g\.[a-z]+$|\.min\.(?:js|css)$|\.snap$)/.test(normalized)
  ) {
    return "generated or mechanical output";
  }
  if (/\.(?:map|svg|png|jpe?g|gif|webp|woff2?|ttf|ico)$/i.test(normalized)) {
    return "binary or generated asset";
  }
  return null;
}

export function classifyRoles(path: string): string[] {
  const normalized = path.toLowerCase();
  const roles = new Set<string>();
  if (/(?:web|ui|client|frontend|components?|pages?|views?)(?:\/|$)/.test(normalized)) {
    roles.add("frontend");
  }
  if (/(?:api|server|backend|routes?|controllers?|services?)(?:\/|$)/.test(normalized)) {
    roles.add("backend");
  }
  if (/(?:db|database|migrations?|schema)(?:\/|\.|$)/.test(normalized)) {
    roles.add("database");
  }
  if (testPathPattern.test(normalized)) roles.add("test");
  if (/(?:docs?|readme|\.md$)/.test(normalized)) roles.add("documentation");
  if (/(?:infra|terraform|deploy|docker|\.github)(?:\/|$)/.test(normalized)) {
    roles.add("infrastructure");
  }
  if (/(?:config|\.config\.|tsconfig|eslint|prettier)/.test(normalized)) {
    roles.add("configuration");
  }
  if (roles.size === 0) roles.add("shared");
  return [...roles];
}

export function attentionFloor(path: string): AttentionLevel {
  if (/(?:^|[\/_\-.])(?:auth(?:entication|orization)?|oauth|sessions?|payments?|billings?|security|crypto|migrations?)(?:[\/_\-.]|$)/i.test(path)) {
    return "STANDARD";
  }
  return "SKIM";
}

export function parseDiffHunks(patch: string | null): DiffHunk[] {
  if (!patch) return [];
  const hunks: DiffHunk[] = [];
  const expression = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm;
  for (const match of patch.matchAll(expression)) {
    hunks.push({
      oldStart: Number(match[1]),
      oldLines: Number(match[2] ?? "1"),
      newStart: Number(match[3]),
      newLines: Number(match[4] ?? "1"),
    });
  }
  return hunks;
}

function maxPatchLine(hunks: DiffHunk[], status: string): number {
  return Math.max(
    1,
    ...hunks.map((hunk) => {
      const useRemovedLines = status === "removed" || hunk.newLines === 0;
      const start = useRemovedLines ? hunk.oldStart : hunk.newStart;
      const count = useRemovedLines ? hunk.oldLines : hunk.newLines;
      return start + Math.max(0, count - 1);
    }),
  );
}

function countSourceLines(source: string): number {
  return Math.max(1, source.split("\n").length - (source.endsWith("\n") ? 1 : 0));
}

function addChangedImportEdges(rows: ManifestRow[]): void {
  const paths = new Set(rows.map((row) => row.path));
  const byPath = new Map(rows.map((row) => [row.path, row]));
  const bareIndex = buildBareSpecifierIndex(rows);
  const importExpression =
    /(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']|require\(\s*["']([^"']+)["']\s*\)|import\(\s*["']([^"']+)["']\s*\)/g;

  for (const row of rows) {
    if (!row.content) continue;
    for (const match of row.content.matchAll(importExpression)) {
      const specifier = match[1] ?? match[2] ?? match[3];
      if (!specifier) continue;
      const target = specifier.startsWith(".")
        ? resolveChangedImport(row.path, specifier, paths)
        : resolveBareImport(row.path, specifier, bareIndex);
      if (!target || target === row.path) continue;
      row.importsChangedFiles.push(target);
      byPath.get(target)?.importedByChangedFiles.push(row.path);
    }
    row.importsChangedFiles = [...new Set(row.importsChangedFiles)].sort();
  }
  for (const row of rows) {
    row.importedByChangedFiles = [...new Set(row.importedByChangedFiles)].sort();
  }
}

const bareSourceExtensionPattern = /\.(?:[cm]?[jt]sx?|json)$/i;
// Path segments that package aliases and tsconfig baseUrl roots typically hide.
const rootSegments = new Set(["src", "lib", "source"]);
const maxSuffixSegments = 5;

/**
 * Index changed files by the trailing path segments a bare or aliased import
 * specifier could refer to (e.g. `twenty-shared/utils` →
 * `packages/twenty-shared/src/utils/index.ts`), so cross-package imports
 * inside the PR resolve without workspace tsconfig/package.json resolution.
 */
function buildBareSpecifierIndex(rows: ManifestRow[]): Map<string, string[]> {
  const index = new Map<string, string[]>();
  const add = (key: string, path: string) => {
    if (!key) return;
    const existing = index.get(key);
    if (existing) {
      if (!existing.includes(path)) existing.push(path);
    } else {
      index.set(key, [path]);
    }
  };
  for (const row of rows) {
    if (!bareSourceExtensionPattern.test(row.path)) continue;
    let stem = row.path.replace(bareSourceExtensionPattern, "");
    const isIndex = stem.endsWith("/index");
    if (isIndex) stem = stem.slice(0, -"/index".length);
    const segments = stem.split("/");
    const variants = [segments];
    const withoutRoots = segments.filter((segment) => !rootSegments.has(segment));
    if (withoutRoots.length !== segments.length) variants.push(withoutRoots);
    for (const variant of variants) {
      const maxLength = Math.min(variant.length, maxSuffixSegments);
      // Single-segment keys only for index/package-root files — a lone
      // basename like `utils` is too ambiguous to treat as a module id.
      const minLength = isIndex ? 1 : 2;
      for (let length = minLength; length <= maxLength; length += 1) {
        add(variant.slice(variant.length - length).join("/"), row.path);
      }
    }
  }
  return index;
}

function resolveBareImport(
  fromPath: string,
  specifier: string,
  index: Map<string, string[]>,
): string | null {
  let clean = specifier.split(/[?#]/, 1)[0] ?? specifier;
  clean = clean.replace(bareSourceExtensionPattern, "");
  if (clean.endsWith("/index")) clean = clean.slice(0, -"/index".length);
  const keys = [clean];
  // `@/foo` and `~/foo` style aliases point at a source root within a package.
  if (/^[@~]\//.test(clean)) keys.push(clean.slice(2));
  // `@scope/pkg/rest` may match a directory named `pkg` without the scope.
  else if (clean.startsWith("@") && clean.includes("/")) {
    keys.push(clean.slice(clean.indexOf("/") + 1));
  }
  for (const key of keys) {
    const candidates = index.get(key);
    if (!candidates?.length) continue;
    return pickClosestPath(fromPath, candidates);
  }
  return null;
}

function pickClosestPath(fromPath: string, candidates: string[]): string {
  let best = candidates[0]!;
  let bestScore = -1;
  for (const candidate of candidates) {
    const score = sharedPrefixSegments(fromPath, candidate);
    if (score > bestScore || (score === bestScore && candidate < best)) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

function sharedPrefixSegments(left: string, right: string): number {
  const leftSegments = left.split("/");
  const rightSegments = right.split("/");
  let count = 0;
  while (
    count < leftSegments.length &&
    count < rightSegments.length &&
    leftSegments[count] === rightSegments[count]
  ) {
    count += 1;
  }
  return count;
}

function resolveChangedImport(
  fromPath: string,
  specifier: string,
  paths: Set<string>,
): string | null {
  const cleanSpecifier = specifier.split(/[?#]/, 1)[0] ?? specifier;
  const base = posix.normalize(posix.join(posix.dirname(fromPath), cleanSpecifier));
  const extension = posix.extname(base).toLowerCase();
  const sourceExtensions = [
    ".ts",
    ".tsx",
    ".mts",
    ".cts",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".json",
  ];
  const candidates = [base];
  const runtimeToSource: Record<string, string[]> = {
    ".js": [".ts", ".tsx", ".js", ".jsx"],
    ".jsx": [".tsx", ".jsx"],
    ".mjs": [".mts", ".mjs"],
    ".cjs": [".cts", ".cjs"],
  };
  if (runtimeToSource[extension]) {
    const stem = base.slice(0, -extension.length);
    candidates.push(...runtimeToSource[extension].map((item) => `${stem}${item}`));
  } else if (!extension) {
    candidates.push(...sourceExtensions.map((item) => `${base}${item}`));
    candidates.push(
      ...sourceExtensions.map((item) => posix.join(base, `index${item}`)),
    );
  }
  return candidates.find((candidate) => paths.has(candidate)) ?? null;
}

async function addRelatedTestFacts(
  rows: ManifestRow[],
  workspacePath: string | null,
): Promise<void> {
  if (!workspacePath) return;
  const testPaths = await findTestFiles(workspacePath);
  const testContents = new Map<string, string>();
  for (let index = 0; index < testPaths.length; index += 50) {
    await Promise.all(
      testPaths.slice(index, index + 50).map(async (path) => {
        const content = await readWorkspaceFile(workspacePath, path, 1_000_000);
        if (content !== null) testContents.set(path, content);
      }),
    );
  }
  const samples = testPaths.slice(0, 6).join(", ");
  const scope = [
    `workspace test-file patterns: test(s)/**, __tests__/**, *.{test,spec}.[cm]?[jt]sx?`,
    `${testContents.size}/${testPaths.length} readable files searched`,
    samples ? `sample: ${samples}${testPaths.length > 6 ? ", …" : ""}` : "no test files found",
  ].join("; ");

  for (const row of rows) {
    if (testPathPattern.test(row.path)) {
      row.relatedTests = {
        status: "not_searched",
        paths: [],
        searchScope: `${scope}; changed file is itself a test file`,
      };
      continue;
    }
    const searchableSymbols = row.symbols.filter((symbol) => symbol.length >= 3);
    if (searchableSymbols.length === 0) {
      row.relatedTests = {
        status: "not_searched",
        paths: [],
        searchScope: `${scope}; no changed symbols extracted`,
      };
      continue;
    }
    if (testContents.size === 0) {
      row.relatedTests = {
        status: "not_searched",
        paths: [],
        searchScope: scope,
      };
      continue;
    }
    const symbolPatterns = searchableSymbols.map(identifierPattern);
    const matches = [...testContents]
      .filter(([, content]) => symbolPatterns.some((pattern) => pattern.test(content)))
      .map(([path]) => path)
      .sort();
    row.relatedTests = {
      status: matches.length > 0 ? "found" : "none_found",
      paths: matches,
      searchScope: scope,
    };
  }
}

function identifierPattern(symbol: string): RegExp {
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^A-Za-z0-9_$])${escaped}(?=$|[^A-Za-z0-9_$])`, "m");
}

async function findTestFiles(workspacePath: string): Promise<string[]> {
  const found: string[] = [];
  const pending = [""];
  while (pending.length > 0 && found.length < 5_000) {
    const directory = pending.pop() ?? "";
    const absolute = posix.join(workspacePath.replaceAll("\\", "/"), directory);
    const entries = await readdir(absolute, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const relativePath = directory ? posix.join(directory, entry.name) : entry.name;
      if (entry.isDirectory()) {
        if (![".git", "node_modules", "dist", "build", "coverage"].includes(entry.name)) {
          pending.push(relativePath);
        }
      } else if (entry.isFile() && testPathPattern.test(relativePath)) {
        found.push(relativePath);
      }
    }
  }
  return found.sort();
}
