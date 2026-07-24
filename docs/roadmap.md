# Roadmap & backlog

Living tracker for post-hackathon development. Concept and design rationale
live in [`review-story-design.md`](../review-story-design.md); this file
tracks what to build next and why. Update it as items land — checked items
stay for one release cycle, then move to the changelog section at the bottom.

_Last updated: 2026-07-23 (branch `eric-post-hackathon`, PR yoniaiz/review-story#15)._

## Verification — minutes each, closes the auth arc

- [ ] **Revoke/re-auth loop**: revoke the GitHub App authorization (GitHub →
  Settings → Applications), confirm the panel lands on the sign-in screen with
  the expiry message and that sign-in recovers. Last untested auth failure path.
- [ ] **CI first-run review**: the workflow has triggered on PR #15 pushes but
  nobody has checked the results. Fix workflow/Dockerfile issues before deploy.

## Deployment — nothing is hosted yet

- [ ] Docker build + local run of the API image (`apps/api/Dockerfile`).
- [ ] Host the API (Fly / Railway / Cloud Run). Prod env needs: Supabase URL +
  secret key, `TOKEN_ENCRYPTION_KEY`, GitHub App client id/secret/slug,
  `API_PUBLIC_BASE_URL`, `EXTENSION_IDS`.
- [ ] Add the hosted callback URL to the GitHub App (Apps support multiple
  callbacks — dev `127.0.0.1` and prod can coexist).
- [ ] Build the extension against the hosted API (`VITE_API_BASE_URL`) and
  decide distribution: Chrome Web Store (new extension ID → append to
  `EXTENSION_IDS`) vs. shared unpacked build.
- [ ] Prod data posture: `REVIEW_SESSION_STORE=supabase`, story cache
  location, and a cleanup job for expired `harness_sessions` rows.
- [ ] **Event-driven App (unlocked by hosting — the "why deploy" story).**
  The GitHub App is currently auth-only; its webhook half is off (design
  decision D5 deferred it, correctly, for the hackathon). A public API
  endpoint enables `pull_request` event subscriptions, which chain into:
  1. *Check-run on opened/edited*: parse the primer-context block, post
     "context block present and valid ✓ / missing ⚠" — enforcement-ladder
     level 2 from the context-contract PRD, and immediate authoring-side
     feedback that the block landed. First thing to build post-deploy.
  2. *Pre-generation on opened*: story ready before the first reviewer
     arrives (the primer brief's "before the reviewer arrives" section);
     first panel open becomes instant instead of 60–90 s.
  3. *Delta/invalidations on synchronize*: new pushes trigger regeneration
     and feed the round-2 experience instead of relying only on SHA polling.
  Until then the flow stays pull-based: the panel fetches the PR body fresh
  on open, so block edits appear at next panel open — seamless enough for
  dogfooding, not for the product.

## Product — design-doc gaps (review-story-design.md §4, §9, §11)

- [ ] **Agentic chat harness** (§11, D6) — the design specifies a Claude Agent
  SDK investigator with read-only Read/Grep/Glob over the PR workspace,
  streamed tool activity, and thread-seeded sessions. Current engine is a
  single-shot OpenAI Responses call with pasted evidence — no tools, no
  codebase navigation. The `ChatEngine` seam exists; this is an engine swap.
  Build §11's guardrails (workspace pinning, no network, untrusted-input
  posture) with it, not after. Highest-leverage item in the backlog.
  **Spec to build against**: `PRODUCT_REVIEW_BRIEF.md` in
  `erl-jpg/codex-hackathon-primer` — the agent-as-investigator doctrine:
  agent runs *after* deterministic evidence exists and *before* the plan is
  finalized; bounded read-only triage returning exact citations in a frozen
  normalized schema; falsifiable evaluation gate (fails → the SDK experiment
  ends); pinned versions, turn/token/wall-clock budgets, deterministic
  verification of every displayed claim, SHA-cached accepted artifacts.
- [ ] **Skills system** — the composer advertises "type / for skills" but only
  `/comment` exists. The primer `EXTENSION_ROADMAP.md` already designed the
  set: **`/explain`, `/evidence`, `/navigate`, `/recheck`, `/comment`** —
  resurrect it as the registry's initial contents (several are thin wrappers
  over existing capabilities), plus `/stage` (the flagged API pending-review
  path — its proper home), `/copy` (design §9's universal fallback), later
  `/since` (round-2). Add a `/` discoverability popover.
- [ ] **Ghost-comment UX per §9** — location confirm before staging, staged
  list with un-stage, Copy-comment fallback button. Also record a D15 in the
  design decision log: composer-first DOM drafting reverses D4's API-primary
  choice; the API path remains for virtualized/unmounted lines.
- [ ] **Round 2 / delta** (§4, §7) — the "it remembered" experience: persist
  the diff snapshot with the story, checkpoint per user, delta classify →
  route → scoped regen, your-comments checklist with independent thread
  badges, changed-since-review chapters, mid-review push banner (SHA poll).
  Prerequisite for the multi-reviewer story. Nothing built yet.
- [ ] **Per-persona entry points** — in the artifact schema and Stage-3
  output; not surfaced in the panel UI.
- [ ] **Context ingestion / context contract** (PRD:
  [`context-contract-prd.md`](context-contract-prd.md), needs team
  ratification) — carry authoring context across the author→reviewer
  boundary. Tier 1: analyzer ingests commits, linked issues, and
  repo-resident direction docs for alignment notes. Tier 2: parse + verify a
  structured `primer-context` block (intent, decisions, risk areas,
  verification claims) — enables intent-vs-implementation diffing and feeds
  the Review Brief's human-review mission. Partially shipped on
  `eric-context-contract` / PR #16 (parser, context endpoint, unified brief,
  elevation-only risk merge); see PRD §11 for the honest inventory.
