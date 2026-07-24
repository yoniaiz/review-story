# Extension → agent harness handoff

The extension is intentionally unchanged by the harness implementation. This document describes the future integration contract for the extension owner.

## Environment

Add these build-time variables to the extension's environment type and local `.env`:

```dotenv
VITE_DEMO_HEAD_SHA=<current PR head SHA>
```

The harness session token (obtained via GitHub sign-in) is sent as a bearer token on normal requests and as the `access_token` query parameter on the SSE URL because `EventSource` cannot set request headers.

## Start and resume a review

Do not start analysis when the side panel opens. Show a **Start review for latest commit** button instead.

1. Determine the PR's current head SHA from the GitHub PR page or GitHub API.
2. `POST /api/prs/:owner/:repo/pulls/:pullNumber/review-sessions` with `{ "headSha": "..." }`.
3. The response returns an existing session for that exact SHA or creates a new session with status `NEW`.
4. If the response includes `artifact`, render it immediately; otherwise open `GET /api/review-sessions/:sessionId/events` as an `EventSource`.
5. Render `story.skeleton`, `story.chapter`, `story.ready`, and `story.error` exactly as the existing story stream does.

The harness intentionally does not compare or show previous sessions when a new commit creates a new head SHA.

## Chapter progress

Use the API as the source of truth rather than keeping visited/completed state only in React:

```http
POST /api/review-sessions/:sessionId/chapters/:chapterId/select
POST /api/review-sessions/:sessionId/chapters/:chapterId/complete
```

Both return the updated session. `complete` is also the semantic result of a chat instruction such as “skip this chapter, I've seen enough.”

## Chat and drafts

```http
POST /api/review-sessions/:sessionId/chat/messages
Content-Type: application/json

{
  "message": "What should I scrutinize here?",
  "chapterId": "chapter-auth",
  "stepId": "src/auth/session.ts"
}
```

`chapterId` and `stepId` are required and must identify a generated review step. The response contains structured user and assistant turns carrying the same scope. Only render turns for the active step; model history is isolated to that step as well. The PR summary remains the global analysis shown before chapter 1. Render assistant citations next to its response. Drafts remain private to the harness until a user explicitly publishes them:

```http
POST /api/review-sessions/:sessionId/drafts
{ "body": "...", "path": "src/file.ts", "line": 42, "side": "RIGHT" }

POST /api/review-sessions/:sessionId/drafts/:draftId/publish
{ "confirm": true }
```

Never call `publish` from a chat response or automatically after draft creation. The publish route creates a GitHub pending review comment.

## Reference patch

[`extension-harness-integration.patch`](./extension-harness-integration.patch) is a minimal reference patch for the current side panel. Apply it only when the extension owner is ready to integrate, then adapt it to the real GitHub head-SHA detection and UI design.
