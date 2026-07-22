import { lazy, Suspense, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { browser } from "wxt/browser";
import { StoryArtifactSchema, StoryStreamEventSchema } from "@review-story/contracts";
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
  Send,
  ShieldCheck,
  Sparkles,
  Workflow,
  XCircle,
} from "lucide-react";
import {
  getPageContext,
  isCommentDraftResult,
  isPrimerExtensionMessage,
  type GitHubPageContext,
} from "../../primer/lib/extension-context";
import { createFallbackCommentDraft, parseCommentCommand } from "../../primer/lib/comment-draft";
import {
  findRouteIndexByPath,
  getExtensionReviewRoute,
} from "../../primer/lib/extension-review";
import type { ReviewPlan, ReviewStepStatus, Severity } from "../../primer/lib/review-plan";
import { deriveChapterStatus } from "../../primer/lib/review-state";
import { HarnessClient, type HarnessSession } from "../../primer/lib/harness-client";
import { isNearScrollEnd } from "../../primer/lib/chat-scroll";
import { storyArtifactToReviewPlan } from "../../primer/lib/story-review-plan";

const TWENTY_PR = "https://github.com/twentyhq/twenty/pull/22819/files";
const ArchitectureView = lazy(async () => {
  const module = await import("./ArchitectureView");
  return { default: module.ArchitectureView };
});
const harnessConfig = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8787",
  ...(import.meta.env.VITE_HARNESS_ACCESS_TOKEN
    ? { accessToken: import.meta.env.VITE_HARNESS_ACCESS_TOKEN }
    : {}),
};
const REPOSITORY_OPTIONS = [
  {
    value: "twentyhq/twenty",
    label: "twentyhq/twenty",
    detail: "Demo PR #22819",
    destination: TWENTY_PR,
  },
  {
    value: "itayfry/king-of-tokens",
    label: "itayfry/king-of-tokens",
    detail: "Pull requests",
    destination: "https://github.com/itayfry/king-of-tokens/pulls",
  },
] as const;

const severityLabel: Record<Severity, string> = {
  "needs-human": "Human attention",
  standard: "Standard review",
  noise: "Low signal",
};

