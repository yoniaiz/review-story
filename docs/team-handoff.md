# Team handoff — current project state

This is the shared context for the frontend/Chrome-extension owner and the analysis-layer owner. It describes the current split after the agent/chat harness foundation was added.

## Ownership

| Layer | Directory | Owns |
|---|---|---|
| Frontend | `apps/extension` | Chrome side panel UI, user input, GitHub DOM synchronization, rendering harness/session state |
| Agent / chat harness | `apps/api` | Review sessions, chapter progress, structured chat history, orchestration, persistence, OpenAI calls, drafts, explicit GitHub publishing |
| Analysis layer | `packages/analyzer` | Reviewer-neutral PR analysis and `StoryArtifact`/SSE production |

`packages/contracts` and `fixtures/mock-artifact.json` remain shared integration surfaces. Coordinate any changes there.

## Agent/chat harness: what exists now

The harness is implemented under `apps/api`.

- A review session is keyed by `owner + repo + pull number + head SHA`.
- The same head SHA resumes the existing session; a different SHA creates a new session with no prior-session comparison.
- Analysis begins only when the harness session SSE endpoint is opened. The harness streams the existing `story.skeleton`, `story.chapter`, `story.ready`, and `story.error` event shapes.
- The harness owns the selected chapter and completed chapters. A message such as “skip this chapter, I've seen enough” completes the current chapter.
- Chat uses the OpenAI Responses API with `gpt-5.6-terra`, `store: false`, and medium reasoning effort. It only accepts citations that match evidence in the stored artifact.
- Drafts are persisted in the harness. Publishing is a distinct confirmed endpoint; it creates a GitHub **pending** review comment by omitting the review event.
- Local sessions use memory. When `SUPABASE_URL` and `SUPABASE_SECRET_KEY` are set, the harness uses the Supabase REST API instead.

## Harness endpoints

All routes are served by the Fastify API. Authenticated deployments use GitHub sign-in: the extension sends its per-user harness session token as `Authorization: Bearer <token>`, and as `access_token=<token>` on SSE URLs because `EventSource` cannot set headers.

| Route | Purpose |
|---|---|
| `POST /api/prs/:owner/:repo/pulls/:pullNumber/review-sessions` | Create or resume a session. Body: `{ "headSha": "..." }` |
| `GET /api/prs/:owner/:repo/pulls/:pullNumber/review-sessions/current?headSha=...` | Find the session for a specific head SHA |
| `GET /api/review-sessions/:sessionId` | Read the current session state |
| `GET /api/review-sessions/:sessionId/events` | Start/resume analysis and receive story SSE events |
| `POST /api/review-sessions/:sessionId/chapters/:chapterId/select` | Set current chapter |
| `POST /api/review-sessions/:sessionId/chapters/:chapterId/complete` | Complete current chapter |
| `POST /api/review-sessions/:sessionId/chat/messages` | Send `{ "message": "..." }`, receive structured user/assistant turns |
| `POST /api/review-sessions/:sessionId/drafts` | Create `{ body, path, line, side }` |
| `POST /api/review-sessions/:sessionId/drafts/:draftId/publish` | Publish only with `{ "confirm": true }` |

## Frontend owner: next integration work

The extension was deliberately left unchanged. The future integration guide is [extension-harness-integration.md](./extension-harness-integration.md), with a reference patch at [extension-harness-integration.patch](./extension-harness-integration.patch).

Main work:

1. Replace the auto-started legacy story stream with an explicit **Start review for latest commit** action.
2. Read the actual GitHub PR head SHA rather than using a demo value.
3. Create/resume the harness session, then consume its SSE stream using the existing story event rendering.
4. Render `currentChapterId`, `completedChapterIds`, chat turns/citations, and drafts from the harness as the source of truth.
5. Use explicit UI confirmation before calling the publish endpoint.

Do not place `OPENAI_API_KEY`, `GITHUB_PAT`, or `SUPABASE_SECRET_KEY` in the extension.

## Analysis-layer owner: next integration work

The current `StaticAnalyzer` remains intentionally fixture-backed. Replace its internals behind the existing `Analyzer` interface—do not add reviewer state, chat history, or user identity to `StoryArtifact`.

The harness currently invokes:

```ts
analyzer.stream({ owner, repo, pullNumber }, { signal })
```

It persists the resulting validated artifact and forwards the existing stream events. Keep the artifact reviewer-neutral and evidence-backed. The real analyzer will need to fetch PR data and produce the same validated shapes; the harness session and frontend contract should not need to change.

## Local and hosted setup

Copy `.env.example` to `.env` and configure only what you use:

```dotenv
OPENAI_API_KEY=                 # required for chat
GITHUB_PAT=                     # required to publish pending comments
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SECRET_KEY=sb_secret_... # server-only; never browser code
```

For Supabase, first run [20260721_review_harness.sql](../supabase/migrations/20260721_review_harness.sql) in the project SQL editor. The secret key belongs only in the API host; the publishable key is not sufficient for this server persistence adapter.

Run and verify locally:

```bash
pnpm install
pnpm dev:api
pnpm --filter @review-story/api test
```

The test suite currently covers the fixture story endpoints and the new head-scoped session flow.

## Known boundaries / intentional follow-ups

- The analyzer is still fixture-backed; arbitrary repositories are not analyzed yet.
- Chat presently grounds answers in artifact evidence. Additional read-only GitHub/file tools can be introduced as explicit harness functions as the real analyzer arrives.
- The extension has not yet adopted session endpoints, by ownership decision.
- Hosted API deployment (for example Railway) remains to be configured after Supabase credentials and deployment access are available.
- The harness currently supports the personal single-user workflow; production OAuth and multi-user authorization are not implemented.
