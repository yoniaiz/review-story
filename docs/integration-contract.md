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

`Analyzer` has three methods:

```ts
interface Analyzer {
  identify(
    request: AnalyzeRequest,
    context?: AnalyzerContext,
  ): Promise<StoryCacheIdentity>;
  analyze(
    request: AnalyzeRequest,
    context?: AnalyzerContext,
  ): Promise<AnalyzeResult>;
  stream(
    request: AnalyzeRequest,
    context?: AnalyzerContext,
  ): AsyncIterable<StoryStreamEvent>;
}
```

`AnalyzeResult` contains `{ artifact, diff_snapshot, usage }`. The richer value stays behind the API boundary so the API can persist a complete generation snapshot while the REST and SSE payloads remain artifact-focused. `identify` resolves the repo node id, head OID, PR, and versions needed for a cache lookup without running generation.

Long-running GitHub and model calls propagate `context.signal`; the harness aborts a shared generation job when its final consumer disconnects. Invalid final output fails at `StoryArtifactSchema.parse` before it reaches the harness or UI. `StaticAnalyzer` remains available only as a test/fixture adapter.

## Agent / chat harness boundary

The backend is an agent/chat harness, not a pass-through analyzer API. It exposes the artifact as both a normal response and an SSE stream, which makes the final artifact easy to inspect while the UI can progressively render cold generation. It also owns the reviewer session that determines the current review chapter, visited progress, conversation history, and the context supplied to chat/tool calls.

The current story endpoints are the frozen analysis transport. Session-aware review and chat endpoints may evolve around them, but they must consume validated analysis and keep private state outside `StoryArtifact`.

SSE event names and payloads:

| Event | Payload | Meaning |
|---|---|---|
| `story.skeleton` | `StorySkeleton` | Track ids/titles/provisional chapter order, chapter titles, and appendix are available; entry points and flow are intentionally absent |
| `story.chapter` | `Chapter` | One complete chapter is ready |
| `story.ready` | `StoryArtifact` | Final validated artifact and order |
| `story.error` | `{ message }` | Generation failed |

## Frontend boundary

The side panel talks only to the agent/chat harness. It creates or resumes a review session for the visible PR head, validates every streamed story event before applying it, and converts the final shared artifact into Primer's review-plan view. Reviewer progress, chat turns, and drafts stay in the session response rather than the artifact.

GitHub DOM work remains in the content script. The extension uses the validated `primer:*` message protocol, including:

```ts
{ type: "primer:context-observed", context: GitHubPageContext }
{ type: "primer:navigate-file", path: string }
{ type: "primer:draft-comment", anchor: DiffAnchor, body: string }
```

Keep direct GitHub DOM work inside `apps/extension/entrypoints/content.ts`. The React panel should only send or receive these messages, which keeps UI iteration independent of the sync spike.
