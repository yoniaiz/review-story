import { randomUUID } from "node:crypto";
import type { StoryArtifact, StorySkeleton } from "@review-story/contracts";

export type ReviewSessionStatus = "NEW" | "GENERATING" | "READY" | "FAILED";
export type ChatRole = "user" | "assistant" | "tool";

export interface ChapterProgress {
  chapterId: string;
  completedAt: string;
}

export interface ChatTurn {
  id: string;
  role: ChatRole;
  content: string;
  citations: Array<{ path: string; lines: [number, number] }>;
  createdAt: string;
}

export interface CommentDraft {
  id: string;
  body: string;
  path: string;
  line: number;
  side: "LEFT" | "RIGHT";
  createdAt: string;
  publishedAt?: string;
  githubCommentUrl?: string;
}

export interface ReviewSession {
  id: string;
  owner: string;
  repo: string;
  pullNumber: number;
  headSha: string;
  status: ReviewSessionStatus;
  currentChapterId?: string;
  completedChapters: ChapterProgress[];
  chatTurns: ChatTurn[];
  drafts: CommentDraft[];
  artifact?: StoryArtifact;
  skeleton?: StorySkeleton;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface NewReviewSession {
  owner: string;
  repo: string;
  pullNumber: number;
  headSha: string;
}

export interface ReviewSessionStore {
  findCurrent(input: NewReviewSession): Promise<ReviewSession | undefined>;
  create(input: NewReviewSession): Promise<ReviewSession>;
  get(id: string): Promise<ReviewSession | undefined>;
  save(session: ReviewSession): Promise<void>;
}

export class MemoryReviewSessionStore implements ReviewSessionStore {
  readonly #sessions = new Map<string, ReviewSession>();

  async findCurrent(input: NewReviewSession): Promise<ReviewSession | undefined> {
    return [...this.#sessions.values()].find(
      (session) =>
        session.owner === input.owner &&
        session.repo === input.repo &&
        session.pullNumber === input.pullNumber &&
        session.headSha === input.headSha,
    );
  }

  async create(input: NewReviewSession): Promise<ReviewSession> {
    const now = new Date().toISOString();
    const session: ReviewSession = {
      id: randomUUID(),
      ...input,
      status: "NEW",
      completedChapters: [],
      chatTurns: [],
      drafts: [],
      createdAt: now,
      updatedAt: now,
    };
    this.#sessions.set(session.id, session);
    return session;
  }

  async get(id: string): Promise<ReviewSession | undefined> {
    return this.#sessions.get(id);
  }

  async save(session: ReviewSession): Promise<void> {
    session.updatedAt = new Date().toISOString();
    this.#sessions.set(session.id, session);
  }
}

export function addChatTurn(
  session: ReviewSession,
  turn: Omit<ChatTurn, "id" | "createdAt">,
): ChatTurn {
  const stored: ChatTurn = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    ...turn,
  };
  session.chatTurns.push(stored);
  return stored;
}

export function completeChapter(session: ReviewSession, chapterId: string): void {
  session.currentChapterId = chapterId;
  if (session.completedChapters.some((chapter) => chapter.chapterId === chapterId)) {
    return;
  }
  session.completedChapters.push({
    chapterId,
    completedAt: new Date().toISOString(),
  });
}

/**
 * Small deterministic command layer for state-only chat intents. It keeps
 * review progress dependable even if the model is unavailable or declines a
 * function call. More nuanced intents belong in the model tool loop.
 */
export function applyConversationStateIntent(
  session: ReviewSession,
  message: string,
): string | undefined {
  const wantsCompletion = /\b(skip|complete|completed|done|seen enough|finish)\b/i.test(message);
  if (!wantsCompletion || !session.currentChapterId) return undefined;
  completeChapter(session, session.currentChapterId);
  return `Completed chapter ${session.currentChapterId}`;
}
