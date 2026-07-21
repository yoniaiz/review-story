# PRD: WS1 Analyzer — real story-generation pipeline

> GitHub: https://github.com/yoniaiz/review-story/issues/1

## Problem Statement

Review Story's side panel needs a real story to render. Today the backend's analyzer is a stub (`StaticAnalyzer`) that streams a hand-written fixture — the panel, sync, ghost comments, and chat all work, but only against one fake PR. A reviewer opening any real pull request gets nothing: no chapters, no reading order, no attention guidance. Until the analyzer actually reads a PR and produces the story artifact, the product's core hypothesis — guided reading that drives the native GitHub diff — cannot be demonstrated on real code.

## Solution

Replace the static analyzer's internals with the real three-AI-call pipeline behind the existing `Analyzer` seam, keeping every type unchanged so the API and extension keep working untouched.

Deterministic code (Stage 0) fetches the PR and repo snapshot from GitHub and compresses every changed file into a compact manifest row. One strong-model call (Stage 1) groups the manifest into chapters and tracks. Code resolves any bounded context requests (Stage 1.5). N parallel mid-model calls (Stage 2) write each chapter card with evidence-anchored claims. One strong-model call (Stage 3) decides reading order, entry points, and flow. Code assembles, validates, and streams the result — skeleton in ~10 seconds, chapters as they finish, final artifact at the end. Failures degrade to deterministic fallbacks instead of killing the story. A JSON-file cache in the API layer makes repeat opens instant and preserves the diff snapshot that future delta regeneration needs.

## User Stories

1. As a reviewer, I want a story generated from the actual PR I'm looking at, so that the guided walkthrough reflects real code instead of a fixture.
2. As a reviewer, I want the story skeleton to appear within ~10 seconds of opening the panel, so that I can start orienting before full generation completes.
3. As a reviewer, I want chapter cards to stream in as they finish, so that I can begin reading early chapters while later ones are still generating.
4. As a reviewer, I want related files grouped into coherent chapters, so that I don't reconstruct the change's structure from an alphabetical file list.
5. As a reviewer, I want lockfiles, generated code, and mechanical noise pre-binned into an appendix, so that my attention budget is spent on meaningful changes.
6. As a reviewer, I want each chapter to carry an attention level (Deep read / Standard / Skim) with stated reasons, so that I know where scrutiny matters most.
7. As a reviewer, I want auth-, payment-, security-, and migration-related files to never be rated below Standard regardless of what the model thinks, so that trust-critical code is never waved through.
8. As a reviewer, I want every AI claim to cite a file and line range that actually exists in the diff, so that I can verify any statement with one click.
9. As a reviewer, I want claims whose citations don't check out to be dropped rather than shown, so that I never act on a hallucinated statement.
10. As a reviewer, I want each chapter to tell me whether any test files reference its changed symbols, so that I know what's exercised and what isn't — stated as a search fact, not a judgment.
11. As a reviewer, I want per-file one-liners inside each chapter, so that I know what each file contributes before opening it.
12. As a reviewer, I want "what to scrutinize" hints per chapter, so that my review starts from the riskiest questions.
13. As a reviewer, I want a recommended reading order with a rationale, so that I read the change in dependency order rather than alphabetically.
14. As a reviewer, I want entry points per persona (backend / frontend), so that I can start the walkthrough from the side of the stack I know best.
15. As a reviewer, I want an executive summary of the whole PR with evidence, so that I understand the change's intent in thirty seconds.
16. As a reviewer, I want a degraded but usable story when a chapter's AI call fails, so that one flaky model response doesn't cost me the whole walkthrough.
17. As a reviewer, I want reopening the panel on an unchanged PR to load instantly from cache, so that I never pay the generation wait twice.
18. As a second reviewer on the same PR, I want the story my colleague's open already generated to load instantly, so that generation cost is paid once per PR, not per person.
19. As the analyzer developer, I want to run the whole pipeline from a terminal command that prints the artifact JSON, so that my edit-test loop is seconds and needs no server or browser.
20. As the analyzer developer, I want each pipeline run to print a per-stage token and dollar summary, so that I can see cost drift immediately.
21. As the analyzer developer, I want the pipeline to be a pure function with no storage side effects, so that I can test and run it anywhere without setup.
22. As the analyzer developer, I want structured outputs enforced against zod schemas at the API boundary, so that malformed model JSON is prevented rather than parsed and patched.
23. As the analyzer developer, I want stage-level schemas separate from the frozen artifact schema, so that prompt iteration never risks breaking the team contract.
24. As the analyzer developer, I want model IDs and concurrency in configuration, so that swapping models needs no code change.
25. As the API developer, I want the analyzer to return the artifact plus the diff snapshot plus usage, so that I can persist a complete story snapshot without reaching into pipeline internals.
26. As the API developer, I want concurrent opens of the same PR deduplicated to one generation job, so that two reviewers don't trigger two paid runs.
27. As the API developer, I want generation aborted when the SSE consumer disconnects, so that abandoned panel opens don't burn tokens.
28. As the extension developer, I want the skeleton event to contain only what Stage 1 actually knows (tracks with ids, titles, provisional chapter order; chapter titles; appendix), so that the panel renders honest provisional structure instead of fabricated entry points and flows.
29. As the extension developer, I want chapter events matched by stable chapter id, so that out-of-order streaming fills the right cards.
30. As the extension developer, I want the final ready event to carry the complete validated artifact with authoritative order, so that the panel can reconcile provisional state in one step.
31. As the demo presenter, I want the demo PR's story pre-generated and cached, so that the live demo opens instantly and cannot be sunk by a cold-generation failure.
32. As the demo presenter, I want generation to never hard-fail on a single model error, so that the live demo survives a flaky call.
33. As a teammate on WS4 (chat), I want the repo snapshot materialized at a predictable workspace path with safe file access, so that the chat engine can reuse the same checkout instead of re-downloading.
34. As the team, I want the diff snapshot stored beside every generated story, so that round-2 "what changed since your review" remains buildable later without retroactive GitHub queries (which the API cannot answer).
35. As the team, I want oversized PRs guarded (repo size cap, file-count cap with a directory-level fallback), so that a pathological PR degrades predictably instead of exploding cost.

