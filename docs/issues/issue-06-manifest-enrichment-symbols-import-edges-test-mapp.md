# Manifest enrichment: symbols, import edges, test mapping, attention floors

> GitHub: https://github.com/yoniaiz/review-story/issues/6
> Status: **Complete**

## What to build

Upgrade the manifest from paths-and-stats to the full grouping signal set. tree-sitter parses changed TS/TSX files and maps each diff hunk to its enclosing function/class (regex fallback for other file types); import statements of changed files yield edges among files in the PR ("imported by N files in this PR"); a grep over the workspace's test directories records which test files reference the changed symbols (a search fact for the related-tests field); deterministic attention floors are computed (migration/auth/payment/security paths never below Standard, generated/mechanical default Skim). Runs in parallel with the Stage-1 slice; richer rows visibly improve grouping quality on the demo PR.

## Parent

#1

## Acceptance criteria

- [x] Changed symbols extracted per file for TS/TSX/JS/JSX via tree-sitter; regex fallback engages for other extensions
- [x] Import edges among changed files present in manifest rows
- [x] Related-tests search facts produced per file with the searched scope recorded
- [x] Attention floors computed deterministically and carried through to chapter assembly (model may raise, never lower)
- [x] Fixture-driven unit tests for the manifest builder and symbol extractor pass

## Blocked by

- #4
