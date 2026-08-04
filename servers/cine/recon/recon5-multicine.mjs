// Recon paso 5 Multicine: llena el formulario de invitado en /order/{id}/redemptions con
// datos de PRUEBA y click "Continúa como invitado" para ver la pantalla final: ¿QR de pago
// (como Cinemark) o pasarela externa con tarjeta?
// Read-only en cuanto a plata: llega a ver la pantalla de pago pero NO completa ningún pago.
// Correr desde el root del monorepo: node servers/cine/recon/recon5-multicine.mjs
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const OUT = dirname(fileURLToPath(import.meta.url));

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const step = (s) => console.log("\n===", s, "===");

const dump = async (page, label) => {
  console.log("URL:", page.url());
  await page.screenshot({ path: `${OUT}/${label}.png`, fullPage: true });
  const info = await page.evaluate(() => ({
    body: document.body.innerText.slice(0, 2000),
    hasQr: !!document.querySelector("img[src*='qr' i], canvas") || /\bqr\b/i.test(document.body.innerText),
    hasCardForm: /n[uú]mero de tarjeta|card number|cvv|fecha de vencimiento/i.test(document.body.innerText),
    inputs: Array.from(document.querySelectorAll("input,select,textarea")).map((i) => ({
      type: i.type || i.tagName.toLowerCase(), name: i.name, ph: i.placeholder,
    })).slice(0, 30),
    buttons: Array.from(document.querySelectorAll("button,a[class*='button']"))
      .map((b) => (b.textContent || "").trim()).filter(Boolean).slice(0, 20),
  }));
  console.log(`${label}:`, JSON.stringify(info, null, 2));
  return info;
};

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({ userAgent: UA, locale: "es-BO", viewport: { width: 1280, height: 1600 } });

  step("buy-tickets → seat-plan → select-tickets → concession → modal → formulario invitado");
  await page.goto("https://www.multicine.com.bo/es-BO/buy-tickets?location=santa-cruz&locationKey=5", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(6500);
  const seatHref = await page.evaluate(() => document.querySelector("a.pc-show-time")?.getAttribute("href") || null);

  await page.goto("https://www.multicine.com.bo" + seatHref, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(7000);
  await page.locator(".seat-item-icon.available").nth(0).click({ timeout: 5000 });
  await page.waitForTimeout(2000);

  await page.locator("a:has-text('Continuar'), button:has-text('Continuar')").first().click({ timeout: 8000, force: true });
  await page.waitForTimeout(4500);
  if (!page.url().includes("select-tickets")) throw new Error("no llegué a select-tickets");

  await page.locator("button.circularPrimary").first().click({ timeout: 5000 });
  await page.waitForTimeout(1500);
  await page.locator("a:has-text('Continuar'), button:has-text('Continuar')").first().click({ timeout: 8000, force: true });
  await page.waitForTimeout(5500);
  if (!page.url().includes("concession")) throw new Error("no llegué a concession");

  await page.locator("a:has-text('Continuar'), button:has-text('Continuar')").first().click({ timeout: 8000, force: true }).catch(() => {});
  await page.waitForTimeout(3000);
  const modalClicked = await page.evaluate(() => {
    const wrap = document.querySelector(".myorderwrap");
    const btn = wrap && Array.from(wrap.querySelectorAll("button,a")).find((e) => (e.textContent || "").trim() === "Continuar");
    if (!btn) return false;
    btn.click();
    return true;
  });
  if (!modalClicked) throw new Error("no encontré el Continuar del modal 'Mi pedido'");
  await page.waitForTimeout(7000);
  if (!page.url().includes("/redemptions")) throw new Error("no llegué al formulario de invitado, sigo en: " + page.url());
  console.log("Llegué al formulario:", page.url());

  step("llenar formulario de invitado (datos de PRUEBA)");
  await page.fill("input[name='firstName']", "Recon").catch((e) => console.log("firstName err:", e.message));
  await page.fill("input[name='lastName']", "Testcine").catch((e) => console.log("lastName err:", e.message));
  await page.fill("input[name='email']", "recon.multicine@example.com").catch((e) => console.log("email err:", e.message));
  await page.fill("input[name='phone']", "70000000").catch((e) => console.log("phone err:", e.message));
  await page.selectOption("select[name='documentType']", "1").catch((e) => console.log("documentType err:", e.message));
  await page.fill("input[name='documentValue']", "1234567").catch((e) => console.log("documentValue err:", e.message));
  await page.screenshot({ path: `${OUT}/r10-form-filled.png`, fullPage: true });

  step("Continúa como invitado");
  const guestBtn = page.locator("button:has-text('Continua como invitado'), a:has-text('Continua como invitado')").first();
  await guestBtn.scrollIntoViewIfNeeded().catch(() => {});
  await guestBtn.click({ timeout: 8000, force: true }).catch((e) => console.log("guestBtn err:", e.message));
  await page.waitForTimeout(7000);

  await dump(page, "r11-post-guest");
} catch (e) {
  console.error("ERR:", e.message);
} finally {
  await browser.close();
}
