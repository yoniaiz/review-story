# Integration contract

The hackathon rule is simple: the artifact is shared; reviewer state is private.

## Frozen artifact

The canonical example is `fixtures/mock-artifact.json`. Its runtime schema and inferred TypeScript types live in `packages/contracts/src/index.ts`.

The artifact contains only shared analysis:

- metadata and version numbers
- executive summary with evidence
- tracks, entry points, flow nodes, and reading order
- chapters, files, scrutiny prompts, related-test search facts, and attention levels
- appendix files and deterministic reasons

Do not add visited state, current chapter, reviewer identity, comment drafts, checkpoints, or NEW/UPDATED badges to the artifact. Those belong to a future `UserReviewSession` or a per-request delta response.

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

The initial `StaticAnalyzer` proves the full path. The analyzer owner can replace its internals stage by stage while continuing to return the same types. Long-running model/provider calls must propagate `context.signal`; the API aborts it when the SSE consumer disconnects. Invalid fixture or model output fails at `StoryArtifactSchema.parse`, before it reaches the API or UI.

## API boundary

The backend exposes the artifact as both a normal response and an SSE stream. This makes the final artifact easy to inspect while the UI can progressively render cold generation.

SSE event names and payloads:

| Event | Payload | Meaning |
|---|---|---|
| `story.skeleton` | `StorySkeleton` | Tracks and provisional chapter titles are available |
| `story.chapter` | `Chapter` | One complete chapter is ready |
| `story.ready` | `StoryArtifact` | Final validated artifact and order |
| `story.error` | `{ message }` | Generation failed |

## Frontend boundary

The side panel imports the same fixture as its zero-backend fallback. It validates all live events before applying them and communicates with the GitHub content script through two messages:

```ts
{ type: "review-story:navigate", path: string, line?: number }
{ type: "review-story:visible-file", path: string }
```

Keep direct GitHub DOM work inside `apps/extension/entrypoints/content.ts`. The React panel should only send or receive these messages, which keeps UI iteration independent of the sync spike.
