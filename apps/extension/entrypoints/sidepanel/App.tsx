import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
} from "lucide-react";
import {
  getPageContext,
  isPrimerExtensionMessage,
  type GitHubPageContext,
} from "../../primer/lib/extension-context";
import { createFallbackCommentDraft, parseCommentCommand } from "../../primer/lib/comment-draft";
import {
  findRouteIndexByPath,
  getExtensionReviewRoute,
} from "../../primer/lib/extension-review";
import type { ReviewPlan, ReviewStepStatus, Severity } from "../../primer/lib/review-plan";
import {
  HarnessClient,
  type HarnessDraft,
  type HarnessSession,
} from "../../primer/lib/harness-client";
import { storyArtifactToReviewPlan } from "../../primer/lib/story-review-plan";

const TWENTY_PR = "https://github.com/twentyhq/twenty/pull/22819/files";
const PREVIEW_FILE = "packages/twenty-front/src/modules/object-record/record-calendar/components/RecordCalendar.tsx";
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

function getInitialContext(): GitHubPageContext {
  const preview = new URLSearchParams(window.location.search).get("preview");
  if (preview === "pr") return getPageContext(TWENTY_PR, PREVIEW_FILE, {
    path: PREVIEW_FILE,
    headSha: "7a4dd79fe24cdf0b65e6d27f902f5fdf7affdc4f",
    line: 78,
    side: "RIGHT",
    excerpt: "return calendarLayout === CalendarLayout.WEEK ? ...",
  });
  if (preview === "github") return getPageContext("https://github.com/twentyhq/twenty");
  return getPageContext("");
}

