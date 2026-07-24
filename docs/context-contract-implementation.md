# Context contract — implementation spec (per mechanism)

Build companion to [`context-contract-prd.md`](context-contract-prd.md)
(§4.5 carrier, §5.5 authoring chain). The PRD says *what and why*; the
[roadmap](roadmap.md) tracks *status*; this file says *how to build each
piece*. Update it as pieces land.

## A. Emitters (authoring side)

### A1. PR template — SHIPPED
`.github/PULL_REQUEST_TEMPLATE.md`. Human prose section on top, fenced
` ```primer-context ` YAML skeleton below with all optional fields present
as comments. GitHub pre-fills it in the web UI only; `gh pr create` and API
callers bypass it (that's what A2–A4 are for).

### A2. Agent instructions — Claude Code SHIPPED, others PENDING
One paragraph, identical semantics per file, telling the agent: on PR
creation, compose the description *around* the contract (intent, decisions,
risk areas, verification, provenance) distilled from the working session;
be accurate over impressive.

- `CLAUDE.md` (repo root) — shipped; produced PR #16's block.
- `AGENTS.md` (repo root) — same paragraph; read by Codex, Devin, and most
  agent CLIs. Straight copy.
- `.cursor/rules/primer-context.mdc` — Cursor's rules format: MDC with
  frontmatter (`description`, `alwaysApply: true`); same paragraph as body.

### A3. `/pr` skill — PENDING
`.claude/skills/primer-context/SKILL.md` (repo-committed so it rides to
every teammate; optional marketplace listing later). Behavior:

1. Distill the session: intent (behavioral claim), decisions with rejected
   alternatives, risk areas as repo-relative paths + notes, honest
   tested/untested lists, provenance.
2. Compose the PR description: human prose wrapping the fenced block.
3. **Pre-flight validate** before creating: run the real parser against the
   drafted body (`tsx -e` importing `parsePrimerContext` from
   `@review-story/contracts`) — the emitter and reader can never drift.
4. Create via `gh pr create --body-file`; on later pushes, update the block
   (`gh pr edit`) when claims changed.
5. Post-deploy: additionally `POST /api/context` (D1) with the parsed
   object; body block becomes the mirror.

### A4. `gh pr create` hook (the authoring hard gate) — PENDING
Claude Code `PreToolUse` hook in the repo's `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "Bash",
      "hooks": [{ "type": "command", "command": "node scripts/primer-context-gate.mjs" }]
    }]
  }
}
```

`scripts/primer-context-gate.mjs`: reads the tool-call JSON from stdin;
ignores commands not matching `gh pr create`; extracts the body
(`--body`/`--body-file`); exits 2 (block, message to the agent: "emit the
primer-context block first — see CLAUDE.md") when no valid block parses,
exit 0 otherwise. Validation = the same `parsePrimerContext`, size bounds
included. PRD open question 6 decides default-on vs opt-in; either way the
hook ships in the setup PR and a repo can delete one settings entry to
disable it.

### A5. Inferred fallback — PENDING (server-side)
When no block exists, the context endpoint (today `GET …/pulls/:n/context`)
returns an inferred contract instead of `absent`: v0 deterministic — intent
from PR title + commit subjects, risk areas from attention-floor paths the
analyzer already computes, `provenance: inferred`, no decisions and no
verification claims (never invent testimony). LLM-assisted inference is a
later upgrade behind the same shape. The panel already renders
`inferred` provenance labeling.

## B. Server side (gated on hosting — see roadmap "event-driven App")

### B1. Context API (PRD §4.5) — PENDING
- `POST /api/context` — auth: harness session (user) or App-authenticated
  agent. Body: `{owner, repo, pullNumber, headSha, context}` where
  `context` validates against `PrimerContextSchema`. Stores one immutable
  row per `(repo, pr, headSha)` submission with the authenticated identity
  and timestamp; resubmission for the same SHA appends a new version.
- Supabase table `primer_contexts` (RLS like the other harness tables):
  `id, repo_node_id/owner+repo, pull_number, head_sha, submitted_by,
  submitted_at, context jsonb`.
- Reader precedence: latest API record for the current head SHA → body
  block (fallback) → inferred (A5). When both exist and differ, surface
  "mirror out of date" in the panel.

### B2. Check-run (enforcement rungs 3–4) — PENDING
Webhook `pull_request` (opened, edited, synchronize) → parse/lookup context
→ create a check-run on the head SHA: success "context present and valid
(source: api|body)" / neutral-with-annotation "missing — Primer inferred
one". Required-status mode is pure repo configuration on GitHub's side; no
extra code. Attestation text includes the authenticated submitter when the
source is the API.

## C. Reader (already shipped, for reference)
`parsePrimerContext` in `@review-story/contracts` (size/alias-bounded fenced
YAML); `GET /api/github/repos/:o/:r/pulls/:n/context`; panel brief (claim
headline, verdict, route highlights, elevation-only severity merge). Any new
carrier must flow through the same parser and schema — one validation path,
everywhere.

## Build order recommendation
A2 remainder (minutes) → A4 hook + A3 skill (the real authoring guarantee,
buildable pre-deploy) → deploy → B1 → B2 → A5. The Tier-2 validation gate
(PRD §9) can run any time before team ratification.
