import { useEffect, useMemo, useState } from "react";
import {
  StoryArtifactSchema,
  StoryStreamEventSchema,
  type Chapter,
  type StoryArtifact,
  type StorySkeleton,
  type Track,
} from "@review-story/contracts";
import mockArtifactJson from "../../../../fixtures/mock-artifact.json";

const mockArtifact = StoryArtifactSchema.parse(mockArtifactJson);

const config = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8787",
  owner: import.meta.env.VITE_DEMO_OWNER ?? "acme",
  repo: import.meta.env.VITE_DEMO_REPO ?? "review-story-demo",
  pullNumber: Number(import.meta.env.VITE_DEMO_PR ?? "123"),
};

type ConnectionState = "connecting" | "streaming" | "ready" | "mock";

interface StoryView {
  artifact: StoryArtifact;
  skeleton?: StorySkeleton;
  streamedChapters: Chapter[];
  loadedChapterIds: Set<string>;
  connection: ConnectionState;
}

interface ChapterListItem {
  id: string;
  title: string;
  chapter?: Chapter;
}

interface VisibleFileMessage {
  type: "review-story:visible-file";
  path: string;
}

export function App() {
  const [storyView, setStoryView] = useState<StoryView>({
    artifact: mockArtifact,
    streamedChapters: [],
    loadedChapterIds: new Set(mockArtifact.chapters.map(({ id }) => id)),
    connection: "connecting",
  });
  const [visited, setVisited] = useState<Set<string>>(new Set());
  const [currentChapterId, setCurrentChapterId] = useState<string>();
  const [selectedTrackId, setSelectedTrackId] = useState(
    mockArtifact.tracks[0]?.id,
  );
  const [draft, setDraft] = useState("");
  const [copyLabel, setCopyLabel] = useState("Copy comment");

  const availableChapters = storyView.skeleton
    ? storyView.streamedChapters
    : storyView.artifact.chapters;
  const tracks = storyView.skeleton?.tracks ?? storyView.artifact.tracks;
  const meta = storyView.skeleton?.meta ?? storyView.artifact.meta;
  const appendix = storyView.skeleton?.appendix ?? storyView.artifact.appendix;
  const chapterItems = useMemo<ChapterListItem[]>(() => {
    if (!storyView.skeleton) {
      return storyView.artifact.chapters.map((chapter) => ({
        id: chapter.id,
        title: chapter.title,
        chapter,
      }));
    }

    return storyView.skeleton.chapters.map((skeletonChapter) => {
      const chapter = storyView.streamedChapters.find(
        ({ id }) => id === skeletonChapter.id,
      );
      return chapter ? { ...skeletonChapter, chapter } : skeletonChapter;
    });
  }, [storyView.artifact.chapters, storyView.skeleton, storyView.streamedChapters]);

  useEffect(() => connectToStoryStream(setStoryView), []);

  useEffect(() => {
    const listener = (message: unknown) => {
      if (!isVisibleFileMessage(message)) return;
      const chapter = availableChapters.find((candidate) =>
        candidate.files.some((file) => file.path === message.path),
      );
      if (!chapter) return;
      setCurrentChapterId(chapter.id);
      setVisited((previous) => new Set(previous).add(chapter.id));
    };

    browser.runtime.onMessage.addListener(listener);
    return () => browser.runtime.onMessage.removeListener(listener);
  }, [availableChapters]);

  const activeTrack =
    tracks.find(({ id }) => id === selectedTrackId) ?? tracks[0];

  const orderedChapterItems = useMemo(
    () => orderChapters(chapterItems, activeTrack),
    [chapterItems, activeTrack],
  );

  const navigateToChapter = async (chapter: Chapter) => {
    if (!storyView.loadedChapterIds.has(chapter.id)) return;
    const firstFile = chapter.files[0];
    if (!firstFile) return;

    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    const navigated = await browser.tabs
      .sendMessage(tab.id, {
        type: "review-story:navigate",
        path: firstFile.path,
        line: firstFile.anchor_hunks[0]?.[0],
      })
      .then((result) => result === true)
      .catch(() => false);
    if (!navigated) return;
    setCurrentChapterId(chapter.id);
    setVisited((previous) => new Set(previous).add(chapter.id));
  };

  const selectEntryPoint = (track: Track, chapterId: string) => {
    setSelectedTrackId(track.id);
    const chapter = availableChapters.find(
      (candidate) => candidate.id === chapterId,
    );
    if (chapter && storyView.loadedChapterIds.has(chapter.id)) {
      void navigateToChapter(chapter);
    }
  };

  const copyDraft = async () => {
    if (!draft.trim()) return;
    await navigator.clipboard.writeText(draft.trim());
    setCopyLabel("Copied");
    window.setTimeout(() => setCopyLabel("Copy comment"), 1_200);
  };

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">PR #{meta.pr}</p>
          <h1>Review Story</h1>
        </div>
        <ConnectionBadge connection={storyView.connection} />
      </header>

      <section className="summary-card">
        <p className="section-label">What changed</p>
        <p>
          {storyView.skeleton
            ? "Building the guided reading order and evidence-backed chapter summaries…"
            : storyView.artifact.exec_summary.text}
        </p>
        <div className="summary-meta">
          <span>{chapterItems.length} chapters</span>
          <span>{appendix.files.length} appendix files</span>
        </div>
      </section>

      {activeTrack ? (
        <>
          <section className="section-block">
            <div className="section-heading">
              <div>
                <p className="section-label">Choose your entry point</p>
                <h2>{activeTrack.title}</h2>
              </div>
            </div>
            <div className="entry-points">
              {activeTrack.entry_points.map((entryPoint) => (
                <button
                  className="entry-button"
                  key={entryPoint.persona}
                  onClick={() => selectEntryPoint(activeTrack, entryPoint.start_chapter)}
                >
                  <span>{entryPoint.persona}</span>
                  <small>{entryPoint.note}</small>
                </button>
              ))}
            </div>
          </section>

          <section className="flow-card" aria-label="Feature flow">
            {activeTrack.flow.map((node, index) => {
              const chapter = node.chapter_id
                ? availableChapters.find(({ id }) => id === node.chapter_id)
                : undefined;
              const canNavigate = chapter
                ? storyView.loadedChapterIds.has(chapter.id)
                : false;
              const isCurrent = node.chapter_id === currentChapterId;
              const isVisited = node.chapter_id ? visited.has(node.chapter_id) : false;
              return (
                <div className="flow-step" key={`${node.label}-${index}`}>
                  <button
                    className={`flow-node ${node.kind} ${isCurrent ? "current" : ""} ${isVisited ? "visited" : ""}`}
                    disabled={!canNavigate}
                    onClick={() =>
                      chapter && canNavigate && void navigateToChapter(chapter)
                    }
                    title={node.kind === "external" ? "External system" : node.label}
                  >
                    {isVisited ? "✓" : index + 1}
                  </button>
                  <span>{node.label}</span>
                  {index < activeTrack.flow.length - 1 ? (
                    <i className="flow-line" aria-hidden="true" />
                  ) : null}
                </div>
              );
            })}
          </section>
        </>
      ) : null}

      <section className="chapters-section">
        <div className="section-heading chapters-heading">
          <div>
            <p className="section-label">Guided walkthrough</p>
            <h2>Reading order</h2>
          </div>
          <span className="progress-count">
            {visited.size}/{chapterItems.length}
          </span>
        </div>

        <div className="chapter-list">
          {orderedChapterItems.map((item, index) => (
            <ChapterCard
              item={item}
              index={index}
              isCurrent={item.id === currentChapterId}
              isVisited={visited.has(item.id)}
              key={item.id}
              onOpen={() => item.chapter && void navigateToChapter(item.chapter)}
            />
          ))}
        </div>
      </section>

      <details className="appendix-card">
        <summary>
          Appendix <span>{appendix.files.length}</span>
        </summary>
        <ul>
          {appendix.files.map((file) => (
            <li key={file}>
              <code>{file}</code>
              <small>{appendix.reasons[file]}</small>
            </li>
          ))}
        </ul>
      </details>

      <section className="composer-card">
        <div>
          <p className="section-label">Review note</p>
          <h2>Draft across files</h2>
        </div>
        <textarea
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Write a note, then copy it into GitHub…"
          rows={4}
          value={draft}
        />
        <div className="composer-actions">
          <button
            className="secondary-button"
            disabled={!draft.trim()}
            onClick={() => void copyDraft()}
          >
            {copyLabel}
          </button>
          <button
            className="primary-button"
            disabled
            title="Backend integration seam: pending-review API"
          >
            Stage · API next
          </button>
        </div>
      </section>
    </main>
  );
}

