# Primer extraction

This directory contains Primer's web review modules and Chrome-extension support code extracted from
[`erl-jpg/codex-hackathon-primer`](https://github.com/erl-jpg/codex-hackathon-primer)
at these pinned commits:

- `main`: `910e2af5a1ad80aa8b51c0ec5cc2c65bb4019251`
- `codex/chrome-extension-review-flow`: `61ac03fc26be135f1bfedb3d12e8386e95397d7d`

The extension implementation lives on the source repository's
`codex/chrome-extension-review-flow` branch rather than `main`. Its side panel,
background worker, GitHub content script, conversation UI, and safe drafting
flow are wired into this repository's WXT app.

Included locally:

- the Review Story React components and responsive styles;
- review-plan validation, state, and repository-map projection logic;
- fixtures for Twenty pull requests `#22819` and `#22908`;
- ordered review evidence for pull request `#22819`.
- page-context and exact diff-anchor contracts;
- the fixture-backed AI conversation UI and review controls;
- `/comment` parsing and native GitHub draft-composer integration;
- deterministic tests for context, anchors, routes, and comment drafting.

The side panel has no runtime dependency on the source repository, a Next.js
server, or a remote font provider. Source adjustments are limited to workspace
import wiring and strict TypeScript compatibility fixes. General AI replies are
still marked unconnected in the source implementation; `/comment`, local review
state, GitHub context tracking, and navigation are implemented.

The concurrently developed King-of-Tokens chat prototype was preserved under
`prototypes/king-of-tokens-chat` while the source branch's context-aware panel
was made active.
