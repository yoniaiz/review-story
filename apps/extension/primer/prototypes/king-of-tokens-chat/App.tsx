import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";

const steps = [
  {
    chapter: 1,
    title: "Turn reputation into tokens",
    file: "main.jsx",
    path: "src/main.jsx",
    question: "calls the reward watcher for every refreshed game state",
    evidence: [
      "src/main.jsx lines 19–23 at the pinned head SHA",
      "Related tests: walletStore tests cover credit, debit, purchase history, and recent-purchase ordering, but not reward-trigger semantics",
    ],
  },
  {
    chapter: 1,
    title: "Turn reputation into tokens",
    file: "walletStore.js",
    path: "src/stores/walletStore.js",
    question: "keeps token balances consistent when a reward is applied twice",
    evidence: [
      "src/stores/walletStore.js lines 44–71",
      "The transaction ledger has an idempotency key, but the new watcher does not pass one",
    ],
  },
  {
    chapter: 1,
    title: "Turn reputation into tokens",
    file: "rewardWatcher.js",
    path: "src/services/rewardWatcher.js",
    question: "maps refreshed reputation events to the correct token amount",
    evidence: [
      "src/services/rewardWatcher.js lines 12–39",
      "Reward thresholds are shared with the profile summary component",
    ],
  },
  {
    chapter: 2,
    title: "Persist the purchase trail",
    file: "purchaseHistory.js",
    path: "src/stores/purchaseHistory.js",
    question: "preserves ordering when multiple purchases share a timestamp",
    evidence: ["src/stores/purchaseHistory.js lines 28–54", "Existing tests only use distinct timestamps"],
  },
  {
    chapter: 2,
    title: "Persist the purchase trail",
    file: "historyPanel.jsx",
    path: "src/components/historyPanel.jsx",
    question: "renders failed purchases without presenting them as completed",
    evidence: ["src/components/historyPanel.jsx lines 63–91", "The API exposes pending, completed, and failed states"],
  },
  {
    chapter: 3,
    title: "Refresh the player state",
    file: "gameState.js",
    path: "src/state/gameState.js",
    question: "does not notify subscribers until the refresh is complete",
    evidence: ["src/state/gameState.js lines 101–129", "Three subscribers read wallet data during refresh"],
  },
  {
    chapter: 3,
    title: "Refresh the player state",
    file: "useRefresh.js",
    path: "src/hooks/useRefresh.js",
    question: "cancels stale refresh requests when the player changes",
    evidence: ["src/hooks/useRefresh.js lines 17–48", "No abort signal is currently passed to fetchGameState"],
  },
  {
    chapter: 4,
    title: "Prove the reward loop",
    file: "walletStore.test.js",
    path: "src/stores/walletStore.test.js",
    question: "covers the end-to-end reward trigger before this change ships",
    evidence: ["src/stores/walletStore.test.js lines 82–146", "The fixture includes purchase updates but no reputation refresh"],
  },
];

type ReviewDecision = "good" | "rejected";

