#!/usr/bin/env node
// MCP server: spark — wraps Spark Desktop CLI for email/calendar/contacts access.

import { execFile } from "node:child_process";

const DEFAULT_BINARY = "/opt/homebrew/bin/spark";
const DEFAULT_TIMEOUT_MS = 30_000;

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface RunOpts {
  binaryPath?: string;
  timeout?: number;
}

export function runSpark(args: string[], opts: RunOpts = {}): Promise<RunResult> {
  const binary = opts.binaryPath ?? DEFAULT_BINARY;
  const timeout = opts.timeout ?? DEFAULT_TIMEOUT_MS;
  return new Promise((resolve) => {
    execFile(binary, args, { timeout, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const exitCode = typeof (err as NodeJS.ErrnoException & { code?: unknown }).code === "number"
          ? ((err as NodeJS.ErrnoException & { code: number }).code)
          : 1;
        resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? err.message), exitCode });
        return;
      }
      resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? ""), exitCode: 0 });
    });
  });
}
