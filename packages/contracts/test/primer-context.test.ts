import { describe, expect, it } from "vitest";
import { parsePrimerContext } from "../src/primer-context.js";

const VALID_BLOCK = `
## Summary

Some prose the humans read.

\`\`\`primer-context
schema: 1
intent: >
  Reviewers can sign in with GitHub and publish comments as themselves.
decisions:
  - choice: composer-first drafting
    rejected: API-first publish
    why: preserves the human checkpoint
risk_areas:
  - path: apps/api/src/auth.ts
    note: refresh rotation under concurrency
verification:
  tested: [sign-in loop]
  untested: [revoke flow]
provenance: agent
\`\`\`

Trailing prose.
`;

describe("parsePrimerContext", () => {
  it("parses a valid fenced block out of surrounding markdown", () => {
    const result = parsePrimerContext(VALID_BLOCK);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.context.intent).toContain("sign in with GitHub");
    expect(result.context.decisions).toHaveLength(1);
    expect(result.context.risk_areas?.[0]?.path).toBe("apps/api/src/auth.ts");
    expect(result.context.verification?.untested).toEqual(["revoke flow"]);
    expect(result.context.provenance).toBe("agent");
  });

  it("reports absent for bodies without a block", () => {
    expect(parsePrimerContext("just a PR description").status).toBe("absent");
    expect(parsePrimerContext("").status).toBe("absent");
    expect(parsePrimerContext(null).status).toBe("absent");
  });

  it("only intent and schema are required", () => {
    const result = parsePrimerContext("```primer-context\nschema: 1\nintent: minimal\n```");
    expect(result.status).toBe("ok");
  });

  it("rejects unknown schema versions and missing intent", () => {
    expect(parsePrimerContext("```primer-context\nschema: 2\nintent: x\n```").status).toBe("invalid");
    expect(parsePrimerContext("```primer-context\nschema: 1\n```").status).toBe("invalid");
  });

  it("rejects malformed YAML with a reason instead of throwing", () => {
    const result = parsePrimerContext("```primer-context\nschema: [unclosed\n```");
    expect(result.status).toBe("invalid");
  });

  it("bounds hostile input size", () => {
    const huge = "```primer-context\nschema: 1\nintent: " + "x".repeat(20_000) + "\n```";
    const result = parsePrimerContext(huge);
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") expect(result.reason).toContain("size limit");
  });
});
