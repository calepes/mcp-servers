import { describe, it, expect, vi, afterEach } from "vitest";
import { Cache } from "../src/cache.js";

describe("Cache", () => {
  afterEach(() => vi.useRealTimers());

  it("stores and retrieves a value", () => {
    const cache = new Cache();
    cache.set("key", { data: 1 }, 60);
    expect(cache.get("key")).toEqual({ data: 1 });
  });

  it("returns null for missing key", () => {
    const cache = new Cache();
    expect(cache.get("missing")).toBeNull();
  });

  it("returns null after TTL expires", () => {
    vi.useFakeTimers();
    const cache = new Cache();
    cache.set("key", "value", 60);
    vi.advanceTimersByTime(61_000);
    expect(cache.get("key")).toBeNull();
  });

  it("does not expire before TTL", () => {
    vi.useFakeTimers();
    const cache = new Cache();
    cache.set("key", "value", 60);
    vi.advanceTimersByTime(59_000);
    expect(cache.get("key")).toBe("value");
  });

  it("isolates keys from each other", () => {
    const cache = new Cache();
    cache.set("a", 1, 60);
    cache.set("b", 2, 60);
    expect(cache.get("a")).toBe(1);
    expect(cache.get("b")).toBe(2);
  });
});
