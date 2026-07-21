# Tracer bullet: real PR to valid artifact with zero AI

> GitHub: https://github.com/yoniaiz/review-story/issues/4
> Status: **Complete**

## What to build

The feasibility-gate slice: point the existing CLI harness at a real GitHub PR and print a schema-valid story artifact, with no model calls. Fetch PR metadata, per-file patches, and the head-commit tarball in parallel (PAT from environment); extract the tarball to the per-repo-per-SHA workspace with a size guard and symlink-safe reads; build a minimal manifest (per-file stats, rule-based noise detection, path-heuristic role tags); assemble deterministically into one "all changes" chapter plus a reasoned appendix; validate against the frozen artifact schema; return the diff snapshot and (empty) usage alongside. After this slice, every later slice just swaps one deterministic piece for a real one while the CLI stays green.

## Parent

#1

## Acceptance criteria

- [x] CLI invoked with owner/repo/PR number prints a schema-valid artifact for a real GitHub PR
- [x] Noise files land in the appendix with per-file reasons; all other changed files are in the single chapter
- [x] Workspace materialized at the predictable per-repo-per-SHA path; oversized repos warn and skip the tarball
- [x] Analyzer returns artifact plus diff snapshot (per-file path, status, patch hash, stats) plus usage, with no storage side effects
- [x] GitHub token read from environment only; never persisted

## Blocked by

- #2

---

**Complete (2026-07-21):** Tracer-bullet target PR — https://github.com/itayfry/king-of-tokens/pull/1 (Add token shop and local leaderboard; ~95 changed files including lockfile/generated noise for the appendix).
