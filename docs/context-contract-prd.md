# Primer Context Contract — PRD (v1.1 draft)

**Status:** proposal for team review (Eric, Yoni, Itay) · not yet ratified ·
Tier 2/3 partially implemented and dogfooded (see §11)
**Depends on:** `review-story-design.md` (core product), `docs/roadmap.md` (Review Brief), `PRODUCT_REVIEW_BRIEF.md` in `erl-jpg/codex-hackathon-primer` (human-review mission, evidence model)
**Author's note:** market claims verified as of early 2026; re-verify before external use.
**v1.1 changes:** carrier architecture revised to API-first with the PR-body
block demoted to ingest/mirror/fallback (§4.5); authoring-side generation and
enforcement chain specified (§5.5); implementation status added (§11).

---

## 1. Problem

The richest context about a change — intent, decisions made, alternatives
rejected, what the agent did versus what the human directed, known weak spots
— is created in the authoring environment and dies there. What survives to
review is, in descending order of reliability:

1. The diff (ground truth, but intent-free)
2. Commit messages, branch name, linked issues (uneven, unparsed)
3. The PR description (often thin when human-written; when agent-written,
   rich but **unstructured, unverified testimony** that no tool checks)
4. Repo-resident direction docs (design docs, roadmaps, `CLAUDE.md` /
   `AGENTS.md`) — the only place "does this PR align with where the product
   is going?" can be answered, and nothing reads them at review time

Reviewers therefore re-derive intent from the diff — the single most
expensive part of reviewing 80-file agent-authored drops — and have no way to
check the author's claims against the implementation.

As agent-authored PRs become the majority, this asymmetry compounds: more
testimony, zero verification.

## 2. Product hypothesis

> A structured, machine-readable **context contract** emitted at PR-creation
> time — and verified by Primer against the diff — turns author testimony
> into reviewable claims, and makes "what needs my human judgment" a
> generated, evidence-backed section rather than a guess.

