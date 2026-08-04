// Recon paso 2 Multicine: seat-plan → estructura de asientos + botón continuar.
// Read-only: NO completo pago. Chrome real (channel chrome) para pasar el WAF.
// Correr desde el root del monorepo: node servers/cine/recon/recon2-multicine.mjs
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const OUT = dirname(fileURLToPath(import.meta.url));

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({ userAgent: UA, locale: "es-BO", viewport: { width: 1280, height: 1600 } });

  // 1) buy-tickets → primer href de horario (token efímero: tomarlo fresco).
  await page.goto("https://www.multicine.com.bo/es-BO/buy-tickets?location=santa-cruz&locationKey=5", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(6500);
  const seatHref = await page.evaluate(() => document.querySelector("a.pc-show-time")?.getAttribute("href") || null);
  console.log("seatHref:", seatHref);
  if (!seatHref) throw new Error("no encontre horario");

  // 2) seat-plan.
  await page.goto("https://www.multicine.com.bo" + seatHref, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(6000);
  console.log("URL seat-plan:", page.url());
  await page.screenshot({ path: `${OUT}/r2-seatplan.png`, fullPage: false });

  const seatInfo = await page.evaluate(() => {
    const body = document.body.innerText.slice(0, 500);
    const seatEls = Array.from(document.querySelectorAll("[class*='seat'],[class*='Seat'],rect[data-seat],g[class*='seat']"));
    const sample = seatEls.slice(0, 6).map((el) => ({ tag: el.tagName.toLowerCase(), cls: el.getAttribute("class"), text: (el.textContent||"").trim().slice(0,20) }));
    const btns = Array.from(document.querySelectorAll("button,a[class*='button']")).map((b)=>({tag:b.tagName.toLowerCase(), text:(b.textContent||"").trim().slice(0,30), cls:b.getAttribute("class")})).filter(b=>b.text);
    return { bodyStart: body, seatCount: seatEls.length, seatSample: sample, buttons: btns.slice(0, 20) };
  });
  console.log("SEATINFO:", JSON.stringify(seatInfo, null, 2));
} catch (e) {
  console.error("ERR:", e.message);
} finally {
  await browser.close();
}
