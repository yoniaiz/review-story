# Roadmap & backlog

Living tracker for post-hackathon development. Concept and design rationale
live in [`review-story-design.md`](../review-story-design.md); this file
tracks what to build next and why. Update it as items land — checked items
stay for one release cycle, then move to the changelog section at the bottom.

_Last updated: 2026-07-23 (branch `eric-post-hackathon`, PR yoniaiz/review-story#15)._

## Verification — minutes each, closes the auth arc

- [ ] **Revoke/re-auth loop**: revoke the GitHub App authorization (GitHub →
  Settings → Applications), confirm the panel lands on the sign-in screen with
  the expiry message and that sign-in recovers. Last untested auth failure path.
- [ ] **CI first-run review**: the workflow has triggered on PR #15 pushes but
  nobody has checked the results. Fix workflow/Dockerfile issues before deploy.

## Deployment — nothing is hosted yet

- [ ] Docker build + local run of the API image (`apps/api/Dockerfile`).
- [ ] Host the API (Fly / Railway / Cloud Run). Prod env needs: Supabase URL +
  secret key, `TOKEN_ENCRYPTION_KEY`, GitHub App client id/secret/slug,
  `API_PUBLIC_BASE_URL`, `EXTENSION_IDS`.
- [ ] Add the hosted callback URL to the GitHub App (Apps support multiple
  callbacks — dev `127.0.0.1` and prod can coexist).
- [ ] Build the extension against the hosted API (`VITE_API_BASE_URL`) and
  decide distribution: Chrome Web Store (new extension ID → append to
  `EXTENSION_IDS`) vs. shared unpacked build.
- [ ] Prod data posture: `REVIEW_SESSION_STORE=supabase`, story cache
  location, and a cleanup job for expired `harness_sessions` rows.

## Product

- [ ] **Surface `meta.warnings` in the panel** — the contract carries analyzer
  degradation warnings (e.g. diff-only notes); no UI renders them. Small.
- [ ] **Range comments** — anchors already capture multi-line selections
  (`startLine`), but drafting refuses ranges; GitHub's composer and API both
  support them. Frequently wanted in real review.
- [ ] **Panel view of the pending review** — "Pending on GitHub (n)" so the
  reviewer tracks their comment batch without switching tabs.
- [ ] **`/comment!` force-publish variant** — the API publish path (pending
  review via user token, append-to-existing-review via GraphQL) is built and
  flagged off (`API_PUBLISH_FALLBACK` in `App.tsx`). Give it an explicit
  trigger or delete it.
- [ ] **Demo flow decision** — "Continue without signing in" is dead against
  any auth-enabled API. Hide it when auth is enforced, or drop it.
- [ ] **Demo repo unblock** — publishing to `itayfry/king-of-tokens` needs the
  owner to install the App:
  https://github.com/apps/primer-review-story-dev/installations/new

## Robustness

- [ ] **Dead DOM code cleanup** — the content script carries two generations
  of GitHub-UI selectors plus the pre-composer drafting machinery. Prune once
  the composer-first flow has soaked.
- [ ] **`/changes` navigation check** — anchoring works on GitHub's new diff
  UI; the navigate-to-step scrolling (`primer:navigate-anchor`) was built for
  the old UI and only half-verified there. One deliberate test, fix as needed.
- [ ] **Markup-drift detection** — GitHub redesigns kill the content script
  silently (cost a full day on 2026-07-23). Have it report "context degraded"
  (no headSha / no resolvable paths) so the panel can say "GitHub changed;
  update Primer" instead of failing mysteriously.
- [ ] **Rate-limit handling** on the API's GitHub proxy endpoints.

## Team / process

- [ ] **Review + merge PR #15** — 35+ commits of drift from `main`; risk
  compounds daily. Everything above is easier after merge.
- [ ] **Yoni installs the App** on `yoniaiz/review-story` so the team repo is
  publishable (same install link as above).
- [ ] **Refresh `docs/team-handoff.md`** — still describes the shared-token
  world; auth, persistence, and the comment flow have all changed.

## Done (this cycle — post-hackathon, 2026-07-22 → 23)

- [x] GitHub App OAuth sign-in: server-side exchange, encrypted token storage,
  30-day opaque sessions, serialized refresh rotation, reauth signaling
- [x] Combined install+authorize flow; proactive per-repo install detection
  with install CTAs; friendly callback for GitHub-initiated installs
- [x] Legacy shared `HARNESS_ACCESS_TOKEN` removed end-to-end
- [x] Supabase persistence (migrations applied, RLS on all harness tables) —
  sessions survive API restarts
- [x] Personal review queue (`/api/github/my-pulls`) with refresh button
- [x] Extension ID pinned via manifest key; dev workflow: `.env`-watching API
  restarts, no managed WXT browser, HMR in the developer's own Chrome
- [x] GitHub's new `/changes` diff UI: head SHA from embedded JSON, file
  containers resolved via `diff-<sha256(path)>` hashing, line/side detection
- [x] `/comment` drafts into GitHub's native composer (hover-summoned button,
  full pointer gesture), draft-only by design — the human reviews and submits
  through GitHub's own review flow
- [x] Analyzer: bare/aliased import resolution, per-file attention floors,
  chapter dependency graph + per-file severity in the panel
- [x] API Dockerfile, `.dockerignore`, CI workflow (unverified in CI)
