// Recon paso 1 Multicine: buy-tickets → estructura de funciones clickeables.
// Read-only. Chrome real (channel chrome) para pasar el WAF CINEsync.
// Correr desde el root del monorepo: node servers/cine/recon/recon1-multicine.mjs
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const OUT = dirname(fileURLToPath(import.meta.url));

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({ userAgent: UA, locale: "es-BO", viewport: { width: 1280, height: 1400 } });
  await page.goto("https://www.multicine.com.bo/es-BO/buy-tickets?location=santa-cruz&locationKey=5", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(6500);

  const denied = await page.evaluate(() => /Access Denied|Error 403/i.test(document.body.innerText));
  console.log("403?", denied);
  console.log("URL:", page.url());
  console.log("TITLE:", await page.title());

  await page.screenshot({ path: `${OUT}/r1-buytickets.png`, fullPage: false });

  const info = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll(".pc-movie-item-row"));
    const first = rows.find((r) => /\d{1,2}:\d{2}\s*hrs/i.test(r.textContent || ""));
    if (!first) return { rows: rows.length, note: "ninguna row con horario" };
    const clickables = Array.from(first.querySelectorAll("a,button,[onclick],[role='button']")).slice(0, 12).map((el) => ({
      tag: el.tagName.toLowerCase(),
      text: (el.textContent || "").trim().slice(0, 40),
      href: el.getAttribute("href"),
      cls: el.getAttribute("class"),
    }));
    return {
      rows: rows.length,
      titulo: (first.querySelector("h1,h2,h3,h4,[class*='title']")?.textContent || "").trim(),
      clickables,
    };
  });
  console.log("INFO:", JSON.stringify(info, null, 2));
} catch (e) {
  console.error("ERR:", e.message);
} finally {
  await browser.close();
}
