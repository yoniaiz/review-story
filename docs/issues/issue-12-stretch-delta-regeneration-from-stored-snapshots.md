# Stretch: delta regeneration from stored snapshots

> GitHub: https://github.com/yoniaiz/review-story/issues/12

## What to build

The round-2 stretch goal, built entirely from stored snapshots. Code classifies the current PR diff against the diff snapshot stored at the viewer's checkpoint into NEW/MODIFIED/DROPPED/UNTOUCHED per file (nearest older snapshot with a notice if the exact checkpoint is missing). If anything is NEW or DROPPED, one cheap routing call (haiku-tier) maps files to join-existing/new-chapter/dropped under a minimum-edit constraint that preserves stable chapter ids. Scoped regeneration follows: full Stage 2 for new chapters, changed-since-checkpoint Stage 2 for modified ones, Stage 3 always re-runs. Delta above ~50% of the story falls back to full regeneration with an id-reuse hint.

## Parent

#1

## Acceptance criteria

- [ ] Classification produces per-file NEW/MODIFIED/DROPPED/UNTOUCHED against a stored snapshot in pure code
- [ ] Routing call preserves untouched chapter ids (checkmarks/badges stay stable)
- [ ] Only affected chapters re-run Stage 2; Stage 3 always re-runs; untouched chapters load from cache
- [ ] Delta above ~50% triggers full regeneration with an id-reuse hint
- [ ] Demo flow: push the prepared commit, refresh, see one updated and one new chapter

## Blocked by

- #11
