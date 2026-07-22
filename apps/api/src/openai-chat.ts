import type { Evidence } from "@review-story/contracts";
import type { ReviewSession } from "./review-session.js";

export interface ChatReply {
  text: string;
  citations: Evidence[];
  responseId?: string;
}

export interface ActiveReviewContext {
  chapterId: string;
  filePath: string;
}

export interface ChatEngine {
  reply(input: {
    session: ReviewSession;
    message: string;
    activeContext?: ActiveReviewContext;
  }): Promise<ChatReply>;
}

/**
 * The harness deliberately gives the model only artifact evidence and the
 * current session snapshot. Repository reads and GitHub writes will be added
 * as explicit server-executed function tools, never as client capabilities.
 */
export class OpenAiResponsesChatEngine implements ChatEngine {
  readonly #apiKey: string | undefined;

  constructor(apiKey?: string) {
    this.#apiKey = apiKey ?? process.env.OPENAI_API_KEY;
  }

  async reply({ session, message, activeContext }: {
    session: ReviewSession;
    message: string;
    activeContext?: ActiveReviewContext;
  }): Promise<ChatReply> {
    if (process.env.ANALYZER_MODE === "deterministic") {
      return deterministicEvidenceReply(session, message, activeContext);
    }
    if (!this.#apiKey) {
      throw new Error("OPENAI_API_KEY is required to use chat");
    }
    if (!session.artifact) {
      return {
        text: "The review outline is still being prepared. Try again after at least one chapter is ready.",
        citations: [],
      };
    }

    const activeChapterId = activeContext?.chapterId ?? session.currentChapterId;
    const activeChapter = session.artifact.chapters.find(({ id }) => id === activeChapterId);
    const activeFile = activeContext && activeChapter
      ? activeChapter.files.find(({ path }) => path === activeContext.filePath)
      : undefined;
    const context = {
      pullRequest: {
        owner: session.owner,
        repo: session.repo,
        number: session.pullNumber,
        headSha: session.headSha,
      },
      overview: {
        summary: session.artifact.exec_summary,
        chapters: session.artifact.chapters.map((chapter) => ({
          id: chapter.id,
          title: chapter.title,
          summary: chapter.summary,
          attention: chapter.attention,
          fileCount: chapter.files.length,
        })),
        omittedFileCount: session.artifact.appendix.files.length,
      },
      activePage: activeChapter ? {
        chapter: {
          id: activeChapter.id,
          title: activeChapter.title,
          summary: activeChapter.summary,
          scrutinize: activeChapter.scrutinize,
          relatedTests: activeChapter.related_tests,
          attention: activeChapter.attention,
        },
        file: activeFile ?? null,
      } : null,
      completedChapterIds: session.completedChapters.map(({ chapterId }) => chapterId),
      history: session.chatTurns.slice(-12).map(({ role, content }) => ({ role, content })),
    };
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: AbortSignal.timeout(20_000),
      headers: {
        Authorization: `Bearer ${this.#apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5.6-terra",
        store: false,
        reasoning: { effort: "medium", context: "all_turns" },
        input: [
          {
            role: "developer",
            content: "You are a code-review assistant. Use only evidence supplied in the review artifact. If evidence is insufficient, say so plainly. End every factual claim with file-and-line citations in the form path:line-line. Never claim that a GitHub comment was published.",
          },
          { role: "developer", content: `Session context:\n${JSON.stringify(context)}` },
          { role: "user", content: message },
        ],
      }),
    }).catch(() => undefined);
    if (!response?.ok) {
      return deterministicEvidenceReply(session, message, activeContext);
    }
    const payload = await response.json() as { id?: string; output_text?: string };
    const text = payload.output_text?.trim() || "I could not produce a review response.";
    const citations = extractAndValidateCitations(text, session);
    if (!citations.length && /[.!?]/.test(text)) {
      return deterministicEvidenceReply(session, message, activeContext);
    }
    return {
      text,
      citations,
      ...(payload.id ? { responseId: payload.id } : {}),
    };
  }
}

function deterministicEvidenceReply(
  session: ReviewSession,
  message: string,
  activeContext?: ActiveReviewContext,
): ChatReply {
  const artifact = session.artifact;
  if (!artifact) {
    return {
      text: "The review outline is still being prepared. Try again when the story is ready.",
      citations: [],
    };
  }

  if (/\b(intent|overall|whole pr|pr summary|what.*pr)\b/i.test(message)) {
    return {
      text: `${artifact.exec_summary.text} ${formatCitations(artifact.exec_summary.evidence)}`,
      citations: artifact.exec_summary.evidence,
    };
  }

  const current = artifact.chapters.find(({ id }) =>
    id === (activeContext?.chapterId ?? session.currentChapterId));
  const highestRisk = [...artifact.chapters].sort((left, right) =>
    attentionRank(right.attention.level) - attentionRank(left.attention.level))[0];
  const chapter = /\b(risk|danger|scrutinize|concern)\b/i.test(message)
    ? highestRisk
    : current ?? highestRisk;
  if (!chapter) {
    return {
      text: `${artifact.exec_summary.text} ${formatCitations(artifact.exec_summary.evidence)}`,
      citations: artifact.exec_summary.evidence,
    };
  }
  const fileClaims = activeContext
    ? [chapter.summary, ...chapter.scrutinize].filter((claim) =>
      claim.evidence.some(({ path }) => path === activeContext.filePath))
    : [];
  const claim = fileClaims[0] ?? chapter.scrutinize[0] ?? chapter.summary;
  return {
    text: `${claim.text} ${formatCitations(claim.evidence)}`,
    citations: claim.evidence,
  };
}

function formatCitations(citations: Evidence[]): string {
  return citations
    .map(({ path, lines }) => `${path}:${lines[0]}-${lines[1]}`)
    .join(", ");
}

function attentionRank(level: "SKIM" | "STANDARD" | "DEEP_READ"): number {
  if (level === "DEEP_READ") return 2;
  if (level === "STANDARD") return 1;
  return 0;
}

function extractAndValidateCitations(text: string, session: ReviewSession): Evidence[] {
  const known = collectEvidence(session);
  const citations: Evidence[] = [];
  for (const match of text.matchAll(/([A-Za-z0-9_./-]+):(\d+)(?:-(\d+))?/g)) {
    const path = match[1];
    const start = Number(match[2]);
    const end = Number(match[3] ?? match[2]);
    if (!path || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)) continue;
    const citation: Evidence = { path, lines: [start, end] };
    if (known.some((candidate) => candidate.path === path && start >= candidate.lines[0] && end <= candidate.lines[1])) {
      citations.push(citation);
    }
  }
  return citations.filter((citation, index) =>
    citations.findIndex((candidate) => candidate.path === citation.path && candidate.lines[0] === citation.lines[0] && candidate.lines[1] === citation.lines[1]) === index,
  );
}

function collectEvidence(session: ReviewSession): Evidence[] {
  const artifact = session.artifact;
  if (!artifact) return [];
  return [
    ...artifact.exec_summary.evidence,
    ...artifact.chapters.flatMap((chapter) => [chapter.summary, ...chapter.scrutinize].flatMap((claim) => claim.evidence)),
    ...artifact.tracks.flatMap((track) => track.flow.flatMap((node) => node.evidence ?? [])),
  ];
}
