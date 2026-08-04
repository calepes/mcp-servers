// Recon paso 4 Multicine: retoma en select-tickets (tipo de entrada), sube la
// cantidad a 1, Continuar, y caracteriza el paso siguiente (el "formulario
// obligatorio" real: ¿login o invitado? ¿campos? ¿entrega QR?).
// Read-only: NO completa pago. Puede reservar temporalmente 1 butaca (se libera sola).
// Correr desde el root del monorepo: node servers/cine/recon/recon4-multicine.mjs
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
    body: document.body.innerText.slice(0, 1200),
    hasLogin: /iniciar sesi[oó]n|log\s?in|correo|contrase/i.test(document.body.innerText),
    inputs: Array.from(document.querySelectorAll("input,select,textarea")).map((i) => ({
      type: i.type || i.tagName.toLowerCase(),
      name: i.name,
      ph: i.placeholder,
      label: i.getAttribute("aria-label") || "",
      required: i.required || false,
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

  step("buy-tickets → horario fresco");
  await page.goto("https://www.multicine.com.bo/es-BO/buy-tickets?location=santa-cruz&locationKey=5", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(6500);
  const seatHref = await page.evaluate(() => document.querySelector("a.pc-show-time")?.getAttribute("href") || null);
  console.log("seatHref:", seatHref);

  step("seat-plan → seleccionar asiento");
  await page.goto("https://www.multicine.com.bo" + seatHref, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(7000);
  let totalTxt = "";
  for (let i = 0; i < 4; i++) {
    // OJO: "[class*='available' i]" también matchea "unavailable" (substring) — usar clase exacta.
    await page.locator(".seat-item-icon.available").nth(i).click({ timeout: 5000 }).catch((e) => console.log(`click intento ${i} err:`, e.message));
    await page.waitForTimeout(2000);
    totalTxt = await page.evaluate(() => (document.body.innerText.match(/Entradas totales:\s*\d+/i) || [""])[0]);
    console.log(`intento ${i} →`, totalTxt);
    if (/[1-9]/.test(totalTxt)) break;
  }
  if (!/[1-9]/.test(totalTxt)) throw new Error("no logré seleccionar ningún asiento tras 4 intentos");

  step("Continuar → select-tickets");
  const cont1 = page.locator("a:has-text('Continuar'), button:has-text('Continuar')").first();
  await cont1.scrollIntoViewIfNeeded().catch(() => {});
  await cont1.click({ timeout: 8000, force: true }).catch((e) => console.log("continuar1 err:", e.message));
  await page.waitForTimeout(4500);
  console.log("URL select-tickets:", page.url());
  if (!page.url().includes("select-tickets")) throw new Error("Continuar no avanzó a select-tickets, sigo en: " + page.url());

  step("subir cantidad a 1");
  // El botón "+" de la tarjeta de tipo de entrada (yellow circle en la screenshot r4).
  const plusSelectors = ["button.circularPrimary", "button:has-text('+')", "[class*='plus' i]", "[aria-label*='increment' i]", "[aria-label*='sumar' i]", "[aria-label*='aumentar' i]"];
  let clicked = false;
  for (const sel of plusSelectors) {
    const n = await page.locator(sel).count().catch(() => 0);
    if (n > 0) {
      await page.locator(sel).first().click({ timeout: 5000 }).catch((e) => console.log(`click ${sel} err:`, e.message));
      clicked = true;
      console.log(`clickeado selector "${sel}" (${n} candidatos)`);
      break;
    }
  }
  if (!clicked) console.log("NO encontré botón '+' — revisar r5-select-tickets.png");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/r5-select-tickets.png`, fullPage: true });
  const qtyTxt = await page.evaluate(() => (document.body.innerText.match(/Entradas:\s*\d+\/\d+/i) || [""])[0]);
  console.log("después del +:", qtyTxt);

  step("Continuar → formulario / checkout");
  const cont2 = page.locator("a:has-text('Continuar'), button:has-text('Continuar')").first();
  const isDisabled = await cont2.evaluate((el) => el.disabled || (el.className || "").includes("disable")).catch(() => null);
  console.log("Continuar disabled?", isDisabled);
  await cont2.scrollIntoViewIfNeeded().catch(() => {});
  await cont2.click({ timeout: 8000, force: true }).catch((e) => console.log("continuar2 err:", e.message));
  await page.waitForTimeout(5500);

  const afterC2 = await dump(page, "r6-post-continuar2");
  if (page.url().includes("select-tickets")) throw new Error("Continuar2 no avanzó, sigo en select-tickets");

  step("Continuar (skip candy bar) → checkout real");
  const cont3 = page.locator("a:has-text('Continuar'), button:has-text('Continuar')").first();
  await cont3.scrollIntoViewIfNeeded().catch(() => {});
  await cont3.click({ timeout: 8000, force: true }).catch((e) => console.log("continuar3 err:", e.message));
  await page.waitForTimeout(6000);

  await dump(page, "r7-checkout-real");

  step("Continuar dentro del modal 'Mi pedido' → checkout real");
  const clickedModal = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll("button,a")).filter((e) => (e.textContent || "").trim() === "Continuar");
    // El botón del modal es el visible con mayor `top` (está al fondo del panel 'Mi pedido').
    const visible = els.filter((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.top >= 0 && r.top < innerHeight;
    });
    if (!visible.length) return { ok: false, reason: "no visible Continuar found", count: els.length };
    visible.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top);
    const el = visible[0];
    const rect = el.getBoundingClientRect();
    el.click();
    return { ok: true, rect: rect.toJSON(), cls: el.className };
  });
  console.log("clickedModal:", JSON.stringify(clickedModal));
  await page.waitForTimeout(6000);

  await dump(page, "r8-post-modal-continuar");
} catch (e) {
  console.error("ERR:", e.message);
} finally {
  await browser.close();
}
