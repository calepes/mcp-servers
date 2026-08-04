// Recon paso 6 Multicine: repite el flujo de invitado con el email REAL de Cal
// (carlos@lepesqueur.net) para poder leer el código OTP vía `spark` y terminar de ver
// la pantalla final (QR de pago o pasarela de tarjeta).
// Read-only en cuanto a plata: llega a ver la pantalla de pago pero NO completa ningún pago.
// Correr desde el root del monorepo: node servers/cine/recon/recon6-multicine.mjs
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { execSync } from "node:child_process";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const OUT = dirname(fileURLToPath(import.meta.url));

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const step = (s) => console.log("\n===", s, "===");
const REAL_EMAIL = "carlos@lepesqueur.net";

const dump = async (page, label) => {
  console.log("URL:", page.url());
  await page.screenshot({ path: `${OUT}/${label}.png`, fullPage: true });
  const info = await page.evaluate(() => ({
    body: document.body.innerText.slice(0, 2200),
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

function latestMulticineOtpId() {
  let searchOut = "";
  try {
    searchOut = execSync(`spark emails carlos@lepesqueur.net:Inbox --filter "from:noreply@multicine.com.bo newer_than:1d" --order descending --page-size 3`, {
      encoding: "utf8", timeout: 20000, cwd: process.env.HOME,
    });
  } catch (e) {
    console.log("spark emails err:", e.message);
    return null;
  }
  const idMatch = searchOut.match(/\n\s*(\d{4,8})\s+carlos@/);
  return idMatch ? Number(idMatch[1]) : null;
}

function findOtp(minId) {
  // Busca el correo de OTP de Multicine en la bandeja real de Cal, exigiendo un ID mayor
  // al `minId` (el más nuevo visto ANTES de disparar el envío) para no reusar un correo
  // viejo — Spark puede tardar en indexar el nuevo y devolver el anterior de otra corrida.
  const id = latestMulticineOtpId();
  if (id === null) return { code: null, reason: "no encontré ningún correo" };
  if (minId !== null && id <= minId) return { code: null, reason: `el más nuevo visto (${id}) no es más nuevo que el baseline (${minId}) — todavía no llega` };
  let threadOut = "";
  try {
    threadOut = execSync(`spark thread ${id}`, { encoding: "utf8", timeout: 20000, cwd: process.env.HOME });
  } catch (e) {
    return { code: null, reason: "thread err: " + e.message };
  }
  const codeMatch = threadOut.match(/\*\*\s*(\d{4,8})\s*\*\*/) || threadOut.match(/OTP[^\d]{0,40}(\d{6})/i);
  return { raw: threadOut.slice(0, 800), code: codeMatch ? codeMatch[1] : null, id };
}

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

  step("llenar formulario de invitado con email REAL");
  await page.fill("input[name='firstName']", "Recon").catch((e) => console.log("firstName err:", e.message));
  await page.fill("input[name='lastName']", "Testcine").catch((e) => console.log("lastName err:", e.message));
  await page.fill("input[name='email']", REAL_EMAIL).catch((e) => console.log("email err:", e.message));
  await page.fill("input[name='phone']", "70000000").catch((e) => console.log("phone err:", e.message));
  await page.selectOption("select[name='documentType']", "1").catch((e) => console.log("documentType err:", e.message));
  await page.fill("input[name='documentValue']", "1234567").catch((e) => console.log("documentValue err:", e.message));

  const baselineId = latestMulticineOtpId();
  console.log("baseline OTP id (antes de disparar):", baselineId);

  step("Continua como invitado (dispara el envío del OTP)");
  const guestBtn = page.locator("button:has-text('Continua como invitado'), a:has-text('Continua como invitado')").first();
  await guestBtn.scrollIntoViewIfNeeded().catch(() => {});
  await guestBtn.click({ timeout: 8000, force: true }).catch((e) => console.log("guestBtn err:", e.message));
  await page.waitForTimeout(6000);
  await dump(page, "r12-otp-screen");

  step("buscar el OTP en la bandeja real (polling)");
  let otp = null;
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 6000));
    const found = findOtp(baselineId);
    console.log(`intento ${i}:`, found.code ? `id=${found.id} code=${found.code}` : found.reason);
    if (found.code) { otp = found.code; console.log("OTP encontrado:", otp); break; }
  }

  if (!otp) {
    console.log("NO se encontró el OTP automáticamente — revisar bandeja a mano y ajustar el filtro de spark search.");
  } else {
    step("ingresar OTP y verificar");
    await page.fill("input[name='verificationCode'], input[placeholder*='código' i]", otp).catch((e) => console.log("otp fill err:", e.message));
    await page.locator("button:has-text('Verificar')").first().click({ timeout: 8000, force: true }).catch((e) => console.log("verificar err:", e.message));
    await page.waitForTimeout(7000);
    await dump(page, "r13-post-verificar");
  }
} catch (e) {
  console.error("ERR:", e.message);
} finally {
  await browser.close();
}
