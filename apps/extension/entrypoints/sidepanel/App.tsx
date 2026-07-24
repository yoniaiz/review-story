import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { browser } from "wxt/browser";
import { StoryArtifactSchema, StoryStreamEventSchema, type Chapter } from "@review-story/contracts";
import { DropdownMenu, Select, Tooltip } from "radix-ui";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  CircleDot,
  ExternalLink,
  FileCode2,
  GitPullRequest,
  Menu,
  MessageSquareText,
  LoaderCircle,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Workflow,
  XCircle,
} from "lucide-react";
import {
  activeContextFromMessage,
  getPageContext,
  isPrimerExtensionMessage,
  reconcilePageContext,
  type GitHubPageContext,
} from "../../primer/lib/extension-context";
import { createFallbackCommentDraft, parseCommentCommand } from "../../primer/lib/comment-draft";
import { createGitHubDiffFragment, createPullFilesUrl } from "../../primer/lib/github-navigation";
import {
  findChapterEntryRouteIndex,
  findRouteIndexByPath,
  getExtensionReviewRoute,
} from "../../primer/lib/extension-review";
import type { ReviewPlan, ReviewStepStatus, Severity } from "../../primer/lib/review-plan";
import { deriveChapterStatus } from "../../primer/lib/review-state";
import {
  HarnessClient,
  type GitHubPullSummary,
  type HarnessSession,
  type MyPullSummary,
} from "../../primer/lib/harness-client";
import { clearStoredAuth, getStoredAuth, signIn, signOut } from "../../primer/lib/auth";
import { isNearScrollEnd } from "../../primer/lib/chat-scroll";
import { storyArtifactToReviewPlan } from "../../primer/lib/story-review-plan";
import { upsertGeneratedChapter } from "../../primer/lib/story-stream-state";

const ArchitectureView = lazy(async () => {
  const module = await import("./ArchitectureView");
  return { default: module.ArchitectureView };
});
// Signed-in users set accessToken to their personal harness session token at
// runtime; the HarnessClient reads this object per-request, so mutation takes
// effect immediately for every client instance.
const harnessConfig: { apiBaseUrl: string; accessToken?: string } = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8787",
};

type AuthState =
  | { status: "loading" }
  | { status: "signed-out"; error?: string }
  | { status: "signed-in"; login: string }
  | { status: "demo" };
const DEMO_PULL_REQUESTS = [
  {
    value: "itayfry/king-of-tokens#1",
    label: "itayfry/king-of-tokens · #1",
    detail: "KoT demo",
    destination: "https://github.com/itayfry/king-of-tokens/pull/1/files",
  },
  {
    value: "twentyhq/twenty#22819",
    label: "twentyhq/twenty · #22819",
    detail: "TwentyHQ demo",
    destination: "https://github.com/twentyhq/twenty/pull/22819/files",
  },
] as const;
const severityLabel: Record<Severity, string> = {
  "needs-human": "Human attention",
  standard: "Standard review",
  noise: "Low signal",
};

async function navigateGitHubDiff(
  path: string,
  headSha: string,
  line?: number,
  side: "LEFT" | "RIGHT" = "RIGHT",
  endLine?: number,
): Promise<boolean> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined || !tab.url) return false;
  const message = line
    ? {
        type: "primer:navigate-anchor" as const,
        anchor: endLine && endLine > line
          ? { path, headSha, line: endLine, side, startLine: line, startSide: side }
          : { path, headSha, line, side },
      }
    : { type: "primer:navigate-file" as const, path };
  try {
    if (await browser.tabs.sendMessage(tab.id, message)) return true;
  } catch {
    // A freshly reloaded extension has no content script in already-open tabs.
    // GitHub's native diff fragment remains a dependable navigation fallback.
  }
  const fragment = await createGitHubDiffFragment(path);
  const destination = createPullFilesUrl(tab.url, fragment);
  if (!destination) return false;
  await browser.tabs.update(tab.id, { url: destination });
  return true;
}

function getInitialContext(): GitHubPageContext {
  const preview = new URLSearchParams(window.location.search).get("preview");
  if (preview === "pr") {
    const owner = import.meta.env.VITE_DEMO_OWNER ?? "itayfry";
    const repo = import.meta.env.VITE_DEMO_REPO ?? "king-of-tokens";
    const pullNumber = import.meta.env.VITE_DEMO_PR ?? "1";
    return getPageContext(
      `https://github.com/${owner}/${repo}/pull/${pullNumber}/files`,
      undefined,
      undefined,
      import.meta.env.VITE_DEMO_HEAD_SHA,
    );
  }
  if (preview === "github") return getPageContext("https://github.com/twentyhq/twenty");
  return getPageContext("");
}

async function navigateGitHubToFile(path: string): Promise<void> {
  if (new URLSearchParams(window.location.search).has("preview")) return;
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) return;

  const scrolled = await browser.tabs.sendMessage(tab.id, {
    type: "primer:navigate-file",
    path,
  }).then((result) => result === true).catch(() => false);
  if (scrolled || !tab.url) return;

  // GitHub's stable file anchor is `diff-${sha256(path)}`. Updating the active
  // tab fragment gives navigation a reliable fallback when the content script
  // was not injected into an already-open PR tab.
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(path));
  const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const destination = new URL(tab.url);
  destination.hash = `diff-${hash}`;
  await browser.tabs.update(tab.id, { url: destination.href });
}

