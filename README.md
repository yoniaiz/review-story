# Review Story

Hackathon starter for a Chrome side panel that turns a GitHub pull request into a guided reading order. The repository follows the architecture in [review-story-design.md](./review-story-design.md), with a frozen analysis contract connecting the extension, the agent/chat harness, and the analysis layer.

## Start in two commands

Requirements: Node 22+ and pnpm 11+.

```bash
pnpm install
pnpm dev
```

This starts:

- the Fastify API at `http://127.0.0.1:8787`
- WXT in Chrome development mode

To load a production build manually, run `pnpm build`, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `apps/extension/.output/chrome-mv3`.

The panel always boots with [fixtures/mock-artifact.json](./fixtures/mock-artifact.json), so frontend work does not need the backend. When the API is running, it connects and consumes the simulated story stream.

## Three-person ownership

| Workstream | Primary directory | Safe independent command | Boundary |
|---|---|---|---|
| Frontend — Chrome extension | `apps/extension` | `pnpm dev:extension` | Presents the review and owns GitHub page synchronization; consumes harness responses and stream events |
| Agent / chat harness | `apps/api` | `pnpm dev:api` | The backend for the extension: orchestrates analysis and chat, owns the reviewer session, review chapters/progress, conversation history, persistence, and GitHub integration |
| Analysis layer | `packages/analyzer` | `pnpm analyze:mock` | Produces validated, reviewer-neutral `StoryArtifact` analysis through the `Analyzer` interface |

The harness is the only layer that combines reviewer state with analysis or decides the next review/chat action. The analysis layer must remain reviewer- and conversation-neutral; the extension must not recreate orchestration state locally.

Treat `packages/contracts` and `fixtures/mock-artifact.json` as frozen integration surfaces during the hackathon. Coordinate changes there before merging; ordinary work inside the three owned directories should not conflict.

## Repository map

```text
apps/
  api/          Agent/chat harness: Fastify API, session and orchestration boundary
  extension/    WXT + React Chrome side panel and GitHub content script
packages/
  analyzer/     Reviewer-neutral analysis adapter; replace its internals with the real pipeline
  contracts/    Zod schemas, TypeScript types, stream events, Analyzer seam
fixtures/
  mock-artifact.json  Canonical shared PR digest for parallel development
```

## Integration contracts

Final artifact:

```http
GET /api/prs/:owner/:repo/pulls/:pullNumber/story
```

Progressive stream:

```http
GET /api/prs/:owner/:repo/pulls/:pullNumber/story/stream
Content-Type: text/event-stream
```

The stream emits, in order:

1. `story.skeleton`
2. one or more `story.chapter`
3. `story.ready`

Failures use `story.error`. Every event contains `{ "type": "...", "data": ... }` and is validated by `StoryStreamEventSchema` in the extension.

The real analyzer should implement the existing `Analyzer` interface in `packages/contracts/src/index.ts`. The harness owns calling it, associating its result with a reviewer session, and exposing it to the extension; its API does not need to change when static generation is replaced.

## Agent / chat harness

The extension starts review explicitly: **Start review** creates (or resumes) a session for the configured PR head SHA, then connects to the session SSE stream. A different head SHA creates a fresh session. The harness owns selected/completed chapters, structured chat turns, evidence citations, and comment drafts.

For local development, sessions are in memory. For hosted persistence, run [`supabase/migrations/20260721_review_harness.sql`](./supabase/migrations/20260721_review_harness.sql) in a Supabase project, then set `SUPABASE_URL` and `SUPABASE_SECRET_KEY` on the API host. Set `OPENAI_API_KEY` for GPT-5.6 Terra chat and `GITHUB_PAT` for the explicit pending-review publish endpoint. These must be server-only environment variables. Set a random `HARNESS_ACCESS_TOKEN` to require a bearer token.

Chat uses the OpenAI Responses API with `gpt-5.6-terra`, `store: false`, and evidence validation. It can complete the current chapter through conversation; creating a GitHub pending-review comment always requires the separate confirmed publish endpoint.

## Useful commands

```bash
pnpm dev                 # API + extension
pnpm dev:api             # backend only
pnpm dev:extension       # extension only, with mock fallback
pnpm analyze:mock        # print the validated artifact JSON
pnpm run check           # TypeScript checks for all workspaces
pnpm test                # contract, analyzer, and API tests
pnpm build               # production API and Chrome extension builds
```

Copy `.env.example` to `.env` to override the demo repository, local API address, fixture path, or streaming delay. The defaults work without an env file. A non-local API also needs matching host permissions and `connect-src` in `apps/extension/wxt.config.ts`.

## What is intentionally stubbed

- GitHub navigation uses the native file/tree/hash fallback ladder, but still needs the design's spike against the chosen demo PR.
- The current analyzer reads the static fixture and simulates progressive generation; swap in a real analyzer behind the same seam.
- Hosted persistence requires a Supabase project and migration; local development intentionally uses an in-memory store.
- The harness is single-user and protects secrets server-side; production OAuth and multi-user authorization are still future work.

Before sharing a branch, run `pnpm run check && pnpm test && pnpm build`.
