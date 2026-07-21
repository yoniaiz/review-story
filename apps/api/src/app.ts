import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { ServerResponse } from "node:http";
import { resolve } from "node:path";
import cors from "@fastify/cors";
import { createAnalyzer } from "@review-story/analyzer";
import {
  AnalyzeRequestSchema,
  type Analyzer,
  type StoryStreamEvent,
} from "@review-story/contracts";
import Fastify, { type FastifyInstance } from "fastify";
import {
  addChatTurn,
  applyConversationStateIntent,
  completeChapter,
  MemoryReviewSessionStore,
  type ReviewSession,
  type ReviewSessionStore,
} from "./review-session.js";
import { OpenAiResponsesChatEngine, type ChatEngine } from "./openai-chat.js";
import { GitHubPendingReviewPublisher, type GitHubPublisher } from "./github-publisher.js";
import {
  GitHubPullReaderError,
  GitHubRestPullReader,
  type GitHubPullReader,
} from "./github-pulls.js";
import { SupabaseReviewSessionStore } from "./supabase-session-store.js";
import { StoryCache } from "./story-cache.js";
import { StoryService } from "./story-service.js";

interface StoryRouteParams {
  owner: string;
  repo: string;
  pullNumber: string;
}

interface RepositoryRouteParams {
  owner: string;
  repo: string;
}

export interface BuildAppOptions {
  analyzer?: Analyzer;
  cache?: StoryCache;
  cacheDirectory?: string;
  logger?: boolean;
  sessions?: ReviewSessionStore;
  chatEngine?: ChatEngine;
  githubPublisher?: GitHubPublisher;
  githubPullReader?: GitHubPullReader;
}

