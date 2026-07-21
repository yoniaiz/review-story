# Review Story

Hackathon starter for a Chrome side panel that turns a GitHub pull request into a guided reading order. The repository follows the architecture in [review-story-design.md](./review-story-design.md), with one frozen JSON contract separating the three team workstreams.

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
| Frontend + GitHub page sync | `apps/extension` | `pnpm dev:extension` | Consumes `StoryArtifact` and SSE events |
| Backend + GitHub integration | `apps/api` | `pnpm dev:api` | Serves the shared contract; owns auth, storage, GitHub APIs |
| Agentic PR analysis | `packages/analyzer` | `pnpm analyze:mock` | Implements the `Analyzer` interface and returns validated artifacts |

Treat `packages/contracts` and `fixtures/mock-artifact.json` as frozen integration surfaces during the hackathon. Coordinate changes there before merging; ordinary work inside the three owned directories should not conflict.

## Repository map

```text
apps/
  api/          Fastify REST + SSE service
  extension/    WXT + React Chrome side panel and GitHub content script
packages/
  analyzer/     Static analyzer adapter; replace its internals with the real pipeline
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

The real analyzer should implement the existing `Analyzer` interface in `packages/contracts/src/index.ts`. The API does not need to change when static generation is replaced.

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

- The analyzer reads the static fixture and simulates progressive generation.
- GitHub navigation uses the native file/tree/hash fallback ladder, but still needs the design's spike against the chosen demo PR.
- **Copy comment** works; **Stage** is visibly reserved for the backend pending-review API.
- Authentication, persistence, GitHub API calls, chat, and round-two/delta behavior remain separate hackathon slices.

Before sharing a branch, run `pnpm run check && pnpm test && pnpm build`.
