import type {
  AttentionLevel,
  Chapter,
  StoryCacheIdentity,
} from "@review-story/contracts";

export interface PullMetadata {
  repoNodeId: string;
  pullNumber: number;
  title: string;
  body: string;
  baseOid: string;
  headOid: string;
}
export interface GitHubChangedFile {
  filename: string;
  previousFilename: string | null;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch: string | null;
}

export interface PreparedPull {
  metadata: PullMetadata;
  files: GitHubChangedFile[];
  workspacePath: string | null;
  warnings: string[];
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
}

export interface RelatedTestFact {
  status: "found" | "none_found" | "not_searched";
  paths: string[];
  searchScope: string;
}

export interface ManifestRow {
  path: string;
  previousPath: string | null;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch: string | null;
  lineCount: number;
  hunks: DiffHunk[];
  noiseReason: string | null;
  roles: string[];
  attentionFloor: AttentionLevel;
  symbols: string[];
  importsChangedFiles: string[];
  importedByChangedFiles: string[];
  relatedTests: RelatedTestFact;
  content: string | null;
}

export interface OutlineChapter {
  id: string;
  title: string;
  trackId: string;
  files: string[];
}

export interface OutlineTrack {
  id: string;
  title: string;
  chapterOrder: string[];
}

export interface ContextRequest {
  path: string;
  chapterIds: string[];
  reason: string;
}

export interface StoryOutline {
  tracks: OutlineTrack[];
  chapters: OutlineChapter[];
  appendix: { files: string[]; reasons: Record<string, string> };
  contextRequests: ContextRequest[];
}

export interface ResolvedContext {
  path: string;
  chapterIds: string[];
  reason: string;
  skeleton: string;
  lineCount: number;
}

export interface PipelineHooks {
  onSkeleton?: (outline: StoryOutline, identity: StoryCacheIdentity) => void | Promise<void>;
  onChapter?: (chapter: Chapter) => void | Promise<void>;
}