function IconButton({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button className="icon-button" type="button" aria-label={label}>{children}</button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tooltip" sideOffset={7}>{label}</Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
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

function LiveReview({ context }: { context: GitHubPageContext }) {
  const client = useMemo(() => new HarnessClient(harnessConfig), []);
  const sourceRef = useRef<EventSource | undefined>(undefined);
  const [session, setSession] = useState<HarnessSession>();
  const [phase, setPhase] = useState<"idle" | "starting" | "generating">("idle");
  const [generationProgress, setGenerationProgress] = useState({ completed: 0, total: 0 });
  const [error, setError] = useState<string>();
  const demoIdentityMatches = context.owner === import.meta.env.VITE_DEMO_OWNER
    && context.repository === import.meta.env.VITE_DEMO_REPO
    && context.pullNumber === Number(import.meta.env.VITE_DEMO_PR ?? "123");
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
          setGenerationProgress({ completed: 0, total: parsed.data.chapters.length });
          setSession((current) => current ? {
            ...current,
            status: "GENERATING",
            skeleton: parsed.data,
          } : current);
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
      source.close();
      setError(`Could not reach the review harness at ${harnessConfig.apiBaseUrl}.`);
      setPhase("idle");
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
        const artifact = StoryArtifactSchema.parse(nextSession.artifact);
        setSession({ ...nextSession, artifact });
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

  if (session?.artifact && plan) {
    return (
      <ReviewConversation
        context={context}
        plan={plan}
        session={session}
        client={client}
        onSessionChange={setSession}
      />
    );
  }

  const busy = phase !== "idle";
  return (
    <div className="review-start">
      <div className="launcher-mark">
        {busy ? <LoaderCircle className="spin" size={23} /> : <Sparkles size={23} strokeWidth={1.6} />}
      </div>
      <p className="utility-label">{context.owner}/{context.repository} · #{context.pullNumber}</p>
      <h1>{phase === "generating" ? "Building your review story…" : "Review the latest commit."}</h1>
      <p className="launcher-copy">
        {phase === "generating"
          ? `${generationProgress.completed} of ${generationProgress.total || "…"} chapters ready. Keep this panel open while Primer connects the evidence.`
          : "Primer will analyze the current PR head, then guide you through an evidence-backed chapter at a time."}
      </p>
      {headSha ? <code className="commit-pill">{headSha.slice(0, 12)}</code> : (
        <p className="start-warning">Open the Files changed tab so Primer can read the current head commit.</p>
      )}
      {error ? <div className="start-error" role="alert"><AlertCircle size={14} /> {error}</div> : null}
      <button className="primary-action start-button" type="button" disabled={!headSha || busy} onClick={() => void startReview()}>
        {busy ? "Starting review…" : session?.status === "FAILED" || error ? "Retry review" : "Start review for latest commit"}
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
  onSessionChange,
}: {
  context: GitHubPageContext;
  plan: ReviewPlan;
  session: HarnessSession;
  client: HarnessClient;
  onSessionChange: (session: HarnessSession) => void;
}) {
  const repo = `${context.owner}/${context.repository}`;
  const activeFileName = context.activeFile?.split("/").at(-1);
  const anchor = context.activeAnchor;
  const anchorLabel = anchor
    ? `${anchor.side === "RIGHT" ? "New" : "Old"} ${anchor.startLine
      ? `lines ${anchor.startLine}–${anchor.line}`
      : `line ${anchor.line}`}`
    : undefined;
  const route = useMemo(() => getExtensionReviewRoute(plan), [plan]);
  const [selectedIndex, setSelectedIndex] = useState(() => {
    const currentChapterIndex = route.findIndex(({ chapter }) => chapter.id === session.currentChapterId);
    if (currentChapterIndex >= 0) return currentChapterIndex;
    const visibleIndex = findRouteIndexByPath(route, context.activeFile);
    return visibleIndex >= 0 ? visibleIndex : 0;
  });
  const [composerValue, setComposerValue] = useState("");
  const [pendingDraft, setPendingDraft] = useState<HarnessDraft>();
  const [draftFeedback, setDraftFeedback] = useState<{
    tone: "working" | "success" | "error";
    message: string;
  }>();
  const selected = route[selectedIndex];
  const selectedStatus: ReviewStepStatus = selected && session.completedChapterIds.includes(selected.chapter.id)
    ? "reviewed"
    : "pending";
  const severity = selected?.file.severity ?? "standard";
  const chapterNumber = selected ? plan.chapters.indexOf(selected.chapter) + 1 : 0;

  useEffect(() => {
    const visibleIndex = findRouteIndexByPath(route, context.activeFile);
    setSelectedIndex(visibleIndex >= 0 ? visibleIndex : 0);
  }, [plan, route]);

  useEffect(() => {
    const visibleIndex = findRouteIndexByPath(route, context.activeFile);
    if (visibleIndex >= 0) setSelectedIndex(visibleIndex);
  }, [context.activeFile, route]);

  const navigateTo = async (index: number) => {
    const next = route[index];
    if (!next) return;
    setSelectedIndex(index);
    try {
      onSessionChange(await client.selectChapter(session.id, next.chapter.id));
    } catch (navigationError) {
      setDraftFeedback({
        tone: "error",
        message: navigationError instanceof Error ? navigationError.message : "Could not save review position",
      });
    }
    if (new URLSearchParams(window.location.search).has("preview")) return;
    void browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (tab?.id !== undefined) {
        return browser.tabs.sendMessage(tab.id, { type: "primer:navigate-file", path: next.file.path });
      }
      return undefined;
    }).catch(() => undefined);
  };

  const completeSelected = async () => {
    if (!selected || selectedStatus === "reviewed") return;
    try {
      onSessionChange(await client.completeChapter(session.id, selected.chapter.id));
    } catch (completionError) {
      setDraftFeedback({
        tone: "error",
        message: completionError instanceof Error ? completionError.message : "Could not complete this chapter",
      });
    }
  };

  const submitComposer = async () => {
    const command = parseCommentCommand(composerValue);
    if (!command) {
      if (!composerValue.trim()) return;
      setDraftFeedback({ tone: "working", message: "Primer is checking the stored evidence…" });
      try {
        await client.sendChatMessage(session.id, composerValue.trim());
        onSessionChange(await client.getSession(session.id));
        setComposerValue("");
        setDraftFeedback(undefined);
      } catch (chatError) {
        setDraftFeedback({
          tone: "error",
          message: chatError instanceof Error ? chatError.message : "Chat is unavailable",
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
    setDraftFeedback({ tone: "working", message: "Saving a private review draft…" });

    try {
      const draft = await client.createDraft(session.id, {
        body,
        path: anchor.path,
        line: anchor.line,
        side: anchor.side,
      });
      setPendingDraft(draft);
      setComposerValue("");
      setDraftFeedback({
        tone: "success",
        message: "Draft saved privately. Confirm below before Primer publishes it to the pending review.",
      });
    } catch (draftError) {
      setDraftFeedback({
        tone: "error",
        message: draftError instanceof Error ? draftError.message : "Could not save the draft",
      });
    }
  };

  const publishDraft = async () => {
    if (!pendingDraft) return;
    setDraftFeedback({ tone: "working", message: "Publishing to your pending GitHub review…" });
    try {
      const published = await client.publishDraft(session.id, pendingDraft.id);
      setPendingDraft(undefined);
      onSessionChange(await client.getSession(session.id));
      setDraftFeedback({
        tone: "success",
        message: published.githubCommentUrl ? "Comment published to the pending review." : "Comment published.",
      });
    } catch (publishError) {
      setDraftFeedback({
        tone: "error",
        message: publishError instanceof Error ? publishError.message : "Could not publish the draft",
      });
    }
  };

  return (
    <>
      <div className="conversation" aria-live="polite">
        <div className="opening-space" aria-hidden="true" />
        <article className="agent-turn">
          <div className="trace" aria-hidden="true"><span /></div>
          <div className="agent-copy">
            <p className="agent-name"><Sparkles size={13} /> Primer</p>
            <h1>I’m ready to guide this review.</h1>
            <p>
              I found <strong>{repo}#{context.pullNumber}</strong>.
              {` I loaded ${route.length} evidence-backed steps across ${plan.chapters.length} chapters and will follow the diff as you scroll.`}
            </p>
          </div>
        </article>

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

        {selected ? (
          <section className="review-step-card">
            <div className="step-heading">
              <span>Chapter {chapterNumber} · Step {selectedIndex + 1}/{route.length}</span>
              <span className={`step-status status-${selectedStatus}`}><i /> {selectedStatus}</span>
            </div>
            <strong>{selected.file.path.split("/").at(-1)}</strong>
            <p>{selected.step.reason}</p>
            <div className="evidence-list">
              {selected.step.evidence.slice(0, 3).map((evidence, index) => (
                <div className="evidence-row" key={`${evidence.kind}-${index}`}>
                  <span>{evidence.kind.replace("-", " ")}</span>
                  <p>{evidence.description}</p>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {session.chatTurns.filter(({ role }) => role !== "tool").map((turn) => (
          <article className={`chat-turn chat-${turn.role}`} key={turn.id}>
            <span>{turn.role === "assistant" ? "Primer" : "You"}</span>
            <p>{turn.content}</p>
            {turn.citations.length > 0 ? (
              <div className="chat-citations">
                {turn.citations.map((citation) => (
                  <code key={`${citation.path}:${citation.lines.join("-")}`}>
                    {citation.path}:{citation.lines[0]}–{citation.lines[1]}
                  </code>
                ))}
              </div>
            ) : null}
          </article>
        ))}

        <div className="suggestions" aria-label="Suggested prompts">
          {["Explain the intent of this PR", "Show the highest-risk decision", "/evidence for this file"].map((prompt) => (
            <button type="button" key={prompt} onClick={() => setComposerValue(prompt)}>{prompt}</button>
          ))}
        </div>
      </div>

      <footer className="composer-shell">
        <div className="review-controls" aria-label="Review navigation">
          <button className="control-button" type="button" aria-label="Previous review step" disabled={selectedIndex <= 0} onClick={() => void navigateTo(selectedIndex - 1)}><ArrowLeft size={15} /></button>
          <span className={`severity severity-${severity}`}><CircleDot size={13} /> {severityLabel[severity]}</span>
          <button className={`control-button status-control ${selectedStatus === "reviewed" ? "is-reviewed" : ""}`} type="button" aria-label={selectedStatus === "reviewed" ? "Chapter reviewed" : "Mark chapter reviewed"} disabled={!selected || selectedStatus === "reviewed"} onClick={() => void completeSelected()}><CheckCircle2 size={15} /></button>
          <button className="control-button" type="button" aria-label="Next review step" disabled={selectedIndex >= route.length - 1} onClick={() => void navigateTo(selectedIndex + 1)}><ArrowRight size={15} /></button>
        </div>
        {draftFeedback ? (
          <div className={`draft-feedback is-${draftFeedback.tone}`} role="status">
            {draftFeedback.tone === "success" ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
            <span>{draftFeedback.message}</span>
            {pendingDraft && draftFeedback.tone === "success" ? (
              <button className="publish-draft" type="button" onClick={() => void publishDraft()}>Confirm publish</button>
            ) : null}
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
          />
          <div className="composer-footer">
            <span><MessageSquareText size={13} /> /comment</span>
            <button type="submit" aria-label="Send message" disabled={draftFeedback?.tone === "working"}><Send size={15} /></button>
          </div>
        </form>
      </footer>
    </>
  );
}

export function App() {
  const [context, setContext] = useState<GitHubPageContext>(getInitialContext);
  const identity = useMemo(() => context.kind === "pull-request"
    ? `${context.owner}/${context.repository} · #${context.pullNumber}`
    : "Review companion", [context]);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("preview")) return undefined;

    void browser.runtime.sendMessage({ type: "primer:get-active-context" }).then((next) => {
      if (next && typeof next === "object" && "kind" in next) setContext(next as GitHubPageContext);
    });

    const listener = (message: unknown) => {
      if (!isPrimerExtensionMessage(message)) return undefined;
      if (message.type === "primer:active-context-changed") setContext(message.context);
      if (message.type === "primer:context-observed") setContext(message.context);
      return undefined;
    };
    browser.runtime.onMessage.addListener(listener);
    return () => browser.runtime.onMessage.removeListener(listener);
  }, []);

  return (
    <Tooltip.Provider delayDuration={350}>
      <main className="panel-shell">
        <header className="panel-header">
          <div className="panel-identity">
            <span className="primer-glyph" aria-hidden="true"><i /><i /><i /></span>
            <div><strong>Primer</strong><span>{identity}</span></div>
          </div>
          <div className="header-actions">
            <IconButton label="Evidence is locally sourced"><ShieldCheck size={16} /></IconButton>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button className="icon-button" type="button" aria-label="Open menu"><Menu size={17} /></button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content className="menu-content" sideOffset={7} align="end">
                  <DropdownMenu.Item>Open full workspace <ExternalLink size={13} /></DropdownMenu.Item>
                  <DropdownMenu.Item>Review settings</DropdownMenu.Item>
                  <DropdownMenu.Separator />
                  <DropdownMenu.Item><Check size={13} /> Fixture mode</DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        </header>

        {context.kind === "pull-request"
          ? <LiveReview context={context} />
          : <ContextLauncher context={context} />}
      </main>
    </Tooltip.Provider>
  );
}
