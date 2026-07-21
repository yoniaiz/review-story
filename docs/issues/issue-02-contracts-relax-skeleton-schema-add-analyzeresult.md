# Contracts: relax skeleton schema + add AnalyzeResult

> GitHub: https://github.com/yoniaiz/review-story/issues/2

## Parent

#1

## What to build

Two negotiated contract changes, landed while the UI is still mock-driven. First, relax the story-skeleton schema to match what Stage 1 can honestly produce: skeleton tracks carry only id, title, and a provisional chapter order — entry points and flow become absent until the final ready event (they are Stage-3 outputs). The final artifact schema is unchanged. Second, add a richer analyzer result type — artifact plus diff snapshot plus usage/cost — so the API layer can persist a complete story snapshot without reaching into pipeline internals. Update the static analyzer, the mock-fixture path, and existing tests so the current mock-driven flow keeps working end-to-end. Requires WS2 sign-off since the skeleton event shape changes.

## Acceptance criteria

- [ ] Skeleton schema no longer requires entry points or flow; skeleton tracks are id, title, and provisional chapter order
- [ ] Final artifact schema is byte-for-byte unchanged
- [ ] A new analyzer result type (artifact, diff snapshot, usage) is exported from the contracts package
- [ ] StaticAnalyzer emits a valid relaxed skeleton and all existing contract/analyzer/API tests pass
- [ ] WS2 sign-off recorded as a comment on this issue

## Blocked by

None - can start immediately