const draftFailureCopy = {
  "anchor-not-found": "That diff line is no longer rendered. Scroll it into view and try again.",
  "composer-not-found": "I found the line, but GitHub’s inline composer did not open.",
  "range-not-supported": "Range drafting needs one more live GitHub check. Select a single line for now.",
  "stale-anchor": "The pull request head changed. Refresh the anchor before drafting.",
  "invalid-request": "The draft was empty or invalid.",
} as const;

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
        const chapterStatus = chapter.steps?.length ? deriveChapterStatus(chapter.steps, statuses) : chapter.status;
        const alignment = chapterIndex < 2 ? "align-start" : chapterIndex > 2 ? "align-end" : "align-center";
        return (
          <div className={`chapter-rail-item ${alignment} ${selected?.chapter.id === chapter.id ? "is-current" : ""}`} key={chapter.id}>
            <button className={`chapter-node status-${chapterStatus}`} type="button" aria-label={`Chapter ${chapterIndex + 1}: ${chapter.title}`} aria-disabled={!chapterRoute.length} onClick={() => chapterRoute[0] && navigateTo(chapterRoute[0].routeIndex)}>
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

function ContextLauncher({ context }: { context: GitHubPageContext }) {
  const onGitHub = context.kind === "github";
  const repo = context.owner && context.repository ? `${context.owner}/${context.repository}` : undefined;
  const repositoryOptions = useMemo(() => {
    if (!repo || REPOSITORY_OPTIONS.some((option) => option.value === repo)) {
      return [...REPOSITORY_OPTIONS];
    }
    return [
      {
        value: repo,
        label: repo,
        detail: "Current repository",
        destination: `https://github.com/${repo}/pulls`,
      },
      ...REPOSITORY_OPTIONS,
    ];
  }, [repo]);
  const [selectedRepository, setSelectedRepository] = useState(repo ?? REPOSITORY_OPTIONS[0].value);
  const selectedOption = repositoryOptions.find((option) => option.value === selectedRepository)
    ?? repositoryOptions[0]!;

  useEffect(() => {
    setSelectedRepository(repo ?? REPOSITORY_OPTIONS[0].value);
  }, [repo]);

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
      <div className="repository-picker">
        <label id="repository-picker-label">Repository</label>
        <Select.Root value={selectedOption.value} onValueChange={setSelectedRepository}>
          <Select.Trigger className="repository-trigger" aria-labelledby="repository-picker-label">
            <span>
              <Select.Value>{selectedOption.label}</Select.Value>
              <small>{selectedOption.detail}</small>
            </span>
            <Select.Icon><ChevronDown size={15} /></Select.Icon>
          </Select.Trigger>
          <Select.Portal>
            <Select.Content className="repository-select-content" position="popper" sideOffset={6}>
              <Select.Viewport>
                {repositoryOptions.map((option) => (
                  <Select.Item className="repository-option" key={option.value} value={option.value}>
                    <Select.ItemText>
                      <span>{option.label}</span>
                      <small>{option.detail}</small>
                    </Select.ItemText>
                    <Select.ItemIndicator><Check size={14} /></Select.ItemIndicator>
                  </Select.Item>
                ))}
              </Select.Viewport>
            </Select.Content>
          </Select.Portal>
        </Select.Root>
      </div>
      <a className="primary-action" href={selectedOption.destination} target="_blank" rel="noreferrer">
        Open selected repository
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
  const [session, setSession] = useState<HarnessSession>();
  const [phase, setPhase] = useState<"idle" | "starting" | "generating">("idle");
  const [generationProgress, setGenerationProgress] = useState({ completed: 0, total: 0 });
  const [error, setError] = useState<string>();
  const [reviewScreen, setReviewScreen] = useState<"overview" | "steps">("overview");
  const [entryRouteIndex, setEntryRouteIndex] = useState(0);
  const demoIdentityMatches = context.owner === (import.meta.env.VITE_DEMO_OWNER ?? "itayfry")
    && context.repository === (import.meta.env.VITE_DEMO_REPO ?? "king-of-tokens")
    && context.pullNumber === Number(import.meta.env.VITE_DEMO_PR ?? "1");
  const headSha = context.headSha
    ?? context.activeAnchor?.headSha
    ?? (demoIdentityMatches ? import.meta.env.VITE_DEMO_HEAD_SHA : undefined);
  const reviewIdentity = `${context.owner}/${context.repository}#${context.pullNumber}:${headSha ?? "unknown"}`;

  useEffect(() => {
    sourceRef.current?.close();
    sourceRef.current = undefined;
    setSession(undefined);
    setPhase("idle");
    setGenerationProgress({ completed: 0, total: 0 });
    setError(undefined);
    setReviewScreen("overview");
    setEntryRouteIndex(0);
  }, [reviewIdentity]);

  useEffect(() => () => sourceRef.current?.close(), []);

  const connectToStream = (nextSession: HarnessSession) => {
    sourceRef.current?.close();
    setPhase("generating");
    let settled = false;
    const source = new EventSource(client.eventsUrl(nextSession.id));
    sourceRef.current = source;

    const handle = (raw: MessageEvent<string>) => {
      try {
        const parsed = StoryStreamEventSchema.parse(JSON.parse(raw.data));
        if (parsed.type === "story.skeleton") {
          setError(undefined);
          setGenerationProgress({ completed: 0, total: parsed.data.chapters.length });
          setSession((current) => current ? { ...current, status: "GENERATING", skeleton: parsed.data } : current);
        }
        if (parsed.type === "story.chapter") {
          setGenerationProgress((current) => ({
            completed: Math.min(current.completed + 1, current.total || current.completed + 1),
            total: current.total || current.completed + 1,
          }));
        }
        if (parsed.type === "story.ready") {
          settled = true;
          source.close();
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
      if (settled) return;
      // EventSource reconnects automatically. A transient SSE close is expected
      // during local dev reloads and must not turn a healthy stored generation
      // into a terminal connection error.
      setPhase("generating");
    };
  };

  const startReview = async () => {
    if (!context.owner || !context.repository || !context.pullNumber || !headSha) return;
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
      if (nextSession.artifact) {
        setSession({ ...nextSession, artifact: StoryArtifactSchema.parse(nextSession.artifact) });
        setPhase("idle");
        return;
      }
      setSession(nextSession);
      connectToStream(nextSession);
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Could not start the review");
      setPhase("idle");
    }
  };

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
              void navigateGitHubToFile(next.file.path);
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
      {headSha ? <code className="commit-pill">{headSha.slice(0, 12)}</code> : <p className="start-warning">Open Files changed so Primer can read the current head commit.</p>}
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
    return currentChapterIndex >= 0 ? currentChapterIndex : 0;
  });
  const statuses = useMemo<Record<string, ReviewStepStatus>>(() =>
    Object.fromEntries(route.map(({ step }) => [step.fileId, step.status])),
  [route]);
  const [composerValue, setComposerValue] = useState("");
  const conversationRef = useRef<HTMLDivElement>(null);
  const followsLatestRef = useRef(true);
  const renderedChatTurnCountRef = useRef(0);
  const observedFileRef = useRef(context.activeFile);
  const [draftFeedback, setDraftFeedback] = useState<{
    tone: "working" | "success" | "error";
    message: string;
  }>();
  const selected = route[selectedIndex];
  const selectedFilePath = selected?.file.path;
  const selectedStatus = selected ? statuses[selected.step.fileId] ?? selected.step.status : "pending";
  const severity = selected?.file.severity ?? "standard";
  const chapterNumber = selected ? plan.chapters.indexOf(selected.chapter) + 1 : 0;

  useEffect(() => {
    const currentChapterIndex = route.findIndex(({ chapter }) => chapter.id === session.currentChapterId);
    if (currentChapterIndex >= 0) {
      setSelectedIndex((current) => route[current]?.chapter.id === session.currentChapterId
        ? current
        : currentChapterIndex);
    }
  }, [route, session.currentChapterId]);

  useEffect(() => {
    if (context.activeFile === observedFileRef.current) return;
    observedFileRef.current = context.activeFile;
    const visibleIndex = findRouteIndexByPath(route, context.activeFile);
    if (visibleIndex >= 0) setSelectedIndex(visibleIndex);
  }, [context.activeFile, route]);

  useEffect(() => {
    if (!selectedFilePath || context.activeFile === selectedFilePath) return;
    void navigateGitHubToFile(selectedFilePath);
    // Only a side-panel route change should initiate GitHub navigation. When
    // GitHub scrolling changes activeFile, the effect above first selects its
    // matching route and this effect then sees both files already aligned.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFilePath]);

  useEffect(() => {
    const previousCount = renderedChatTurnCountRef.current;
    renderedChatTurnCountRef.current = session.chatTurns.length;
    if (session.chatTurns.length <= previousCount || !followsLatestRef.current) return;

    const conversation = conversationRef.current;
    if (!conversation) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    conversation.scrollTo({
      top: conversation.scrollHeight,
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }, [session.chatTurns.length]);

  const navigateTo = async (index: number) => {
    const next = route[index];
    if (!next) return;
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
      followsLatestRef.current = true;
      setDraftFeedback({ tone: "working", message: "Preparing evidence and asking Primer…" });
      try {
        const response = await client.sendChatMessage(
          session.id,
          message,
          selected ? { chapterId: selected.chapter.id, filePath: selected.file.path } : undefined,
        );
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
    setDraftFeedback({ tone: "working", message: "Opening GitHub’s native composer…" });

    if (new URLSearchParams(window.location.search).has("preview")) {
      setDraftFeedback({
        tone: "success",
        message: "Preview: draft prepared. In the extension, GitHub opens it for your review.",
      });
      return;
    }

    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (tab?.id === undefined) throw new Error("No active tab");
      const result: unknown = await browser.tabs.sendMessage(tab.id, {
        type: "primer:draft-comment",
        anchor,
        body,
      });
      if (!isCommentDraftResult(result)) throw new Error("Invalid drafting response");
      if (!result.ok) {
        setDraftFeedback({ tone: "error", message: draftFailureCopy[result.error] });
        return;
      }
      setComposerValue("");
      setDraftFeedback({
        tone: "success",
        message: "Draft ready in GitHub. Edit, cancel, or submit it there.",
      });
    } catch {
      setDraftFeedback({
        tone: "error",
        message: "Primer could not reach the active GitHub diff. Return to the PR and try again.",
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
        {selected ? (
          <section className="focus-step-card">
            <button className="overview-back" type="button" onClick={onBackToOverview}>
              <ArrowLeft size={13} /> PR summary
            </button>
            <div className="focus-step-meta">
              <span>Chapter {chapterNumber} · Step {selectedIndex + 1} of {route.length}</span>
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

        <div className="chat-section-heading">
          <span>Ask about this step</span>
          <small>{selected?.file.path.split("/").at(-1)}</small>
        </div>

        {session.chatTurns.filter((turn) => turn.role !== "tool").slice(-8).map((turn) => (
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

        <div className="suggestions step-suggestions" aria-label="Suggested prompts">
          <button type="button" onClick={() => setComposerValue("Explain this file’s role in the chapter")}>Explain this file’s role</button>
          <button type="button" onClick={() => setComposerValue("What should I verify in this file?")}>What should I verify?</button>
          <button type="button" onClick={() => setComposerValue("Show the strongest evidence for this step")}>Show step evidence</button>
        </div>
      </div>

      <footer className="composer-shell">
        <div className="review-controls" aria-label="Review navigation">
          <button className="control-button" type="button" aria-label="Previous review step" disabled={selectedIndex <= 0} onClick={() => navigateTo(selectedIndex - 1)}><ArrowLeft size={15} /></button>
          <span className={`severity severity-${severity}`}><CircleDot size={13} /> {severityLabel[severity]}</span>
          <button className={`control-button status-control ${selectedStatus === "reviewed" ? "is-reviewed" : ""}`} type="button" aria-label={selectedStatus === "reviewed" ? "Chapter reviewed" : "Complete chapter"} disabled={!selected || selectedStatus === "reviewed"} onClick={() => void completeSelected()}><CheckCircle2 size={15} /></button>
          <button className="control-button" type="button" aria-label="Next review step" disabled={selectedIndex >= route.length - 1} onClick={() => navigateTo(selectedIndex + 1)}><ArrowRight size={15} /></button>
        </div>
        {draftFeedback ? (
          <div className={`draft-feedback is-${draftFeedback.tone}`} role="status">
            {draftFeedback.tone === "success" ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
            <span>{draftFeedback.message}</span>
          </div>
        ) : null}
        <form className="composer" onSubmit={(event) => {
          event.preventDefault();
          void submitComposer();
        }}>
          <textarea
            aria-label="Ask Primer"
            placeholder="Ask about this change, or type / for skills"
            rows={2}
            value={composerValue}
            onChange={(event) => {
              setComposerValue(event.target.value);
              if (draftFeedback?.tone !== "working") setDraftFeedback(undefined);
            }}
            onKeyDown={submitOnEnter}
          />
          <div className="composer-footer">
            <span><MessageSquareText size={13} /> {selected?.file.path.split("/").at(-1) ?? "Current step"}</span>
            <button type="submit" aria-label="Send message" disabled={!composerValue.trim() || draftFeedback?.tone === "working"}><Send size={15} /></button>
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
  const identity = useMemo(() => context.kind === "pull-request"
    ? `${context.owner}/${context.repository} · #${context.pullNumber}`
    : "Review companion", [context]);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("preview")) return undefined;

    const refreshActiveContext = async () => {
      const next = await browser.runtime.sendMessage({ type: "primer:get-active-context" }).catch(() => undefined);
      if (next && typeof next === "object" && "kind" in next) {
        const observed = next as GitHubPageContext;
        if (observed.kind === "pull-request") {
          setContext(observed);
          return;
        }
      }

      // A freshly reloaded unpacked extension may not yet have a content script
      // in an already-open GitHub tab. The active tab URL is still authoritative
      // enough to identify the PR and expose the Start Analyze action.
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      const fromActiveTab = getPageContext(tab?.url ?? "");
      if (fromActiveTab.kind === "pull-request") setContext(fromActiveTab);
      else if (next && typeof next === "object" && "kind" in next) setContext(next as GitHubPageContext);
    };

    void refreshActiveContext();

    const listener = (message: unknown) => {
      if (!isPrimerExtensionMessage(message)) return undefined;
      if (message.type === "primer:active-context-changed" || message.type === "primer:context-observed") {
        if (message.context.kind === "pull-request") setContext(message.context);
        else void refreshActiveContext();
      }
      return undefined;
    };
    browser.runtime.onMessage.addListener(listener);
    const onActivated = () => void refreshActiveContext();
    const onUpdated = (_tabId: number, change: { status?: string; url?: string }) => {
      if (change.url || change.status === "complete") void refreshActiveContext();
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
                  <DropdownMenu.Item>Open full workspace <ExternalLink size={13} /></DropdownMenu.Item>
                  <DropdownMenu.Item>Review settings</DropdownMenu.Item>
                  <DropdownMenu.Separator />
                  <DropdownMenu.Item><Check size={13} /> Live harness</DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        </header>

        {context.kind === "pull-request"
          ? <LiveReview context={context} panelView={panelView} />
          : <ContextLauncher context={context} />}
      </main>
    </Tooltip.Provider>
  );
}
