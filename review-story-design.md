# Review Story — PRD & Technical Design (v2 · Hackathon Build)

**Status:** v2, revised after external design review · team hackathon build → ship → present
**Platform:** GitHub only · Chrome only
**Read order:** §1–5 product story · §6–13 technical design · §14 hackathon build plan & demo script · §16 decision log (the *why* behind every choice).

---

## 1. What this is

Review Story turns reviewing a large GitHub pull request into a guided, ordered walkthrough — **inside GitHub's own UI**. A Chrome side panel tells the reviewer where to start, what order to read in, what each cluster of files does, and what deserves scrutiny. It drives the native Files Changed page as the reviewer moves, keeps a "you are here" marker honest as they scroll, and stages draft review comments as the reviewer's **own pending GitHub review** — authored under the human's identity, published only when the human clicks Submit.

Three things it deliberately is **not**: it does not render diffs (GitHub does), it does not review code as a bot (the human authors everything), and it does not write code.

## 2. Problem

In the agentic-coding era, developers spend less time writing code and far more time reviewing 80+ file feature drops. Native platforms present files alphabetically; reviewers burn their best attention hunting for the entry point, tracing execution across fragmented files, and re-orienting after every author push. Review — not authoring — is now the bottleneck.

## 3. Positioning — the wedge

Honest competitive picture (verified July 2026):

- **CodeRabbit Change Stack** reorganizes PRs into dependency-ordered cohorts and layers with range summaries and diagrams — and now also supports inline comments that accumulate into a **native pending review** submitted from its UI, GitHub **Viewed-state sync**, **snapshots** across pushes (incl. force-pushes) answering "what changed since I last looked," a review-conversation viewer with resolved/outdated indicators, chat, and symbol lookup (Code Peek). All of it inside **CodeRabbit's own three-panel interface**, opened from a button in its PR comment.
- **GitHub itself** now ships **docked panels** on Files Changed (overview, comments, merge status, alerts side-by-side with the diff) and Copilot chat can sit beside the diff.

So the wedge is exactly one thing, and it is still unclaimed:

> **Guidance that drives the native GitHub diff.** Not a replacement review interface, not a bot's comment thread — the reviewer stays on the actual Files Changed page they already live in, and the story navigates *it*.

Human authorship of comments is a **property we keep** (accurately: *user-attributed, app-mediated* — audit logs record programmatic access), not the wedge itself.

**Product hypothesis:** guided reading is materially more useful when it drives the native GitHub diff rather than living in a separate interface or a static comment.

**Hackathon success criteria:** a working end-to-end product on real PRs, and a live demo (§14) where the story generates, navigation drives GitHub, a ghost comment stages under the presenter's name, and a mid-demo push flows into the round-2 screen. *(Post-hackathon validation gates — voluntary reuse on ~60% of eligible PRs, ≥95% navigation success, zero confidently-wrong claims in a pilot — are archived in §16/D13 for the day this graduates from demo to trial.)*

## 4. The experience, end to end

### Round 1 — first open
A reviewer lands on a PR and opens the side panel. Generation starts on open: the story **skeleton** (tracks + chapter titles) appears in ~10 seconds, chapter cards stream in over the next minute. The reviewer picks an **entry point** matching their expertise — a backend reviewer starts at the schema and reads outward; a frontend reviewer starts at the component and reads inward. Same story, different traversal.

Each **chapter** groups related files with a summary, an **attention badge** (`Deep read / Standard / Skim`) with its reasons, per-file one-liners, "what to scrutinize" hints — every AI claim carrying a **file:line evidence anchor** — and a `related tests: no test files reference these symbols` note when the static mapping finds nothing (a search fact, never auto-labeled a risk). Noise (lockfiles, generated code, mechanical renames) is pre-binned into an optional **appendix** — surfaced as low-attention, not hidden, since dependency changes can be security-critical. A **feature-flow map** renders each track as a horizontal stepper of system layers — `Login Page → API Gateway → Auth0 (external) → Users Table` — visited nodes checked, current node glowing, node weight reflecting attention. Refactors with no natural flow render as grouped nodes without arrows; external nodes come only from high-precision signals (SDK imports, config) and are ghosted/unclickable.

