import { describe, expect, it } from "vitest";
import { isRateLimited, resetRateLimit } from "@/lib/rate-limit";

describe("rate-limit", () => {
  it("allows up to 5 attempts within the window", () => {
    const key = `test:${Math.random()}`;
    for (let i = 0; i < 5; i++) {
      expect(isRateLimited(key)).toBe(false);
    }
  });

  it("blocks the 6th attempt within the same window", () => {
    const key = `test:${Math.random()}`;
    for (let i = 0; i < 5; i++) isRateLimited(key);
    expect(isRateLimited(key)).toBe(true);
  });

  it("resets after resetRateLimit is called", () => {
    const key = `test:${Math.random()}`;
    for (let i = 0; i < 6; i++) isRateLimited(key);
    resetRateLimit(key);
    expect(isRateLimited(key)).toBe(false);
  });

  it("tracks independent keys separately", () => {
    const keyA = `test:${Math.random()}`;
    const keyB = `test:${Math.random()}`;
    for (let i = 0; i < 6; i++) isRateLimited(keyA);
    expect(isRateLimited(keyA)).toBe(true);
    expect(isRateLimited(keyB)).toBe(false);
  });
});
