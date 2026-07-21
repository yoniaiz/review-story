# Stage 2: parallel chapter passes with evidence-anchor validation

> GitHub: https://github.com/yoniaiz/review-story/issues/7

## What to build

The cost-center stage. For each Stage-1 chapter, one mid-model call (concurrency capped, configurable, ~5) receives only that chapter's diffs, trimmed file contents, and the Stage-1 outline, and returns the chapter card: summary, scrutiny hints, per-file one-liners with anchor hunks, attention level (raise-only above the floor), related-tests note — every claim tagged observed/inferred with file:line evidence. After each call, mechanical anchor validation runs in code: cited paths must be changed or context files, line ranges are clamped to actual file length, anchors that miss are dropped, and claims with no surviving anchors are removed. A chapter whose call fails after one retry degrades to a deterministic stats-only card; the story always completes. Chapter events are emitted per-completion once streaming lands.

## Parent

#1

## Acceptance criteria

- [ ] Chapter cards contain model-written summaries, scrutiny hints, and per-file notes with anchors
- [ ] Every surviving claim has at least one anchor pointing at a changed/context file with an in-bounds line range
- [ ] Claims with no valid anchors are dropped; drop counts logged per run
- [ ] A failed chapter call yields a stats-only card and the artifact still validates
- [ ] Calls run in parallel under the configured concurrency cap
- [ ] Fixture-driven unit tests for the anchor validator pass

## Blocked by

- #5
- #6