Clicking a chapter **drives the GitHub page** to its files; scrolling GitHub updates the panel's you-are-here marker. When the reviewer spots something, they draft in the panel and click **Stage** — after confirming the target (`stage at schema.prisma:42?` with the lines previewed), the comment appears in GitHub as a native pending-review comment under their own name, editable and submittable with GitHub's own buttons. A **Copy comment** button sits beside Stage as the universal fallback: one click copies the draft for pasting into GitHub's native composer. A **chat** pane answers questions about the PR and codebase ("didn't we already implement something like this in route X?"), navigating the source read-only and streaming its search activity.

### Mid-review push
The panel polls the PR's head SHA (~30 s). On change: *"PR updated — refresh story?"* Refresh runs **delta regeneration** — only affected chapters re-run; the rest load from cache.

### Round 2 — returning after the author responds
The reviewer submitted 7 comments Tuesday; the author pushed 4 commits and replied. Thursday the panel does **not** pretend it's a first visit:

```
┌─ Review Story ────────────────────────────┐
│ ⟳ Round 2 — 4 commits since your review   │
├───────────────────────────────────────────┤
│ YOUR COMMENTS (7)                         │
│ schema.prisma:42 — cascade delete         │
│   [Resolved by author] [1 reply]          │
│ routes.ts:118 — rate limiting             │
│   [2 replies] · "intentional, because…"   │
│ auth.ts:77 — [Outdated] [1 reply]         │
│ 4 more · [no replies yet]                 │
├───────────────────────────────────────────┤
│ CHANGED SINCE YOUR REVIEW                 │
│ Ch.2 Auth API · UPDATED                   │
│ Ch.9 Email notifications · NEW            │
│ 6 other chapters untouched                │
├───────────────────────────────────────────┤
│ FULL STORY — resume at ch.6               │
│ ✓✓✓✓✓ ⬤6 7 8 9   (2 updated, 1 new)      │
└───────────────────────────────────────────┘
```

Thread states render as **independent badges** (a thread can be resolved *and* replied *and* outdated simultaneously; `resolvedBy` names the actor) — GitHub's fields displayed, never judged. "Changed since your review" chapters navigate to those files in the current diff (GitHub's native range view offered as a secondary link). Author additions that don't fit existing chapters become **NEW chapters**, automatically unvisited. Visited checkmarks and chat history persist per user per PR — a resumed session, not a restart. Staged-but-unsubmitted drafts from before the push are flagged.

