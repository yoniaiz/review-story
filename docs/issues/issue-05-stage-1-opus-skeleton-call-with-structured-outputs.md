# Stage 1: Sonnet skeleton call with structured outputs and cost logging

> GitHub: https://github.com/yoniaiz/review-story/issues/5
> Status: **Complete**

## What to build

The first AI call. Build the shared stage-runner wrapper — structured outputs enforced against stage-level zod schemas, one retry on failure, per-call usage accounting — and use it for Stage 1: the strong model receives the full manifest plus PR title/body and returns tracks, chapters with member files, and appendix confirmations (plus up to ten context requests, resolved in a later slice). Code validates that every changed file lands in exactly one chapter or the appendix; on residual failure after one re-prompt, unplaced files go to a code-generated misc chapter. The CLI now prints real multi-chapter groupings (chapter cards remain deterministic stats-only until Stage 2) and a per-stage token/dollar summary each run.

## Parent

#1

## Acceptance criteria

- [x] Chapters, tracks, and appendix come from the model via structured outputs validated by a stage-level zod schema
- [x] Every changed file appears in exactly one chapter or the appendix; violation triggers one re-prompt, then a misc chapter
- [x] Model IDs and settings come from configuration, not code
- [x] CLI prints per-stage token counts and dollar cost each run
- [x] A stage-runner failure after retry degrades gracefully (single-chapter fallback), never crashes the run

## Blocked by

- #4

---

**Complete (2026-07-21):** Live Stage-1 smoke passed against `itayfry/king-of-tokens#1` in one call with structured output. Stage 1 is now configured to use Sonnet for faster, cheaper demo runs.