function IconButton({ label, children, onClick, pressed }: { label: string; children: ReactNode; onClick?: () => void; pressed?: boolean }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button className={`icon-button ${pressed ? "is-active" : ""}`} type="button" aria-label={label} aria-pressed={pressed} onClick={onClick}>{children}</button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tooltip" sideOffset={7}>{label}</Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

function PrimerMark() {
  return (
    <svg className="primer-mark" viewBox="0 0 32 32" aria-hidden="true">
      <path className="primer-mark-route" d="M4.5 27V3.5h14c5.5 0 9 3.5 9 9s-3.5 9-9 9H13v-3h5.5c3.8 0 6-2.3 6-6s-2.2-6-6-6h-11V27z" />
      <rect className="primer-mark-origin" x="3.5" y="2.5" width="5" height="5" />
      <rect className="primer-mark-signal" x="22.5" y="10" width="7" height="7" />
    </svg>
  );
}

function StatusMark({ status }: { status: "pending" | "done" | "recheck" }) {
  if (status === "done") return <CheckCircle2 aria-label="Reviewed" />;
  if (status === "recheck") return <XCircle aria-label="Needs recheck" />;
  return <Circle aria-label="Open" />;
}

function ChapterRail({ plan, route, statuses, selectedIndex, navigateTo }: {
  plan: ReviewPlan;
  route: ReturnType<typeof getExtensionReviewRoute>;
  statuses: Record<string, ReviewStepStatus>;
  selectedIndex: number;
  navigateTo: (index: number) => void;
}) {
  const selected = route[selectedIndex];
  return (
    <nav className="chapter-rail" aria-label="Review chapters">
      {plan.chapters.map((chapter, chapterIndex) => {
        const chapterRoute = route.map((item, index) => ({ ...item, routeIndex: index })).filter((item) => item.chapter.id === chapter.id);
        const chapterEntryRouteIndex = findChapterEntryRouteIndex(route, chapter);
        const chapterStatus = chapter.steps?.length ? deriveChapterStatus(chapter.steps, statuses) : chapter.status;
        const alignment = chapterIndex < 2 ? "align-start" : chapterIndex > 2 ? "align-end" : "align-center";
        return (
          <div className={`chapter-rail-item ${alignment} ${selected?.chapter.id === chapter.id ? "is-current" : ""}`} key={chapter.id}>
            <button className={`chapter-node status-${chapterStatus}`} type="button" aria-label={`Chapter ${chapterIndex + 1}: ${chapter.title}`} aria-disabled={chapterEntryRouteIndex < 0} onClick={() => chapterEntryRouteIndex >= 0 && navigateTo(chapterEntryRouteIndex)}>
              <StatusMark status={chapterStatus} />
            </button>
            <span className="chapter-node-label">Ch {chapterIndex + 1}</span>
            <div className="chapter-peek" role="group" aria-label={`${chapter.title} steps`}>
              <div className="chapter-peek-heading"><span>Chapter {chapterIndex + 1} · {chapter.fileIds.length} files</span><strong>{chapter.title}</strong><p>{chapter.summary}</p></div>
              {chapterRoute.length ? <div className="chapter-peek-steps">{chapterRoute.map((item) => {
                const stepStatus = statuses[item.step.fileId] ?? item.step.status;
                return <button className={item.routeIndex === selectedIndex ? "is-current" : ""} type="button" key={item.step.fileId} onClick={() => navigateTo(item.routeIndex)}><span className={`map-status status-${stepStatus === "reviewed" ? "done" : stepStatus}`}><StatusMark status={stepStatus === "reviewed" ? "done" : stepStatus} /></span><span><small>Step {item.step.order}</small><strong>{item.file.path.split("/").at(-1)}</strong></span></button>;
              })}</div> : <div className="chapter-peek-empty"><span>Queued</span><code>{chapter.entryPoint.split("/").at(-1)}</code></div>}
            </div>
          </div>
        );
      })}
    </nav>
  );
}

function SignInScreen({ onSignIn, onDemoContinue, error }: {
  onSignIn: () => void;
  onDemoContinue: (destination: string) => void;
  error?: string;
}) {
  const [selectedDemoValue, setSelectedDemoValue] = useState<string>(DEMO_PULL_REQUESTS[0].value);
  const selectedDemo = DEMO_PULL_REQUESTS.find(({ value }) => value === selectedDemoValue)
    ?? DEMO_PULL_REQUESTS[0];
  return (
    <div className="launcher">
      <div className="launcher-mark"><GitPullRequest size={23} strokeWidth={1.6} /></div>
      <p className="utility-label">Primer</p>
      <h1>Sign in with GitHub to begin.</h1>
      <p className="launcher-copy">
        Primer analyzes pull requests and publishes review comments as you.
        Sign in so everything runs under your own GitHub identity.
      </p>
      {error ? <p className="launcher-copy" role="alert">{error}</p> : null}
      <button className="primary-action" type="button" onClick={onSignIn}>
        Sign in with GitHub
      </button>
      <div className="repository-picker pull-request-picker sign-in-demo">
        <label id="sign-in-demo-picker-label">Or continue with a demo pull request</label>
        <Select.Root value={selectedDemoValue} onValueChange={setSelectedDemoValue}>
          <Select.Trigger className="repository-trigger" aria-labelledby="sign-in-demo-picker-label">
            <span>
              <Select.Value />
              <small>{selectedDemo.detail}</small>
            </span>
            <Select.Icon><ChevronDown size={15} /></Select.Icon>
          </Select.Trigger>
          <Select.Portal>
            <Select.Content className="repository-select-content" position="popper" sideOffset={6}>
              <Select.Viewport>
                {DEMO_PULL_REQUESTS.map((demo) => (
                  <Select.Item className="repository-option" key={demo.value} value={demo.value}>
                    <Select.ItemText>{demo.label}</Select.ItemText>
                    <Select.ItemIndicator><Check size={14} /></Select.ItemIndicator>
                  </Select.Item>
                ))}
              </Select.Viewport>
            </Select.Content>
          </Select.Portal>
        </Select.Root>
        <button
          className="repository-trigger demo-continue"
          type="button"
          onClick={() => onDemoContinue(selectedDemo.destination)}
        >
          <span>
            <span>Continue without signing in</span>
            <small>Opens {selectedDemo.label} · local dev API only</small>
          </span>
          <span><ExternalLink size={15} /></span>
        </button>
      </div>
    </div>
  );
}

function ReviewQueue({ onExpired }: { onExpired: () => void }) {
  const client = useMemo(() => new HarnessClient(harnessConfig), []);
  const [pulls, setPulls] = useState<MyPullSummary[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [refreshCount, setRefreshCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    void client.getMyPulls().then((nextPulls) => {
      if (cancelled) return;
      setPulls(nextPulls);
      setStatus("ready");
    }).catch((error: unknown) => {
      if (cancelled) return;
      const message = error instanceof Error ? error.message : "";
      if (/reauth_required|unauthorized|sign_in_required/i.test(message)) onExpired();
      else setStatus("error");
    });
    return () => { cancelled = true; };
  }, [client, onExpired, refreshCount]);

  const header = (
    <div className="review-queue-header">
      <label>Your review queue</label>
      <button
        className="review-queue-refresh"
        type="button"
        aria-label="Refresh review queue"
        disabled={status === "loading"}
        onClick={() => setRefreshCount((count) => count + 1)}
      >
        <RefreshCw size={12} className={status === "loading" ? "is-refreshing" : undefined} />
      </button>
    </div>
  );

  let body;
  if (status === "loading" && !pulls.length) {
    body = <p className="launcher-copy">Loading your review queue…</p>;
  } else if (status === "error") {
    body = <p className="launcher-copy">Could not load your review queue.</p>;
  } else if (!pulls.length) {
    body = <p className="launcher-copy">No pull requests are waiting on you.</p>;
  }
  if (body) {
    return <>{header}{body}</>;
  }
  return (
    <>
    {header}
    <nav className="review-queue" aria-label="Your review queue">
      {pulls.map((pull) => (
        <button
          key={`${pull.owner}/${pull.repo}#${pull.number}`}
          className="repository-trigger review-queue-item"
          type="button"
          onClick={() => {
            void browser.tabs.create({
              url: `https://github.com/${pull.owner}/${pull.repo}/pull/${pull.number}/files`,
            });
          }}
        >
          <span>
            <span>{pull.owner}/{pull.repo} · #{pull.number}</span>
            <small>
              {pull.role === "review-requested" ? "Review requested" : pull.role === "assigned" ? "Assigned" : "Your PR"}
              {" · updated "}{new Date(pull.updatedAt).toLocaleDateString()}
            </small>
          </span>
        </button>
      ))}
    </nav>
    </>
  );
}

function ContextLauncher({ context, auth, onExpired }: {
  context: GitHubPageContext;
  auth: AuthState;
  onExpired: () => void;
}) {
  const client = useMemo(() => new HarnessClient(harnessConfig), []);
  const onGitHub = context.kind === "github";
  const repo = context.owner && context.repository ? `${context.owner}/${context.repository}` : undefined;
  const [pulls, setPulls] = useState<GitHubPullSummary[]>([]);
  const [selectedPullNumber, setSelectedPullNumber] = useState("");
  const [selectedDemoValue, setSelectedDemoValue] = useState<string>(DEMO_PULL_REQUESTS[0].value);
  const [pullsStatus, setPullsStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");

  useEffect(() => {
    let cancelled = false;
    setPulls([]);
    setSelectedPullNumber("");
    if (!context.owner || !context.repository) {
      setPullsStatus("idle");
      return () => { cancelled = true; };
    }
    setPullsStatus("loading");
    void client.listPullRequests(context.owner, context.repository).then((nextPulls) => {
      if (cancelled) return;
      setPulls(nextPulls);
      setSelectedPullNumber(nextPulls[0]?.number.toString() ?? "");
      setPullsStatus("ready");
    }).catch(() => {
      if (!cancelled) setPullsStatus("error");
    });
    return () => { cancelled = true; };
  }, [client, context.owner, context.repository]);

  const selectedPull = pulls.find(({ number }) => number.toString() === selectedPullNumber);
  const selectedDemo = DEMO_PULL_REQUESTS.find(({ value }) => value === selectedDemoValue)
    ?? DEMO_PULL_REQUESTS[0];
  const destination = repo && selectedPull
    ? `https://github.com/${repo}/pull/${selectedPull.number}/files`
    : repo
      ? `https://github.com/${repo}/pulls`
      : selectedDemo.destination;

  return (
    <div className="launcher">
      <div className="launcher-mark"><GitPullRequest size={23} strokeWidth={1.6} /></div>
      <p className="utility-label">{onGitHub ? repo ?? "GitHub" : "No pull request detected"}</p>
      <h1>{onGitHub ? "Open a pull request to begin." : "Primer follows your review on GitHub."}</h1>
      <p className="launcher-copy">
        {onGitHub
          ? "When you open a pull request, the review story, evidence, and agent controls will appear here."
          : "Move to a GitHub pull request and this panel will become your evidence-backed review companion."}
      </p>
      {auth.status === "signed-in" ? (
        <div className="repository-picker">
          <ReviewQueue onExpired={onExpired} />
        </div>
      ) : null}
      <div className="repository-picker">
        <label>Repository</label>
        <div className="repository-trigger repository-current">
          <span>
            <span>{repo ?? "Any GitHub repository"}</span>
            <small>{repo ? "Current repository" : "Open a repository to continue"}</small>
          </span>
        </div>
      </div>
      {repo ? (
        <div className="repository-picker pull-request-picker">
          <label id="pull-request-picker-label">Pull request</label>
          {pulls.length ? (
            <Select.Root value={selectedPullNumber} onValueChange={setSelectedPullNumber}>
              <Select.Trigger className="repository-trigger" aria-labelledby="pull-request-picker-label">
                <span>
                  <Select.Value />
                  <small>{selectedPull?.draft ? "Draft" : "Open"} · updated {selectedPull ? new Date(selectedPull.updatedAt).toLocaleDateString() : ""}</small>
                </span>
                <Select.Icon><ChevronDown size={15} /></Select.Icon>
              </Select.Trigger>
              <Select.Portal>
                <Select.Content className="repository-select-content" position="popper" sideOffset={6}>
                  <Select.Viewport>
                    {pulls.map((pull) => (
                      <Select.Item className="repository-option" key={pull.number} value={pull.number.toString()}>
                        <Select.ItemText>#{pull.number} · {pull.title}</Select.ItemText>
                        <Select.ItemIndicator><Check size={14} /></Select.ItemIndicator>
                      </Select.Item>
                    ))}
                  </Select.Viewport>
                </Select.Content>
              </Select.Portal>
            </Select.Root>
          ) : (
            <div className="repository-trigger repository-current">
              <span>
                <span>{pullsStatus === "loading" ? "Loading pull requests…" : pullsStatus === "error" ? "Could not load pull requests" : "No open pull requests"}</span>
                <small>{pullsStatus === "error" ? "Check the local API and GitHub token" : "Open PRs appear here"}</small>
              </span>
            </div>
          )}
        </div>
      ) : (
        <div className="repository-picker pull-request-picker">
          <label id="demo-pull-request-picker-label">Demo pull request</label>
          <Select.Root value={selectedDemoValue} onValueChange={setSelectedDemoValue}>
            <Select.Trigger className="repository-trigger" aria-labelledby="demo-pull-request-picker-label">
              <span>
                <Select.Value />
                <small>{selectedDemo.detail}</small>
              </span>
              <Select.Icon><ChevronDown size={15} /></Select.Icon>
            </Select.Trigger>
            <Select.Portal>
              <Select.Content className="repository-select-content" position="popper" sideOffset={6}>
                <Select.Viewport>
                  {DEMO_PULL_REQUESTS.map((demo) => (
                    <Select.Item className="repository-option" key={demo.value} value={demo.value}>
                      <Select.ItemText>{demo.label}</Select.ItemText>
                      <Select.ItemIndicator><Check size={14} /></Select.ItemIndicator>
                    </Select.Item>
                  ))}
                </Select.Viewport>
              </Select.Content>
            </Select.Portal>
          </Select.Root>
        </div>
      )}
      <a className="primary-action" href={destination} target="_blank" rel="noreferrer">
        {selectedPull ? "Open Files changed" : repo ? "Browse pull requests" : "Open demo Files changed"}
        <ExternalLink size={15} />
      </a>
    </div>
  );
}

function ReviewOverview({ context, session, plan, route, onStart }: {
  context: GitHubPageContext;
  session: HarnessSession & { artifact: NonNullable<HarnessSession["artifact"]> };
  plan: ReviewPlan;
  route: ReturnType<typeof getExtensionReviewRoute>;
  onStart: (routeIndex: number) => void;
}) {
  const deepReadCount = session.artifact.chapters.filter(({ attention }) =>
    attention.level === "DEEP_READ").length;

  return (
    <div className="overview-scroll">
      <section className="review-overview">
        <div className="overview-hero">
          <p className="utility-label">{context.owner}/{context.repository} · #{context.pullNumber}</p>
          <div className="overview-signal"><Sparkles size={16} /></div>
          <h1>I’m ready to guide this review.</h1>
          <p className="overview-brief">{session.artifact.exec_summary.text}</p>
          <div className="overview-stats" aria-label="Pull request analysis summary">
            <span><strong>{plan.stats.totalFiles}</strong> changed files</span>
            <span><strong>{plan.stats.chapters}</strong> review chapters</span>
            <span><strong>{deepReadCount}</strong> deep-read areas</span>
          </div>
          <button className="primary-action overview-start" type="button" disabled={!route.length} onClick={() => onStart(0)}>
            Begin guided review <ArrowRight size={15} />
          </button>
        </div>

        <div className="overview-section-heading">
          <span>Review path</span>
          <small>{route.length} evidence-backed steps</small>
        </div>
        <div className="overview-chapters">
          {plan.chapters.map((chapter, index) => {
            const artifactChapter = session.artifact.chapters.find(({ id }) => id === chapter.id);
            const firstRouteIndex = route.findIndex((item) => item.chapter.id === chapter.id);
            return (
              <button className="overview-chapter" type="button" key={chapter.id} disabled={firstRouteIndex < 0} onClick={() => onStart(firstRouteIndex)}>
                <span className="overview-chapter-number">{String(index + 1).padStart(2, "0")}</span>
                <span className="overview-chapter-copy">
                  <span className="overview-chapter-meta">
                    {chapter.fileIds.length} files · {artifactChapter?.attention.level.replace("_", " ").toLowerCase() ?? "standard"}
                  </span>
                  <strong>{chapter.title}</strong>
                  <p>{chapter.summary}</p>
                </span>
                <ArrowRight size={15} />
              </button>
            );
          })}
        </div>
        {plan.stats.noiseFiles ? (
          <p className="overview-appendix">Primer set aside {plan.stats.noiseFiles} generated or low-signal files to keep the guided path focused.</p>
        ) : null}
      </section>
    </div>
  );
}

function LiveReview({ context, panelView }: {
  context: GitHubPageContext;
  panelView: "conversation" | "architecture";
}) {
  const client = useMemo(() => new HarnessClient(harnessConfig), []);
  const sourceRef = useRef<EventSource | undefined>(undefined);
  const activeReviewIdentityRef = useRef("");
  const autoStartedIdentityRef = useRef<string | undefined>(undefined);
  const [session, setSession] = useState<HarnessSession>();
  const [phase, setPhase] = useState<"idle" | "starting" | "generating">("idle");
  const [generatedChapters, setGeneratedChapters] = useState<Chapter[]>([]);
  const [error, setError] = useState<string>();
  const [resolvedHeadSha, setResolvedHeadSha] = useState<string>();
  const [headResolutionError, setHeadResolutionError] = useState<string>();
  const [reviewScreen, setReviewScreen] = useState<"overview" | "steps">("overview");
  const [entryRouteIndex, setEntryRouteIndex] = useState(0);
  const headSha = context.headSha
    ?? context.activeAnchor?.headSha
    ?? resolvedHeadSha;
  const reviewIdentity = `${context.owner}/${context.repository}#${context.pullNumber}:${headSha ?? "unknown"}`;

  useEffect(() => {
    let cancelled = false;
    setResolvedHeadSha(undefined);
    setHeadResolutionError(undefined);
    if (context.headSha || context.activeAnchor?.headSha) return () => { cancelled = true; };
    if (!context.owner || !context.repository || !context.pullNumber) return () => { cancelled = true; };
    void client.getPullRequest(context.owner, context.repository, context.pullNumber).then((pull) => {
      if (!cancelled) setResolvedHeadSha(pull.headSha);
    }).catch((lookupError) => {
      if (!cancelled) {
        setHeadResolutionError(lookupError instanceof Error ? lookupError.message : "Could not resolve the current PR head");
      }
    });
    return () => { cancelled = true; };
  }, [client, context.activeAnchor?.headSha, context.headSha, context.owner, context.pullNumber, context.repository]);

  useEffect(() => {
    activeReviewIdentityRef.current = reviewIdentity;
    autoStartedIdentityRef.current = undefined;
    sourceRef.current?.close();
    sourceRef.current = undefined;
    setSession(undefined);
    setPhase("idle");
    setGeneratedChapters([]);
    setError(undefined);
    setReviewScreen("overview");
    setEntryRouteIndex(0);
  }, [reviewIdentity]);

  useEffect(() => () => sourceRef.current?.close(), []);

  const connectToStream = useCallback((nextSession: HarnessSession, requestedIdentity: string) => {
    sourceRef.current?.close();
    setPhase("generating");
    let settled = false;
    const source = new EventSource(client.eventsUrl(nextSession.id));
    sourceRef.current = source;

    const handle = (raw: MessageEvent<string>) => {
      if (activeReviewIdentityRef.current !== requestedIdentity) return;
      try {
        const parsed = StoryStreamEventSchema.parse(JSON.parse(raw.data));
        if (parsed.type === "story.skeleton") {
          setError(undefined);
          setSession((current) => current ? { ...current, status: "GENERATING", skeleton: parsed.data } : current);
        }
        if (parsed.type === "story.chapter") {
          setGeneratedChapters((current) => upsertGeneratedChapter(current, parsed.data));
        }
        if (parsed.type === "story.ready") {
          settled = true;
          source.close();
          setGeneratedChapters(parsed.data.chapters);
          setSession((current) => {
            if (!current) return current;
            const { error: _error, ...rest } = current;
            return { ...rest, status: "READY", artifact: parsed.data };
          });
          setPhase("idle");
        }
        if (parsed.type === "story.error") {
          settled = true;
          source.close();
          setError(parsed.data.message);
          setPhase("idle");
        }
      } catch (streamError) {
        settled = true;
        source.close();
        setError(streamError instanceof Error ? streamError.message : "Invalid story event");
        setPhase("idle");
      }
    };

    for (const eventName of ["story.skeleton", "story.chapter", "story.ready", "story.error"]) {
      source.addEventListener(eventName, handle as EventListener);
    }
    source.onerror = () => {
      if (settled || activeReviewIdentityRef.current !== requestedIdentity) return;
      // EventSource reconnects automatically. A transient SSE close is expected
      // during local dev reloads and must not turn a healthy stored generation
      // into a terminal connection error.
      setPhase("generating");
    };
  }, [client]);

  const startReview = useCallback(async () => {
    if (!context.owner || !context.repository || !context.pullNumber || !headSha) return;
    const requestedIdentity = reviewIdentity;
    sourceRef.current?.close();
    setError(undefined);
    setPhase("starting");
    try {
      const nextSession = await client.createOrResume({
        owner: context.owner,
        repo: context.repository,
        pullNumber: context.pullNumber,
        headSha,
      });
      if (activeReviewIdentityRef.current !== requestedIdentity) return;
      if (nextSession.artifact) {
        const artifact = StoryArtifactSchema.parse(nextSession.artifact);
        setGeneratedChapters(artifact.chapters);
        setSession({ ...nextSession, artifact });
        setPhase("idle");
        return;
      }
      setSession(nextSession);
      connectToStream(nextSession, requestedIdentity);
    } catch (startError) {
      if (activeReviewIdentityRef.current !== requestedIdentity) return;
      autoStartedIdentityRef.current = undefined;
      setError(startError instanceof Error ? startError.message : "Could not start the review");
      setPhase("idle");
    }
  }, [client, connectToStream, context.owner, context.pullNumber, context.repository, headSha, reviewIdentity]);

  useEffect(() => {
    if (!context.owner || !context.repository || !context.pullNumber || !headSha) return;
    if (autoStartedIdentityRef.current === reviewIdentity) return;
    autoStartedIdentityRef.current = reviewIdentity;
    void startReview();
  }, [context.owner, context.pullNumber, context.repository, headSha, reviewIdentity, startReview]);

  const plan = useMemo(() => session?.artifact
    ? storyArtifactToReviewPlan(
      session.artifact,
      `${context.owner}/${context.repository}`,
      session.completedChapterIds,
    )
    : undefined, [context.owner, context.repository, session?.artifact, session?.completedChapterIds]);
  const route = useMemo(() => plan ? getExtensionReviewRoute(plan) : [], [plan]);
  const statuses = useMemo<Record<string, ReviewStepStatus>>(
    () => Object.fromEntries(route.map(({ step }) => [step.fileId, step.status])),
    [route],
  );
  const selectedIndex = Math.max(0, route.findIndex(({ chapter }) => chapter.id === session?.currentChapterId));
  const generatedChapterIds = new Set(generatedChapters.map(({ id }) => id));
  const generationChapters = session?.skeleton?.chapters ?? [];
  const generationProgress = {
    completed: generationChapters.filter(({ id }) => generatedChapterIds.has(id)).length,
    total: generationChapters.length,
  };

  const enterGuidedReview = async (routeIndex: number) => {
    const next = route[routeIndex];
    if (!next || !session) return;
    setEntryRouteIndex(routeIndex);
    if (next.chapter.id !== session.currentChapterId) {
      try {
        setSession(await client.selectChapter(session.id, next.chapter.id));
      } catch {
        // The local route remains usable if progress persistence is unavailable.
      }
    }
    setReviewScreen("steps");
    void navigateGitHubToFile(next.file.path);
  };

  if (session?.artifact && plan) {
    if (panelView === "architecture") {
      return (
        <Suspense fallback={<div className="architecture-loading">Preparing dependency map…</div>}>
          <ArchitectureView
            plan={plan}
            route={route}
            statuses={statuses}
            selectedIndex={selectedIndex}
            navigateTo={(index) => {
              const next = route[index];
              if (!next) return;
              if (next.chapter.id !== session.currentChapterId) {
                void client.selectChapter(session.id, next.chapter.id).then(setSession).catch(() => undefined);
              }
              if (new URLSearchParams(window.location.search).has("preview")) return;
              void navigateGitHubDiff(
                next.file.path,
                plan.headSha,
                next.step.line,
                next.step.side,
                next.step.endLine,
              ).catch(() => undefined);
            }}
          />
        </Suspense>
      );
    }
    if (reviewScreen === "overview") {
      return (
        <ReviewOverview
          context={context}
          session={session as HarnessSession & { artifact: NonNullable<HarnessSession["artifact"]> }}
          plan={plan}
          route={route}
          onStart={(index) => void enterGuidedReview(index)}
        />
      );
    }
    return (
      <ReviewConversation
        context={context}
        plan={plan}
        session={session}
        client={client}
        initialSelectedIndex={entryRouteIndex}
        onBackToOverview={() => setReviewScreen("overview")}
        onSessionChange={setSession}
      />
    );
  }

  const busy = phase !== "idle";
  return (
    <div className="launcher review-start">
      <div className="launcher-mark">{busy ? <LoaderCircle className="spin" size={23} /> : <Sparkles size={23} strokeWidth={1.6} />}</div>
      <p className="utility-label">{context.owner}/{context.repository} · #{context.pullNumber}</p>
      <h1>{phase === "generating" ? "Building your review story…" : "Review the latest commit."}</h1>
      <p className="launcher-copy">{phase === "generating"
        ? `${generationProgress.completed} of ${generationProgress.total || "…"} chapters ready. Keep this panel open while Primer connects the evidence.`
        : "Primer will analyze the current PR head, then guide you through 2–5 evidence-backed chapters."}</p>
      {headSha
        ? <code className="commit-pill">{headSha.slice(0, 12)}</code>
        : <p className="start-warning">{headResolutionError ?? "Resolving the current PR head…"}</p>}
      {generationChapters.length ? (
        <div className="chapter-build-list" aria-label="Chapter analysis progress">
          {generationChapters.map((chapter) => {
            const generated = generatedChapters.find(({ id }) => id === chapter.id);
            return (
              <div className={generated ? "is-ready" : "is-pending"} key={chapter.id}>
                {generated ? <CheckCircle2 size={14} /> : <LoaderCircle className="spin" size={14} />}
                <span><strong>{chapter.title}</strong><small>{generated ? `${generated.files.length} files ready` : "Analyzing evidence…"}</small></span>
              </div>
            );
          })}
        </div>
      ) : null}
      {error ? <div className="start-error" role="alert"><AlertCircle size={14} /> {error}</div> : null}
      <button className="primary-action start-button" type="button" disabled={!headSha || busy} onClick={() => void startReview()}>
        {busy ? "Analyzing with agents…" : error ? "Retry review" : "Start review for latest commit"}
        {busy ? <LoaderCircle className="spin" size={15} /> : <ArrowRight size={15} />}
      </button>
    </div>
  );
}

function ReviewConversation({
  context,
  plan,
  session,
  client,
  initialSelectedIndex,
  onBackToOverview,
  onSessionChange,
}: {
  context: GitHubPageContext;
  plan: ReviewPlan;
  session: HarnessSession;
  client: HarnessClient;
  initialSelectedIndex: number;
  onBackToOverview: () => void;
  onSessionChange: (session: HarnessSession) => void;
}) {
  const activeFileName = context.activeFile?.split("/").at(-1);
  const anchor = context.activeAnchor;
  const anchorLabel = anchor
    ? `${anchor.side === "RIGHT" ? "New" : "Old"} ${anchor.startLine
      ? `lines ${anchor.startLine}–${anchor.line}`
      : `line ${anchor.line}`}`
    : undefined;
  const route = useMemo(() => getExtensionReviewRoute(plan), [plan]);
  const [selectedIndex, setSelectedIndex] = useState(() => {
    if (route[initialSelectedIndex]) return initialSelectedIndex;
    const currentChapterIndex = route.findIndex(({ chapter }) => chapter.id === session.currentChapterId);
    return currentChapterIndex >= 0 ? currentChapterIndex : -1;
  });
  const statuses = useMemo<Record<string, ReviewStepStatus>>(() =>
    Object.fromEntries(route.map(({ step }) => [step.fileId, step.status])),
  [route]);
  const [composerValue, setComposerValue] = useState("");
  const conversationRef = useRef<HTMLDivElement>(null);
  const followsLatestRef = useRef(true);
  const renderedChatStateRef = useRef({ scopeKey: "", count: 0 });
  const observedFileRef = useRef(context.activeFile);
  const suppressFollowUntilRef = useRef(0);
  const [draftFeedback, setDraftFeedback] = useState<{
    tone: "working" | "success" | "error";
    message: string;
    action?: { label: string; url: string };
  }>();
  const [appAccess, setAppAccess] = useState<{ installed: boolean; installUrl?: string }>();

  useEffect(() => {
    let cancelled = false;
    if (!context.owner || !context.repository) return () => { cancelled = true; };
    void client.getAppAccess(context.owner, context.repository)
      .then((access) => { if (!cancelled) setAppAccess(access); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [client, context.owner, context.repository]);
  const selected = route[selectedIndex];
  const selectedFilePath = selected?.file.path;
  const selectedStatus = selected ? statuses[selected.step.fileId] ?? selected.step.status : "pending";
  const severity = selected?.file.severity ?? "standard";
  const chapterNumber = selected ? plan.chapters.indexOf(selected.chapter) + 1 : 0;
  const selectedScopeKey = selected ? `${selected.chapter.id}\u0000${selected.step.fileId}` : "";
  const activeChatTurns = useMemo(() => selected
    ? session.chatTurns.filter((turn) =>
      turn.chapterId === selected.chapter.id && turn.stepId === selected.step.fileId)
    : [], [selected, session.chatTurns]);

  useEffect(() => {
    setSelectedIndex((current) => {
      if (route[current]?.chapter.id === session.currentChapterId) return current;
      const currentChapterIndex = route.findIndex(({ chapter }) => chapter.id === session.currentChapterId);
      return currentChapterIndex >= 0 ? currentChapterIndex : current;
    });
  }, [route, session.currentChapterId]);

  useEffect(() => {
    if (context.activeFile === observedFileRef.current) return;
    observedFileRef.current = context.activeFile;
    // While Primer itself is scrolling the diff, intermediate files pass
    // through the viewport; following them would yank the selection away
    // from the step the reviewer just chose.
    if (Date.now() < suppressFollowUntilRef.current) return;
    const visibleIndex = findRouteIndexByPath(route, context.activeFile);
    if (visibleIndex >= 0) setSelectedIndex(visibleIndex);
  }, [context.activeFile, route]);

  useEffect(() => {
    const previous = renderedChatStateRef.current;
    const scopeChanged = previous.scopeKey !== selectedScopeKey;
    renderedChatStateRef.current = { scopeKey: selectedScopeKey, count: activeChatTurns.length };
    if (!scopeChanged && activeChatTurns.length <= previous.count) return;
    if (!followsLatestRef.current && !scopeChanged) return;
    if (scopeChanged) followsLatestRef.current = true;

    const conversation = conversationRef.current;
    if (!conversation) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // A scope change is a page transition: the step (or the overview) opens
    // from the top. Within an unchanged scope, new turns keep following.
    conversation.scrollTo({
      top: scopeChanged ? 0 : conversation.scrollHeight,
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }, [activeChatTurns.length, selectedScopeKey]);

  const navigateTo = async (index: number) => {
    const next = route[index];
    if (!next) return;
    setComposerValue("");
    setDraftFeedback(undefined);
    setSelectedIndex(index);
    if (next.chapter.id !== session.currentChapterId) {
      try {
        onSessionChange(await client.selectChapter(session.id, next.chapter.id));
      } catch (navigationError) {
        setDraftFeedback({
          tone: "error",
          message: navigationError instanceof Error ? navigationError.message : "Could not save review position",
        });
      }
    }
    if (new URLSearchParams(window.location.search).has("preview")) return;
    suppressFollowUntilRef.current = Date.now() + 1800;
    try {
      const navigated = await navigateGitHubDiff(
        next.file.path,
        plan.headSha,
        next.step.line,
        next.step.side,
        next.step.endLine,
      );
      if (!navigated) {
        setDraftFeedback({
          tone: "error",
          message: "Open this pull request's Files changed tab so Primer can navigate to the review step.",
        });
      }
    } catch (navigationError) {
      setDraftFeedback({
        tone: "error",
        message: navigationError instanceof Error ? navigationError.message : "Could not navigate to this diff",
      });
    }
  };

  const completeSelected = async () => {
    if (!selected || selectedStatus === "reviewed") return;
    try {
      onSessionChange(await client.completeChapter(session.id, selected.chapter.id));
      const nextChapterIndex = route.findIndex((item, index) =>
        index > selectedIndex && item.chapter.id !== selected.chapter.id);
      if (nextChapterIndex >= 0) await navigateTo(nextChapterIndex);
    } catch (completionError) {
      setDraftFeedback({
        tone: "error",
        message: completionError instanceof Error ? completionError.message : "Could not complete chapter",
      });
    }
  };

  const submitComposer = async () => {
    const message = composerValue.trim();
    if (!message) return;
    const command = parseCommentCommand(composerValue);
    if (!command) {
      if (!selected) {
        setDraftFeedback({ tone: "error", message: "Open a review step before starting a conversation." });
        return;
      }
      followsLatestRef.current = true;
      setDraftFeedback({ tone: "working", message: "Preparing evidence and asking Primer…" });
      try {
        const response = await client.sendChatMessage(session.id, {
          message,
          chapterId: selected.chapter.id,
          stepId: selected.step.fileId,
        });
        onSessionChange({
          ...session,
          chatTurns: [...session.chatTurns, response.user, response.assistant],
        });
        setComposerValue("");
        setDraftFeedback(undefined);
      } catch (error) {
        setDraftFeedback({
          tone: "error",
          message: error instanceof Error ? error.message : "Primer chat is unavailable.",
        });
      }
      return;
    }
    if (!anchor) {
      setDraftFeedback({
        tone: "error",
        message: "Select or scroll to a GitHub diff line before drafting a comment.",
      });
      return;
    }

    const reviewReason = selected?.file.path === anchor.path ? selected.step.reason : undefined;
    const body = createFallbackCommentDraft(command.instruction, reviewReason);
    setDraftFeedback({ tone: "working", message: "Creating a pending review comment on GitHub…" });

    if (new URLSearchParams(window.location.search).has("preview")) {
      setDraftFeedback({
        tone: "success",
        message: "Preview: draft prepared. In the extension, it becomes a pending GitHub review comment.",
      });
      return;
    }

    // Draft in GitHub's own inline composer: it renders live, the user
    // reviews and edits before anything reaches GitHub, and submission flows
    // through GitHub's native review UI (Start a review → Submit review).
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (tab?.id !== undefined) {
        const result: unknown = await browser.tabs.sendMessage(tab.id, {
          type: "primer:draft-comment",
          anchor,
          body,
        }).catch(() => undefined);
        if (result && typeof result === "object" && (result as { ok?: boolean }).ok) {
          setComposerValue("");
          setDraftFeedback({
            tone: "success",
            message: "Draft ready in GitHub's composer. Edit it there, then Start a review.",
          });
          return;
        }
      }
    } catch {
      // Fall through to the flagged API path or the error below.
    }

    // The API path publishes a pending comment directly — no composer
    // checkpoint — so it stays flagged off while drafting is human-reviewed.
    // Flip to re-enable as a fallback (comments need a page refresh to show).
    const API_PUBLISH_FALLBACK = false;
    if (!API_PUBLISH_FALLBACK) {
      setDraftFeedback({
        tone: "error",
        message: "Could not open GitHub's comment composer on that line. Scroll it into view and try again.",
      });
      return;
    }

    try {
      const draft = await client.createDraft(session.id, {
        body,
        path: anchor.path,
        line: anchor.line,
        side: anchor.side,
      });
      await client.publishDraft(session.id, draft.id);
      setComposerValue("");
      setDraftFeedback({
        tone: "success",
        message: "Pending review comment created — refresh the PR to see it. It stays private until you submit the review.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const installUrl = /App to be installed/i.test(message)
        ? message.match(/https:\/\/github\.com\/apps\/\S+/)?.[0]
        : undefined;
      setDraftFeedback({
        tone: "error",
        message: /422|pending review/i.test(message)
          ? "GitHub already has a pending review for you on this PR. Submit or discard it on GitHub, then try again."
          : installUrl
            ? `Publishing needs the Primer GitHub App installed on ${context.owner}/${context.repository}. Install it, or send the link to the repo owner.`
            : `Could not create the review comment.${message ? ` ${message}` : ""}`,
        ...(installUrl ? { action: { label: "Install", url: installUrl } } : {}),
      });
    }
  };

  const submitOnEnter = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (composerValue.trim() && draftFeedback?.tone !== "working") void submitComposer();
  };

  return (
    <>
      <div
        className="conversation step-conversation"
        ref={conversationRef}
        role="log"
        aria-label="Review conversation"
        aria-live="polite"
        tabIndex={0}
        onScroll={(event) => {
          followsLatestRef.current = isNearScrollEnd(event.currentTarget);
        }}
      >
        <div className="opening-space" aria-hidden="true" />
        {!selected ? (
          <article className="agent-turn">
            <div className="trace" aria-hidden="true"><span /></div>
            <div className="agent-copy">
              <p className="agent-name"><Sparkles size={13} /> Primer</p>
              <h1>I’m ready to guide this review.</h1>
              <p>
                I found <strong>{context.owner}/{context.repository}#{context.pullNumber}</strong>.
                {plan
                  ? ` I loaded ${route.length} evidence-backed steps across ${plan.chapters.length} chapters and will follow the diff as you scroll.`
                  : " I’ll follow the diff as you scroll and keep the review tied to the visible code."}
              </p>
            </div>
          </article>
        ) : null}

        <section className={`context-card ${context.activeFile ? "is-live" : ""}`}>
          <div className="context-card-heading">
            <span><FileCode2 size={14} /> Live GitHub context</span>
            <span className="live-signal"><i /> {context.activeFile ? "Following" : "Waiting"}</span>
          </div>
          {context.activeFile ? (
            <>
              <strong>{activeFileName}</strong>
              <code>{context.activeFile}</code>
              {anchor ? (
                <div className="anchor-detail">
                  <span>{anchorLabel}</span>
                  <code>{anchor.headSha.slice(0, 7)}</code>
                  {anchor.selectedText ? <p>“{anchor.selectedText}”</p> : null}
                </div>
              ) : null}
              <p>{anchor
                ? "Your next question or command will stay tied to this exact diff position."
                : "I’ll use this file as context. Select a diff line to create an exact anchor."}</p>
            </>
          ) : (
            <p>Open the Files changed tab or scroll to a diff and I’ll follow the active file.</p>
          )}
        </section>

        {!selected ? (
          <section className="pr-analysis-card" aria-label="Pull request analysis">
            <div className="pr-analysis-heading"><GitPullRequest size={14} /><span>PR context &amp; analysis</span></div>
            <strong>{plan.title}</strong>
            <div className="pr-analysis-stats">
              <span><b>{plan.stats.totalFiles}</b> files</span>
              <span><b>{plan.stats.chapters}</b> chapters</span>
              <span><b>{plan.stats.noiseFiles}</b> low signal</span>
            </div>
            <p>This overview applies to the whole pull request. Step conversations open on their own page, scoped to a single review step.</p>
            {route.length ? (
              <button className="begin-review" type="button" onClick={() => void navigateTo(0)}>
                Begin chapter 1 <ArrowRight size={14} />
              </button>
            ) : null}
          </section>
        ) : null}

        {selected ? (
          <section className="review-step-card">
            <div className="step-heading">
              <button
                className="step-back"
                type="button"
                onClick={() => {
                  setComposerValue("");
                  setDraftFeedback(undefined);
                  onBackToOverview();
                }}
              >
                <ArrowLeft size={13} /> Overview
              </button>
              <span>Chapter {chapterNumber} · Step {selectedIndex + 1}/{route.length}</span>
              <span className={`step-status status-${selectedStatus}`}><i /> {selectedStatus}</span>
            </div>
            <h1>{selected.file.path.split("/").at(-1)}</h1>
            <code className="focus-file-path">{selected.file.path}</code>
            <p className="focus-step-summary">{selected.step.reason}</p>
            <div className={`focus-live-context ${context.activeFile === selected.file.path ? "is-aligned" : ""}`}>
              <FileCode2 size={13} />
              <span>{context.activeFile === selected.file.path
                ? "GitHub is aligned to this file"
                : context.activeFile
                  ? `GitHub is currently on ${activeFileName}`
                  : "Waiting for the GitHub diff"}</span>
              {anchor?.path === selected.file.path ? <code>{anchorLabel}</code> : null}
            </div>
            {selected.step.evidence.length ? (
              <div className="focus-evidence">
                <span className="focus-section-label">What to verify</span>
                {selected.step.evidence.slice(0, 2).map((evidence, index) => (
                  <div className="focus-evidence-row" key={`${evidence.kind}-${index}`}>
                    <i />
                    <p>{evidence.description}</p>
                  </div>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}

        {selected ? (
          <div className="step-conversation-label">
            <span>Step {selected.step.order} conversation</span>
            <small>{activeChatTurns.length ? `${activeChatTurns.length} turns` : "No messages yet"}</small>
          </div>
        ) : null}

        {activeChatTurns.map((turn) => (
          <article className={`chat-turn chat-turn-${turn.role}`} key={turn.id}>
            <p className="chat-turn-author">
              {turn.role === "assistant" ? <><Sparkles size={12} /> Primer</> : "You"}
            </p>
            <p>{turn.content}</p>
            {turn.citations.length ? (
              <div className="chat-citations" aria-label="Response evidence">
                {turn.citations.map((citation) => (
                  <code key={`${citation.path}:${citation.lines.join("-")}`}>
                    {citation.path}:{citation.lines[0]}-{citation.lines[1]}
                  </code>
                ))}
              </div>
            ) : null}
          </article>
        ))}

        {selected ? (
          <div className="suggestions" aria-label="Suggested prompts">
            <button type="button" onClick={() => setComposerValue("Explain why this file is in this step")}>Why is this file here?</button>
            <button type="button" onClick={() => setComposerValue("What should I scrutinize in this step?")}>What should I scrutinize?</button>
            <button type="button" onClick={() => setComposerValue("/evidence for this file")}>/evidence for this file</button>
          </div>
        ) : null}
      </div>

      <footer className="composer-shell">
        <div className="review-controls" aria-label="Review navigation">
          <button className="control-button" type="button" aria-label="Previous review step" disabled={selectedIndex <= 0} onClick={() => navigateTo(selectedIndex - 1)}><ArrowLeft size={15} /></button>
          <span className={`severity severity-${severity}`}><CircleDot size={13} /> {severityLabel[severity]}</span>
          <button className={`control-button status-control ${selectedStatus === "reviewed" ? "is-reviewed" : ""}`} type="button" aria-label={selectedStatus === "reviewed" ? "Chapter reviewed" : "Complete chapter"} disabled={!selected || selectedStatus === "reviewed"} onClick={() => void completeSelected()}><CheckCircle2 size={15} /></button>
          <button className="control-button" type="button" aria-label="Next review step" disabled={selectedIndex >= route.length - 1} onClick={() => navigateTo(selectedIndex + 1)}><ArrowRight size={15} /></button>
        </div>
        {appAccess?.installed === false && !draftFeedback ? (
          <div className="draft-feedback is-working" role="status">
            <AlertCircle size={13} />
            <span>
              Primer can read this pull request but cannot publish comments until its GitHub App
              is installed on {context.owner}/{context.repository}.
            </span>
            {appAccess.installUrl ? (
              <button
                className="feedback-action"
                type="button"
                onClick={() => { void browser.tabs.create({ url: appAccess.installUrl }); }}
              >
                Install
              </button>
            ) : null}
          </div>
        ) : null}
        {draftFeedback ? (
          <div className={`draft-feedback is-${draftFeedback.tone}`} role="status">
            {draftFeedback.tone === "success" ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
            <span>{draftFeedback.message}</span>
            {draftFeedback.action ? (
              <button
                className="feedback-action"
                type="button"
                onClick={() => { void browser.tabs.create({ url: draftFeedback.action!.url }); }}
              >
                {draftFeedback.action.label}
              </button>
            ) : null}
          </div>
        ) : null}
        <form className="composer" onSubmit={(event) => {
          event.preventDefault();
          void submitComposer();
        }}>
          <textarea
            aria-label="Ask Primer"
            placeholder={selected ? "Ask about this step, or type / for skills" : "Begin chapter 1 to open its conversation"}
            rows={2}
            disabled={!selected}
            value={composerValue}
            onChange={(event) => {
              setComposerValue(event.target.value);
              if (draftFeedback?.tone !== "working") setDraftFeedback(undefined);
            }}
            onKeyDown={submitOnEnter}
          />
          <div className="composer-footer">
            <span><MessageSquareText size={13} /> /comment</span>
            <button type="submit" aria-label="Send message" disabled={!selected || !composerValue.trim() || draftFeedback?.tone === "working"}><Send size={15} /></button>
          </div>
        </form>
        <div className="review-path">
          <ChapterRail plan={plan} route={route} statuses={statuses} selectedIndex={selectedIndex} navigateTo={(index) => void navigateTo(index)} />
        </div>
      </footer>
    </>
  );
}

export function App() {
  const [context, setContext] = useState<GitHubPageContext>(getInitialContext);
  const [panelView, setPanelView] = useState<"conversation" | "architecture">("conversation");
  const [auth, setAuth] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    void getStoredAuth().then(async (stored) => {
      if (!stored) {
        setAuth({ status: "signed-out" });
        return;
      }
      harnessConfig.accessToken = stored.sessionToken;
      // Validate the stored session before trusting it: a restarted or
      // redeployed API may no longer recognize the token, and every other
      // surface would then fail with an opaque "unauthorized".
      try {
        const viewer = await new HarnessClient(harnessConfig).getMe();
        setAuth({ status: "signed-in", login: viewer.login });
      } catch {
        await clearStoredAuth();
        delete harnessConfig.accessToken;
        setAuth({ status: "signed-out", error: "Your session expired. Sign in again." });
      }
    });
  }, []);

  const handleSignIn = useCallback(() => {
    void signIn(harnessConfig.apiBaseUrl).then((stored) => {
      harnessConfig.accessToken = stored.sessionToken;
      setAuth({ status: "signed-in", login: stored.login });
    }).catch((error: unknown) => {
      setAuth({
        status: "signed-out",
        error: error instanceof Error ? error.message : "Sign-in failed",
      });
    });
  }, []);

  const handleSignOut = useCallback(() => {
    const stored = harnessConfig.accessToken && auth.status === "signed-in"
      ? { sessionToken: harnessConfig.accessToken, login: auth.login }
      : undefined;
    void signOut(harnessConfig.apiBaseUrl, stored).finally(() => {
      delete harnessConfig.accessToken;
      setAuth({ status: "signed-out" });
    });
  }, [auth]);

  // Demo path: skip OAuth and rely on the unauthenticated local dev API.
  const handleDemoContinue = useCallback((destination: string) => {
    setAuth({ status: "demo" });
    void browser.tabs.create({ url: destination });
  }, []);

  const handleSessionExpired = useCallback(() => {
    void clearStoredAuth().finally(() => {
      delete harnessConfig.accessToken;
      setAuth({ status: "signed-out", error: "Your session expired. Sign in again." });
    });
  }, []);
  const identity = useMemo(() => context.kind === "pull-request"
    ? `${context.owner}/${context.repository} · #${context.pullNumber}`
    : "Review companion", [context]);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("preview")) return undefined;

    const contextFromActiveTab = async (): Promise<{ tabId: number; context: GitHubPageContext } | undefined> => {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      return tab?.id !== undefined && tab.url
        ? { tabId: tab.id, context: getPageContext(tab.url) }
        : undefined;
    };

    // Prefer the content-script response because it includes the visible file,
    // anchor, and head SHA. Query the tab directly as an independent fallback:
    // PR detection should not disappear just because a dev service worker or
    // content script was invalidated during an extension reload.
    void Promise.allSettled([
      browser.runtime.sendMessage({ type: "primer:get-active-context" }),
      contextFromActiveTab(),
    ]).then(([runtimeResult, tabResult]) => {
      const runtimeContext = runtimeResult.status === "fulfilled"
        && runtimeResult.value
        && typeof runtimeResult.value === "object"
        && "kind" in runtimeResult.value
        ? runtimeResult.value as GitHubPageContext
        : undefined;
      const activeTab = tabResult.status === "fulfilled" ? tabResult.value : undefined;
      const tabContext = activeTab?.context;
      const runtimeMatchesActivePull = runtimeContext?.kind === "pull-request"
        && tabContext?.kind === "pull-request"
        && runtimeContext.owner === tabContext.owner
        && runtimeContext.repository === tabContext.repository
        && runtimeContext.pullNumber === tabContext.pullNumber;
      setContext(
        runtimeMatchesActivePull
          ? runtimeContext
          : tabContext ?? runtimeContext ?? getPageContext(""),
      );
    });

    const listener = (message: unknown) => {
      if (!isPrimerExtensionMessage(message)) return undefined;
      if (message.type === "primer:active-context-changed") {
        void contextFromActiveTab().then((activeTab) => {
          const next = activeContextFromMessage(message, activeTab?.tabId);
          setContext(next ?? activeTab?.context ?? getPageContext(""));
        });
      }
      return undefined;
    };
    browser.runtime.onMessage.addListener(listener);

    const refreshFromActiveTab = () => {
      void contextFromActiveTab().then((activeTab) => {
        if (activeTab) setContext((current) => reconcilePageContext(activeTab.context.url, current));
      }).catch(() => undefined);
    };
    const onActivated = () => {
      refreshFromActiveTab();
    };
    const onUpdated = (_tabId: number, change: { url?: string }, tab: { active: boolean }) => {
      if (tab.active && change.url) refreshFromActiveTab();
    };
    browser.tabs.onActivated.addListener(onActivated);
    browser.tabs.onUpdated.addListener(onUpdated);

    return () => {
      browser.runtime.onMessage.removeListener(listener);
      browser.tabs.onActivated.removeListener(onActivated);
      browser.tabs.onUpdated.removeListener(onUpdated);
    };
  }, []);

  return (
    <Tooltip.Provider delayDuration={350}>
      <main className="panel-shell">
        <header className="panel-header">
          <div className="panel-identity">
            <PrimerMark />
            <div><strong>Primer</strong><span>{identity}</span></div>
          </div>
          <div className="header-actions">
            {context.kind === "pull-request" ? (
              <IconButton label={panelView === "architecture" ? "Return to conversation" : "Show dependency map"} pressed={panelView === "architecture"} onClick={() => setPanelView((current) => current === "architecture" ? "conversation" : "architecture")}><Workflow size={16} /></IconButton>
            ) : <IconButton label="Evidence is locally sourced"><ShieldCheck size={16} /></IconButton>}
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button className="icon-button" type="button" aria-label="Open menu"><Menu size={17} /></button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content className="menu-content" sideOffset={7} align="end">
                  {context.kind === "pull-request" ? (
                    <DropdownMenu.Item onSelect={() => {
                      void browser.tabs.create({
                        url: `https://github.com/${context.owner}/${context.repository}/pull/${context.pullNumber}/files`,
                      });
                    }}>Open Files changed on GitHub <ExternalLink size={13} /></DropdownMenu.Item>
                  ) : (
                    <DropdownMenu.Item onSelect={() => { void browser.tabs.create({ url: "https://github.com/pulls" }); }}>
                      Open your pull requests <ExternalLink size={13} />
                    </DropdownMenu.Item>
                  )}
                  <DropdownMenu.Separator />
                  <DropdownMenu.Item disabled><Check size={13} /> Live harness</DropdownMenu.Item>
                  {auth.status === "signed-in" ? (
                    <DropdownMenu.Item onSelect={handleSignOut}>
                      Sign out ({auth.login})
                    </DropdownMenu.Item>
                  ) : null}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        </header>

        {auth.status === "loading" ? null
          : auth.status === "signed-out"
            ? <SignInScreen onSignIn={handleSignIn} onDemoContinue={handleDemoContinue} {...(auth.error ? { error: auth.error } : {})} />
            : context.kind === "pull-request"
              ? <LiveReview context={context} panelView={panelView} />
              : <ContextLauncher context={context} auth={auth} onExpired={handleSessionExpired} />}
      </main>
    </Tooltip.Provider>
  );
}
