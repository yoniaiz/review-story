# Dogfood experiment: does a decision corpus reach the authoring moment?

**Date:** 2026-07-24 · **Question:** PRD §4.6 — do structured
`.primer/decisions/` records change authoring-agent behavior, and what
format do agents actually use? · **Verdict: yes, decisively.**

## Setup

Six planning-only agent runs (fresh general-purpose agents, no session
context), two probe tasks each designed to collide with settled decisions:

- **Task A** — "publish the comment immediately on /comment, no extra
  clicks" (collides with decisions 001 composer-first, 002 draft-only)
- **Task B** — "persist every PR's context block into the repository as
  committed files" (collides with 004 API-first carrier, 005 .primer-as-
  memory-not-carrier)

Three repo states:

1. **Docs-rich** — the real repo (PRDs, roadmap, CLAUDE.md present)
2. **Bare** — worktree with all direction docs stripped (simulates the
   ordinary, documentation-light repo Primer meets in the wild)
3. **Corpus** — bare + `.primer/decisions/` (6 ADR-lite records distilled
   from this week) + a 3-line CLAUDE.md pointer

## Results

| Arm | Task A (instant publish) | Task B (committed context) |
|---|---|---|
| Docs-rich | Pushed back via **code comments** ("reverses a deliberate safety decision"); no citations; still planned the reversal with gates | Found and cited the PRD ("§4.5–4.6… confirm this is a deliberate revisit"); designed the compliant merge-time alternative |
| Bare | Saw code comments, asked for "explicit acceptance" — then **recommended the worst design anyway**: instantly-public standalone comments, chosen *over* pending reviews | **Decision-blind**: competently designed the explicitly-rejected mechanism (per-PR files on the PR branch riding into main); never surfaced the diff-pollution objection |
| Corpus | Cited 001/002/003/005/006 by number; quoted 001's reserved `/comment!` escape hatch and built exactly that; proposed the decision-log amendment via 005's process; refused the public-publish reading outright | Led with a conflict flag quoting 004/005; **"I will not treat a task description as ratification"**; designed a decision-compatible alternative (orphan archive branch) and proposed it as record 007 |

Cost: corpus agents needed the fewest tool calls (4–6) — records delivered
judgment without archaeology. Docs-rich needed 6–7; bare spent effort
(up to 11) reaching worse conclusions.

## Findings

1. **The product claim is validated.** In a docs-light repo, agents
   confidently rebuild rejected designs (Bare-B) or recommend the
   highest-risk variant while nominally asking permission (Bare-A). Six
   small records + a 3-line pointer converted both into precise,
   citation-backed pushback with decision-compatible alternatives —
   matching or beating the documentation-disciplined arm at lower cost.
2. **Code comments are a real but insufficient channel.** They braked
   Task A everywhere (the flag's comment carries the decision) but provide
   no steering — Bare-A still picked the worst design — and no coverage
   where no comment happens to sit (Bare-B got nothing).
3. **Prose docs work but don't productize.** Docs-rich B equaled corpus
   behavior — because this repo keeps unusually good docs. That channel is
   a team-culture accident; the corpus is its productized form (this was
   the §4.6 decision rationale; the experiment confirms it empirically).

## Format lessons (the experiment's tuning purpose)

- **`Implications` is the operative field.** Corpus-A didn't just respect
  001 — it *built the feature 001's implications reserved* (`/comment!`).
  Records should state what future work must do, not only what was decided.
- **Numbered ids enable precise citation** ("reverses 001 and 002") — keep
  them short and stable.
- **Cross-references between records compound** (001↔002 travelled
  together in every corpus response).
- **`status: accepted (pending team ratification)` was honored** —
  Corpus-B distinguished ratified from pending and asked for formal
  ratification before reversal. The status field is load-bearing.
- **A 3-line pointer suffices for discovery** — no elaborate indexing
  needed; agents read the whole small corpus.
- Unexpected bonus: corpus agents **self-applied the process** — both
  proposed their changes as new/amended decision records via 005's
  human-ratified-PR mechanism, unprompted.

## Actions taken

- The six records are installed as the real `.primer/decisions/` (this
  repo becomes the first production corpus) and `CLAUDE.md` points to them.
- PRD §4.6 experiment-status updated; roadmap dogfood item closed.

## Limits

Single model family, one run per cell (no variance estimate), probe tasks
authored by the same person who wrote the records, plan-only outputs.
Directionally strong, not a benchmark.
