import { useEffect, useMemo, useState, type ReactNode } from "react";
import { browser } from "wxt/browser";
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
  Send,
  ShieldCheck,
  Sparkles,
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
  getReviewPlanForContext,
} from "../../primer/lib/extension-review";
import type { ReviewPlan, ReviewStepStatus, Severity } from "../../primer/lib/review-plan";

const TWENTY_PR = "https://github.com/twentyhq/twenty/pull/22819/files";
const PREVIEW_FILE = "packages/twenty-front/src/modules/object-record/record-calendar/components/RecordCalendar.tsx";
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

function ReviewConversation({ context, plan }: { context: GitHubPageContext; plan?: ReviewPlan | undefined }) {
  const repo = `${context.owner}/${context.repository}`;
  const activeFileName = context.activeFile?.split("/").at(-1);
  const anchor = context.activeAnchor;
  const anchorLabel = anchor
    ? `${anchor.side === "RIGHT" ? "New" : "Old"} ${anchor.startLine
      ? `lines ${anchor.startLine}–${anchor.line}`
      : `line ${anchor.line}`}`
    : undefined;
  const route = useMemo(() => plan ? getExtensionReviewRoute(plan) : [], [plan]);
  const [selectedIndex, setSelectedIndex] = useState(() => {
    const visibleIndex = findRouteIndexByPath(route, context.activeFile);
    return visibleIndex >= 0 ? visibleIndex : 0;
  });
  const [statuses, setStatuses] = useState<Record<string, ReviewStepStatus>>(() =>
    Object.fromEntries(route.map(({ step }) => [step.fileId, step.status])),
  );
  const [composerValue, setComposerValue] = useState("");
  const [draftFeedback, setDraftFeedback] = useState<{
    tone: "working" | "success" | "error";
    message: string;
  }>();
  const selected = route[selectedIndex];
  const selectedStatus = selected ? statuses[selected.step.fileId] ?? selected.step.status : "pending";
  const severity = selected?.file.severity ?? "standard";
  const chapterNumber = selected && plan ? plan.chapters.indexOf(selected.chapter) + 1 : 0;

  useEffect(() => {
    const visibleIndex = findRouteIndexByPath(route, context.activeFile);
    setSelectedIndex(visibleIndex >= 0 ? visibleIndex : 0);
    setStatuses(Object.fromEntries(route.map(({ step }) => [step.fileId, step.status])));
  }, [plan, route]);

  useEffect(() => {
    const visibleIndex = findRouteIndexByPath(route, context.activeFile);
    if (visibleIndex >= 0) setSelectedIndex(visibleIndex);
  }, [context.activeFile, route]);

  const navigateTo = (index: number) => {
    const next = route[index];
    if (!next) return;
    setSelectedIndex(index);
    if (new URLSearchParams(window.location.search).has("preview")) return;
    void browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (tab?.id !== undefined) {
        return browser.tabs.sendMessage(tab.id, { type: "primer:navigate-file", path: next.file.path });
      }
      return undefined;
    }).catch(() => undefined);
  };

  const toggleReviewed = () => {
    if (!selected) return;
    setStatuses((current) => ({
      ...current,
      [selected.step.fileId]: selectedStatus === "reviewed" ? "pending" : "reviewed",
    }));
  };

  const submitComposer = async () => {
    const command = parseCommentCommand(composerValue);
    if (!command) {
      setDraftFeedback({
        tone: "error",
        message: "Live conversation is not connected yet. Use /comment to prepare a GitHub draft.",
      });
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
              {plan
                ? ` I loaded ${route.length} evidence-backed steps across ${plan.chapters.length} chapters and will follow the diff as you scroll.`
                : " I’ll follow the diff as you scroll and keep the review tied to the visible code."}
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

        <div className="suggestions" aria-label="Suggested prompts">
          <button type="button">Explain the intent of this PR</button>
          <button type="button">Show the highest-risk decision</button>
          <button type="button">/evidence for this file</button>
        </div>
      </div>

      <footer className="composer-shell">
        <div className="review-controls" aria-label="Review navigation">
          <button className="control-button" type="button" aria-label="Previous review step" disabled={selectedIndex <= 0} onClick={() => navigateTo(selectedIndex - 1)}><ArrowLeft size={15} /></button>
          <span className={`severity severity-${severity}`}><CircleDot size={13} /> {severityLabel[severity]}</span>
          <button className={`control-button status-control ${selectedStatus === "reviewed" ? "is-reviewed" : ""}`} type="button" aria-label={selectedStatus === "reviewed" ? "Mark pending" : "Mark reviewed"} disabled={!selected} onClick={toggleReviewed}><CheckCircle2 size={15} /></button>
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
  const plan = useMemo(() => getReviewPlanForContext(context), [context]);
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
          ? <ReviewConversation context={context} plan={plan} />
          : <ContextLauncher context={context} />}
      </main>
    </Tooltip.Provider>
  );
}