function ChapterCard({
  item,
  index,
  isCurrent,
  isVisited,
  onOpen,
}: {
  item: ChapterListItem;
  index: number;
  isCurrent: boolean;
  isVisited: boolean;
  onOpen: () => void;
}) {
  const chapter = item.chapter;
  return (
    <article className={`chapter-card ${isCurrent ? "current" : ""}`}>
      <button className="chapter-open" disabled={!chapter} onClick={onOpen}>
        <span className={`chapter-index ${isVisited ? "visited" : ""}`}>
          {isVisited ? "✓" : index + 1}
        </span>
        <span className="chapter-title-wrap">
          <span className="chapter-title">{item.title}</span>
          <span className="chapter-files">
            {chapter ? `${chapter.files.length} files` : "Analyzing…"}
          </span>
        </span>
        {chapter ? (
          <AttentionBadge level={chapter.attention.level} />
        ) : (
          <span className="attention-badge loading">Queued</span>
        )}
      </button>

      {chapter ? (
        <div className="chapter-body">
          <p>{chapter.summary.text}</p>
          <ul className="file-list">
            {chapter.files.map((file) => (
              <li key={file.path}>
                <code>{file.path}</code>
                <span>{file.note}</span>
              </li>
            ))}
          </ul>
          {chapter.scrutinize.length ? (
            <div className="scrutinize-box">
              <strong>What to scrutinize</strong>
              {chapter.scrutinize.map((item) => (
                <p key={item.text}>{item.text}</p>
              ))}
            </div>
          ) : null}
          <p className="tests-note">{chapter.related_tests.note}</p>
        </div>
      ) : (
        <div className="chapter-loading">Analyzing this chapter…</div>
      )}
    </article>
  );
}

