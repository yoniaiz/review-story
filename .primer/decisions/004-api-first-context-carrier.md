---
id: 004
title: The context contract's system of record is Primer's API, not the PR body
date: 2026-07-24
status: accepted (pending team ratification)
source: docs/context-contract-prd.md §4.5
---

**Decision:** once hosted, contracts are POSTed to Primer's API
(authenticated, keyed by repo+PR+head SHA, immutable per-push history).
The PR-body block demotes to human mirror + zero-adoption fallback.

**Rejected:** the PR body as permanent record; committed per-PR context
files (`.primer/context.md`).

**Why:** body blocks have no integrity (silently editable), self-declared
provenance, no per-push versioning, fragile transport. Committed per-PR
files pollute the reviewed diff and store PR-scoped data in branch-scoped
storage.

**Implications:** never design features that treat the PR body block as
authoritative; the reader precedence is API record → body block → inferred.
