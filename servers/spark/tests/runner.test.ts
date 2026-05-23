import { describe, it, expect } from "vitest";
import { runSpark } from "../src/index.js";

describe("runSpark", () => {
  it("returns stdout, stderr, exitCode on success", async () => {
    // Use 'echo' as a stand-in by mocking execFile path via env override
    const result = await runSpark(["--version"], { binaryPath: "/bin/echo" });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("--version");
  });

  it("returns non-zero exitCode + stderr on failure", async () => {
    const result = await runSpark([], { binaryPath: "/bin/false" });
    expect(result.exitCode).not.toBe(0);
  });

  it("respects timeout", async () => {
    const start = Date.now();
    const result = await runSpark(["10"], { binaryPath: "/bin/sleep", timeout: 200 });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(2000);
    expect(result.exitCode).not.toBe(0); // killed by timeout
  });
});