export async function buildApp(
  options: BuildAppOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });
  const analyzer = options.analyzer ?? createAnalyzer();
  const sessions = options.sessions ?? createSessionStore();
  const chatEngine = options.chatEngine ?? new OpenAiResponsesChatEngine();
  const githubPublisher = options.githubPublisher ?? new GitHubPendingReviewPublisher();
  const githubPullReader = options.githubPullReader ?? new GitHubRestPullReader();
  const cache =
    options.cache ??
    new StoryCache(
      options.cacheDirectory ??
        process.env.STORY_CACHE_ROOT ??
        resolve(process.cwd(), ".review-story", "cache"),
    );
  const stories = new StoryService(analyzer, cache);

  await app.register(cors, {
    origin: true,
    methods: ["GET", "POST", "PATCH"],
  });

  const accessToken = process.env.HARNESS_ACCESS_TOKEN;
  if (accessToken) {
    app.addHook("onRequest", async (request, reply) => {
      if (request.url.startsWith("/health")) return;
      const headerToken = request.headers.authorization?.replace(/^Bearer\s+/i, "");
      const queryToken = new URL(request.url, "http://localhost").searchParams.get("access_token");
      if (headerToken !== accessToken && queryToken !== accessToken) {
        return reply.code(401).send({ error: "unauthorized" });
      }
    });
  }

  app.get("/health", async () => ({ status: "ok" }));

  app.get<{ Params: RepositoryRouteParams }>(
    "/api/github/repos/:owner/:repo/pulls",
    async (request, reply) => {
      if (!validRepositoryParams(request.params)) {
        return reply.code(400).send({ error: "invalid_request" });
      }
      try {
        return { pulls: await githubPullReader.list(request.params.owner, request.params.repo) };
      } catch (error) {
        return githubReadFailure(reply, error);
      }
    },
  );

  app.get<{ Params: StoryRouteParams }>(
    "/api/github/repos/:owner/:repo/pulls/:pullNumber",
    async (request, reply) => {
      const requestData = parseRouteParams(request.params);
      if (!requestData.success) return invalidRequest(reply, requestData.error.flatten());
      try {
        return githubPullReader.get(
          requestData.data.owner,
          requestData.data.repo,
          requestData.data.pullNumber,
        );
      } catch (error) {
        return githubReadFailure(reply, error);
      }
    },
  );

  app.get<{ Params: StoryRouteParams; Querystring: { headSha?: string } }>(
    "/api/prs/:owner/:repo/pulls/:pullNumber/review-sessions/current",
    async (request, reply) => {
      const requestData = parseRouteParams(request.params);
      if (!requestData.success) return invalidRequest(reply, requestData.error.flatten());
      const headSha = request.query.headSha;
      if (!headSha) return reply.code(400).send({ error: "head_sha_required" });
      const session = await sessions.findCurrent({ ...requestData.data, headSha });
      return session ? publicSession(session) : reply.code(404).send({ error: "not_found" });
    },
  );

  app.post<{ Params: StoryRouteParams; Body: { headSha?: string } }>(
    "/api/prs/:owner/:repo/pulls/:pullNumber/review-sessions",
    async (request, reply) => {
      const requestData = parseRouteParams(request.params);
      if (!requestData.success) return invalidRequest(reply, requestData.error.flatten());
      const headSha = request.body?.headSha?.trim();
      if (!headSha) return reply.code(400).send({ error: "head_sha_required" });
      const input = { ...requestData.data, headSha };
      const existing = await sessions.findCurrent(input);
      if (existing) {
        if (shouldRegenerateCollapsedStory(existing)) {
          resetSessionStory(existing);
          await sessions.save(existing);
        }
        return publicSession(existing);
      }
      const session = await sessions.create(input);
      return reply.code(201).send(publicSession(session));
    },
  );

  app.get<{ Params: { sessionId: string } }>(
    "/api/review-sessions/:sessionId",
    async (request, reply) => {
      const session = await sessions.get(request.params.sessionId);
      return session ? publicSession(session) : reply.code(404).send({ error: "not_found" });
    },
  );

  app.get<{ Params: { sessionId: string } }>(
    "/api/review-sessions/:sessionId/events",
    async (request, reply) => {
      const session = await sessions.get(request.params.sessionId);
      if (!session) return reply.code(404).send({ error: "not_found" });
      reply.hijack();
      reply.raw.writeHead(200, sseHeaders());
      const abortController = new AbortController();
      reply.raw.once("close", () => abortController.abort());
      try {
        if (session.artifact) {
          await writeSseEvent(reply.raw, "story.ready", { type: "story.ready", data: session.artifact });
          return;
        }
        session.status = "GENERATING";
        await sessions.save(session);
        for await (const event of stories.stream(
          toAnalyzeRequest(session),
          abortController.signal,
        )) {
          applyStoryEvent(session, event);
          await sessions.save(session);
          if (!(await writeSseEvent(reply.raw, event.type, event))) break;
        }
      } catch (error) {
        session.status = "FAILED";
        session.error = error instanceof Error ? error.message : "Unknown error";
        await sessions.save(session);
        await writeSseEvent(reply.raw, "story.error", { type: "story.error", data: { message: session.error } });
      } finally {
        if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.end();
      }
    },
  );

  app.post<{ Params: { sessionId: string; chapterId: string } }>(
    "/api/review-sessions/:sessionId/chapters/:chapterId/select",
    async (request, reply) => mutateChapter(sessions, request.params.sessionId, request.params.chapterId, false, reply),
  );

  app.post<{ Params: { sessionId: string; chapterId: string } }>(
    "/api/review-sessions/:sessionId/chapters/:chapterId/complete",
    async (request, reply) => mutateChapter(sessions, request.params.sessionId, request.params.chapterId, true, reply),
  );

  app.post<{ Params: { sessionId: string }; Body: { message?: string; chapterId?: string; stepId?: string } }>(
    "/api/review-sessions/:sessionId/chat/messages",
    async (request, reply) => {
      const session = await sessions.get(request.params.sessionId);
      const message = request.body?.message?.trim();
      const chapterId = request.body?.chapterId?.trim();
      const stepId = request.body?.stepId?.trim();
      if (!session) return reply.code(404).send({ error: "not_found" });
      if (!message) return reply.code(400).send({ error: "message_required" });
      if (!chapterId || !stepId) return reply.code(400).send({ error: "chat_scope_required" });
      const chapter = session.artifact?.chapters.find(({ id }) => id === chapterId);
      if (!chapter?.files.some(({ path }) => path === stepId)) {
        return reply.code(409).send({ error: "step_not_ready" });
      }
      const scope = { chapterId, stepId };
      session.currentChapterId = chapterId;
      const userTurn = addChatTurn(session, { ...scope, role: "user", content: message, citations: [] });
      const stateChange = applyConversationStateIntent(session, message);
      if (stateChange) addChatTurn(session, { ...scope, role: "tool", content: stateChange, citations: [] });
      try {
        const response = await chatEngine.reply({ session, message, scope });
        const assistantTurn = addChatTurn(session, { ...scope, role: "assistant", content: response.text, citations: response.citations });
        await sessions.save(session);
        return { user: userTurn, assistant: assistantTurn };
      } catch (error) {
        await sessions.save(session);
        return reply.code(503).send({ error: "chat_unavailable", message: error instanceof Error ? error.message : "Unknown error" });
      }
    },
  );

  app.post<{ Params: { sessionId: string }; Body: { body?: string; path?: string; line?: number; side?: "LEFT" | "RIGHT" } }>(
    "/api/review-sessions/:sessionId/drafts",
    async (request, reply) => {
      const session = await sessions.get(request.params.sessionId);
      const body = request.body?.body?.trim();
      const path = request.body?.path?.trim();
      const line = request.body?.line;
      const side = request.body?.side ?? "RIGHT";
      if (!session) return reply.code(404).send({ error: "not_found" });
      if (!body || !path || !Number.isInteger(line) || !line || line < 1) {
        return reply.code(400).send({ error: "invalid_draft" });
      }
      const draft = {
        id: randomUUID(), body, path, line, side, createdAt: new Date().toISOString(),
      };
      session.drafts.push(draft);
      await sessions.save(session);
      return reply.code(201).send(draft);
    },
  );

  app.post<{ Params: { sessionId: string; draftId: string }; Body: { confirm?: boolean } }>(
    "/api/review-sessions/:sessionId/drafts/:draftId/publish",
    async (request, reply) => {
      const session = await sessions.get(request.params.sessionId);
      if (!session) return reply.code(404).send({ error: "not_found" });
      if (request.body?.confirm !== true) return reply.code(400).send({ error: "explicit_confirmation_required" });
      const draft = session.drafts.find(({ id }) => id === request.params.draftId);
      if (!draft) return reply.code(404).send({ error: "draft_not_found" });
      if (draft.publishedAt) return reply.code(409).send({ error: "draft_already_published" });
      try {
        const published = await githubPublisher.publish(session, draft);
        draft.publishedAt = new Date().toISOString();
        draft.githubCommentUrl = published.url;
        await sessions.save(session);
        return draft;
      } catch (error) {
        return reply.code(502).send({ error: "github_publish_failed", message: error instanceof Error ? error.message : "Unknown error" });
      }
    },
  );

  app.get<{ Params: StoryRouteParams }>(
    "/api/prs/:owner/:repo/pulls/:pullNumber/story",
    async (request, reply) => {
      const analyzeRequest = parseRouteParams(request.params);
      if (!analyzeRequest.success) {
        return reply.code(400).send({
          error: "invalid_request",
          details: analyzeRequest.error.flatten(),
        });
      }

      const abortController = new AbortController();
      const abortAnalysis = () => abortController.abort();
      reply.raw.once("close", abortAnalysis);
      try {
        return (
          await stories.analyze(analyzeRequest.data, abortController.signal)
        ).artifact;
      } finally {
        reply.raw.off("close", abortAnalysis);
      }
    },
  );

  app.get<{ Params: StoryRouteParams }>(
    "/api/prs/:owner/:repo/pulls/:pullNumber/story/stream",
    async (request, reply) => {
      const analyzeRequest = parseRouteParams(request.params);
      if (!analyzeRequest.success) {
        return reply.code(400).send({
          error: "invalid_request",
          details: analyzeRequest.error.flatten(),
        });
      }

      reply.hijack();
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      const abortController = new AbortController();
      const abortAnalysis = () => abortController.abort();
      reply.raw.once("close", abortAnalysis);

      try {
        for await (const event of stories.stream(
          analyzeRequest.data,
          abortController.signal,
        )) {
          if (reply.raw.destroyed) break;
          if (!(await writeSseEvent(reply.raw, event.type, event))) break;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        if (!reply.raw.destroyed) {
          await writeSseEvent(reply.raw, "story.error", {
            type: "story.error",
            data: { message },
          });
        }
      } finally {
        abortController.abort();
        reply.raw.off("close", abortAnalysis);
        if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.end();
      }
    },
  );

  return app;
}

