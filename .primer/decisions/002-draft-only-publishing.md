---
id: 002
title: Primer never publishes without an explicit human submit
date: 2026-07-23
status: accepted
source: /comment flow design discussion
---

**Decision:** Primer drafts; the human submits. Staged comments become
GitHub pending reviews only via the user's own "Start a review" /
"Submit review" clicks.

**Rejected:** auto-submitting drafted comments; auto-clicking GitHub's
composer buttons.

**Why:** comments post under the user's identity; an AI-drafted comment
must always pass through the author's judgment. GitHub's "Add single
comment" button publishes instantly and publicly — automation near it is
one UI change away from an irreversible mistake.

**Implications:** any feature reducing clicks in the comment flow must
preserve a human checkpoint before content reaches GitHub.
