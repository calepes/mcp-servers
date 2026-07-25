/// <reference lib="dom" />
// Compra de entradas de cine (Cinemark Bolivia) — Fase 2: guest checkout.
//
// NOTA tsc: la directiva `/// <reference lib="dom" />` habilita los tipos del
// DOM (document, ...) SOLO para este archivo — necesario porque los callbacks
// de page.evaluate() corren en el browser. Ver cine.ts.
//
// `iniciar()` navega el checkout de Cinemark como INVITADO hasta la pantalla de
// asientos (/seats) y captura un screenshot del mapa de butacas. NO selecciona
// asientos ni avanza al pago — eso vive en fases posteriores. Devuelve el
// `browser`/`page` abiertos (el llamador es responsable de cerrar el browser) y
// el `seatDeadline` (epoch ms) leído del countdown de retención de asiento.
//
// Lanzamiento idéntico a cine.ts: Chrome real headless (`channel: "chrome"`)
// con User-Agent de Chrome — el Chromium propio de Playwright dispara WAFs.
//
// ─────────────────────────────────────────────────────────────────────────────
// SELECTORES DEL CHECKOUT (verificados en recon 2026-07-24, película Moana)
// ─────────────────────────────────────────────────────────────────────────────
// Flujo real observado (una función con MUCHA disponibilidad):
//   /pelicula/{slug}
//     → click en el "pill" del horario:  <div><svg/><p>HH:MMhs</p></div>
//       (el <p> es hoja; el onClick vive en el div contenedor → el click burbujea)
//     → botón "Comprar entradas" (sticky footer; hay un duplicado oculto → :visible)
//     → [modal login "Compra como invitado"] — data-testid="login_drawer_buy_as_guest_button"
//       OJO: en la sesión de recon (con cookies) el modal NO apareció y saltó
//       directo a /review. Se maneja best-effort: si aparece se clickea, si no
//       se sigue. En un Chrome fresco (daemon) probablemente SÍ aparezca.
//     → /tickets-purchase/review  → botón "Continuar"
//     → /tickets-purchase/tickets → stepper de cantidad (arranca en 0)
//       + (incrementar): [data-testid^="button__counter-increase"]  (el testid
//         incluye el conteo actual, ej. button__counter-increase__1·2DGENERALOLBB-0
//         → usar prefijo ^=). Fallback: botón con el svg del "+".
//       → botón "Continuar" (se habilita al tener ≥1 entrada)
//     → /tickets-purchase/seats  ← objetivo de esta fase
//
// ── MAPA DE ASIENTOS en /seats (CRÍTICO para el parser de la próxima fase) ──
//   Contenedor:            [data-testid="tickets-purchase-seats"]
//   Cada butaca:           <div class="MuiBox-root ..." aria-label="A21" ...>
//                          aria-label = etiqueta de la butaca, formato ^[A-Z]\d+$
//                          (letra = fila A..O, número = posición).
//   ★ ASIENTO DISPONIBLE (seleccionable):
//       tiene además  data-seat-identifier="A21"  (mismo valor que aria-label).
//       → Selector de disponibles:  [data-seat-identifier]
//       → Seleccionar una butaca X: [data-seat-identifier="X"]
//       svg 9x9 con icono de silla (fill="url(#pattern0_...)").
//   ★ ACCESIBLE EN SILLA DE RUEDAS ("Accesible"):
//       aria-label presente, data-seat-identifier AUSENTE; svg más ancho
//       (viewBox "0 0 21 20") con el pictograma de silla de ruedas.
//   ★ ACOMPAÑANTE ("C"):
//       aria-label presente, data-seat-identifier AUSENTE; svg 9x9 con un icono
//       circular (path "M4.5 0C2.014...") — la "C" del mapa.
//   → Regla del parser: una butaca es SELECCIONABLE ⇔ tiene data-seat-identifier.
//     El resto (accesibles + acompañante + ocupadas) NO se eligen en este flujo.
//   Recon: 278 butacas con aria-label; 272 con data-seat-identifier (disponibles),
//   6 sin él (3 accesibles viewBox 21x20 + 3 acompañante circular).
//   OJO: la sala de recon estaba VACÍA (función recién abierta) → NO se capturó
//   ninguna butaca "No disponible"/ocupada real; su markup exacto queda por
//   confirmar, pero por diseño también carecerá de data-seat-identifier, así que
//   la regla de arriba (seleccionable ⇔ data-seat-identifier) se mantiene válida.
//   Fixture: src/__fixtures__/cine/seats.html
//
//   Countdown de retención: <p class="MuiTypography-...">· MM:SS</p> (hoja).
//   No hay <header> ni clase "timer"/"countdown" — se ubica por el texto "· MM:SS".
//
// ── FLUJO POST-ASIENTOS (verificado en recon 2026-07-24 — crítico para fase QR) ──
//   /seats → (CTA "Continuar") → /tickets-purchase/candies (CONFITERÍA)
//          → (CTA "Continuar", carrito vacío) → /checkout
//   ★ CTA de avance en /seats y /candies: NO es un <button>. Es un <h4>/<div> con
//     texto "Continuar" en el sticky footer, superpuesto al botón "Compra rápida"
//     (que es un <button> alternativo de compra express). `button:has-text(...)`
//     NO lo agarra → clickear el primer elemento VISIBLE con texto EXACTO
//     "Continuar" (regex ^Continuar$ para excluir contenedores tipo "BS 140.40Continuar").
//   ★ CHECKOUT (/checkout) — inputs por id ESTABLE:
//       Comprador: #walletFirstName · #walletLastName · #walletDocumentNumber · #walletEmail
//                  (label "Correo eletrónico*" está mal escrito en el sitio — usar el id).
//                  NO hay campo de celular en el checkout.
//       Factura:   #invoiceNitOrCi · #invoiceComplement (opcional) · #invoiceNameOrBusiness
//       Tarjeta (NO tocar): #creditCardNumber · #expirationDate · #securityCode
//       Método de pago: tabs "Tarjeta" (default) / "QR Code". Total en "Total BS N".
//   ★ LÍMITE DE SEGURIDAD: el CTA final "Continuar" (sticky, "BS N Continuar")
//     avanza al PAGO/QR — NUNCA pulsarlo en este flujo; capturar el resumen y parar.

