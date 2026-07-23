---
id: 001
title: Comment drafting goes through GitHub's native composer, not the API
date: 2026-07-23
status: accepted
source: PR #16 lineage; reverses design-doc decision D4
---

**Decision:** `/comment` fills GitHub's inline composer; the user reviews,
edits, and submits through GitHub's own review flow.

**Rejected:** publishing pending review comments directly via the GitHub
API as the primary path.

**Why:** the composer is the human checkpoint — nothing reaches GitHub
without passing the author's eyes. API-created comments also don't render
until a page refresh.

**Implications:** the API publish path exists but is flagged off
(`API_PUBLISH_FALLBACK` in `apps/extension/entrypoints/sidepanel/App.tsx`);
any future instant-publish feature must be an explicit opt-in variant
(e.g. `/comment!`), never the default. See also 002.