- [ ] **Authoring-side emitter chain** (PRD §5.5; build spec: [`context-contract-implementation.md`](context-contract-implementation.md) — "the moment the PR
  description is written is the last moment the authoring context exists").
  The repo is the universal adapter: one setup PR ships every emitter, and
  the contract is the description's *skeleton*, not an attachment.
  - [x] `.github/PULL_REQUEST_TEMPLATE.md` block skeleton (humans)
  - [x] `CLAUDE.md` emit instructions (Claude Code — produced PR #16's block)
  - [ ] `AGENTS.md` + `.cursor/rules` variants (Codex/Devin, Cursor)
  - [ ] `/pr` skill (`.claude/skills/primer-context/`): composes the
    description around the contract; post-deploy, POSTs to the context API
  - [ ] Claude Code hook on `gh pr create` — blocks creation without a
    block; the only authoring-side hard gate (PRD open question 6:
    default-on vs opt-in)
  - [ ] Inferred-fallback generator (Primer drafts a block from commits +
    diff when absent, labeled `provenance: inferred`)
  - Server-side rungs of the chain (check-run flag → required status) live
    in the Deployment section's event-driven-App item; graduated posture:
    solo dev = nudge + fallback, team = + check-run, enterprise = required.
- [ ] **API-first carrier** (PRD §4.5, unlocked by hosting) — authenticated
  `POST` of the contract keyed by repo+PR+head SHA (verified provenance,
  per-push history); PR body demotes to human mirror + zero-adoption
  fallback; reader prefers the API record and flags mirror divergence.
- [ ] **Run the Tier-2 validation gate** (PRD §9) — on 3 known PRs, ≥1 true
  intent-vs-implementation mismatch, 0 false claims-as-facts; we have the
  PRs, the gate is unrun.
- [ ] **Context archive branch** (idea — agent-proposed, needs team
  evaluation; origin: the Corpus-B run of the 2026-07-24 dogfood
  experiment, `docs/experiments/2026-07-24-decision-corpus-dogfood.md`).
  - **Why this is only an idea**: it was designed by an authoring agent
    working *within* decision records 004/005, not by the team; nobody has
    ratified it, and it competes for scope with the API record it would
    mirror. It is recorded so the design isn't lost, not because it is
    scheduled.
  - **What it serves**: the one goal §4.5/§4.6 currently gives up —
    per-PR context that is durable *in git* (survives GitHub, travels
    with clones, platform-independent) — without violating the settled
    constraint that per-PR context never touches the reviewed diff.
  - **Why it would matter**: it makes the context history tamper-evident
    and portable (append-only files under git's own history), gives
    enterprises an exportable audit trail that isn't hostage to Primer's
    database, and would strengthen the §6.5 compliance story ("every
    claim, at every push, in your own repo").
  - **How it operates**: a bot-written orphan branch (e.g.
    `primer/context-archive`) with no shared history with the code — same
    repository, never merged, never in any PR's diff (the `gh-pages`
    pattern). Layout: one folder per PR, one immutable YAML file per
    (PR, head SHA) push, written by Primer's server via GitHub's git data
    API at context ingestion and at merge. Append-only; files are never
    edited. Precedence unchanged: the API record stays the system of
    record ("database wins"); the branch is the durable, portable mirror.
  - **Costs to weigh**: requires contents-write App permission (shared
    with the check-run/graduation work), a second copy of API data (needs
    the explicit database-wins rule), and file accumulation on busy repos
    (tiny files, but unbounded).
  - **Relationship to §4.6**: complementary, not competing — the archive
    is the *raw per-push record*; `.primer/decisions/` remains the
    *curated, human-ratified distillation*. If built, it slots into the
    post-deploy webhook cluster alongside graduation.
- [ ] **`.primer/` repo memory** (PRD §4.6, proposal — needs design + team
  ratification) — not a PR-context carrier: durable repo-resident memory.
  Merged PRs' decision logs graduate into ADR-shaped
  `.primer/decisions/` records (candidate automation: merge-time webhook
  proposes the graduation commit); Tier-1 reads the corpus back for
  alignment checks that compound with every merge; `.primer/config.yaml`
  becomes the config home when Primer grows repo-level settings.
  **Git persistence per §4.6's framework**: config yes (when it exists);
  **decision memory: Primer systematizes it** (decided 2026-07-24 — the
  prose-docs channel only exists in documentation-disciplined repos; a
  product cannot ship "keep excellent docs" as its mechanism), shipped
  only as human-ratified graduation PRs, never silent commits; per-PR
  context never. Dogfood experiment retargeted at tuning the record
  format; a skill-side API fetch is the complementary non-git channel.
- [ ] **Review Brief** (team decision needed) — the pre-review screen from
  primer's `PRODUCT_REVIEW_BRIEF.md`: *what changed, why it matters, what
  requires me, why trust this route* — with a reconciling scope funnel
  ("158 changed → collapsed → relevant → 5 chapters"), a human-review
  mission (the few questions needing human judgment), and a trust/readiness
  block (analyzed SHA, evidence availability, generated-vs-fixture
  labeling). Its critique still holds: the panel opens straight into
  chapters — "the map should be the first act, not the unexplained front
  door." Was explicitly labeled a proposal awaiting Yoni/Itay review and
  never ratified — put it on the team agenda before building.
- [ ] **Reviewer posture + risk ledger** (from the same brief, further out) —
  a Focused → Adversarial depth dial, post-review calibration feedback,
  and a live evidence-backed risk ledger that updates as checks run and
  decisions land, using coarse labels rather than precise-looking scores.
- [ ] **Findings & review outcome layers** — primer roadmap steps 12–14,
  unbuilt in both repos: persistent findings (reviewer controls type,
  resolution, recheck, blocking), revision handling (which prior judgments
  survive a push), and review synthesis where the human exclusively picks
  approve / comment / request changes.
- [ ] **Design-doc refresh** — §6/§12 still say SQLite/Drizzle + PAT; reality
  is Supabase + GitHub App OAuth. Update, add this cycle's decisions to the
  §16 log, and adopt the primer brief's positioning line in §3: *"make the
  remaining human-review responsibility explicit, then provide the shortest
  evidence-backed path through it"* (vs CodeRabbit = traverse easily,
  Baz = specialized reviewers).
- [ ] **Settle the name** — Review Story vs Primer is still unresolved and
  both appear across the codebase and docs.

## Product — smaller items

- [ ] **Surface `meta.warnings` in the panel** — the contract carries analyzer
  degradation warnings (e.g. diff-only notes); no UI renders them. Small.
- [ ] **Range comments** — anchors already capture multi-line selections
  (`startLine`), but drafting refuses ranges; GitHub's composer and API both
  support them. Frequently wanted in real review.
- [ ] **Panel view of the pending review** — "Pending on GitHub (n)" so the
  reviewer tracks their comment batch without switching tabs.
- [ ] **`/comment!` force-publish variant** — the API publish path (pending
  review via user token, append-to-existing-review via GraphQL) is built and
  flagged off (`API_PUBLISH_FALLBACK` in `App.tsx`). Give it an explicit
  trigger or delete it.
- [ ] **Demo flow decision** — "Continue without signing in" is dead against
  any auth-enabled API. Hide it when auth is enforced, or drop it.
- [ ] **Demo repo unblock** — publishing to `itayfry/king-of-tokens` needs the
  owner to install the App:
  https://github.com/apps/primer-review-story-dev/installations/new

## Robustness

- [ ] **Dead DOM code cleanup** — the content script carries two generations
  of GitHub-UI selectors plus the pre-composer drafting machinery. Prune once
  the composer-first flow has soaked.
- [ ] **`/changes` navigation check** — anchoring works on GitHub's new diff
  UI; the navigate-to-step scrolling (`primer:navigate-anchor`) was built for
  the old UI and only half-verified there. One deliberate test, fix as needed.
- [ ] **Markup-drift detection** — GitHub redesigns kill the content script
  silently (cost a full day on 2026-07-23). Have it report "context degraded"
  (no headSha / no resolvable paths) so the panel can say "GitHub changed;
  update Primer" instead of failing mysteriously.
- [ ] **Rate-limit handling** on the API's GitHub proxy endpoints.

## Team / process

- [ ] **Review + merge PR #15** — 35+ commits of drift from `main`; risk
  compounds daily. Everything above is easier after merge.
- [ ] **Yoni installs the App** on `yoniaiz/review-story` so the team repo is
  publishable (same install link as above).
- [ ] **Refresh `docs/team-handoff.md`** — still describes the shared-token
  world; auth, persistence, and the comment flow have all changed.

## Done (this cycle — post-hackathon, 2026-07-22 → 23)

- [x] GitHub App OAuth sign-in: server-side exchange, encrypted token storage,
  30-day opaque sessions, serialized refresh rotation, reauth signaling
- [x] Combined install+authorize flow; proactive per-repo install detection
  with install CTAs; friendly callback for GitHub-initiated installs
- [x] Legacy shared `HARNESS_ACCESS_TOKEN` removed end-to-end
- [x] Supabase persistence (migrations applied, RLS on all harness tables) —
  sessions survive API restarts
- [x] Personal review queue (`/api/github/my-pulls`) with refresh button
- [x] Extension ID pinned via manifest key; dev workflow: `.env`-watching API
  restarts, no managed WXT browser, HMR in the developer's own Chrome
- [x] GitHub's new `/changes` diff UI: head SHA from embedded JSON, file
  containers resolved via `diff-<sha256(path)>` hashing, line/side detection
- [x] `/comment` drafts into GitHub's native composer (hover-summoned button,
  full pointer gesture), draft-only by design — the human reviews and submits
  through GitHub's own review flow
- [x] Analyzer: bare/aliased import resolution, per-file attention floors,
  chapter dependency graph + per-file severity in the panel
- [x] API Dockerfile, `.dockerignore`, CI workflow (unverified in CI)