## Implementation Decisions

**Pipeline architecture.** Five stages behind the existing `Analyzer` seam. Stage 0: deterministic prep in code — parallel fetch of PR metadata, per-file patches, and the head-SHA tarball; noise detection by rule list; per-file stats; path-heuristic role tags; deterministic attention floors (migrations/auth/payment/security never below Standard; generated/mechanical default Skim; the model may raise, never lower); tree-sitter symbol extraction for TS/TSX with regex fallback; import edges among changed files only; grep-based test↔source mapping; diff snapshot construction. Stage 1: one strong-model call over the full manifest (~130 tokens/file) plus PR title/body, returning tracks, chapters with member files, appendix confirmations, and ≤10 context requests; code validates every file lands in exactly one chapter or the appendix. Stage 1.5: bounded context fetch from the workspace (≤10 files, one round, no loop). Stage 2: one mid-model call per chapter in parallel (concurrency cap ~5), each seeing only its chapter's diffs, trimmed contents, and the Stage-1 outline. Stage 3: one strong-model call over chapter summaries producing reading order, entry points, flows, and the exec summary.

**Deferred from Stage 0:** hunk-pattern clustering and import out-edges to unchanged files — the team-controlled demo PR will not exercise them; the >300-file directory-level fallback covers pathological cases.

**Models.** Stage 1 and Stage 3: `claude-opus-4-8` (structure errors contaminate everything downstream; the calls are single and cheap). Stage 2: `claude-sonnet-5` (the N-call cost center). `claude-haiku-4-5` reserved for the delta routing call if the stretch goal lands. Model IDs and the concurrency cap live in configuration.

**Structured output.** Every AI call uses the Anthropic SDK's structured outputs (`messages.parse` with zod-derived output format). Three new stage-level zod schemas live in the analyzer package, separate from the frozen artifact schema in the contracts package; deterministic code maps stage outputs into the final artifact.

**Failure policy: degrade, never fail.** Every AI call retries once. Stage 1 residual failures put unplaced files in a code-generated misc chapter. A failed Stage 2 call yields a deterministic stats-only chapter card (files, hunk counts, attention at floor, no AI claims). A failed Stage 3 yields code-synthesized fallbacks: Stage-1 chapter order, one generic entry point, a linear flow derived from chapter order. `story.error` is reserved for total failures such as GitHub being unreachable.

**Evidence anchor validation.** Mechanical, in code, after Stages 2 and 3: every cited path must be a changed file or a Stage-1.5 context file; line ranges are clamped to actual file length; anchors that miss entirely are dropped; a claim that loses all anchors is removed from the artifact (the schema requires at least one anchor per claim). Semantic verification stays manual on the demo PR.

