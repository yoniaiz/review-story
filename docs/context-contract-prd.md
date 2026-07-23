# Primer Context Contract — PRD (v1 draft)

**Status:** proposal for team review (Eric, Yoni, Itay) · not yet ratified
**Depends on:** `review-story-design.md` (core product), `docs/roadmap.md` (Review Brief), `PRODUCT_REVIEW_BRIEF.md` in `erl-jpg/codex-hackathon-primer` (human-review mission, evidence model)
**Author's note:** market claims verified as of early 2026; re-verify before external use.

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

Carried as a fenced block in the PR body (primary — visible to humans,
survives with zero infrastructure) or `.primer/context.md` (alternative for
long content). YAML inside a ` ```primer-context ` fence:

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
  conversation content beyond the distilled fields; the contract lives in
  the PR, which is as public as the repo.

## 8. Risks

| Risk | Mitigation |
|---|---|
| Agents emit confidently wrong contracts | Testimony/evidence separation; verification pass; `inferred` labeling |
| Contract rot after review iterations (code changes, block doesn't) | Key claims to head SHA at emission; stale-SHA banner like every other Primer surface |
| Nobody adopts the format | Tier 1 + fallback generator deliver value at zero adoption; template is the two-minute on-ramp |
| Schema churn breaks emitters | `schema: 1` version field; additive evolution only until v2 |
| GitHub ships the integrated version | Tool-agnosticism; speed; the verification pass (not the format) is the moat |

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
2. PR-body block vs `.primer/context.md` as primary?
3. Does the verification pass run in the analyzer pipeline (Stage 2.5) or as
   part of the future agentic harness (which the roadmap already specs)?
4. Naming: "Primer Context" / "context contract" / something better — and
   does the fence tag (` ```primer-context `) survive a product rename?
5. Sequencing vs the Review Brief: build Tier 1 inside the brief work (they
   feed each other), or land the brief first with contract fields stubbed?