function AttentionBadge({ level }: { level: Chapter["attention"]["level"] }) {
  const label = {
    DEEP_READ: "Deep read",
    STANDARD: "Standard",
    SKIM: "Skim",
  }[level];
  return <span className={`attention-badge ${level.toLowerCase()}`}>{label}</span>;
}

function ConnectionBadge({ connection }: { connection: ConnectionState }) {
  const labels: Record<ConnectionState, string> = {
    connecting: "Connecting",
    streaming: "Generating",
    ready: "Live",
    mock: "Mock data",
  };
  return (
    <span className={`connection-badge ${connection}`}>
      <i /> {labels[connection]}
    </span>
  );
}

function connectToStoryStream(
  setStoryView: React.Dispatch<React.SetStateAction<StoryView>>,
): () => void {
  const streamUrl = new URL(
    `/api/prs/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/pulls/${config.pullNumber}/story/stream`,
    config.apiBaseUrl,
  );
  const eventSource = new EventSource(streamUrl);

  const consume = (event: MessageEvent<string>) => {
    const result = StoryStreamEventSchema.safeParse(JSON.parse(event.data));
    if (!result.success) {
      console.warn("Ignored invalid story event", result.error);
      return;
    }
    if (result.data.type === "story.skeleton") {
      const skeleton = result.data.data;
      setStoryView((previous) => ({
        ...previous,
        skeleton,
        streamedChapters: [],
        loadedChapterIds: new Set(),
        connection: "streaming",
      }));
    }

    if (result.data.type === "story.chapter") {
      const chapter = result.data.data;
      setStoryView((previous) => ({
        ...previous,
        streamedChapters: previous.streamedChapters.some(
          ({ id }) => id === chapter.id,
        )
          ? previous.streamedChapters.map((candidate) =>
              candidate.id === chapter.id ? chapter : candidate,
            )
          : [...previous.streamedChapters, chapter],
        loadedChapterIds: new Set(previous.loadedChapterIds).add(chapter.id),
        connection: "streaming",
      }));
    }

    if (result.data.type === "story.ready") {
      const artifact = result.data.data;
      setStoryView({
        artifact,
        streamedChapters: [],
        loadedChapterIds: new Set(artifact.chapters.map(({ id }) => id)),
        connection: "ready",
      });
      eventSource.close();
    }

    if (result.data.type === "story.error") {
      console.warn("Story stream failed", result.data.data.message);
      setStoryView(mockStoryView());
      eventSource.close();
    }
  };

  for (const eventName of [
    "story.skeleton",
    "story.chapter",
    "story.ready",
    "story.error",
  ]) {
    eventSource.addEventListener(eventName, consume as EventListener);
  }

  eventSource.onerror = () => {
    setStoryView(mockStoryView());
    // Keep EventSource open: its native retry lets the API start or recover later.
  };

  return () => eventSource.close();
}

function mockStoryView(): StoryView {
  return {
    artifact: mockArtifact,
    streamedChapters: [],
    loadedChapterIds: new Set(mockArtifact.chapters.map(({ id }) => id)),
    connection: "mock",
  };
}

function orderChapters<T extends { id: string }>(chapters: T[], track?: Track): T[] {
  if (!track) return chapters;
  const order = new Map(track.chapter_order.map((id, index) => [id, index]));
  return [...chapters].sort(
    (left, right) =>
      (order.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(right.id) ?? Number.MAX_SAFE_INTEGER),
  );
}

function isVisibleFileMessage(message: unknown): message is VisibleFileMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    "type" in message &&
    message.type === "review-story:visible-file" &&
    "path" in message &&
    typeof message.path === "string"
  );
}
