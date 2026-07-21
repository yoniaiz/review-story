import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { extractChangedSymbols } from "../src/symbol-extractor.js";

describe("symbol extractor", () => {
  it("maps a TypeScript hunk to its enclosing function with tree-sitter", () => {
    const source = [
      "export class SessionStore {",
      "  rotateToken(value: string) {",
      "    return value.trim();",
      "  }",
      "}",
    ].join("\n");
    expect(
      extractChangedSymbols("src/session.ts", source, [
        { oldStart: 3, oldLines: 1, newStart: 3, newLines: 1 },
      ]),
    ).toContain("rotateToken");

    expect(
      extractChangedSymbols("src/session.ts", source, [
        { oldStart: 2, oldLines: 1, newStart: 2, newLines: 1 },
      ]),
    ).toContain("rotateToken");
  });

  it("uses the regex fallback for non-JavaScript files", () => {
    const source = "class PaymentGateway:\n    def charge(self):\n        return True\n";
    expect(
      extractChangedSymbols("payments/gateway.py", source, [
        { oldStart: 3, oldLines: 1, newStart: 3, newLines: 1 },
      ]),
    ).toEqual(["charge"]);
  });

  it("uses tree-sitter for JavaScript and returns every declaration in a hunk", async () => {
    const source = await readFile(
      new URL("./fixtures/symbols/multi.js", import.meta.url),
      "utf8",
    );
    expect(
      extractChangedSymbols("src/multi.js", source, [
        { oldStart: 1, oldLines: 2, newStart: 1, newLines: 2 },
      ]),
    ).toEqual(["first", "second"]);
  });

  it("does not let a local declaration mask its enclosing method", () => {
    const source = [
      "export class SessionStore {",
      "  rotateToken(value: string) {",
      "    const normalized = value.trim();",
      "    return normalized;",
      "  }",
      "}",
    ].join("\n");
    expect(
      extractChangedSymbols("src/session.ts", source, [
        { oldStart: 3, oldLines: 1, newStart: 3, newLines: 1 },
      ]),
    ).toEqual(["rotateToken"]);
  });
});
