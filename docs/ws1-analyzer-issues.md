# WS1 Analyzer — issue breakdown

Local copy of the tracer-bullet slices published to GitHub. Parent PRD: [issue #1](https://github.com/yoniaiz/review-story/issues/1) (local copy: [ws1-analyzer-prd.md](./ws1-analyzer-prd.md)). All issues carry the `ready-for-agent` label.

| Issue | Slice | Type | Blocked by |
|---|---|---|---|
| [#2](https://github.com/yoniaiz/review-story/issues/2) | Contracts: relax skeleton schema + `AnalyzeResult` | HITL (WS2 sign-off) | none |
| [#3](https://github.com/yoniaiz/review-story/issues/3) | Demo repo: team-controlled TS project with prepared 80-file PR | HITL | none |
| [#4](https://github.com/yoniaiz/review-story/issues/4) | Tracer bullet: real PR → valid artifact with zero AI | AFK | #2 |
| [#5](https://github.com/yoniaiz/review-story/issues/5) | Stage 1: Opus skeleton call with structured outputs + cost logging | AFK | #4 |
| [#6](https://github.com/yoniaiz/review-story/issues/6) | Manifest enrichment: symbols, import edges, test mapping, attention floors | AFK | #4 |
| [#7](https://github.com/yoniaiz/review-story/issues/7) | Stage 2: parallel chapter passes with evidence-anchor validation | AFK | #5, #6 |
| [#8](https://github.com/yoniaiz/review-story/issues/8) | Stage 1.5: bounded context fetch from the workspace | AFK | #7 |
| [#9](https://github.com/yoniaiz/review-story/issues/9) | Stage 3: synthesis, final assembly, deterministic fallbacks | AFK | #7 |
| [#10](https://github.com/yoniaiz/review-story/issues/10) | Streaming: real pipeline behind the SSE endpoint | AFK | #9 |
| [#11](https://github.com/yoniaiz/review-story/issues/11) | JSON-file story cache with concurrent-generation dedup | AFK | #10 |
| [#12](https://github.com/yoniaiz/review-story/issues/12) | Stretch: delta regeneration from stored snapshots | AFK | #11 |

## Key decisions (from the design interview)

- **Scope:** Stages 0→1→1.5→2→3 committed; snapshots stored from day one; delta regeneration is the stretch goal.
- **Demo target:** team-controlled repo — [itayfry/king-of-tokens](https://github.com/itayfry/king-of-tokens) (JavaScript/HTML); tree-sitter for TS/TSX/JS/JSX, regex fallback elsewhere. The ~80-file demo PR is still to be authored (tracked in #3).
- **Data:** tarball workspace at `/tmp/ws/{repo}/{sha}` from day one; shared with WS4's chat.
- **Stage 0 cut:** build fetch, noise, stats, roles, floors, symbols, changed-file import edges, test mapping, diff snapshot; defer hunk clustering and out-edges to unchanged files.
- **Models:** `claude-opus-4-8` for Stages 1 & 3, `claude-sonnet-5` for Stage 2 (~5 concurrent), `claude-haiku-4-5` reserved for delta routing. IDs in config.
- **Structured output:** `messages.parse` + zod stage schemas (separate from the frozen artifact schema).
- **Failure policy:** degrade, never fail — retry once, then misc chapter / stats-only card / deterministic synthesis fallback.
- **Anchors:** mechanically validated in code (path must be changed/context file, line ranges clamped, unverifiable claims dropped).
- **Streaming:** skeleton after Stage 1, chapters as they finish (matched by id), ready after Stage 3; abort propagates to SDK calls.
- **Persistence:** analyzer is a pure function returning `{artifact, diffSnapshot, usage}`; API caches to `cache/{hash}.json` with in-memory dedup. No SQLite for the hackathon.
- **Eval:** per-run per-stage token/$ log printed by the CLI; hand-read the demo PR's story before demo day.

## Contract changes to negotiate first (issue #2)

1. Relax `StorySkeletonSchema`: skeleton tracks become `{id, title, provisional chapter_order}`; `entry_points`/`flow` arrive only at `story.ready` (they are Stage-3 outputs).
2. Analyzer exposes a richer result: `{artifact, diffSnapshot, usage}` so the API can persist a complete story snapshot.
