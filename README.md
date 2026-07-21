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

On Twenty pull request `#22819`, the panel loads the bundled six-step Chapter 1 route and follows the visible GitHub file and selected line. Outside that golden-path PR it shows the contextual repository launcher. All UI, fixtures, fonts, and deterministic GitHub adapters build locally without the source repository.

The extracted composer includes the source branch's partial AI-chat experience. `/comment` prepares a grounded draft in GitHub's native inline composer without submitting it. General live AI responses still require the planned chat backend; the panel states that limitation explicitly.

## Three-person ownership

| Workstream | Primary directory | Safe independent command | Boundary |
|---|---|---|---|
| Frontend — Chrome extension | `apps/extension` | `pnpm dev:extension` | Presents the extracted Primer review experience and owns GitHub page synchronization |
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

Progressive stream (available for the next live-data and AI-chat integration; the extracted panel does not call it yet):

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

## Useful commands

```bash
pnpm dev                 # API + extension
pnpm dev:api             # backend only
pnpm dev:extension       # extension only, with mock fallback
pnpm analyze:mock        # print the validated artifact JSON
pnpm run check           # TypeScript checks for all workspaces
pnpm test                # extension context/drafting plus contract, analyzer, and API tests
pnpm build               # production API and Chrome extension builds
```

Copy `.env.example` to `.env` to override the demo repository, local API address, fixture path, or streaming delay. The defaults work without an env file. A non-local API also needs matching host permissions and `connect-src` in `apps/extension/wxt.config.ts`.

## What is intentionally stubbed

- The extracted extension uses the static Twenty `#22819` route for evidence-backed chat context; live review-plan and AI response wiring remain separate integration steps.
- The analyzer reads the original static fixture and simulates progressive generation.
- GitHub context, navigation, and exact diff anchors are implemented but still need the source roadmap's live selector smoke pass.
- `/comment` fills GitHub's native single-line composer but never submits; multi-line range drafting remains deliberately blocked pending live validation.
- Authentication, persistence, GitHub API calls, session-aware chat orchestration, and round-two/delta behavior remain separate hackathon slices.

Before sharing a branch, run `pnpm run check && pnpm test && pnpm build`.
