# Review Story

Hackathon starter for a Chrome side panel that turns a GitHub pull request into an agent-guided review. The extension includes the Primer Chrome experience from [`erl-jpg/codex-hackathon-primer`](https://github.com/erl-jpg/codex-hackathon-primer), including its conversation UI, GitHub context tracking, fixture-backed evidence, review navigation, and safe `/comment` drafting flow.

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

On a pull request, Primer reads the current head SHA, creates or resumes a private review session, and streams the real analyzer's skeleton, chapter progress, and final evidence-backed story into the side panel. The bundled Twenty plan remains available as deterministic adapter/test data.

The composer uses the session-aware chat harness. `/comment` saves a private draft and requires a separate explicit confirmation before publishing it to GitHub's pending review.

## Three-person ownership

| Workstream | Primary directory | Safe independent command | Boundary |
|---|---|---|---|
| Frontend — Chrome extension | `apps/extension` | `pnpm dev:extension` | Presents the extracted Primer review experience and owns GitHub page synchronization |
| Agent / chat harness | `apps/api` | `pnpm dev:api` | The backend for the extension: orchestrates analysis and chat, owns the reviewer session, review chapters/progress, conversation history, persistence, and GitHub integration |
| Analysis layer | `packages/analyzer` | `pnpm analyze <owner> <repo> <pr>` | Produces validated, reviewer-neutral stories through the real staged `Analyzer` pipeline |

The harness is the only layer that combines reviewer state with analysis or decides the next review/chat action. The analysis layer must remain reviewer- and conversation-neutral; the extension must not recreate orchestration state locally.

Treat `packages/contracts` and `fixtures/mock-artifact.json` as frozen integration surfaces during the hackathon. Coordinate changes there before merging; ordinary work inside the three owned directories should not conflict.

## Repository map

```text
apps/
  api/          Agent/chat harness: Fastify API, session and orchestration boundary
  extension/    WXT + React Chrome side panel and GitHub content script
packages/
  analyzer/     GitHub prep + three-model-call story-generation pipeline
  contracts/    Zod schemas, TypeScript types, stream events, Analyzer seam
fixtures/
  mock-artifact.json  Canonical shared PR digest for parallel development
```

## Integration contracts

Final artifact:

```http
GET /api/prs/:owner/:repo/pulls/:pullNumber/story
```

Direct progressive analysis stream:

```http
GET /api/prs/:owner/:repo/pulls/:pullNumber/story/stream
Content-Type: text/event-stream
```

The side panel starts or resumes a head-scoped review session, then consumes the same validated events through `GET /api/review-sessions/:sessionId/events` so reviewer progress, chat turns, and drafts remain private.

The stream emits, in order:

1. `story.skeleton`
2. one or more `story.chapter`
3. `story.ready`

Failures use `story.error`. Every event contains `{ "type": "...", "data": ... }` and is validated by `StoryStreamEventSchema` in the extension.

The analyzer implements the existing `Analyzer` interface in `packages/contracts/src/index.ts`. It returns the shared artifact together with the immutable diff snapshot and per-stage usage. The harness owns caching that result, associating the artifact with reviewer sessions, and exposing it to the extension.

## Useful commands

```bash
pnpm dev                 # API + extension
pnpm dev:api             # backend only
pnpm dev:extension       # extension only
pnpm analyze <owner> <repo> <pr>  # print artifact JSON and usage/cost summary
pnpm analyze:tracer <owner> <repo> <pr>  # deterministic artifact, zero model calls
pnpm run check           # TypeScript checks for all workspaces
pnpm test                # extension context/drafting plus contract, analyzer, and API tests
pnpm build               # production API and Chrome extension builds
```

Copy `.env.example` to `.env` to configure GitHub/Anthropic credentials, models, analyzer limits, cache/workspace paths, and the demo repository. Public GitHub repositories work without a GitHub token, and a missing Anthropic key deliberately uses deterministic fallbacks. A non-local API also needs matching host permissions and `connect-src` in `apps/extension/wxt.config.ts`.

## What remains outside this slice

- GitHub context, navigation, and exact diff anchors are implemented but still need the source roadmap's live selector smoke pass.
- Multi-line range drafting remains deliberately blocked pending live validation.
- Hosted persistence requires a Supabase project and migration; local development intentionally uses an in-memory store.
- The harness is single-user and protects secrets server-side; production OAuth and multi-user authorization are still future work.
- Round-two/delta regeneration remains a separate stretch slice. Story persistence is the API-owned JSON cache under `.review-story/cache` by default.

Before sharing a branch, run `pnpm run check && pnpm test && pnpm build`.