import type { Browser, Page } from "playwright";
import { hoyLaPaz } from "./fecha.js";
// playwright se resuelve desde node_modules del workspace (dep de mcp-cine).
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { chromium } = require("playwright") as typeof import("playwright");

const CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// Prefijo de 3 letras del mes, para matchear los tabs de fecha de Cinemark
// ("DOM26/JUL"). DUPLICADO A PROPÓSITO desde cartelera.ts (mismo MESES3/diaMes):
// importarlo desde allá obligaría a compra.ts a arrastrar todo el módulo de
// scraping de cartelera solo por 6 líneas. Si cambia el criterio de matching de
// fechas, actualizar AMBOS archivos.
const MESES3 = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"] as const;

/** { dia, mes3 } de una fecha YYYY-MM-DD, para comparar contra el texto de un tab. */
function diaMes(fecha: string): { dia: number; mes3: string } {
  return { dia: Number(fecha.slice(8, 10)), mes3: MESES3[Number(fecha.slice(5, 7)) - 1] };
}

export interface IniciarArgs {
  slug: string; // "moana"
  hora: string; // "20:30" (zero-padded HH:MM, tal como lo muestra la cartelera)
  cantidad: number; // nº de entradas
  fecha?: string; // YYYY-MM-DD ya resuelta. Sin ella, la función de HOY.
}

export interface IniciarResult {
  page: Page;
  browser: Browser;
  mapaScreenshot: Buffer;
  seatDeadline: number; // epoch ms — vencimiento de la retención de asiento
}

