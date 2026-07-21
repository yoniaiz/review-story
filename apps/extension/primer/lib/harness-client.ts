import type { GitHubPageContext } from "./extension-context";

export interface HarnessCitation {
  path: string;
  lines: [number, number];
}

export interface HarnessChatTurn {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  citations: HarnessCitation[];
  createdAt: string;
}

interface ReviewSessionResponse {
  id: string;
  artifact?: unknown;
}

interface ChatResponse {
  user: HarnessChatTurn;
  assistant: HarnessChatTurn;
}

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8787";
const accessToken = import.meta.env.VITE_HARNESS_ACCESS_TOKEN;
const sessionPromises = new Map<string, Promise<string>>();

export async function sendHarnessChatMessage(
  context: GitHubPageContext,
  message: string,
): Promise<ChatResponse> {
  const sessionId = await getReadySession(context);
  const response = await fetch(apiUrl(`/api/review-sessions/${encodeURIComponent(sessionId)}/chat/messages`), {
    method: "POST",
    headers: requestHeaders(true),
    body: JSON.stringify({ message }),
  });
  if (!response.ok) throw await responseError(response, "Chat is unavailable");
  return response.json() as Promise<ChatResponse>;
}

async function getReadySession(context: GitHubPageContext): Promise<string> {
  const owner = context.owner;
  const repo = context.repository;
  const pullNumber = context.pullNumber;
  const headSha = context.activeAnchor?.headSha;
  if (!owner || !repo || !pullNumber || !headSha) {
    throw new Error("Select or scroll to a GitHub diff line so Primer can pin the chat to the current commit.");
  }

  const key = `${owner}/${repo}#${pullNumber}@${headSha}`;
  const existing = sessionPromises.get(key);
  if (existing) return existing;

  const pending = createReadySession(owner, repo, pullNumber, headSha).catch((error) => {
    sessionPromises.delete(key);
    throw error;
  });
  sessionPromises.set(key, pending);
  return pending;
}

async function createReadySession(
  owner: string,
  repo: string,
  pullNumber: number,
  headSha: string,
): Promise<string> {
  const response = await fetch(apiUrl(
    `/api/prs/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pullNumber}/review-sessions`,
  ), {
    method: "POST",
    headers: requestHeaders(true),
    body: JSON.stringify({ headSha }),
  });
  if (!response.ok) throw await responseError(response, "Review session could not be started");
  const session = await response.json() as ReviewSessionResponse;
  if (!session.id) throw new Error("The review harness returned an invalid session.");
  if (!session.artifact) await waitForArtifact(session.id);
  return session.id;
}

async function waitForArtifact(sessionId: string): Promise<void> {
  const url = apiUrl(`/api/review-sessions/${encodeURIComponent(sessionId)}/events`);
  if (accessToken) url.searchParams.set("access_token", accessToken);
  const response = await fetch(url);
  if (!response.ok) throw await responseError(response, "Review evidence could not be prepared");
  if (!response.body) throw new Error("The review evidence stream was empty.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const data = chunk.split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      if (!data) continue;
      const event = JSON.parse(data) as { type?: string; data?: { message?: string } };
      if (event.type === "story.ready") return;
      if (event.type === "story.error") {
        throw new Error(event.data?.message ?? "Review evidence generation failed.");
      }
    }
    if (done) break;
  }
  throw new Error("Review evidence generation ended before the artifact was ready.");
}

function apiUrl(path: string): URL {
  return new URL(path, apiBaseUrl);
}

function requestHeaders(json = false): HeadersInit {
  return {
    ...(json ? { "Content-Type": "application/json" } : {}),
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  };
}

async function responseError(response: Response, fallback: string): Promise<Error> {
  const payload = await response.json().catch(() => undefined) as
    | { message?: string; error?: string }
    | undefined;
  return new Error(payload?.message ?? payload?.error ?? `${fallback} (${response.status})`);
}
