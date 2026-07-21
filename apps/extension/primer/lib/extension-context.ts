export type ExtensionPageKind = "pull-request" | "github" | "outside-github";
export type DiffSide = "LEFT" | "RIGHT";

export interface DiffAnchor {
  path: string;
  headSha: string;
  line: number;
  side: DiffSide;
  startLine?: number;
  startSide?: DiffSide;
  selectedText?: string;
  excerpt?: string;
}

export interface GitHubPageContext {
  kind: ExtensionPageKind;
  url: string;
  owner?: string;
  repository?: string;
  pullNumber?: number;
  headSha?: string;
  activeFile?: string;
  activeAnchor?: DiffAnchor;
  observedAt: string;
}

export type CommentDraftFailure =
  | "anchor-not-found"
  | "composer-not-found"
  | "range-not-supported"
  | "stale-anchor"
  | "invalid-request";

export type CommentDraftResult =
  | { ok: true; status: "drafted" }
  | { ok: false; error: CommentDraftFailure };

const COMMENT_DRAFT_FAILURES: CommentDraftFailure[] = [
  "anchor-not-found",
  "composer-not-found",
  "range-not-supported",
  "stale-anchor",
  "invalid-request",
];

export type PrimerExtensionMessage =
  | { type: "primer:context-observed"; context: GitHubPageContext }
  | { type: "primer:get-active-context" }
  | { type: "primer:request-context" }
  | { type: "primer:navigate-file"; path: string }
  | { type: "primer:draft-comment"; anchor: DiffAnchor; body: string }
  | { type: "primer:active-context-changed"; tabId: number; context: GitHubPageContext };

const PULL_REQUEST_PATH = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/;

export function getPageContext(
  urlValue: string,
  activeFile?: string,
  activeAnchor?: DiffAnchor,
  headSha?: string,
): GitHubPageContext {
  const observedAt = new Date().toISOString();
  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    return { kind: "outside-github", url: urlValue, observedAt };
  }

  if (url.hostname !== "github.com") {
    return { kind: "outside-github", url: url.href, observedAt };
  }

  const pullRequest = url.pathname.match(PULL_REQUEST_PATH);
  if (pullRequest) {
    const observedFile = activeAnchor?.path ?? activeFile;
    return {
      kind: "pull-request",
      url: url.href,
      owner: pullRequest[1]!,
      repository: pullRequest[2]!,
      pullNumber: Number(pullRequest[3]),
      ...(headSha ?? activeAnchor?.headSha ? { headSha: headSha ?? activeAnchor!.headSha } : {}),
      ...(observedFile ? { activeFile: observedFile } : {}),
      ...(activeAnchor ? { activeAnchor } : {}),
      observedAt,
    };
  }

  const [, owner, repository] = url.pathname.split("/");
  return {
    kind: "github",
    url: url.href,
    ...(owner ? { owner } : {}),
    ...(repository ? { repository } : {}),
    observedAt,
  };
}

export function isPrimerExtensionMessage(value: unknown): value is PrimerExtensionMessage {
  if (!value || typeof value !== "object" || !("type" in value) || typeof value.type !== "string") {
    return false;
  }

  if (value.type === "primer:get-active-context" || value.type === "primer:request-context") return true;
  if (value.type === "primer:navigate-file") {
    return "path" in value && typeof value.path === "string" && value.path.length > 0;
  }
  if (value.type === "primer:draft-comment") {
    return "anchor" in value
      && isDiffAnchor(value.anchor)
      && "body" in value
      && typeof value.body === "string"
      && value.body.trim().length > 0
      && value.body.length <= 10_000;
  }
  if (!("context" in value) || !isGitHubPageContext(value.context)) return false;
  if (value.type === "primer:context-observed") return true;
  return value.type === "primer:active-context-changed"
    && "tabId" in value
    && typeof value.tabId === "number";
}

function isGitHubPageContext(value: unknown): value is GitHubPageContext {
  if (!value || typeof value !== "object") return false;
  const context = value as Record<string, unknown>;
  return (context.kind === "pull-request" || context.kind === "github" || context.kind === "outside-github")
    && typeof context.url === "string"
    && typeof context.observedAt === "string"
    && (context.owner === undefined || typeof context.owner === "string")
    && (context.repository === undefined || typeof context.repository === "string")
    && (context.pullNumber === undefined || typeof context.pullNumber === "number")
    && (context.headSha === undefined || typeof context.headSha === "string")
    && (context.activeFile === undefined || typeof context.activeFile === "string")
    && (context.activeAnchor === undefined || isDiffAnchor(context.activeAnchor));
}

export function isDiffAnchor(value: unknown): value is DiffAnchor {
  if (!value || typeof value !== "object") return false;
  const anchor = value as Record<string, unknown>;
  const validSide = (side: unknown) => side === "LEFT" || side === "RIGHT";
  const hasStartLine = anchor.startLine !== undefined;
  const hasStartSide = anchor.startSide !== undefined;
  return typeof anchor.path === "string"
    && anchor.path.length > 0
    && typeof anchor.headSha === "string"
    && anchor.headSha.length > 0
    && typeof anchor.line === "number"
    && Number.isInteger(anchor.line)
    && anchor.line > 0
    && validSide(anchor.side)
    && hasStartLine === hasStartSide
    && (anchor.startLine === undefined
      || (typeof anchor.startLine === "number" && Number.isInteger(anchor.startLine) && anchor.startLine > 0))
    && (anchor.startSide === undefined || validSide(anchor.startSide))
    && (anchor.startLine === undefined || anchor.startLine <= anchor.line)
    && (anchor.startSide === undefined || anchor.startSide === anchor.side)
    && (anchor.selectedText === undefined || typeof anchor.selectedText === "string")
    && (anchor.excerpt === undefined || typeof anchor.excerpt === "string");
}

export function isCommentDraftResult(value: unknown): value is CommentDraftResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  if (result.ok === true) return result.status === "drafted";
  return result.ok === false
    && typeof result.error === "string"
    && COMMENT_DRAFT_FAILURES.includes(result.error as CommentDraftFailure);
}