function Icon({ name }: { name: "branch" | "menu" | "file" | "chat" | "left" | "right" | "check" | "reject" | "send" }) {
  const paths = {
    branch: <><circle cx="7" cy="5" r="2"/><circle cx="17" cy="19" r="2"/><path d="M7 7v6a4 4 0 0 0 4 4h4M17 17V9"/><circle cx="17" cy="7" r="2"/></>,
    menu: <><path d="M4 7h16M4 12h16M4 17h16"/></>,
    file: <><path d="M6 3h8l4 4v14H6zM14 3v5h5"/><path d="m9 15-2 2 2 2m6-4 2 2-2 2"/></>,
    chat: <path d="M4 5h16v12H9l-5 4zM8 9h8M8 13h6"/>,
    left: <path d="m15 18-6-6 6-6"/>,
    right: <path d="m9 18 6-6-6-6"/>,
    check: <path d="m7 12 3 3 7-7"/>,
    reject: <path d="m7 7 10 10M17 7 7 17"/>,
    send: <path d="m4 4 16 8-16 8 3-8zM7 12h8"/>,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24">{paths[name]}</svg>;
}

export function App() {
  const [stepIndex, setStepIndex] = useState(1);
  const [decisions, setDecisions] = useState<Record<string, ReviewDecision>>({});
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const step = steps[stepIndex] ?? steps[0]!;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [stepIndex]);

  const moveStep = (direction: -1 | 1) => {
    setStepIndex((value) => Math.max(0, Math.min(steps.length - 1, value + direction)));
  };

  const decideStep = (decision: ReviewDecision) => {
    setDecisions((current) => ({ ...current, [step.path]: decision }));
    moveStep(1);
  };

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      const target = event.target;
      const isEditing = target instanceof HTMLElement
        && Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
      if (isEditing || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        moveStep(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        moveStep(1);
      } else if (event.key.toLowerCase() === "g") {
        event.preventDefault();
        decideStep("good");
      } else if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        decideStep("rejected");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [step.path]);

  const sendDraft = () => {
    const message = draft.trim();
    if (!message) return;
    setMessages((current) => [...current, message]);
    setDraft("");
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    sendDraft();
  };

  const submitOnEnter = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    sendDraft();
  };

  return (
    <main className="primer-app">
      <header className="topbar">
        <div className="primer-mark" aria-label="Primer"><span /><i /></div>
        <div className="repo-copy"><strong>PR REVIEW</strong><span>itayfry/king-of-tokens · #1</span></div>
        <div className="topbar-actions">
          <button aria-label="Open review graph"><Icon name="branch" /></button>
          <button aria-label="Open menu"><Icon name="menu" /></button>
        </div>
      </header>

      <div className="conversation-scroll" ref={scrollRef} tabIndex={0}>
        <section className="conversation" aria-label="Review conversation">
          <div className="timeline" aria-hidden="true"><span /></div>
          <p className="agent-label"><span>✣</span> Primer</p>
          <h1>I’m ready to guide this review.</h1>
          <p className="intro">I found <strong>itayfry/king-of-tokens#1.</strong> I prepared 8 evidence-backed steps across 4 chapters and will follow the diff as you scroll.</p>

          <article className="context-card">
            <div className="context-kicker"><span><Icon name="file" /> Live GitHub context</span><em><i /> Following</em></div>
            <h2>{step.file}</h2>
            <code>{step.path}</code>
            <p>Primer can draft from this review step. Click a diff line to override its anchor.</p>
            <button><Icon name="chat" /> Draft chapter comment</button>
          </article>

          <article className="step-card">
            <header><span>Chapter {step.chapter}</span><strong>{step.title}</strong></header>
            <div className="step-body">
              <div className="step-meta"><span>Step {stepIndex + 1} of {steps.length}</span><em className={decisions[step.path] ?? "pending"}><i /> {decisions[step.path] === "good" ? "Good" : decisions[step.path] === "rejected" ? "Rejected" : "Pending"}</em></div>
              <div className="start-card"><small>Start here</small><strong>{step.file}</strong><code>{step.path}</code></div>
              <div className="review-question"><small>Review question</small><p>{step.question}</p></div>
              <div className="evidence"><small>Evidence behind this step</small>{step.evidence.map((item) => <p key={item}><b>Changed</b><span>{item}</span></p>)}</div>
            </div>
          </article>

          <div className="chapter-preview" aria-label="Upcoming chapters">
            <span>Chapter {Math.min(step.chapter + 1, 4)}</span><span>Chapter {Math.min(step.chapter + 2, 4)}</span><span>Review complete</span>
          </div>

          {messages.map((message, index) => (
            <article className="user-message" key={`${message}-${index}`}><small>You</small><p>{message}</p></article>
          ))}
        </section>
      </div>

      <footer className="chat-dock">
        <nav className="review-nav" aria-label="Review step navigation">
          <span className="attention"><i /> Human attention</span>
          <span className="step-position">Step {stepIndex + 1} / {steps.length}</span>
          <button aria-label="Previous step (Left arrow)" aria-keyshortcuts="ArrowLeft" title="Previous step (←)" disabled={stepIndex === 0} onClick={() => moveStep(-1)}><Icon name="left" /><kbd aria-hidden="true">←</kbd></button>
          <button aria-label="Mark step good (G)" aria-keyshortcuts="G" title="Mark good (G)" onClick={() => decideStep("good")}><Icon name="check" /><kbd aria-hidden="true">G</kbd></button>
          <button aria-label="Reject step (R)" aria-keyshortcuts="R" title="Reject (R)" onClick={() => decideStep("rejected")}><Icon name="reject" /><kbd aria-hidden="true">R</kbd></button>
          <button aria-label="Next step (Right arrow)" aria-keyshortcuts="ArrowRight" title="Next step (→)" disabled={stepIndex === steps.length - 1} onClick={() => moveStep(1)}><Icon name="right" /><kbd aria-hidden="true">→</kbd></button>
        </nav>
        <form className="composer" onSubmit={submit}>
          <textarea aria-label="Ask about this change" rows={2} placeholder="Ask about this change, or type / for skills" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={submitOnEnter} />
          <button aria-label="Send message" disabled={!draft.trim()}><Icon name="send" /></button>
        </form>
      </footer>
    </main>
  );
}

