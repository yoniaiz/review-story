import { describe, expect, it } from "vitest";
import { distanceFromScrollEnd, isNearScrollEnd } from "./chat-scroll";

describe("chat scroll position", () => {
  it("recognizes a reader at the bottom", () => {
    expect(isNearScrollEnd({ scrollHeight: 1_000, scrollTop: 600, clientHeight: 400 })).toBe(true);
  });

  it("allows a small buffer near the bottom", () => {
    expect(isNearScrollEnd({ scrollHeight: 1_000, scrollTop: 540, clientHeight: 400 })).toBe(true);
    expect(isNearScrollEnd({ scrollHeight: 1_000, scrollTop: 520, clientHeight: 400 })).toBe(false);
  });

  it("clamps browser rounding beyond the scroll end", () => {
    expect(distanceFromScrollEnd({ scrollHeight: 500, scrollTop: 101, clientHeight: 400 })).toBe(0);
  });
});
