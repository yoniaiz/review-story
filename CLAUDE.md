# Review Story — agent instructions

## Decision records

Before designing or implementing changes, read `.primer/decisions/` —
settled product decisions live there. Do not reverse a recorded decision
without flagging it explicitly; propose amendments as changes to the
records themselves (human-ratified via PR, per decision 005).

## Pull request context block (dogfooding our own product)

When creating or updating a pull request, include a ` ```primer-context ` block
in the PR description, distilled from the working session (spec:
`docs/context-contract-prd.md`; template: `.github/PULL_REQUEST_TEMPLATE.md`):

- `intent`: the behavioral outcome, phrased as a claim reviewers can verify.
- `decisions`: significant choices made, what was rejected, and why.
- `risk_areas`: paths the author wants human eyes on, with a short note.
- `verification`: what was actually tested vs. knowingly untested — be
  honest; overstating `tested` defeats the product.
- `provenance`: `agent`, `human`, or `mixed`.

The block is author testimony: Primer displays it as claims and verifies it
against the diff. Keep it accurate over impressive.