function createSessionStore(): ReviewSessionStore {
  if (process.env.REVIEW_SESSION_STORE?.toLowerCase() === "memory") {
    return new MemoryReviewSessionStore();
  }
  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && secretKey) return new SupabaseReviewSessionStore(url, secretKey);
  return new MemoryReviewSessionStore();
}

async function writeSseEvent(
  response: ServerResponse,
  eventName: string,
  event: unknown,
): Promise<boolean> {
  if (response.destroyed || response.writableEnded) return false;
  const chunk = `event: ${eventName}\ndata: ${JSON.stringify(event)}\n\n`;
  if (response.write(chunk)) return true;

  return Promise.race([
    once(response, "drain").then(() => true),
    once(response, "close").then(() => false),
  ]);
}

function sseHeaders() {
  return {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  };
}

function toAnalyzeRequest(session: ReviewSession) {
  return {
    owner: session.owner,
    repo: session.repo,
    pullNumber: session.pullNumber,
  };
}

function applyStoryEvent(session: ReviewSession, event: StoryStreamEvent): void {
  if (event.type === "story.skeleton") session.skeleton = event.data;
  if (event.type === "story.ready") {
    session.artifact = event.data;
    session.status = "READY";
  }
  if (event.type === "story.error") {
    session.status = "FAILED";
    session.error = event.data.message;
  }
}