**Streaming contract.** `story.skeleton` emitted after Stage 1; `story.chapter` emitted the moment each Stage-2 call resolves, in completion order, matched by chapter id; `story.ready` after Stage 3 with the final validated artifact and authoritative order. The abort signal from the analyzer context propagates into in-flight SDK calls.

**Contract changes to negotiate with the team (do first, while the UI is mock-driven).** (1) Relax the skeleton schema: skeleton tracks become id, title, and provisional chapter order; entry points and flow become absent until the ready event — Stage 1 cannot honestly produce them. (2) The analyzer exposes a richer result alongside the artifact: diff snapshot and usage/cost, so the API can persist a complete story snapshot.

**Persistence.** None inside the analyzer — it is a pure function. The API layer caches `{artifact, diffSnapshot, generatedAt}` as one JSON file per cache key (hash of repo node id, PR number, head OID, and analyzer/prompt/schema versions), with an in-memory map deduplicating concurrent generations. No SQLite for the hackathon; the file store swaps for a database behind the same read/write functions later.

**Workspace.** Tarball extracted to a per-repo-per-SHA temp workspace with a size guard and symlink-safe reads; built as a small module intended for reuse by the chat workstream.

**Demo target.** A team-controlled TypeScript repository with a prepared ~80-file PR, a planted issue, and a prepared follow-up commit. Symbol extraction ships for TS/TSX only.

**Cost/eval.** Each SDK call's usage is summed into a per-run, per-stage token and dollar summary printed by the CLI harness and stored beside the cache entry. Quality assurance is reading the demo PR's generated story by hand before demo day; zod validation gates every artifact.

**Build order.** (1) Real pipeline runnable from the existing CLI harness — the feasibility gate; (2) wire behind the `Analyzer` seam so SSE works unchanged; (3) JSON-file cache in the API; (4) stretch: delta classification and scoped regeneration from stored snapshots.

## Testing Decisions

Tests assert external behavior through each module's public interface — inputs in, outputs out — never internal call sequences or private helpers. Prior art: the existing contracts and analyzer test suites (vitest, fixture-driven) are the pattern to follow.

Unit-tested modules (pure or near-pure, fixture-driven):

- **manifest-builder** — noise rules classify known filenames; role tags from paths; attention floors for auth/migration paths; import-edge extraction from sample sources; test↔source mapping against a fixture tree.
- **symbol-extractor** — diff hunks map to the enclosing function/class in TS/TSX fixtures; regex fallback engages for non-TS files.
- **anchor-validator** — valid anchors pass; unknown paths are dropped; overshooting line ranges are clamped; claims with no surviving anchors are removed.
- **assembler** — stage outputs produce a schema-valid artifact; unplaced files land in a misc chapter; a failed chapter yields a stats-only card; a failed synthesis yields the deterministic fallback order/entry point/flow; attention never falls below floor.
- **diff-snapshot** — stable per-file records including patch hashing.
- **story-cache** — hit/miss behavior, key sensitivity to head OID and versions, concurrent-request dedup.

Not unit-tested (verified via CLI runs against the demo repo): github-fetcher, workspace, stage-runners, pipeline orchestration. LLM calls are not mocked for the hackathon.

## Out of Scope

- Delta regeneration, round-2 screens, and checkpoint logic (stretch; the diff snapshot is stored to keep it possible).
- Hunk-pattern clustering and import out-edges to unchanged files.
- SQLite/Drizzle persistence, Postgres, queues, webhooks, and pre-generation.
- Ghost comments, panel↔GitHub sync, chat engine, flow-map UI (other workstreams).
- Non-TypeScript tree-sitter grammars; GitLab; multi-user OAuth (PAT only).
- LLM-judge evaluation rubrics and semantic anchor verification passes.
- Reviewer-relative state of any kind inside the artifact (visited, NEW/UPDATED, checkpoints) — per the integration contract, those never live in the shared story.

## Further Notes

- The artifact schema is the frozen team contract; the two negotiated changes (skeleton relaxation, richer analyzer result) are the only contract edits and should land before UI work hardens against the current mock.
- Cost envelope from the design: small PR $0.10–0.30; 80-file PR ≈ $1–2, 60–90 s cold, ~10 s to skeleton; warm cache <1 s. The per-run cost log verifies this stays true.
- The GitHub PAT arrives via environment configuration; tokens are never persisted by the analyzer.
- Repository content, PR descriptions, and diffs are untrusted input to prompts; prompts must instruct models to treat embedded instructions as data.
