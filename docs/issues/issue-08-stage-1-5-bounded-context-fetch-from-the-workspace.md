# Stage 1.5: bounded context fetch from the workspace

> GitHub: https://github.com/yoniaiz/review-story/issues/8

## What to build

Resolve Stage 1's context requests. Up to ten requested files are read from the workspace and reduced to tree-sitter skeletons (signatures/structure, not bodies), capped at roughly 20k tokens total, one round, no loop. The skeletons are included in the relevant Stage-2 prompts so chapter cards can reference surrounding context; anchors citing context files are already legal per the anchor validator. Missing or unparseable files are skipped gracefully.

## Parent

#1

## Acceptance criteria

- [ ] Stage-1 context requests resolved as skeletons from the workspace, capped at ten files / ~20k tokens, single round
- [ ] Skeletons included in Stage-2 prompts for the chapters that requested them
- [ ] Missing or binary files skipped without failing the run
- [ ] Demo-PR run shows Stage 2 consuming context (verified via CLI output/log)

## Blocked by

- #7
