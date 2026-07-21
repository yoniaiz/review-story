# Streaming: real pipeline behind the SSE endpoint

> GitHub: https://github.com/yoniaiz/review-story/issues/10

## What to build

Implement the analyzer's streaming path with real timing and wire it through the existing API SSE endpoint. The skeleton event (relaxed schema) is emitted immediately after Stage 1; each chapter event fires the moment its Stage-2 call resolves, in completion order, matched by chapter id; the ready event after Stage 3 carries the final validated artifact with authoritative order. The abort signal propagates into in-flight SDK calls so a disconnected SSE consumer stops paying for generation. Demoable in the actual side panel against a real PR.

## Parent

#1

## Acceptance criteria

- [ ] Skeleton event emitted right after Stage 1 and validates against the relaxed skeleton schema
- [ ] Chapter events emitted per-completion (out of order is fine) and carry chapter ids the skeleton announced
- [ ] Ready event carries the final artifact with authoritative order
- [ ] Closing the SSE connection aborts in-flight model calls
- [ ] Side panel renders the progressive story on a real PR end-to-end

## Blocked by

- #9
