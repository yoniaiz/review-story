import { once } from "node:events";
import type { ServerResponse } from "node:http";
import cors from "@fastify/cors";
import { createAnalyzer } from "@review-story/analyzer";
import { AnalyzeRequestSchema, type Analyzer } from "@review-story/contracts";
import Fastify, { type FastifyInstance } from "fastify";

interface StoryRouteParams {
  owner: string;
  repo: string;
  pullNumber: string;
}

export interface BuildAppOptions {
  analyzer?: Analyzer;
  logger?: boolean;
}

export async function buildApp(
  options: BuildAppOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });
  const analyzer = options.analyzer ?? createAnalyzer();

  await app.register(cors, {
    origin: true,
    methods: ["GET"],
  });

  app.get("/health", async () => ({ status: "ok" }));

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

      return analyzer.analyze(analyzeRequest.data);
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
        for await (const event of analyzer.stream(analyzeRequest.data, {
          signal: abortController.signal,
        })) {
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

function parseRouteParams(params: StoryRouteParams) {
  return AnalyzeRequestSchema.safeParse({
    owner: params.owner,
    repo: params.repo,
    pullNumber: Number(params.pullNumber),
  });
}