export async function iniciar(args: IniciarArgs): Promise<IniciarResult> {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const page = await browser.newPage({ userAgent: CHROME_UA });
  try {
    await page.goto(`https://www.cinemark.com.bo/pelicula/${args.slug}`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(3500);

    // 0) Aceptar el banner de cookies ("TU PRIVACIDAD ES MUY IMPORTANTE...").
    //    En un Chrome fresco (sin cookies, como el del daemon) este modal cubre
    //    la página e intercepta los clicks. Best-effort: si no aparece, seguir.
    try {
      await page.getByRole("button", { name: /^Acepto$/i }).click({ timeout: 4000 });
      await page.waitForTimeout(600);
    } catch {
      /* sin banner de cookies — continuar */
    }

    // 0.5) Elegir la FECHA. Cinemark muestra los horarios de UN día por vez; sin
    //    este click se compraría siempre la función de hoy aunque el usuario pida
    //    otra fecha.
    //
    //    Los tabs son <div class="date-carousel-item"> (NO <button>, NO [role=tab],
    //    NO <a> — verificado 2026-07-25), con esta forma:
    //      HOY  → <div class="date-carousel-item"><h3>HOY</h3></div>
    //      otro → <div class="date-carousel-item"><p>DOM</p><p>26/JUL</p></div>
    //    El carrusel se renderiza DOS veces (mobile + desktop) → preferir el visible.
    //    Muestra ~5 días; una fecha fuera de esa ventana no existe en el DOM.
    //
    //    Se matchea DÍA **Y** MES (mismo criterio que cartelera.ts). Matchear solo
    //    por número de día falla en silencio de dos formas: (a) el día viene
    //    zero-padded ("01/AGO"), así que comparar contra "1" nunca matchearía los
    //    días 1-9; (b) pedir el 27/AGO agarraría el tab del 27/JUL y compraría la
    //    función del mes equivocado. Acá eso cuesta plata y un viaje al cine.
    if (args.fecha && args.fecha !== hoyLaPaz()) {
      const ok = await page.evaluate(({ dia, mes3 }: { dia: number; mes3: string }) => {
        // Ancla ^...$ para NO matchear el contenedor del carrusel, cuyo texto
        // concatena todos los tabs ("HOYDOM26/JULLUN27/JUL…").
        const TAB = /^[a-záéíóúñ.]{0,10}\s*(\d{1,2})\s*[./-]?\s*([a-z]{3,})\.?$/;
        const cands = Array.from(
          document.querySelectorAll(".date-carousel-item, button, [role=tab], a, p, h3"),
        ).filter((el) => {
          const m = TAB.exec((el.textContent ?? "").trim().toLowerCase());
          return !!m && Number(m[1]) === dia && m[2].startsWith(mes3);
        });
        const visible = (e: Element) => (e as HTMLElement).offsetParent !== null;
        const pick =
          cands.find((e) => e.classList.contains("date-carousel-item") && visible(e)) ??
          cands.find(visible) ??
          cands[0];
        if (!pick) return false;
        (pick as HTMLElement).click();
        return true;
      }, diaMes(args.fecha));
      if (!ok) {
        throw new Error(
          `No encontré el botón de la fecha ${args.fecha} en Cinemark. ` +
            `Solo se pueden comprar las funciones de los próximos días que muestra el sitio.`,
        );
      }
      await page.waitForTimeout(1500);
    }

    // 1) Seleccionar el horario. El pill es <div><svg/><p>HH:MMhs</p></div>; el
    //    <p> es hoja y el onClick vive en el div → el click en el <p> burbujea.
    //    Hay un duplicado (mobile/desktop) → .first().
    await page.getByText(`${args.hora}hs`, { exact: true }).first().click();
    await page.waitForTimeout(800);

    // 2) "Comprar entradas" (sticky footer; hay un duplicado oculto → :visible).
    await page.locator('button:has-text("Comprar entradas"):visible').first().click();

    // 3) Modal de login → "Compra como invitado" (best-effort: puede no aparecer).
    const guest = page.locator('[data-testid="login_drawer_buy_as_guest_button"]');
    try {
      await guest.waitFor({ state: "visible", timeout: 5000 });
      await guest.click();
    } catch {
      /* el modal no apareció (sesión ya como invitado) — continuar */
    }

    // 4) Review → Continuar.
    await page.waitForURL(/tickets-purchase\/review/, { timeout: 20000 });
    await page.waitForTimeout(800);
    await page.locator('button:has-text("Continuar"):visible').first().click();

    // 5) Cantidad de entradas. El stepper arranca en 0 → clickear `cantidad` veces.
    await page.waitForURL(/tickets-purchase\/tickets/, { timeout: 20000 });
    await page.waitForTimeout(1200);
    const incSel =
      '[data-testid^="button__counter-increase"]:visible, button:has(svg path[d^="M11.5 12.5H6.5"]):visible';
    for (let i = 0; i < args.cantidad; i++) {
      await page.locator(incSel).first().click();
      await page.waitForTimeout(600);
    }

    // 6) Continuar → /seats.
    await page.locator('button:has-text("Continuar"):visible').first().click();
    await page.waitForURL(/tickets-purchase\/seats/, { timeout: 20000 });
    // El contenedor del mapa puede reportarse "hidden" durante la hidratación
    // (vive dentro de un wrapper con transform/scroll) → esperar "attached", no
    // "visible". La señal fuerte es que existan butacas con data-seat-identifier.
    await page.locator('[data-testid="tickets-purchase-seats"]').waitFor({
      state: "attached",
      timeout: 15000,
    });
    await page
      .locator("[data-seat-identifier]")
      .first()
      .waitFor({ state: "attached", timeout: 15000 });
    await page.waitForTimeout(1500);

    const seatDeadline = await leerSeatDeadline(page);
    const mapaScreenshot = await page.screenshot({ fullPage: true });
    return { page, browser, mapaScreenshot, seatDeadline };
  } catch (e) {
    // Si algo falla antes de llegar a /seats, cerrar el browser para no dejar
    // Chrome colgado, y re-lanzar.
    await browser.close().catch(() => {});
    throw e;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Parser puro: labels de butacas SELECCIONABLES (⇔ tienen data-seat-identifier).
// ─────────────────────────────────────────────────────────────────────────────
export function parseAsientosDisponibles(html: string): string[] {
  const out: string[] = [];
  const re = /data-seat-identifier="([A-Z]+\d+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) out.push(m[1]);
  return [...new Set(out)];
}

export interface ElegirAsientosResult {
  resumenScreenshot: Buffer;
  total: number;
  seatRestanteMs: number;
}

// Selecciona los asientos, salta confitería, llega a /checkout, llena los datos
// del comprador (SIN avanzar al pago) y captura el resumen.
//
// El mapa de asientos NO es único: varía por sala y película (layout, filas,
// numeración, tipos VIP/premier/DBOX/accesible, cantidad). Por eso `elegirAsientos`
// NUNCA clickea a ciegas — primero lee el HTML VIVO de /seats, saca la lista de
// disponibles con `parseAsientosDisponibles` y valida que cada asiento pedido
// esté realmente disponible. Si alguno no está, lanza un Error legible (no un
// timeout críptico) para que el LLM le remande el mapa a Cal.
export async function elegirAsientos(
  page: Page,
  asientos: string[],
  comprador: import("./comprador.js").Comprador,
  seatDeadline: number,
): Promise<ElegirAsientosResult> {
  // Validar disponibilidad contra el DOM vivo ANTES de clickear.
  const html = await page.content();
  const disponibles = parseAsientosDisponibles(html);
  const setDisp = new Set(disponibles);
  const faltantes = asientos.filter((a) => !setDisp.has(a));
  if (faltantes.length) {
    throw new Error(
      `Asiento(s) no disponible(s): ${faltantes.join(", ")}. ` +
        `Disponibles en esta sala (${disponibles.length}): ${disponibles.slice(0, 30).join(", ")}` +
        (disponibles.length > 30 ? ", …" : ""),
    );
  }

  for (const label of asientos) {
    await page.locator(`[data-seat-identifier="${label}"]`).click();
    await page.waitForTimeout(400);
  }

  // Asientos → confitería. OJO: el CTA "Continuar" del sticky footer de /seats NO
  // es un <button> — es un <h4>/<div> con el texto "Continuar" que se superpone al
  // botón "Compra rápida" e intercepta el click (verificado en recon 2026-07-24).
  // Por eso NO sirve `button:has-text("Continuar")`; hay que clickear el primer
  // elemento VISIBLE cuyo texto sea exactamente "Continuar".
  await clickContinuarVisible(page);
  await page.waitForURL(/tickets-purchase\/candies/i, { timeout: 20000 });
  await page.waitForTimeout(2000);

  // Confitería (/candies): saltar SIN comprar nada. El mismo CTA "Continuar" del
  // footer avanza dejando el carrito de confitería vacío.
  await clickContinuarVisible(page);

  // Checkout: llenar datos del comprador (SIN avanzar al pago).
  await page.waitForURL(/checkout/i, { timeout: 20000 });
  await page.waitForTimeout(2500);
  await llenarDatosComprador(page, comprador);
  const total = await leerTotal(page);
  const resumenScreenshot = await page.screenshot({ fullPage: true });
  return { resumenScreenshot, total, seatRestanteMs: seatDeadline - Date.now() };
}

// Clickea el primer elemento VISIBLE cuyo texto sea exactamente "Continuar".
// Necesario porque el CTA de avance en /seats y /candies se renderiza como un
// <h4>/<div> (no <button>), y hay múltiples nodos "Continuar" (algunos ocultos
// o contenedores como "BS 140.40Continuar" — el regex ^Continuar$ excluye esos).
async function clickContinuarVisible(page: Page): Promise<void> {
  const loc = page.getByText(/^Continuar$/);
  const n = await loc.count();
  for (let i = 0; i < n; i++) {
    const el = loc.nth(i);
    if (await el.isVisible().catch(() => false)) {
      await el.click();
      return;
    }
  }
  throw new Error('No se encontró un CTA "Continuar" visible para avanzar.');
}

// Llena SOLO los datos del comprador + factura (NUNCA la tarjeta). Selectores por
// id estable del checkout de Cinemark (recon 2026-07-24):
//   #walletFirstName · #walletLastName · #walletDocumentNumber · #walletEmail
//   Factura: #invoiceNitOrCi · #invoiceNameOrBusiness (a nombre de Cal).
// No hay campo de celular en el checkout (el comprador.celular no se usa aquí).
// Tarjeta (#creditCardNumber/#expirationDate/#securityCode) queda INTACTA.
async function llenarDatosComprador(
  page: Page,
  c: import("./comprador.js").Comprador,
): Promise<void> {
  await page.locator("#walletFirstName").fill(c.nombre);
  await page.locator("#walletLastName").fill(c.apellido);
  await page.locator("#walletDocumentNumber").fill(c.documento);
  await page.locator("#walletEmail").fill(c.correo);
  // Datos de factura a nombre de Cal (best-effort — pueden no aparecer).
  await page.locator("#invoiceNitOrCi").fill(c.documento).catch(() => {});
  await page.locator("#invoiceNameOrBusiness").fill(`${c.nombre} ${c.apellido}`).catch(() => {});
}

// Lee el TOTAL del resumen del checkout (subtotal + cargo por servicio). El
// resumen lista "Subtotal BS X", "+ cargo por servicio BS Y" y "Total BS Z".
// Formato de monto de Cinemark: punto = decimal, coma = miles (ej. "1,140.40").
// OJO: `\bTotal\b` para NO matchear dentro de "Sub-total" (sin \b se agarra el
// subtotal). Fallback: el último "BS ..." de la lista (el total va al final).
async function leerTotal(page: Page): Promise<number> {
  const txt = await page.locator("body").innerText();
  const parse = (s: string) => Number(s.replace(/,/g, "")); // quitar separador de miles
  const tot = /\bTotal\b\s*BS\s*([\d.,]+)/i.exec(txt);
  if (tot) return parse(tot[1]);
  const all = [...txt.matchAll(/BS\s*([\d.,]+)/gi)];
  return all.length ? parse(all[all.length - 1][1]) : 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// GENERAR QR (pago) — desde /checkout, tras llenar los datos del comprador.
// Selectores/marcadores VALIDADOS en una compra real (2026-07-24).
// ─────────────────────────────────────────────────────────────────────────────
export interface GenerarQrResult {
  qrScreenshot: Buffer;
  seatRestanteMs: number;
}

// Selecciona método QR, re-llena datos (por el re-render), genera y captura el QR.
// GOTCHA CRÍTICO: al cambiar a "QR Code" el form se re-renderiza y VACÍA los
// campos #walletFirstName/#walletLastName/#walletDocumentNumber/#walletEmail →
// hay que RE-LLENARLOS después de elegir QR. Factura y celular sobreviven.
export async function generarQr(
  page: Page,
  comprador: import("./comprador.js").Comprador,
  seatDeadline: number,
): Promise<GenerarQrResult> {
  await page.locator('button:text-is("QR Code")').click();
  await page.waitForTimeout(1200);
  // El re-render vacía los wallet fields → re-llenar.
  await page.locator("#walletFirstName").fill(comprador.nombre);
  await page.locator("#walletLastName").fill(comprador.apellido);
  await page.locator("#walletDocumentNumber").fill(comprador.documento);
  await page.locator("#walletEmail").fill(comprador.correo);
  // Celular: aparece solo al elegir QR.
  await page.locator("#qrPhone").fill(comprador.celular);
  // Términos y condiciones.
  const cb = page.locator('input[type="checkbox"]');
  if (!(await cb.isChecked())) await cb.click();
  // CTA "Continuar": es un <h4> (no <button>).
  await page.locator('h4:text-is("Continuar")').filter({ visible: true }).first().click();
  // Tras ~3-4s aparece el QR (src = data URI PNG).
  await page
    .locator('img[alt="QR Code"]')
    .waitFor({ state: "visible", timeout: 20000 });
  await page.waitForTimeout(800);
  const qrScreenshot = await page.locator('img[alt="QR Code"]').screenshot();
  return { qrScreenshot, seatRestanteMs: seatDeadline - Date.now() };
}

// ─────────────────────────────────────────────────────────────────────────────
// Parser puro: ¿el HTML es la pantalla de confirmación de compra (/order)?
// Marcador MÁS fuerte (no aquí): la URL cambia de /checkout a /order/{id}. Este
// respaldo en el HTML busca el h1 "Confirmación de Compra" + "Código retiro".
//
// GOTCHA (recon 2026-07-24): el sitio es una SPA que precarga TODAS las cadenas
// i18n (incl. "Confirmación de Compra" y "Código retiro") dentro de <script>
// desde CUALQUIER pantalla — p.ej. /seats las trae en su bundle. Buscar sobre el
// HTML crudo daría falso positivo. Por eso primero se quitan <script>/<style>:
// los marcadores solo cuentan si aparecen en el DOM RENDERIZADO (como en /order).
export function detectarPagoConfirmado(html: string): boolean {
  const rendered = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
  return (
    /Confirmaci[oó]n de Compra/i.test(rendered) && /C[oó]digo\s+retiro/i.test(rendered)
  );
}

export interface EntradasInfo {
  codigoRetiro: string;
  sala: string;
  asiento: string;
  pelicula: string;
}

// Parser puro: extrae los datos de las entradas del HTML de /order. El QR de
// INGRESO no está en la web (llega por correo) — acá solo el código de retiro.
export function extraerEntradas(html: string): EntradasInfo {
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const codigoRetiro = (/C[oó]digo\s+retiro[:\s]*([A-Z0-9]{6,})/i.exec(text) ?? [])[1] ?? "";
  const sala = (/Sala\s+(\d+)/i.exec(text) ?? [])[1] ?? "";
  const asiento = (/asiento\s+([A-Z]+-?\d+)/i.exec(text) ?? [])[1] ?? "";
  const pelicula =
    (/([A-ZÁÉÍÓÚÑ0-9][A-ZÁÉÍÓÚÑ0-9 ]{2,40}?)\s*\((?:DOB|SUB)/i.exec(text) ?? [])[1]?.trim() ?? "";
  return { codigoRetiro, sala, asiento, pelicula };
}

// ─────────────────────────────────────────────────────────────────────────────
// VERIFICAR PAGO — lee el DOM vivo tras generar el QR. El pago está confirmado
// ⇔ la URL cambió a /order/{id} (marcador FUERTE) o el HTML renderizado ya es la
// pantalla de confirmación (detectarPagoConfirmado). Si pagó, captura las entradas.
// ─────────────────────────────────────────────────────────────────────────────
export interface VerificarPagoResult {
  pagado: boolean;
  entradasScreenshot?: Buffer;
  entradas?: EntradasInfo;
}

export async function verificarPago(page: Page): Promise<VerificarPagoResult> {
  const url = page.url();
  const html = await page.content();
  const pagado = /\/order\/\d+/.test(url) || detectarPagoConfirmado(html);
  if (!pagado) return { pagado: false };
  await page.waitForTimeout(1200);
  const entradas = extraerEntradas(await page.content());
  const entradasScreenshot = await page.screenshot({ fullPage: true });
  return { pagado: true, entradasScreenshot, entradas };
}

// Lee el countdown de retención de asiento del header de /seats. El timer es un
// nodo hoja con texto "· MM:SS". Si no se encuentra, asume 8 min (default del
// sitio) desde ahora.
async function leerSeatDeadline(page: Page): Promise<number> {
  const now = Date.now();
  try {
    const secs = await page.evaluate(() => {
      for (const el of Array.from(document.querySelectorAll("p, span, div"))) {
        if (el.children.length) continue; // solo nodos hoja
        const t = (el.textContent || "").trim();
        const m = /^·\s*(\d{1,2}):(\d{2})$/.exec(t); // el countdown siempre lleva "· "
        if (m) return Number(m[1]) * 60 + Number(m[2]);
      }
      return null;
    });
    if (secs != null) return now + secs * 1000;
  } catch {
    /* fallthrough */
  }
  return now + 8 * 60_000;
}