async function mutateChapter(
  sessions: ReviewSessionStore,
  sessionId: string,
  chapterId: string,
  completed: boolean,
  reply: { code(statusCode: number): { send(payload: unknown): unknown } },
) {
  const session = await sessions.get(sessionId);
  if (!session) return reply.code(404).send({ error: "not_found" });
  if (!session.artifact?.chapters.some((chapter) => chapter.id === chapterId)) {
    return reply.code(409).send({ error: "chapter_not_ready" });
  }
  if (completed) completeChapter(session, chapterId);
  else session.currentChapterId = chapterId;
  await sessions.save(session);
  return publicSession(session);
}

function publicSession(session: ReviewSession) {
  return {
    id: session.id,
    owner: session.owner,
    repo: session.repo,
    pullNumber: session.pullNumber,
    headSha: session.headSha,
    status: session.status,
    ...(session.currentChapterId ? { currentChapterId: session.currentChapterId } : {}),
    completedChapterIds: session.completedChapters.map(({ chapterId }) => chapterId),
    chatTurns: session.chatTurns,
    drafts: session.drafts,
    ...(session.artifact ? { artifact: session.artifact } : {}),
    ...(session.skeleton ? { skeleton: session.skeleton } : {}),
    ...(session.error ? { error: session.error } : {}),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

function shouldRegenerateCollapsedStory(session: ReviewSession): boolean {
  const configuredVersion = Number(process.env.ANALYZER_VERSION);
  const artifact = session.artifact;
  if (!artifact || !Number.isInteger(configuredVersion) || configuredVersion <= 0) return false;
  const meaningfulFiles = artifact.chapters.reduce(
    (total, chapter) => total + chapter.files.length,
    0,
  );
  return artifact.meta.versions.analyzer < configuredVersion
    && artifact.chapters.length === 1
    && meaningfulFiles > 1;
}

function resetSessionStory(session: ReviewSession): void {
  session.status = "NEW";
  session.completedChapters = [];
  session.chatTurns = [];
  session.drafts = [];
  delete session.currentChapterId;
  delete session.artifact;
  delete session.skeleton;
  delete session.error;
}

function invalidRequest(
  reply: { code(statusCode: number): { send(payload: unknown): unknown } },
  details: unknown,
) {
  return reply.code(400).send({ error: "invalid_request", details });
}

function validRepositoryParams(params: RepositoryRouteParams): boolean {
  return Boolean(params.owner.trim() && params.repo.trim());
}

function githubReadFailure(
  reply: { code(statusCode: number): { send(payload: unknown): unknown } },
  error: unknown,
) {
  if (error instanceof GitHubPullReaderError) {
    const status = error.status === 404 ? 404 : error.status === 403 ? 403 : 502;
    return reply.code(status).send({ error: "github_read_failed", message: error.message });
  }
  return reply.code(502).send({
    error: "github_read_failed",
    message: error instanceof Error ? error.message : "GitHub pull request lookup failed",
  });
}

function parseRouteParams(params: StoryRouteParams) {
  return AnalyzeRequestSchema.safeParse({
    owner: params.owner,
    repo: params.repo,
    pullNumber: Number(params.pullNumber),
  });
}
