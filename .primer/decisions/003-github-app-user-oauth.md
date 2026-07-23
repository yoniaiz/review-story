---
id: 003
title: GitHub App user-to-server OAuth; no shared tokens
date: 2026-07-23
status: accepted
source: post-hackathon auth work (PR #15)
---

**Decision:** every GitHub action runs on the signed-in user's own token
via GitHub App OAuth; the legacy shared HARNESS_ACCESS_TOKEN was removed
entirely.

**Rejected:** shared PAT / shared access token modes.

**Why:** per-user attribution (comments as the real reviewer), central
revocability, org-admin-controlled installation — the enterprise-correct
access model.

**Implications:** writes require the App installed on the target repo;
features must degrade with an actionable install CTA, not raw 403s.
