import { spawn, type ChildProcess } from "node:child_process";
import { accessSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright";
import { findFreePort } from "./port.js";

const CHROME_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];
const PROFILE_DIR = `${process.env.HOME}/.boa-checkin/chrome-profile`;

function resolveChromePath(): string {
  for (const p of CHROME_PATHS) {
    try {
      accessSync(p);
      return p;
    } catch {
      /* probar siguiente */
    }
  }
  throw new Error("No se encontró el binario de Google Chrome en las rutas conocidas.");
}

async function waitForCdp(port: number, timeoutMs = 10000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${port}/json/version`);
      if (res.ok) return;
    } catch {
      /* Chrome todavía no levantó el puerto */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Chrome no respondió en el puerto CDP ${port} después de ${timeoutMs}ms.`);
}

export interface BoaBrowserSession {
  page: Page;
  close(): Promise<void>;
}

/**
 * Lanza el Chrome REAL del sistema (no el Chromium que trae Playwright) con un
 * perfil propio dedicado, y conecta Playwright vía CDP. Validado en spike
 * 2026-07-04: chromium.launch() propio es bloqueado por el WAF (Imperva) de
 * BoA; conectando a un Chrome real vía CDP no lo es.
 */
export async function openBoaBrowserSession(): Promise<BoaBrowserSession> {
  const port = await findFreePort();
  const chromePath = resolveChromePath();

  const proc: ChildProcess = spawn(
    chromePath,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${PROFILE_DIR}`,
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank",
    ],
    { stdio: "ignore", detached: false },
  );

  try {
    await waitForCdp(port);
  } catch (err) {
    proc.kill();
    throw err;
  }

  const browser: Browser = await chromium.connectOverCDP(`http://localhost:${port}`);
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? (await context.newPage());
  await page.setViewportSize({ width: 430, height: 932 }).catch(() => {});

  return {
    page,
    async close() {
      await browser.close().catch(() => {});
      proc.kill();
    },
  };
}
