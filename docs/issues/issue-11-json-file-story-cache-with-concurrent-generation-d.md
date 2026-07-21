# JSON-file story cache with concurrent-generation dedup

> GitHub: https://github.com/yoniaiz/review-story/issues/11

## What to build

Persistence in the API layer, kept minimal: one JSON file per cache key (hash of repo node id, PR number, head OID, and analyzer/prompt/schema versions) storing artifact, diff snapshot, usage, and generation time. On request: cache hit streams the stored story instantly; miss runs the pipeline and writes the file; an in-memory map dedupes concurrent opens of the same PR into one generation job whose result both consumers receive. The analyzer itself stays storage-free. This delivers instant reopens, reviewer-B instant load, the demo pre-warm, and preserves the snapshot the delta stretch needs.

## Parent

#1

## Acceptance criteria

- [ ] Second open of an unchanged PR serves the cached story in under a second
- [ ] Cache key changes with head OID and any analyzer/prompt/schema version bump
- [ ] Two concurrent opens of the same cold PR trigger exactly one pipeline run
- [ ] Diff snapshot and usage persisted beside the artifact
- [ ] Unit tests for the cache module (hit/miss, key sensitivity, dedup) pass

## Blocked by

- #10
