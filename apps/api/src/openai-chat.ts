import type { Evidence } from "@review-story/contracts";
import type { ReviewSession } from "./review-session.js";

export interface ChatReply {
  text: string;
  citations: Evidence[];
  responseId?: string;
}

export interface ChatEngine {
  reply(input: { session: ReviewSession; message: string }): Promise<ChatReply>;
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

  async reply({ session, message }: { session: ReviewSession; message: string }): Promise<ChatReply> {
    if (!this.#apiKey) {
      throw new Error("OPENAI_API_KEY is required to use chat");
    }
    if (!session.artifact) {
      return {
        text: "The review outline is still being prepared. Try again after at least one chapter is ready.",
        citations: [],
      };
    }

    const context = {
      currentChapterId: session.currentChapterId ?? null,
      completedChapterIds: session.completedChapters.map(({ chapterId }) => chapterId),
      artifact: session.artifact,
      history: session.chatTurns.slice(-12).map(({ role, content }) => ({ role, content })),
    };
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
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
    });
    if (!response.ok) {
      throw new Error(`OpenAI request failed: ${response.status} ${await response.text()}`);
    }
    const payload = await response.json() as { id?: string; output_text?: string };
    const text = payload.output_text?.trim() || "I could not produce a review response.";
    const citations = extractAndValidateCitations(text, session);
    if (!citations.length && /[.!?]/.test(text)) {
      throw new Error("The model returned a review answer without verifiable evidence citations");
    }
    return {
      text,
      citations,
      ...(payload.id ? { responseId: payload.id } : {}),
    };
  }
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
