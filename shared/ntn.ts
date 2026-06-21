import { spawnSync } from "node:child_process";

export const NTN_BIN = "/opt/homebrew/bin/ntn";

export interface NtnResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

export function callNtn(
  path: string,
  opts: { method?: "POST" | "PATCH" | "DELETE"; body?: unknown } = {}
): NtnResult {
  const args = ["api"];
  if (opts.method) args.push("-X", opts.method);
  args.push(path);
  if (opts.body !== undefined) args.push("-d", JSON.stringify(opts.body));

  const result = spawnSync(NTN_BIN, args, { encoding: "utf8", timeout: 15_000 });

  if (result.status !== 0) {
    return { ok: false, error: (result.stderr || result.stdout).trim() };
  }
  try {
    return { ok: true, data: JSON.parse(result.stdout) };
  } catch {
    return { ok: true, data: result.stdout.trim() };
  }
}
