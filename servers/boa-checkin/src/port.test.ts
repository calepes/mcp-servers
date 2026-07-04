import { describe, it, expect } from "vitest";
import { findFreePort } from "./port.js";

describe("findFreePort", () => {
  it("returns a port number in the valid TCP range", async () => {
    const port = await findFreePort();
    expect(port).toBeGreaterThan(1024);
    expect(port).toBeLessThan(65536);
  });

  it("returns different ports on consecutive calls (no double-bind)", async () => {
    const a = await findFreePort();
    const b = await findFreePort();
    expect(a).not.toBe(b);
  });
});
