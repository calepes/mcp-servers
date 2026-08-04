// Recon paso 3 Multicine: seleccionar 1 asiento → Continuar → caracterizar el
// paso siguiente (tipo de entrada / confitería / formulario / login).
// Read-only: NO completa pago. Puede reservar temporalmente 1 butaca (se libera sola).
// >>> ESTE ES EL SIGUIENTE PASO PENDIENTE DEL HANDOFF <<<
// Correr desde el root del monorepo: node servers/cine/recon/recon3-multicine.mjs
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const OUT = dirname(fileURLToPath(import.meta.url));

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const step = (s) => console.log("\n===", s, "===");

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({ userAgent: UA, locale: "es-BO", viewport: { width: 1280, height: 1600 } });

  step("buy-tickets → horario fresco");
  await page.goto("https://www.multicine.com.bo/es-BO/buy-tickets?location=santa-cruz&locationKey=5", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(6500);
  const seatHref = await page.evaluate(() => document.querySelector("a.pc-show-time")?.getAttribute("href") || null);
  console.log("seatHref:", seatHref);

  step("seat-plan");
  await page.goto("https://www.multicine.com.bo" + seatHref, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(6000);

  // Descubrir el selector del asiento disponible: volcar clases de hojas dentro del mapa.
  const seatClasses = await page.evaluate(() => {
    const cont = document.querySelector(".seatmapcontainer") || document.body;
    const leaves = Array.from(cont.querySelectorAll("*")).filter((el) => el.children.length === 0 && /asiento|seat|disponible/i.test((el.getAttribute("class")||"") + (el.getAttribute("aria-label")||"")));
    const classes = {};
    for (const el of leaves) { const c = el.getAttribute("class")||el.tagName; classes[c]=(classes[c]||0)+1; }
    return classes;
  });
  console.log("seat leaf classes:", JSON.stringify(seatClasses, null, 2));

  step("seleccionar asiento");
  const selectors = ["[class*='available' i]", "[aria-label*='Disponible' i]", "[class*='disponible' i]", ".seatmapcontainer [class*='seat'][class*='able']"];
  let picked = null;
  for (const sel of selectors) {
    const n = await page.locator(sel).count().catch(()=>0);
    if (n > 0) { picked = sel; console.log(`selector "${sel}" → ${n} elementos`); break; }
  }
  if (picked) {
    await page.locator(picked).first().click({ timeout: 5000 }).catch((e)=>console.log("click err:", e.message));
    await page.waitForTimeout(2500);
  } else {
    console.log("no encontre selector de asiento — revisar r2-seatplan.png / r3-seat-selected.png");
  }
  const totalTxt = await page.evaluate(() => (document.body.innerText.match(/Entradas totales:\s*\d+/i)||[""])[0]);
  console.log("después del click:", totalTxt);
  await page.screenshot({ path: `${OUT}/r3-seat-selected.png`, fullPage: false });

  step("Continuar");
  const cont = page.locator("a:has-text('Continuar'), button:has-text('Continuar')").first();
  await cont.click({ timeout: 5000 }).catch((e)=>console.log("continuar err:", e.message));
  await page.waitForTimeout(6000);
  console.log("URL tras Continuar:", page.url());
  await page.screenshot({ path: `${OUT}/r4-post-continuar.png`, fullPage: true });
  const next = await page.evaluate(() => ({
    body: document.body.innerText.slice(0, 900),
    hasLogin: /iniciar sesi[oó]n|log\s?in|correo|contrase/i.test(document.body.innerText),
    inputs: Array.from(document.querySelectorAll("input,select,textarea")).map((i)=>({type:i.type||i.tagName.toLowerCase(), name:i.name, ph:i.placeholder, label:(i.getAttribute("aria-label")||"")})).slice(0,25),
    buttons: Array.from(document.querySelectorAll("button,a[class*='button']")).map((b)=>(b.textContent||"").trim()).filter(Boolean).slice(0,20),
  }));
  console.log("NEXT STEP:", JSON.stringify(next, null, 2));
} catch (e) {
  console.error("ERR:", e.message);
} finally {
  await browser.close();
}
