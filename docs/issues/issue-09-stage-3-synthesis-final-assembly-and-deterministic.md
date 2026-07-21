# Stage 3: synthesis, final assembly, and deterministic fallbacks

> GitHub: https://github.com/yoniaiz/review-story/issues/9

## What to build

The closing AI call and the assembler's last responsibilities. The strong model receives all chapter summaries and returns the reading order with rationale, per-persona entry points, track flow arrays, the executive summary, and cross-chapter observations. Code assembles the complete artifact, enforces every cross-reference (chapter ids in tracks/flows/entry points), and validates against the frozen schema. If synthesis fails after one retry, code synthesizes fallbacks: Stage-1 chapter order, one generic entry point, and a linear flow derived from chapter order — the story ships regardless. After this slice the CLI prints a complete, real story for the demo PR.

## Parent

#1

## Acceptance criteria

- [ ] Reading order, entry points, flows, and exec summary come from the model and pass full artifact validation including cross-references
- [ ] Synthesis failure after retry produces the deterministic fallback order/entry-point/flow and the artifact still validates
- [ ] Attention levels in the final artifact never fall below their floors
- [ ] Fixture-driven unit tests for the assembler and diff-snapshot modules pass
- [ ] CLI prints a complete story for the demo PR with total run cost

## Blocked by

- #7
