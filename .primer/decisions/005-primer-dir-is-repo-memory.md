---
id: 005
title: .primer/ is durable repo memory, never a per-PR context carrier
date: 2026-07-24
status: accepted (pending team ratification)
source: docs/context-contract-prd.md §4.6
---

**Decision:** `.primer/` holds durable, cross-PR artifacts only: decision
records (this directory) graduated from merged PRs via human-ratified
proposal PRs, and eventually repo-level config. Per-PR context never
lives in git.

**Rejected:** committing each PR's context block into the repo.

**Why:** per-PR data is PR-scoped; a committed file describes nothing
current after merge, conflicts across parallel PRs, and pollutes the very
diff Primer reviews. What belongs in git is what authoring agents need
while writing code: the decisions that outlive PRs.

**Implications:** graduation is bot-proposed, human-merged — never silent
commits.
