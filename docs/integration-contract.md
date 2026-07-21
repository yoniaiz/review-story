# Integration contract

The hackathon rule is simple: analysis is shared and reviewer-neutral; reviewer state and conversations are private and owned by the agent/chat harness.

## Layer ownership

The three layers have deliberately different responsibilities:

| Layer | Owner | Responsibilities | Must not own |
|---|---|---|---|
| Frontend | Chrome extension (`apps/extension`) | Rendering, user input, and GitHub page synchronization | Review orchestration, durable reviewer state, or analysis decisions |
| Agent / chat harness | Backend (`apps/api`) | Reviewer session, current review chapter/progress, conversation history, chat/tool orchestration, analysis requests, persistence, and GitHub integration | The implementation details of PR analysis |
| Analysis layer | Analyzer (`packages/analyzer`) | Produce and stream validated, reviewer-neutral PR analysis | Reviewer identity/state, chat history, or navigation decisions |

The harness is the sole boundary between the extension and the analysis layer. It may combine a `StoryArtifact` with private session state when responding to the extension, but it must never write that state back into the shared artifact.

## Frozen artifact

The canonical example is `fixtures/mock-artifact.json`. Its runtime schema and inferred TypeScript types live in `packages/contracts/src/index.ts`.

The artifact contains only shared analysis:

- metadata and version numbers
- executive summary with evidence
- tracks, entry points, flow nodes, and reading order
- chapters, files, scrutiny prompts, related-test search facts, and attention levels
- appendix files and deterministic reasons

Do not add visited state, current chapter, reviewer identity, comment drafts, checkpoints, conversation history, or NEW/UPDATED badges to the artifact. Those belong to the harness's `UserReviewSession`, chat state, or a per-request delta response.

## Analyzer boundary

`Analyzer` has two methods:

```ts
interface Analyzer {
  analyze(
    request: AnalyzeRequest,
    context?: AnalyzerContext,
  ): Promise<StoryArtifact>;
  stream(
    request: AnalyzeRequest,
    context?: AnalyzerContext,
  ): AsyncIterable<StoryStreamEvent>;
}
```

The initial `StaticAnalyzer` proves the full path. The analysis-layer owner can replace its internals stage by stage while continuing to return the same types. Long-running model/provider calls must propagate `context.signal`; the harness aborts it when the SSE consumer disconnects. Invalid fixture or model output fails at `StoryArtifactSchema.parse`, before it reaches the harness or UI.

## Agent / chat harness boundary

The backend is an agent/chat harness, not a pass-through analyzer API. It exposes the artifact as both a normal response and an SSE stream, which makes the final artifact easy to inspect while the UI can progressively render cold generation. It also owns the reviewer session that determines the current review chapter, visited progress, conversation history, and the context supplied to chat/tool calls.

The current story endpoints are the frozen analysis transport. Session-aware review and chat endpoints may evolve around them, but they must consume validated analysis and keep private state outside `StoryArtifact`.

SSE event names and payloads:

| Event | Payload | Meaning |
|---|---|---|
| `story.skeleton` | `StorySkeleton` | Tracks and provisional chapter titles are available |
| `story.chapter` | `Chapter` | One complete chapter is ready |
| `story.ready` | `StoryArtifact` | Final validated artifact and order |
| `story.error` | `{ message }` | Generation failed |

## Frontend boundary

The side panel imports the same fixture as its zero-backend fallback. In live mode it talks only to the agent/chat harness, validates all received events before applying them, and communicates with the GitHub content script through two messages:

```ts
{ type: "review-story:navigate", path: string, line?: number }
{ type: "review-story:visible-file", path: string }
```

Keep direct GitHub DOM work inside `apps/extension/entrypoints/content.ts`. The React panel should only send or receive these messages, which keeps UI iteration independent of the sync spike.