### A second reviewer
Reviewer B opens the same PR: the story loads instantly from cache (A's open paid for generation; concurrent cold opens dedupe to one job). B gets their **own lens** — own entry point, progress, staged ghosts (pending reviews are private per author on GitHub itself), own chat, own round-2 delta computed against *B's* checkpoint. A's **submitted** threads are visible inline because GitHub renders them natively; chapter cards show thread counts ("Ch.3 · 💬 2 threads, 1 open"). Chat is seeded with all public threads, so B asking "is this cascade deletion safe?" gets *"reviewer A raised exactly this — author resolved it with soft-delete, thread at schema.prisma:42."* Before staging, a proximity check warns if an existing thread sits on the same lines.

**Recurring design principles:** *the story is shared team infrastructure; the lens is private* · *deterministic pipes now, LLM judgment over the same data later* · *ride GitHub's mechanisms, never reimplement them* · *deterministic facts are labeled as such; LLM judgments carry evidence anchors.*

## 5. Scope

**Hackathon build (in):** story generation · panel↔GitHub sync · ghost comments **+ Copy fallback** · chat · feature-flow map · per-chapter attention levels (`Deep read / Standard / Skim`, asymmetric floors) · delta regeneration via stored snapshots · Round-2 (return detection, comments checklist, changed-since-review track, staged-drafts guard, progress + chat persistence) · multi-reviewer shared-thread context + proximity dedup guard · regen-on-push banner.

**Deferred (parking lot):**

| Feature | Why deferred |
|---|---|
| Architecture-graph minimap (free-form nodes/edges) | LLM-invented semantic edges = credibility risk; flow map covers orientation |
| Testing playbook | Hallucination surface; later version must be grounded in repo files only |
| Permutations tab | Not core to the hypothesis |
| Comment cascades, reviewer personas | Bot-review identity — off-thesis |
| Async breadcrumbs (AI-written); sequel AI verdicts | LLM judgment over data the pipes already carry; chat answers "did he fix it?" on demand meanwhile |
| Semantic dedup; "have we built this" semantic search | Embeddings later; proximity/grep now |
| Suggestion blocks in ghost comments | Still human-committed — reconsider early |
| GitLab; webhooks & pre-generation; coverage ingestion; queue/Postgres | Scale features |

**Honesty edits:** "test coverage" → **"related tests (textual-reference search, scope shown)"** with no automatic risk label. "<100 ms" holds for **warm cache only** (cold ≈ 10 s to skeleton). GitHub-only.

## 6. Architecture

```text
┌───────────────────────────────┐    HTTPS (REST + SSE)    ┌──────────────────────────────┐
│   Chrome Extension (WXT)      │ ◄──────────────────────► │ Agent / chat harness         │
│  · Side panel (React):        │                           │ (Fastify, TS)                 │
│    review UI, input, staging  │                           │ · reviewer session + progress │
│  · Content script:            │                           │ · chapter state + chat history│
│    navigation and page sync   │                           │ · ChatEngine (Agent SDK)      │
│  · no orchestration state     │                           │ · GitHub proxy + job runner   │
└───────────────────────────────┘                           └──────┬───────────┬───────┘
                                                                    │           │
                                                   analysis request │           │ GitHub/chat tools
                                                                    ▼           ▼
                                                     ┌──────────────────┐  ┌─────────────────┐
                                                     │ Analysis layer   │  │ GitHub + LLM    │
                                                     │ · pipeline (§7)  │  │ provider APIs   │
                                                     │ · StoryArtifact  │  │                 │
                                                     │ · no user state  │  └─────────────────┘
                                                     └──────────────────┘
Local state: SQLite (story snapshots + diff snapshots, jobs, user sessions, encrypted tokens)
             /tmp/ws/{repo}/{sha} workspaces (tarball; TTL ~6h idle + LRU cap; re-fetch by SHA)
```

**Data model (three entities — reviewer-relative data never lives in the shared story):**

| Entity | Scope | Contents |
|---|---|---|
| `StorySnapshot` | Shared | repo node ID, PR, head OID, artifact JSON, **diff snapshot** (per-file: path, status, patch hash, stats at generation time), analyzer/prompt/schema versions |
| `UserReviewSession` | Private | user, PR, checkpoint OID (last-reviewed or last-seen), chosen entry point, visited chapters, chat session |
| Delta (computed) | Per request | classify current diff vs. the *stored* snapshot at the viewer's checkpoint → NEW/MODIFIED/DROPPED/UNTOUCHED per chapter; never persisted into the shared artifact |

**Cache/job key:** `hash(repo_node_id, pr, head_oid, analyzer_version, prompt_version, schema_version)` — PR number alone would collide across repositories.

**Ownership boundary:** the Chrome extension renders and synchronizes the GitHub page; it does not own durable review flow. The agent/chat harness orchestrates every reviewer-facing action: it creates and restores the session, tracks the active and visited chapters, retains conversation history, invokes the analysis layer, and supplies bounded context to chat. The analysis layer returns only reviewer-neutral artifacts and stream events; it never receives reviewer identity, chapter progress, or chat history.

**Key decisions vs. the original design doc** (rationale in §16): Maki engine → deterministic pipeline behind an `Analyzer` seam · DOM-injected comments → pending-review API (+ Copy fallback) · webhook pre-generation → generate on panel-open + SHA polling · scrollIntoView/IntersectionObserver → native-mechanism ladder + sticky header · chat = Claude Agent SDK behind a `ChatEngine` seam (pi = multi-provider fallback; its docs state it ships no permission system). Kept: GitHub App > PATs for the *product* (PAT for the hackathon), tarball ingestion with size guard, analyzer→artifact→slim-chat decoupling.

## 7. Analyzer pipeline

Three AI calls with plain code between them. The AI never decides what to do next; code does.

**Stage 0 — deterministic prep (0 tokens).** Fetch PR metadata + per-file patches + head-SHA tarball in parallel (guards: repo > ~1 GB → warn/skip; > ~300 effective files → directory-level story with notice). Pure code then computes: noise detection (lockfiles, `@generated`, snapshots, `dist/`, minified, pure renames → appendix); per-file stats; import graph among changed files + out-edges to unchanged files; changed-symbol extraction (tree-sitter for the repo's languages, regex fallback); **hunk-pattern clustering** (a 950-file mechanical rename collapses to one manifest row + 3 samples, deviating files promoted to a real chapter); test↔source textual mapping; file-role tags; **attention floors** (migrations, auth/payment/security paths never below Standard; mechanical/generated default Skim); and the **diff snapshot** persisted with the story for future delta computation.

**Stage 1 — story skeleton (1 call, STRONG model).** The structure decision contaminates every later stage, so it gets the strongest model — pennies at one call per PR. Input: manifest (~130 tokens/file) + PR title/body. Output (structured JSON): tracks, chapters with member files, appendix confirmations, ≤10 **context requests**. **Code validates:** every changed file lands in exactly one chapter or appendix; one re-prompt on failure, else misc chapter.

**Stage 1.5 — bounded context fetch (0 tokens).** Resolve context requests as tree-sitter skeletons from the tarball on disk. Cap: 10 files / ~20 k tokens, one round, no loop.

**Stage 2 — chapter passes (N parallel calls, mid model; provider concurrency cap ~5).** Each call gets only its chapter's diffs + trimmed contents + skeletons + the Stage-1 outline. Returns: summary, scrutinize hints, flow label + kind, per-file one-liners, anchor hunks, attention level (may raise, never lower below the floor), related-tests note — **and every claim carries `evidence: [{path, lines}]` plus `kind: observed | inferred`.** Oversized files are truncated to changed regions + enclosing scope; binary/missing patches degrade to a stats-only line.

**Stage 3 — synthesis (1 call, strong model).** Chapter summaries in (~8 k tokens); reading order + rationale, per-persona entry points, flow arrays, exec summary, cross-chapter observations out. UI note: skeleton order shown during streaming is labeled *provisional*; final order applies on Stage-3 completion unless the user has already started (then a "suggested reorder" chip appears instead of yanking the list).

Assemble → zod-validate → store `StorySnapshot` → stream over SSE.

**Cost/latency envelope:** small PR $0.10–0.30 · 80-file PR ≈ $1–2, 60–90 s cold, ~10 s to skeleton · warm cache < 1 s.

**Delta regeneration (works entirely from stored snapshots — no retroactive GitHub queries, which the API cannot answer):**
1. **Classify (code, free):** current PR diff vs. the diff snapshot stored at the viewer's checkpoint → NEW / MODIFIED / DROPPED / UNTOUCHED per file. If no snapshot exists at that exact checkpoint, use the nearest older stored snapshot and say so.
2. **Route:** no NEW/DROPPED → skip. Otherwise one routing call: existing skeleton + manifest of new/dropped files → join / new chapter / dropped, under a *minimum-edit* constraint (stable chapter IDs preserve checkmarks and badges).
3. **Scoped regen:** full Stage-2 for NEW chapters; "what changed since checkpoint" Stage-2 for MODIFIED; **Stage 3 always re-runs.**
Escape hatches: delta > ~50 % of the story → full regeneration with an ID-reuse hint; manual **Rebuild story** button always available. Same code path serves the mid-review banner and round-2 — only the checkpoint differs.

## 8. Artifact schema (v1 sketch — freeze in hour 0, see §14)

```json
{
  "meta": { "repo_node_id": "R_x", "pr": 123, "head_oid": "…", "versions": { "analyzer": 1, "prompt": 1, "schema": 1 }, "status": "READY" },
  "exec_summary": { "text": "…", "evidence": [ { "path": "src/api/routes.ts", "lines": [102, 148] } ] },
  "tracks": [
    {
      "id": "trk_auth",
      "title": "OAuth token refresh",
      "entry_points": [
        { "persona": "backend", "start_chapter": "ch_schema", "note": "read data-layer outward" },
        { "persona": "frontend", "start_chapter": "ch_login_ui", "note": "read UI inward" }
      ],
      "flow": [
        { "chapter_id": "ch_login_ui", "label": "Login Page", "kind": "code" },
        { "chapter_id": "ch_api",      "label": "API Gateway", "kind": "code" },
        { "chapter_id": null,          "label": "Auth0",       "kind": "external", "evidence": [ { "path": "src/auth/client.ts", "lines": [1, 12] } ] },
        { "chapter_id": "ch_schema",   "label": "Users Table", "kind": "code" }
      ],
      "chapter_order": ["ch_schema", "ch_api", "ch_login_ui"]
    }
  ],
  "chapters": [
    {
      "id": "ch_api",
      "title": "Auth API routing",
      "summary": { "text": "…", "kind": "inferred", "evidence": [ { "path": "src/api/routes.ts", "lines": [102, 148] } ] },
      "files": [ { "path": "src/api/routes.ts", "note": "adds /refresh endpoint", "anchor_hunks": [[102, 148]] } ],
      "scrutinize": [ { "text": "token rotation on concurrent refresh", "kind": "inferred", "evidence": [ { "path": "src/api/routes.ts", "lines": [120, 131] } ] } ],
      "related_tests": { "status": "none_found", "note": "no direct textual references in searched test files", "search_scope": "test/**, __tests__/**" },
      "attention": { "level": "DEEP_READ", "floor": "STANDARD", "reasons": ["auth path", "no test references", "imported by 14 files in this PR"] }
    }
  ],
  "appendix": { "files": ["package-lock.json"], "reasons": { "package-lock.json": "lockfile" } }
}
```

Deliberately absent: free-form graph nodes/edges, ghost comments (they live in GitHub as pending reviews), playbook, breadcrumbs, permutations — and **any reviewer-relative field** (`NEW/UPDATED` status, delta summaries, checkpoints): those are computed per viewer (§6 data model), never baked into the shared story.

## 9. Ghost comments

**Primary mechanism:** GitHub's pending-review API. Create a review with `event` omitted → **PENDING** review: unpublished, private to its author, native yellow badges, edited/deleted/submitted with GitHub's own UI. Flow: *Stage* → **location confirm** (`stage at schema.prisma:42?`, lines previewed — comments drafted from a chapter or chat carry their target from that context) → backend checks for an existing pending review (one per user per PR; second create = 422) → create-with-comment or append via GraphQL `addPullRequestReviewThread` → visible on the page (refresh-triggered if needed). Multi-line via `start_line`/`line` + `side`.

**Universal fallback:** the **Copy comment** button beside Stage — copies the draft to the clipboard for GitHub's native composer. Zero-API, works in every mode, saves the live demo if anything misbehaves, and quietly serves the "collect notes across files, convert to threads later" workflow.

**Safety UX:** staged comments are real pending comments — GitHub's Submit publishes them all. Stage one at a time on explicit click; panel shows the staged list with un-stage; GitHub shows the pending count on Submit. For "comment on the exact line I'm looking at," the native composer is one click away — we don't compete with it.

**Hackathon auth:** a fine-grained PAT (Pull requests: write) authors as the demo account. GitHub App + user-OAuth (state param, callback validation, revocation, account matching) is the multi-user upgrade. Honesty note for the deck: activity is *user-attributed, app-mediated* — audit logs record programmatic access.

## 10. Panel ↔ GitHub sync

Principle: ride GitHub's own mechanisms. GitHub's file tree can navigate to any file including unmounted ones in virtualized mode — working navigation machinery is guaranteed present; we trigger it.

**Panel → GitHub, fallback ladder:** (1) element mounted → `scrollIntoView` + highlight · (2) not mounted → set `location.hash` to GitHub's per-file diff anchor and let their router mount + scroll (line anchors best-effort) · (3) hash ignored → synthesize a click on the native file-tree item · (4) floor: full-page navigation to the anchor URL.

**GitHub → Panel:** watch the **sticky file header** (one MutationObserver on the one pinned element naming the file in view) → map path → chapter. Fallback: IntersectionObserver per mounted container.

**Mode matrix:** new default Files Changed — target. Experimental virtualized mode — expected via the ladder; else a "switch off experimental mode for guided navigation" banner. Classic — unsupported.

**Support level is spike-gated, not promised:** these are undocumented DOM surfaces GitHub changes at will (routes have already moved; virtualized mode explicitly warns extensions). **Half-day timeboxed spike, WS2's first task:** verify anchors + sticky header on a small PR, a 150-file PR, and the virtualized mode; check Turbo soft-navigation survival, split-diff on a 13″ screen, files marked Viewed/collapsed, file filters, renamed paths, and coexistence with **GitHub's own docked panels** — if two side panels crush diff width, that's a product problem to solve in layout (auto-collapse, overlay mode), not a styling nit. Committed promise: file-level navigation; line-level highlighting best-effort.

## 11. Chat

**Engine:** Claude Agent SDK (TS), headless, behind a `ChatEngine` seam — multi-hop code investigation is what the harness is tuned for. **Guardrails:** `allowedTools: [Read, Grep, Glob]` only; permission callback pins paths inside `/tmp/ws/{repo}/{sha}`; containerized worker with no outbound network beyond the LLM API; `maxTurns` + timeout; tool activity streamed to the panel. **Prompt-injection posture:** repository text, PR descriptions, and review comments are *untrusted input* — the system prompt says so explicitly, instructions found in repo content are never followed, and read-only tools + no network bound the blast radius to misleading answers (which evidence anchors help the user check).

**Seeding:** artifact digest + "viewing chapter N" + capped thread digest in the system prompt; `pr_info.md` and `threads.md` (public review threads, fetched fresh per session) in the workspace. Sessions persist per (user, PR); round-2 re-seeds with round-2 state, so "did he actually fix my cascade concern?" works on demand. Expectation: navigation is lexical — grep, not semantic memory.

## 12. Stack & security

| Component | Choice |
|---|---|
| Language / backend | TypeScript, Node 22, single Fastify service |
| Jobs | In-process runner, dedup on the §6 cache key, concurrency cap |
| DB | SQLite + Drizzle (snapshots, sessions, tokens); flips to Postgres later |
| Transport | SSE owned by the side panel (MV3 service workers can't hold sockets) |
| Extension | WXT + React + Tailwind |
| GitHub | Octokit; PAT now, App + user-OAuth later |
| LLM | Anthropic SDK (pipeline) · Agent SDK (chat) |
| Parsing | tree-sitter bindings for the demo repo's languages; regex fallback |
| Hosting | localhost for the hackathon; Fly/Railway single container + volume when shared |

**Security baseline (real controls, sized to the build):** authorization check before serving any cached story or thread data (repo access verified against the caller's token) · PAT/user tokens encrypted at rest · workspaces TTL'd; canonical-path + symlink-safe access · chat container read-only mounts, no network · startup recovery for jobs stuck `RUNNING` · **data-retention policy per class**: raw checkouts (TTL hours), derived artifacts & chat transcripts (contain source-derived text — retained per user consent, deletable), provider-side retention per the LLM API agreement. The earlier claim "source never persisted outside /tmp" was wrong — artifacts and transcripts are source-derived and are governed accordingly.

## 13. Evaluation (hackathon-sized)

Zod schema validation on every artifact · token/cost log per run · generate on 2–3 PRs the team knows cold and **hand-check the evidence anchors** (a claim whose cited lines don't support it is a bug, not a style issue) · the corrected output of that exercise doubles as the golden demo artifact. Formal rubric corpus = post-hackathon.

## 14. Hackathon build plan

**Hour 0 — freeze the contract.** The §8 schema is the team's API. Hand-write `mock-artifact.json` for the demo PR immediately: WS2 builds the entire UI against it while WS1 makes it real. Integration = swapping the mock for the endpoint.

**Workstreams (parallel):**

| WS | Owns | Order of work |
|---|---|---|
| **WS1 · Pipeline** | Stage 0 → 1 → 2 → 3, snapshots, delta | CLI first (PR URL in, story markdown out — the feasibility gate); then SSE endpoint; then delta |
| **WS2 · Extension** | Side panel UI, sync, flow map | **Half-day sync spike first** (§10); then panel on mock artifact; chapters → entry points → attention badges → round-2 screen → flow map last |
| **WS3 · GitHub integration** | Ghost comments, threads, round-2 data | Pending-review staging + Copy fallback; threads query + badges; proximity dedup; checkpoint detection |
| **WS4 · Chat** | Agent SDK service | Locked-down session + seeding; streamed activity; threads.md |

Cut order if time runs out (last built = first cut): flow map → chat → round-2 screen → delta (Rebuild button covers it) → multi-reviewer badges. The demo still works at every cut level.

**Demo script (3 minutes):**
1. Open an 80-file PR cold → panel opens → skeleton in seconds, chapters streaming. "This PR is alphabetical soup on GitHub — here's its story."
2. Pick the backend entry point → click chapter 1 → **GitHub scrolls itself**. Scroll manually → the you-are-here marker follows.
3. Attention badges: "the tool spent our attention budget for us — two deep-reads, the rest skims, lockfiles filed away."
4. Spot the planted issue → draft in panel → **Stage** → switch to GitHub: pending comment, presenter's own name, native yellow badge. Submit review natively.
5. Teammate pushes a prepared commit live → banner → refresh → **round-2 screen**: comment resolved, one chapter UPDATED, one NEW. "It didn't restart — it remembered."
6. Close on the wedge: "Everything you saw happened on GitHub's own page. We didn't replace the review — we gave it a narrator."

## 15. Known risks

| Risk | Mitigation |
|---|---|
| GitHub UI churn / undocumented DOM | Writes via official APIs only; navigation rides GitHub's anchors/tree; spike before UI build; support level spike-gated |
| Docked panels + our panel crush diff width | Spike checks 13″ layout; auto-collapse/overlay layout answer |
| Plausible-but-wrong story | Evidence anchors on every claim; strong model for structure; Rebuild button; hand-checked golden demo PR |
| Demo-day failure | Copy-comment fallback; pre-warmed cached artifact for the demo PR; every cut level still demos |
| Mass mechanical changes | Hunk-pattern clustering + outlier promotion |
| Accidental publish of staged comments | Stage-one-at-a-time; staged list; GitHub's own pending count |
| Cost runaway | Bounded pipeline; on-demand generation; per-key caching; delta regen |
| Single-maintainer deps | Maki/pi off the critical path, behind `Analyzer`/`ChatEngine` seams |

## 16. Decision log

| # | Decision | Chosen | Rejected | Why |
|---|---|---|---|---|
| D1 | Wedge & hypothesis | **Placement**: guidance that drives the native GitHub diff | Narrative quality as wedge; authorship as wedge | CodeRabbit ships cohorts/layers *and* native pending reviews, viewed sync, snapshots — in its own UI. GitHub ships docked panels. The native-diff-driving experience is the one unclaimed thing; authorship demoted to a kept property (user-attributed, app-mediated) |
| D2 | Scope | Story + sync + ghost comments + chat + flow map + attention + delta + round-2 + multi-reviewer context | Full original PRD (breadcrumbs, cascades, personas, playbook…) | Off-thesis or LLM-judgment layers deferred; deterministic pipes ship first |
| D3 | Analyzer | Deterministic 3-stage pipeline, plain SDK, `Analyzer` seam; **strong model for Stage 1** | Maki; Agent-SDK analyzer; cheap Stage-1 model | Bounded transformation ≠ exploration; predictable cost, parallel, debuggable. Structure errors contaminate everything downstream — don't penny-pinch the highest-leverage call |
| D4 | Ghost comments | Pending-review API + location confirm + **Copy fallback** | DOM injection; read-only (no staging) | Virtualization removes DOM targets; API is versioned and authors as the human. Read-only rejected: staging serves cross-file drafting and the demo; Copy fallback de-risks it at zero cost |
| D5 | Trigger | Generate on panel-open + SHA polling | Webhook pre-generation | Pay only for viewed PRs; no webhook infra |
| D6 | Chat | Claude Agent SDK, read-only lockdown, `ChatEngine` seam | Hand-rolled loop; pi; maki | Investigation is harness home turf; built-in permissioning. pi = multi-provider fallback (ships no permission system per its docs); maki's ACP is editor-shaped |
| D7 | Sync | Native-mechanism ladder + sticky header; **spike-gated**, half-day, WS2 task #1 | scrollIntoView/IO as spec'd; "committed" support claims | Undocumented DOM; virtualized mode warns extensions; GitHub's own tree proves navigation exists — trigger it, verify first |
| D8 | Stack | TS/Fastify/SQLite/SSE/WXT/Octokit; PAT for hackathon | BullMQ/Redis/WS; App+OAuth now | No webhooks → no queue; MV3 can't hold sockets; OAuth is the multi-user upgrade |
| D9 | Eval | Schema validation + cost log + hand-checked evidence anchors on known PRs | Golden-fixture rubric + LLM judge | Hackathon-sized; corrected outputs double as the demo artifact; formal corpus post-hackathon |
| D10 | Build order | Hour-0 schema freeze + mock artifact; 4 parallel workstreams; explicit cut order | Sequential solo ladder | Team build; mock-first lets UI and pipeline proceed in parallel; every cut level still demos |
| D11 | Attention levels | `Deep read / Standard / Skim`, LLM-assigned over deterministic floors (raise-only) | "Severity" framing; free scores | Scores scrutiny, not bugs; false lows are the trust-killer, so code owns the floor |
| D12 | External review adoption | ~70 % adopted: three-entity data model, full cache key, evidence anchors + observed/inferred, related-tests rewording, independent thread badges, strong Stage 1, security baseline, snapshot-based delta, honest support claims | Read-only product; removing chat/flow map/delta; multi-week research program | The review caught real errors (shared/private contradiction, cache key, retroactive-diff hole, overclaimed principles). Its prescription was sized for a funded trial, not a hackathon; fixes adopted, amputations declined |
| D13 | Validation gates | Hackathon success = working product + live demo (§14 script) | 2–3-week trial gates as immediate criteria | Archived for post-hackathon: voluntary reuse ~60 % of eligible PRs · ≥95 % navigation success · ≥90 % chapters rated coherent · zero critical unsupported claims · first guidance ≤ 5 s or pre-gen becomes mandatory |
| D14 | Delta mechanism | Classify against the **diff snapshot stored at generation time** | Retroactive GitHub compare queries | "PR diff at old head" is not an endpoint; compare paginates (300/page, 3 000 cap) with heavy payloads. Record the past instead of recomputing it |