The differentiated capability this unlocks is **intent-vs-implementation
diffing**: *"the author claims selection state is preserved; no changed or
related test touches selection — scrutinize here."* Only a tool holding both
the claim (contract) and an evidence pipeline (Primer's analyzer) can do
this.

## 3. Market position (early-2026 snapshot)

| Player | What they do | What they don't |
|---|---|---|
| CodeRabbit, Qodo PR-Agent, Greptile, Ellipsis | Post-hoc summaries/walkthroughs re-derived from the diff | No authoring intent; no claim verification |
| GitHub Copilot / Workspace | PR summaries; spec→plan→implementation traces | Traces locked to GitHub's authoring flow; not a structured artifact consumed by independent review tools |
| Agent CLIs (Claude Code, Codex, Devin, Cursor) | Rich prose PR descriptions of their own sessions | Unstructured testimony; nothing parses or verifies it |
| Baz | Verifies against linked requirements (tickets) | Ticket-grain intent, not decision-grain session context |
| Standards layer | `AGENTS.md`/`CLAUDE.md` = instructions **into** agents | No adopted standard for context **out of** agents into review |

**The gap:** everyone generates descriptions; nobody defines a contract that
a separate review tool verifies against the diff. **Strategic risk:** GitHub
could vertically integrate Workspace traces into review; the counter is that
Primer's contract is tool-agnostic (any agent, any editor, humans).

## 4. The contract (v0 shape — freeze after team review)

Interchange format: YAML inside a ` ```primer-context ` fence. Where it
*lives* is §4.5 — the format is stable across carriers:

```yaml
schema: 1
intent: >
  Behavioral outcome the change is supposed to accomplish, one paragraph,
  written as a claim ("reviewers can now sign in with GitHub and publish
  comments as themselves").
decisions:
  - choice: composer-first comment drafting
    rejected: API-first publish
    why: preserves the human checkpoint before anything reaches GitHub
risk_areas:
  - path: apps/api/src/auth.ts
    note: refresh-token rotation under concurrent requests
verification:
  tested: [sign-in loop, persistence across restarts, composer drafting]
  untested: [revoke/re-auth loop]
provenance: agent  # agent | human | mixed
alignment:
  roadmap_items: [docs/roadmap.md#deployment]  # optional pointers into repo docs
```

Design rules:

- **Every field optional except `schema` and `intent`.** A thin block is
  better than no block; missing fields degrade gracefully.
- **The contract is testimony, never evidence.** Primer displays it labeled
  *author-claimed*, verifies what it can, and never merges claims into its
  own evidence-anchored output. A claim Primer cannot support becomes a
  scrutiny hint, not a fact.
- **Human-readable first.** The block must read as a decent PR description
  section even for someone who has never heard of Primer.

## 4.5 Carrier architecture — API-first, body as mirror and fallback (v1.1)

The PR-body block was the right bootstrap (zero infrastructure, works with no
adoption) and is the wrong **system of record** for a product:

- **No integrity** — anyone with edit rights can rewrite it, silently, and
  nobody audits GitHub's body-edit history.
- **Self-declared provenance** — `provenance: agent` is a string anyone can
  type; the enterprise audit-trail story cannot rest on the honor system.
- **One mutable blob per PR** — claims are made about a specific head SHA,
  but the block has no per-push versioning; three pushes later it silently
  describes code that no longer exists.
- **Fragile transport** — fenced YAML survives until a body-editing bot or
  template merge corrupts it.
- **Pollutes the human artifact** — descriptions are for people.

**Product architecture (requires the hosted API):**

1. Emitters **POST the contract to Primer's API**, authenticated via the
   GitHub App / user token — provenance becomes a verified fact ("submitted
   by identity X"), stored keyed by `repo + PR + head SHA` with immutable
   history per push.
2. The same emitter writes a **short human-readable summary** into the PR
   body — a mirror for humans and non-Primer readers, not the record.
3. Primer's reader **prefers the API record, falls back to parsing the
   body** — the zero-adoption path (hand-written block, no tooling) keeps
   working exactly as today; the block demotes from system-of-record to
   ingestion format + human mirror.
4. The check-run (§6.5) attests against the API record: "context submitted
   by authenticated agent X at SHA Y" — the audit-trail claim made honest.

Until the API is hosted, the body block **is** the carrier (current state,
§11); nothing about the format changes when the API lands.

## 4.6 `.primer/` as repo-resident memory (proposal, distinct from the carrier)

`.primer/context.md` lost the per-PR-carrier role for scope reasons: a
committed file pollutes the very diff Primer reviews, stores PR-scoped data
in branch-scoped storage (post-merge it describes nothing current; parallel
PRs conflict), and can't be edited mid-review without moving the head SHA.

Its unique property — **in the repo**: versioned with the code,
host-agnostic, greppable, reviewable as content — fits a different role:
**durable repo memory**, the accumulation layer per-PR context lacks.

- **Decision graduation**: when a PR merges, the durable residue of its
  contract (decisions that outlive the PR) distills into
  `.primer/decisions/` — ADR-shaped records agents and humans already know
  how to read. Candidate automation: the merge-time webhook proposes the
  graduation commit. The graduation commit is its own change, so PR diffs
  stay clean.
- **Tier-1 source**: the analyzer reads `.primer/decisions/` alongside the
  other direction docs — "this PR contradicts a decision recorded in
  `.primer/decisions/007-composer-first.md`" becomes a checkable alignment
  note, and the corpus compounds with every merge (the "continual codebase
  context" layer).
- **Config home**: repo-level Primer settings (`.primer/config.yaml` —
  enforcement level, ignore patterns, conventions) live in the same
  directory when Primer grows configurable behavior.

Status: proposal only — needs design (graduation format, dedup, who
approves the graduation commit) and team ratification alongside the rest of
this PRD. Nothing implements it yet.

## 5. How Primer consumes it

Three tiers, buildable independently and in order:

**Tier 1 — exploit what already survives (no contract needed).**
Analyzer ingests commit messages, linked issues, and repo-resident direction
docs (`docs/*.md`, `CLAUDE.md`, `AGENTS.md`) from the tarball it already has.
Output: an *alignment note* in the story ("implements roadmap item X";
"touches an area the design doc marks deferred") with citations to the doc
lines. Feeds the Review Brief's "why it matters" section.

**Tier 2 — parse and verify the contract.**
- Parse the block from PR body / `.primer/context.md`; zod-validate; ignore
  malformed blocks with a visible "context block present but unreadable" note.
- Render in the Review Brief: intent (labeled author-claimed), decision log,
  risk areas (these seed the **human-review mission** — the piece the primer
  brief said couldn't be built honestly without this data).
- **Verification pass** (the differentiator): for each checkable claim, the
  analyzer looks for supporting/contradicting evidence — `verification.tested`
  entries with no corresponding test changes, `risk_areas` paths not covered
  by any chapter's scrutiny hints, intent claims about behavior with no
  anchor in the diff. Mismatches become scrutiny hints with evidence.

**Tier 3 — emitters.**
- **PR template** (`.github/PULL_REQUEST_TEMPLATE.md`) with the block
  skeleton — the floor, works for humans, zero tooling.
- **Agent-instructions paragraph** for `CLAUDE.md` / `AGENTS.md` /
  `.cursor/rules`: "on PR creation, emit the primer-context block distilled
  from this session." Committed once; rides the repo to every teammate's
  agent.
- **Packaged skill** (`.claude/skills/primer-context/`) for richer distilling
  and pre-flight validation. Repo-committed; marketplace listing optional.
- **Fallback generator**: Primer drafts the block itself from commits + diff
  when absent, labeled `provenance: inferred` — repos with zero adoption
  still get the degraded experience, honestly labeled.

## 5.5 Authoring-side generation — how a PR drives this

The moment the PR description is written is the last moment the authoring
context still exists; the design intercepts that moment, per tool, with the
repo as the universal adapter (one "Primer setup PR" ships every file below):

| Tool | Mechanism | Strength |
|---|---|---|
| Claude Code | `CLAUDE.md` instructions; optional `/pr` skill that composes description + contract and (post-deploy) POSTs to the API | nudge → strong |
| Claude Code, enforced | A hook intercepting `gh pr create`: blocks creation when no contract is present — the only authoring-side *hard* gate available today | gate |
| Cursor | `.cursor/rules` with the same emit instruction | nudge |
| Codex / other agents | `AGENTS.md` | nudge |
| Humans | PR template scaffolds the block; their assistant fills it from diff + commits on request | weakest |

Two principles:

- **The contract is the description's skeleton, not an attachment.** The
  emitting agent writes the PR description *around* intent / decisions /
  risks — prose for humans wrapping the structured block — so emitting costs
  nothing extra at the moment the agent already writes a description.
- **The same repo docs serve both directions.** `CLAUDE.md`, `AGENTS.md`,
  and the direction docs instruct agents while authoring *and* are what
  Tier 1 reads at review time; the `alignment` field points back into them.
  Keeping direction docs current feeds the product directly.

**The enforcement chain.** No single layer guarantees the contract; the
chain does:

1. **Generation moment** (authoring tool): instructions/skill make the agent
   write the description *around* the contract — intent, decisions, and
   risks are the description's structure, with prose for humans wrapped
   around them, so the block is never extra work after the fact.
2. **Creation gate** (Claude Code hook, optional per repo): `gh pr create`
   without a block → blocked with "emit the context block first." A hard
   stop before GitHub ever sees the PR.
3. **Server flag** (post-deploy webhook): PR opened → Primer's check-run
   marks ✓/⚠ in the merge box. The author sees it instantly; visibility and
   social pressure do the rest.
4. **Hard policy** (opt-in): the check-run becomes a branch-protection
   required status — no merge without valid context. Enterprise mode.
5. **Backstop** (always on): no block anywhere → Primer infers one from
   commits + diff, labeled `inferred`. The reviewer experience never
   degrades to zero.

Graduated by appetite: a solo dev gets 1 + 5, a team runs 1–3, an
enterprise flips on 4.

## 6. Installation & distribution story

The repo is the distribution channel. Adoption for a team is **one setup PR**
(template + instructions paragraph + optional skill), the same
one-time-per-repo motion as the GitHub App install — bundle them as a single
"Primer setup" flow. No per-user installs, no version skew, works identically
for Claude Code, Codex, Cursor, and humans.

## 6.5 Enterprise posture & adjacent integrations

**Point of access.** The org-level GitHub App install is the enterprise entry
point: admin-granted, scoped, auditable, centrally revocable. Developer
identity rides GitHub org membership (inheriting the org's SSO/SAML);
extensions deploy fleet-wide via Chrome enterprise policy. The open
architectural fork: the API sees code and review data, so enterprise means
either a self-hosted/VPC deployment (the existing single-container Docker +
Postgres shape fits) or a hosted tier with zero-retention LLM agreements and
the §12 retention policy made contractual.

**Carrying the contract by policy, not habit — the enforcement ladder:**

1. *Ambient*: template + agent-instructions files make the block the default.
2. *Visible*: the App posts a check-run per PR — "context block present and
   valid" vs "missing — Primer inferred one." Non-blocking; absence becomes
   visible in the merge box.
3. *Required* (opt-in per repo/org): the check becomes a branch-protection
   required status; the contract then carries on 100% of PRs by policy.

Level 3 is also the compliance story: "every merged change has documented
intent, declared provenance (agent vs human), named risk areas, and evidence
of human review" is the change-management audit trail SOC 2 / ISO
change-control asks for — generated as a by-product. For enterprises,
"which Q3 changes were agent-authored and who reviewed them?" may be a
stronger buying reason than the review UX itself.

**Notion / Jira / Linear.** Intent exists at three grains; each layer owns
one: **requirement** (ticket/PRD — Jira, Linear, Notion), **decision** (the
authoring session — the contract, Primer's turf, captured by nobody else),
**implementation** (the diff — GitHub). Integrations are read-only context
resolvers for the contract's `alignment` pointers: Primer fetches the linked
requirement text into the Review Brief and upgrades verification to the full
chain — *ticket says X → author claims X implemented → diff shows/lacks
evidence*. No requirement management, no ticket write-back — the moment we
write to Jira we are a project-management tool and off-thesis.

## 7. Non-goals

- Not a session-transcript format — the contract is a distillation, small
  enough to read in the PR body.
- Not auto-review: Primer never converts claims into verdicts; it converts
  them into *where to look*.
- Not a replacement for tickets/specs — `alignment` may point at them, but
  requirement tracking (Baz's turf) is out of scope.
- No private-context exfiltration: the emitting skill must not include
  conversation content beyond the distilled fields; the body mirror is as
  public as the repo, and the API record carries the same content at the
  same sensitivity — never more.

## 8. Risks

| Risk | Mitigation |
|---|---|
| Agents emit confidently wrong contracts | Testimony/evidence separation; verification pass; `inferred` labeling |
| Contract rot after review iterations (code changes, block doesn't) | Key claims to head SHA at emission; stale-SHA banner like every other Primer surface |
| Nobody adopts the format | Tier 1 + fallback generator deliver value at zero adoption; template is the two-minute on-ramp |
| Schema churn breaks emitters | `schema: 1` version field; additive evolution only until v2 |
| GitHub ships the integrated version | Tool-agnosticism; speed; the verification pass (not the format) is the moat |
| API record and body mirror diverge | Reader prefers the API record and shows a "mirror out of date" note when the body block differs; the mirror is explicitly non-authoritative |
| Body block tampered after review starts (pre-API, or fallback path) | Per-SHA keying at emission; post-API, the check-run attests the authenticated record and the body is never the record |

## 9. Validation

- **Dogfood immediately**: emit the block on every review-story PR (this
  repo's `CLAUDE.md` gets the instructions paragraph first).
- Tier 2 gate: on 3 known PRs, the verification pass must produce at least
  one true, useful intent-vs-implementation mismatch and zero false claims
  presented as facts.
- Adoption signal worth tracking once real users exist: % of reviewed PRs
  carrying a block, and whether reviewers open the human-review mission.

## 10. Open questions for team review

1. Ratify the v0 field set — anything missing that authors would actually
   fill? Anything that will rot unfilled?
2. ~~PR-body block vs `.primer/context.md` as primary?~~ Superseded by §4.5
   (v1.1): API-first once hosted; body block as ingest/mirror/fallback.
   `.primer/context.md` is no longer a carrier candidate — it is reframed
   as repo-resident memory (§4.6: decision graduation on merge, Tier-1
   source, config home). Ratify §4.5 and §4.6 as a pair.
3. Does the verification pass run in the analyzer pipeline (Stage 2.5) or as
   part of the future agentic harness (which the roadmap already specs)?
4. Naming: "Primer Context" / "context contract" / something better — and
   does the fence tag (` ```primer-context `) survive a product rename?
5. Sequencing vs the Review Brief: build Tier 1 inside the brief work (they
   feed each other), or land the brief first with contract fields stubbed?
6. The Claude Code `gh pr create` hook (§5.5): ship it in the setup PR as
   default-on, or opt-in? A hard authoring gate is the strongest guarantee
   and the most annoying failure mode.

## 11. Implementation status (2026-07-24, branch `eric-context-contract`, PR #16)

Built and dogfooded ahead of ratification — the format needed real usage to
critique; treat all of it as revisable by team review:

- **Contracts**: `PrimerContextSchema` + `parsePrimerContext` (size-bounded,
  alias-limited fenced-YAML extraction hardened against hostile PR bodies).
- **API**: `GET /api/github/repos/:owner/:repo/pulls/:n/context` — parses the
  body fresh with the caller's token. (Pull-based; the §4.5 POST API and the
  §6.5 check-run wait on hosting — see the roadmap's event-driven-App chain.)
- **Panel**: the review opening is a unified brief — author's claim as the
  provenance-labeled headline, a deterministic one-sentence verdict,
  expandable chapter route with author-ask highlights, untested warning
  line, inline decisions disclosure. Author risk areas raise matching files
  to needs-human (elevation only); stale flagged paths surfaced.
- **Emitters**: PR template + `CLAUDE.md` live in this repo; PR #16's own
  description carries the first real block. Cursor/AGENTS.md variants and
  the `/pr` skill + creation hook are not yet written.
- **Verification pass**: only the deterministic slices exist (risk-path
  matching, untested surfacing, stale detection). Test-evidence
  cross-referencing and intent-vs-diff checking are unbuilt (open question
  3 decides where they run).
