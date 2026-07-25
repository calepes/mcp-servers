import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page, Frame } from "playwright";
import type { BoaTraveler } from "./travelers.js";
import { missingBoaFields } from "./missing-fields.js";
import { lookupAirportName, type WalletPassData } from "./wallet-pass.js";
import { pickJourney, type JourneyEstado, type JourneyInfo } from "./journeys.js";

/**
 * `page.frame()` es sincrónico y devuelve null si el <iframe> todavía no se
 * adjuntó al DOM — hace falta esperar explícitamente su aparición (la SPA de
 * BoA lo agrega recién después de la navegación al widget de check-in).
 */
async function waitForAmadeusFrame(page: Page, timeoutMs = 15000): Promise<Frame> {
  await page.locator('iframe[name="responseFrame"]').waitFor({ timeout: timeoutMs });
  const frame = page.frame({ name: "responseFrame" });
  if (!frame) throw new Error("No se encontró el iframe de Amadeus (responseFrame).");
  return frame;
}

async function dismissCookieBanner(page: Page): Promise<void> {
  // El banner de cookies aparece unos segundos DESPUÉS de domcontentloaded
  // (hidratación de la SPA) — isVisible() sin esperar da falso negativo si se
  // chequea demasiado temprano. waitFor con estado "visible" sí espera.
  const confirmBtn = page.getByRole("button", { name: "Confirm" });
  const appeared = await waitVisible(confirmBtn, 5000);
  if (appeared) await confirmBtn.click();
}

/**
 * `locator.isVisible()` no espera (el `timeout` de sus opciones está
 * deprecado y se ignora) — para chequear presencia de un elemento OPCIONAL
 * que la SPA de Amadeus puede tardar en renderizar, hay que usar `waitFor`
 * con catch, no `isVisible`.
 */
async function waitVisible(locator: import("playwright").Locator, timeoutMs: number): Promise<boolean> {
  return locator
    .waitFor({ state: "visible", timeout: timeoutMs })
    .then(() => true)
    .catch(() => false);
}

/** Busca la reserva en boa.bo y entra al widget de Amadeus. */
export async function searchBoaReservation(
  page: Page,
  locator: string,
  apellido: string,
): Promise<void> {
  await page.goto("https://www.boa.bo", { waitUntil: "domcontentloaded", timeout: 45000 });
  await dismissCookieBanner(page);

  await page.getByRole("button", { name: "Start Check-in" }).first().click({ timeout: 15000 });
  await page.getByRole("textbox", { name: "FIGUEROA" }).fill(apellido);
  await page.getByRole("textbox", { name: "2AOFFP" }).fill(locator);
  await page.getByRole("button", { name: /Start Check-in.*Iniciar/i }).click();

  await (await waitForAmadeusFrame(page))
    .getByText(/Your journey|Choose how to get your boarding passes|Required information|Manage your booking/i)
    .first()
    .waitFor({ timeout: 20000 });
}

// Badges/etiquetas que BoA antepone al nombre real en la lista de pasajeros
// ("adult", "child", "infant") — no son el nombre, hay que saltarlas.
const PASSENGER_BADGE_WORDS = new Set(["adult", "child", "infant"]);

/**
 * De las líneas de texto de un <li> de pasajero, la primera que NO es un
 * badge de tipo de pasajero y que tiene pinta de nombre (2+ palabras) es el
 * nombre real (ej. "Carlos Lepesqueur"), no la primera línea a secas.
 */
function extractPassengerName(rowText: string): string | null {
  const lines = rowText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of lines) {
    if (PASSENGER_BADGE_WORDS.has(line.toLowerCase())) continue;
    if (/^[A-Za-zÀ-ÿ' -]+\s[A-Za-zÀ-ÿ' -]+$/.test(line)) return line;
  }
  return null;
}

/**
 * Escanea las tarjetas <refx-journey-summary-card-cont> de "Your journeys".
 * Cada tarjeta tiene TRES estados (bug real 2026-07-20, ver journeys.ts):
 * "Check in" (abierto), "Manage check-in" (ya checkeado), o ninguno de los
 * dos ("Check-in opens in ..." — todavía no abre).
 */
async function scanJourneys(
  frame: Frame,
): Promise<{ card: import("playwright").Locator; info: JourneyInfo }[]> {
  const cards = frame.locator("refx-journey-summary-card-cont");
  const count = await cards.count();
  const out: { card: import("playwright").Locator; info: JourneyInfo }[] = [];
  for (let i = 0; i < count; i++) {
    const card = cards.nth(i);
    const titulo = (await card.locator("h3.journey-title").innerText().catch(() => "")).trim();
    let estado: JourneyEstado = "noAbierto";
    if ((await card.getByRole("button", { name: "Check in", exact: true }).count()) > 0) {
      estado = "abierto";
    } else if ((await card.getByRole("button", { name: "Manage check-in", exact: true }).count()) > 0) {
      estado = "checkeado";
    }
    out.push({ card, info: { titulo, estado } });
  }
  return out;
}

export interface SelectJourneyResult {
  /** true si el tramo elegido YA estaba checkeado — la página queda en "Manage your booking". */
  yaCheckeado: boolean;
}

/**
 * Si la reserva tiene más de un tramo (ida y vuelta, o multi-destino), BoA
 * muestra una pantalla "Your journeys" con una tarjeta por tramo. Hay que
 * entrar al tramo correcto ANTES de llegar a la lista de pasajeros, o
 * `listBoaPassengers` no encuentra nada (bug real 2026-07-04: devolvía
 * `pasajeros: []` en silencio en vez de fallar). Reservas de un solo tramo
 * saltan directo a "Who is checking in?" y esta función no hace nada.
 *
 * Si el tramo elegido YA está checkeado (bug real 2026-07-20: antes esto
 * fallaba con el mensaje FALSO "el check-in todavía no está abierto"), entra
 * por "Manage check-in" y devuelve { yaCheckeado: true } para que el caller
 * siga por el camino de "Manage your booking" (boarding pass / asiento) en
 * vez de intentar un check-in nuevo.
 */
export async function selectJourney(page: Page, tramo?: string): Promise<SelectJourneyResult> {
  const frame = await waitForAmadeusFrame(page);
  // El wait previo en searchBoaReservation ya confirmó que ALGUNO de los
  // textos esperados apareció ("Your journey(s)" incluido) — acá solo hace
  // falta un chequeo corto, no una espera larga.
  const onJourneysScreen = await waitVisible(
    frame.getByRole("heading", { level: 1, name: "Your journeys" }),
    2000,
  );
  if (!onJourneysScreen) {
    // Reserva de UN solo tramo: BoA salta "Your journeys". Si ese único tramo
    // ya está checkeado, el widget aterriza directo en "Manage your booking"
    // (warning del daemon-health-reviewer 2026-07-20: sin este chequeo, el
    // caso single-tramo checkeado caía al flujo de check-in nuevo sobre una
    // pantalla equivocada y moría en timeout). Chequeo corto — si no aparece,
    // es un check-in nuevo normal.
    const onManageScreen = await waitVisible(
      frame.getByRole("heading", { name: "Manage your booking" }),
      1500,
    );
    return { yaCheckeado: onManageScreen };
  }

  const journeys = await scanJourneys(frame);
  const pick = pickJourney(
    journeys.map((j) => j.info),
    tramo,
    ["abierto", "checkeado"],
  );
  const elegido = journeys[pick.index];

  if (pick.estado === "checkeado") {
    await elegido.card.getByRole("button", { name: "Manage check-in", exact: true }).click();
    await frame.getByRole("heading", { name: "Manage your booking" }).waitFor({ timeout: 15000 });
    return { yaCheckeado: true };
  }

  await elegido.card.getByRole("button", { name: "Check in", exact: true }).click();
  await frame
    .getByText(/Who is checking in|Choose how to get your boarding passes|Required information/i)
    .first()
    .waitFor({ timeout: 20000 });
  return { yaCheckeado: false };
}

/**
 * Avanza desde "Who is checking in?" (selección de pasajeros — vienen
 * marcados por defecto) y "Restricted Items" (declaración de mercancías
 * peligrosas) hasta "Required information". Ambas pantallas aparecen una sola
 * vez por tramo, antes de la lista de pasajeros propiamente dicha. No-op si
 * la reserva no las muestra (BoA las salta en algunos flujos).
 */
export async function advancePastPassengerSelection(page: Page): Promise<void> {
  const frame = await waitForAmadeusFrame(page);

  const continueBtn = frame.getByRole("button", { name: "Continue", exact: true });
  if (await waitVisible(continueBtn, 5000)) {
    await continueBtn.click();
    await frame.getByText(/Restricted Items|Required information/i).first().waitFor({ timeout: 15000 });
  }

  const agreeBtn = frame.getByRole("button", { name: "I agree and continue" });
  if (await waitVisible(agreeBtn, 5000)) {
    await agreeBtn.click();
    await frame.getByText(/Required information/i).first().waitFor({ timeout: 15000 });
  }
}

/** Lista los pasajeros de la reserva y si cada uno ya hizo check-in. */
export async function listBoaPassengers(page: Page): Promise<{ nombre: string; yaCheckeado: boolean }[]> {
  const frame = await waitForAmadeusFrame(page);
  const rows = frame.locator('li:has(input[type="checkbox"]), li:has-text("Checked in")');
  const count = await rows.count();
  const result: { nombre: string; yaCheckeado: boolean }[] = [];
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    const text = await row.innerText().catch(() => "");
    if (!text.trim()) continue;
    const nombre = extractPassengerName(text);
    if (!nombre) continue;
    result.push({
      nombre,
      yaCheckeado: /checked in/i.test(text),
    });
  }
  return result;
}

const COUNTRY_NAMES: Record<string, string> = {
  CO: "Colombia",
  PE: "Peru",
  BO: "Bolivia",
  BR: "Brazil",
  AR: "Argentina",
};

async function pickAutocomplete(frame: Frame, fieldName: string | RegExp, value: string): Promise<void> {
  const input = frame.getByRole("combobox", { name: fieldName });
  await input.click();
  await input.fill(value);
  const option = frame.getByRole("option", { name: value, exact: false }).first();
  await option.waitFor({ timeout: 5000 });
  // Si el option queda fuera del viewport, Enter selecciona el único resultado visible.
  const visible = await option.isVisible().catch(() => false);
  if (visible) await option.click();
  else await frame.page().keyboard.press("Enter");
}

/**
 * Llena nacionalidad, país de residencia, datos personales y documento de viaje
 * de UN pasajero usando lo que haya en datos-viaje.json. Devuelve los campos
 * que BoA todavía pide y que no estaban resueltos (missingBoaFields ya los
 * predice, pero esto refleja lo que el propio formulario reportó).
 */
export async function fillRequiredInfo(page: Page, traveler: BoaTraveler): Promise<string[]> {
  const frame = await waitForAmadeusFrame(page);

  // Vuelos domésticos (o reservas donde BoA ya tiene los datos guardados) no
  // muestran estos campos — "Required information" puede venir ya completa
  // (solo "Emergency contact", o directo el botón "Confirm and continue").
  // Si el combobox de nacionalidad no aparece, no hay nada que llenar.
  const hasNationalityField = await waitVisible(frame.getByRole("combobox", { name: "Nationality" }), 4000);
  if (!hasNationalityField) return [];

  const missing = missingBoaFields(traveler);
  if (missing.length > 0) return missing; // no tiene sentido ni intentar sin estos datos

  // Nacionalidad
  await pickAutocomplete(frame, "Nationality", COUNTRY_NAMES[traveler.paisNacionalidad] ?? traveler.paisNacionalidad);
  await frame.getByRole("button", { name: "Save nationality information" }).click();

  // País de residencia (asumimos Bolivia — todos los viajeros de datos-viaje.json residen ahí;
  // si algún día no es así, agregar el campo paisResidencia a BoaTraveler)
  await pickAutocomplete(frame, "Country of residence", "Bolivia");
  await frame.getByRole("button", { name: "Save country information" }).click();

  // Datos personales — género y fecha de nacimiento ya vienen prellenados por BoA
  // desde la reserva; solo hace falta lugar de nacimiento.
  await frame.getByRole("textbox", { name: "Place of birth" }).fill(traveler.lugarNacimiento!);
  await frame.getByRole("button", { name: "Save personal details" }).click();

  // Documento de viaje
  const docType = frame.getByRole("combobox", { name: "Document type" });
  await docType.click();
  await frame.getByRole("option", { name: "Passport" }).click();
  await frame.getByRole("textbox", { name: "Document number" }).fill(traveler.pasaporte!.numero);
  await frame.getByRole("textbox", { name: "Document expiry date" }).fill(traveler.pasaporte!.vencimiento);
  await pickAutocomplete(frame, "Document issuing country", COUNTRY_NAMES[traveler.pasaporte!.paisEmisor] ?? traveler.pasaporte!.paisEmisor);
  await frame.getByRole("button", { name: "Save travel document" }).click();

  return [];
}

export interface BoaSeatOption {
  preseleccionado: string | null;
  alternativas: string[];
}

/** Confirma la info requerida y devuelve el mapa de asientos del pasajero activo. */
export async function getSeatOptions(page: Page): Promise<BoaSeatOption> {
  const frame = await waitForAmadeusFrame(page);
  await frame.getByRole("button", { name: "Confirm and continue" }).click();
  return readSeatMap(frame);
}

/**
 * Lee el mapa de asientos de la pantalla "Select your seat" — compartido por
 * `getSeatOptions` (check-in nuevo, tras "Confirm and continue" de Required
 * information) y `openSeatChangeForJourney` (cambio de asiento post-checkin,
 * que llega a esta misma pantalla directo desde "Manage your booking >
 * Change seats" — validado en vivo 2026-07-04 contra una reserva real: mismos
 * elementos, mismo botón "Confirm seat selection and continue").
 */
async function readSeatMap(frame: Frame): Promise<BoaSeatOption> {
  // Bug real 2026-07-04 #1 (producción, vía Jano): getByText(/Select your seat/i)
  // también matchea el subtítulo "Pre-select your seats" del link "Change
  // seats" en "Manage your booking" (cambio de asiento post-checkin) — 2
  // elementos con esa substring → strict mode violation. Acotar a heading
  // nivel 1 (el título real de esta pantalla) evita la ambigüedad.
  await frame.getByRole("heading", { level: 1, name: /Select your seat/i }).waitFor({ timeout: 15000 });

  // Bug real 2026-07-04 #2 (encontrado recién al probar end-to-end con código
  // real, no clicks manuales): los botones de asiento NO tienen `aria-label`
  // como atributo HTML literal — el "aria-label" que reporta el snapshot de
  // accesibilidad de Playwright es en realidad TEXTO COMPUTADO desde spans
  // internos `cdk-visually-hidden` (Angular CDK), invisibles pero presentes en
  // el DOM. `getAttribute("aria-label")` y el selector CSS `[aria-label*=...]`
  // SIEMPRE devuelven null/vacío contra este markup — por eso `getSeatOptions`
  // nunca había funcionado vía automatización real (solo "funcionaba" en las
  // validaciones manuales con el snapshot de accesibilidad, que sí computa el
  // nombre correctamente). Fix: usar `getByRole` (que sí usa el nombre
  // accesible computado) para ENCONTRAR el botón, y el atributo `title` (un
  // atributo real, ej. `title="19A"`) para leer el código de asiento.
  const selectedBtn = frame.getByRole("button", { name: /selected for passenger/i }).first();
  const preseleccionado = await selectedBtn.getAttribute("title").catch(() => null);

  const freeButtons = frame.getByRole("button", { name: /Free of charge/i });
  const count = await freeButtons.count();
  const alternativas: string[] = [];
  for (let i = 0; i < count; i++) {
    const seat = await freeButtons.nth(i).getAttribute("title");
    if (seat) alternativas.push(seat);
  }
  return { preseleccionado, alternativas };
}

/**
 * Navega a "Manage your booking" del tramo YA checkeado indicado (o el único
 * si la reserva tiene uno solo). Si la reserva tiene más de un tramo, BoA lo
 * muestra bajo "Journeys already checked in" en "Your journeys" con botón
 * "Manage check-in" (en vez de "Check in"). Compartido por
 * `openSeatChangeForJourney` (cambio de asiento) y `getBoardingPassForJourney`
 * (recuperar boarding pass) — ambas aterrizan en la misma pantalla "Manage
 * your booking" antes de bifurcar a su acción específica.
 */
async function openManageBooking(frame: Frame, tramo?: string): Promise<void> {
  const onJourneysScreen = await waitVisible(
    frame.getByRole("heading", { level: 1, name: "Your journeys" }),
    2000,
  );
  if (!onJourneysScreen) return; // reserva de un solo tramo: ya está en "Manage your booking"

  const journeys = await scanJourneys(frame);
  const pick = pickJourney(
    journeys.map((j) => j.info),
    tramo,
    ["checkeado"],
  );
  await journeys[pick.index].card
    .getByRole("button", { name: "Manage check-in", exact: true })
    .click();
  await frame.getByRole("heading", { name: "Manage your booking" }).waitFor({ timeout: 15000 });
}

/**
 * Cambia el asiento de un tramo ya checkeado: navega a "Manage your booking"
 * (ver `openManageBooking`) y sigue a "Change seats", que aterriza en la
 * misma pantalla "Select your seat" que usa el check-in nuevo. Devuelve el
 * mapa de asientos actual para elegir el nuevo (no confirma nada — eso lo
 * hace `confirmSeatAndContinue` después).
 */
export async function openSeatChangeForJourney(page: Page, tramo?: string): Promise<BoaSeatOption> {
  const frame = await waitForAmadeusFrame(page);
  await openManageBooking(frame, tramo);
  await frame.getByRole("link", { name: "Change seats", exact: false }).click();
  return readSeatMap(frame);
}

/**
 * Recupera el boarding pass de un tramo YA checkeado (sin volver a hacer
 * check-in ni tocar el asiento) — gap real encontrado 2026-07-04: Cal pidió
 * "dame el boarding" para un vuelo ya checkeado y Jano no tenía ninguna tool
 * para eso (solo prepareBoaCheckin/confirmBoaCheckin para check-in NUEVO y
 * manageBoaSeat para cambiar asiento), así que alucinó "el check-in no está
 * abierto" en vez de simplemente buscar el PDF ya emitido. Navega a "Manage
 * your booking" (ver `openManageBooking`) y devuelve el boarding pass de
 * CADA pasajero checkeado en ese tramo (ver `getAllBoardingPasses` — bug
 * real 2026-07-04: una reserva de 3 pasajeros solo devolvía 1 PDF).
 */
export async function getBoardingPassForJourney(page: Page, tramo?: string): Promise<{ nombre: string; url: string }[]> {
  const frame = await waitForAmadeusFrame(page);
  await openManageBooking(frame, tramo);
  return getAllBoardingPasses(page);
}

/**
 * Recopila TODOS los datos visuales que necesita `buildBoaPassFields` desde
 * "Manage your booking"/"Your boarding pass" — el mismo camino que ya usa
 * `getBoardingPassForJourney`. NO decodifica el BCBP (eso lo hace
 * `decodeBoardingPassBarcode` sobre el PDF descargado aparte); esto es solo
 * lo que ya está visible en pantalla.
 *
 * ⚠️ NO VALIDADO contra una reserva real de BoA (Task 9, 2026-07-16): los
 * regexes de abajo son un best-effort sobre cómo debería verse el texto de la
 * fila, mirroreando el parsing ya probado en `getAllBoardingPasses` (el match
 * `Passenger\n(nombre)` unas líneas arriba en este mismo archivo, ese SÍ
 * validado en vivo). Antes de confiar en esto en producción, correr contra
 * una reserva confirmada real (locator/apellido que dé Cal), loguear
 * `rowText` y ajustar los regex al texto real — igual que el resto de las
 * funciones de este archivo (ver comentarios "Bug real ..." de arriba, todos
 * fruto de esa misma iteración). Validación explícitamente diferida a la
 * verificación E2E manual del plan (Task 13).
 */
export async function getWalletPassScrapeData(
  page: Page,
  locator: string,
  tramo?: string,
  nombre?: string,
): Promise<Omit<WalletPassData, "barcodeMessage">> {
  const frame = await waitForAmadeusFrame(page);
  await openManageBooking(frame, tramo);

  const passengerRow = frame.getByRole("listitem").filter({ hasText: nombre ?? "" }).first();
  const rowText = await passengerRow.innerText();

  const flightNumber = (rowText.match(/\b(OB\d{2,4})\b/) || [])[1] ?? "";
  const route = rowText.match(/([A-Z]{3})\s*(?:to|→|-)\s*([A-Z]{3})/i);
  const originCode = route?.[1]?.toUpperCase() ?? "";
  const destinationCode = route?.[2]?.toUpperCase() ?? "";
  const seat = (rowText.match(/Seat\s*([0-9]{1,2}[A-Z])/i) || [])[1] ?? "";
  const boardingGroup = (rowText.match(/Group\s*([0-9]+)/i) || [])[1] ?? "";
  // Bug real encontrado 2026-07-20 (reserva HVKNUC): `[A-Z0-9]+` sin límite
  // capturaba texto de relleno tipo "Gate: Check..." (BoA no muestra puerta
  // real hasta más cerca del vuelo) devolviendo "Check" como si fuera un
  // código de puerta. Un código de puerta real es corto y casi siempre trae
  // al menos un dígito ("3", "12", "B25") — se limita el largo a 4 y se
  // exige un dígito para filtrar palabras sueltas.
  const gateCandidate = (rowText.match(/Gate\s*:?\s*([A-Z0-9]{1,4})\b/i) || [])[1];
  const gate = gateCandidate && /\d/.test(gateCandidate) ? gateCandidate.toUpperCase() : undefined;
  const travelClass = /business/i.test(rowText) ? "Business" : "Economy";
  const departureTime = (rowText.match(/Departure\s*([0-9]{1,2}:[0-9]{2})/i) || [])[1] ?? "";
  const arrivalTime = (rowText.match(/(?:Arrival|Landing)\s*([0-9]{1,2}:[0-9]{2})/i) || [])[1];
  const boardingTime = (rowText.match(/Boarding\s*([0-9]{1,2}:[0-9]{2})/i) || [])[1] ?? "";
  const flightDate = (rowText.match(/([0-9]{1,2}\s+[A-Za-z]{3}\b)/) || [])[1] ?? "";
  const frequentFlyerMatch = rowText.match(/Elevate\s*[:#]?\s*([A-Z0-9 ]{4,})/i);

  return {
    locator,
    passengerName: (nombre ?? rowText.match(/Passenger\n([A-Za-zÀ-ÿ' -]+)/)?.[1] ?? "").trim(),
    frequentFlyerNumber: frequentFlyerMatch?.[1]?.trim(),
    flightNumber,
    originCode,
    originName: lookupAirportName(originCode),
    destinationCode,
    destinationName: lookupAirportName(destinationCode),
    departureTime,
    arrivalTime,
    boardingTime,
    flightDate,
    seat,
    boardingGroup,
    travelClass,
    gate,
  };
}

/**
 * Carga (o edita) el número de viajero frecuente de Elévate en un tramo YA
 * checkeado. Gap real encontrado 2026-07-04 (mismo patrón que
 * `getBoaBoardingPass`): Cal pidió agregar su número de viajero frecuente y
 * no había tool para eso. El botón "Add frequent flyer information" (pasa a
 * "Edit frequent flyer information" una vez cargado) vive en "Manage your
 * booking" bajo la sección "Passenger", junto al nombre — mismo lugar donde
 * `openManageBooking` ya deja parado a `openSeatChangeForJourney` y
 * `getBoardingPassForJourney`. El programa se hardcodea a "Boliviana De
 * Aviacion - OB" (Elévate) porque es el único que tiene sentido en este
 * flujo. `pasajero` (substring de nombre) desambigua si la reserva tiene más
 * de un pasajero; sin él, toma el primero que tenga el botón.
 */
export async function setFrequentFlyer(
  page: Page,
  numero: string,
  opts?: { tramo?: string; pasajero?: string },
): Promise<void> {
  const frame = await waitForAmadeusFrame(page);
  await openManageBooking(frame, opts?.tramo);

  let filas = frame.getByRole("listitem").filter({ hasText: /frequent flyer information/i });
  if (opts?.pasajero) {
    filas = filas.filter({ hasText: opts.pasajero });
  }
  const count = await filas.count();
  if (count === 0) {
    throw new Error(
      opts?.pasajero
        ? `No encontré a "${opts.pasajero}" en la lista de pasajeros de este tramo.`
        : "No encontré el botón de viajero frecuente para ningún pasajero de este tramo.",
    );
  }

  await filas.first().getByRole("button", { name: /frequent flyer information/i }).click();
  const dialog = frame.getByRole("dialog", { name: "Frequent Flyers" });
  await dialog.waitFor({ timeout: 10000 });
  await dialog.getByRole("combobox", { name: "Frequent flyer program" }).click();
  await frame.getByRole("option", { name: "Boliviana De Aviacion - OB" }).click();
  await dialog.getByRole("textbox", { name: "Frequent flyer number" }).fill(numero);
  await dialog.getByRole("button", { name: "Confirm" }).click();
  await dialog.waitFor({ state: "hidden", timeout: 10000 });

  // Bug real 2026-07-13 (producción, vía Jano): el diálogo se cerraba
  // reportando éxito pero el número nunca quedaba grabado en el backend de
  // Amadeus — confirmado bajando el boarding pass real y viendo "FREQUENT
  // FLYER: None", dos intentos consecutivos, ambos "exitosos" según el código
  // (cierre visual del diálogo ≠ submit realmente persistido). Verificación
  // post-condición: el botón de la fila pasa de "Add" a "Edit frequent flyer
  // information" SOLO si el número quedó asociado — si sigue en modo "Add",
  // el guardado falló y hay que decirlo, no reportar éxito falso.
  const editButton = filas.first().getByRole("button", { name: /Edit frequent flyer information/i });
  const confirmado = await waitVisible(editButton, 8000);
  if (!confirmado) {
    throw new Error(
      "BoA no confirmó el guardado del número de viajero frecuente (el botón sigue en modo 'Add', no 'Edit') — probablemente no se persistió. Reintentar.",
    );
  }
}

/**
 * Cambia el asiento estando YA parado en "Manage your booking" (sin volver a
 * navegar desde "Your journeys") — usado por el camino idempotente de
 * `confirmBoaCheckin` cuando el tramo ya quedó checkeado (bug real 2026-07-20:
 * `prepareBoaCheckin` ejecuta el check-in real del lado de Amadeus, así que el
 * confirm posterior encuentra el tramo checkeado y debe AJUSTAR el asiento en
 * vez de repetir un check-in que ya no existe). No-op si el asiento pedido ya
 * es el actual.
 */
export async function changeSeatFromManage(
  page: Page,
  seatCode: string,
): Promise<{ cambiado: boolean; asiento: string }> {
  const frame = await waitForAmadeusFrame(page);
  // Guard multi-pax (blocking del daemon-health-reviewer, 2026-07-20): este
  // camino no selecciona pasajero — readSeatMap lee "el primero seleccionado"
  // y con 2+ pasajeros podría cambiarle el asiento a la persona equivocada
  // (misma clase de bug silencioso que el boarding pass multi-pax del
  // 2026-07-04). Una fila por pasajero en "Manage your booking" = el botón de
  // frequent flyer (patrón ya validado en setFrequentFlyer). Si hay más de
  // una, error honesto en vez de un cambio a ciegas.
  const paxCount = await frame
    .getByRole("listitem")
    .filter({ hasText: /frequent flyer information/i })
    .count();
  if (paxCount > 1) {
    throw new Error(
      `La reserva tiene ${paxCount} pasajeros checkeados y el cambio de asiento post-checkin todavía no puede elegir a cuál aplicarlo — riesgo de cambiar el asiento equivocado. Hacelo desde la web/app de BoA por ahora.`,
    );
  }
  await frame.getByRole("link", { name: "Change seats", exact: false }).click();
  const opciones = await readSeatMap(frame);
  if (opciones.preseleccionado === seatCode) {
    // Ya está en ese asiento: confirmar sin tocar nada para volver a "Manage".
    await confirmSeatAndContinue(page);
    return { cambiado: false, asiento: seatCode };
  }
  if (!opciones.alternativas.includes(seatCode)) {
    throw new Error(
      `El asiento ${seatCode} no está libre en este tramo. Actual: ${opciones.preseleccionado ?? "desconocido"}. Libres: ${opciones.alternativas.join(", ") || "ninguno"}.`,
    );
  }
  await confirmSeatAndContinue(page, seatCode);
  return { cambiado: true, asiento: seatCode };
}

/** Elige un asiento específico (si se pasa) o confirma el preseleccionado, y sigue. */
export async function confirmSeatAndContinue(page: Page, seatCode?: string): Promise<void> {
  const frame = await waitForAmadeusFrame(page);
  if (seatCode) {
    await frame.getByRole("button", { name: new RegExp(`Seat ${seatCode}\\b`) }).click();
    // Bug real 2026-07-04 #3 (producción, vía Jano — timeout esperando "Confirm
    // seat selection and continue"): clickear un asiento no lo selecciona
    // directo — abre un <mat-dialog> "Seat selection details" (título "Seat
    // XX", características, botón "Select seat"). Hay que confirmar AHÍ
    // adentro; recién entonces el asiento queda marcado como seleccionado y
    // el botón principal "Confirm seat selection and continue" se habilita.
    const dialog = frame.locator('[role="dialog"]').first();
    const dialogAppeared = await waitVisible(dialog, 4000);
    if (dialogAppeared) {
      // Bug real 2026-07-04 #4 (producción, vía Jano — timeout esperando
      // "Select seat" DENTRO del diálogo): si el asiento clickeado YA es el
      // preseleccionado (ej. reintento de un cambio que ya se aplicó), el
      // diálogo igual aparece pero SOLO trae el botón "Close" (sin texto,
      // `aria-label="Close"`) — no hay nada que confirmar. Probar "Select
      // seat" primero (asiento nuevo) y si no aparece, cerrar con "Close"
      // (asiento ya seleccionado) en vez de colgarse esperando un botón que
      // no existe en ese caso.
      const selectSeatBtn = dialog.getByRole("button", { name: "Select seat" });
      const hasSelectButton = await waitVisible(selectSeatBtn, 3000);
      if (hasSelectButton) {
        await selectSeatBtn.click();
      } else {
        await dialog.getByRole("button", { name: "Close" }).click();
      }
      await dialog.waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
    }
  }
  await frame.getByRole("button", { name: "Confirm seat selection and continue" }).click();
  // Check-in nuevo: termina en "You are checked in!". Cambio de asiento
  // post-checkin: pantalla final NO validada en vivo (Cal prefirió no tocar
  // su asiento real en la sesión donde se construyó esto, 2026-07-04) —
  // tolerante a que en vez de eso vuelva a "Manage your booking".
  await frame.getByText(/You are checked in!|Manage your booking/i).first().waitFor({ timeout: 20000 });
}

/**
 * Bug real 2026-07-04 (producción, vía Vesta — reserva de 3 pasajeros,
 * Cal pidió "el boarding" de las 3 y solo recibió 1): en "Your boarding
 * pass", cada pasajero es una fila (`listitem`) separada. Antes de mostrar
 * SU botón "Download / Print" hay que clickear SU botón "Show additional
 * boarding pass info" (colapsado por default en todas las filas salvo la
 * primera) — sin eso, `getByRole("button", { name: "Download / Print" })`
 * a nivel de página solo encuentra el de la fila ya expandida (normalmente
 * la primera), y genera un PDF de 1 sola página con ESE pasajero, sin
 * importar cuántos haya en la reserva. Confirmado bajando y comparando los
 * PDFs reales de una reserva de 3 (Catalina/Antonia/Noe): cada botón de
 * "Download / Print", scopeado a SU fila, da un PDF distinto de 1 página.
 */
async function downloadBoardingPassRow(page: Page, row: import("playwright").Locator): Promise<string> {
  const rowDownload = row.getByRole("button", { name: "Download / Print" });
  const yaVisible = await waitVisible(rowDownload, 500);
  if (!yaVisible) {
    await row.getByRole("button", { name: "Show additional boarding pass info" }).click();
    await rowDownload.waitFor({ timeout: 8000 });
  }
  const [popup] = await Promise.all([
    page.context().waitForEvent("page", { timeout: 15000 }),
    rowDownload.click(),
  ]);
  await popup.waitForLoadState("domcontentloaded");
  const url = popup.url();
  await popup.close();
  return url;
}

/** La fila (listitem) de UN pasajero en "Your boarding pass" — por nombre si
 * se pasa, o la primera si no (caso de check-in nuevo, donde BoA procesa un
 * pasajero a la vez y esta pantalla naturalmente muestra una sola fila). */
function boardingPassRowFor(frame: Frame, nombre?: string) {
  let filas = frame.getByRole("listitem");
  if (nombre) filas = filas.filter({ hasText: nombre });
  return filas.first();
}

/**
 * Desde "You are checked in!"/"Manage your booking" navega a la tarjeta de
 * embarque y devuelve la URL pública del PDF (checkin.si.amadeus.net/.../
 * bp?id=...) de UN pasajero — la misma que Telegram puede consumir directo
 * con sendDocument, sin que nosotros descarguemos ni sirvamos el archivo.
 * `nombre` desambigua si hay más de una fila visible; usado por
 * `confirmBoaCheckin`, que ya itera pasajero por pasajero.
 */
export async function getBoardingPassUrl(page: Page, nombre?: string): Promise<string> {
  const frame = await waitForAmadeusFrame(page);
  await frame.getByRole("button", { name: "View boarding passes" }).click();
  await frame.getByRole("heading", { name: "Your boarding pass" }).waitFor({ timeout: 15000 });
  const row = boardingPassRowFor(frame, nombre);
  return downloadBoardingPassRow(page, row);
}

/**
 * Boarding pass de TODOS los pasajeros checkeados en la pantalla actual —
 * usado por `getBoaBoardingPass` para reservas con varios pasajeros (ver
 * bug real arriba). Devuelve `{ nombre, url }` por cada fila.
 */
export async function getAllBoardingPasses(page: Page): Promise<{ nombre: string; url: string }[]> {
  const frame = await waitForAmadeusFrame(page);
  await frame.getByRole("button", { name: "View boarding passes" }).click();
  await frame.getByRole("heading", { name: "Your boarding pass" }).waitFor({ timeout: 15000 });

  const filas = frame.getByRole("listitem");
  const count = await filas.count();
  const resultado: { nombre: string; url: string }[] = [];
  for (let i = 0; i < count; i++) {
    const fila = filas.nth(i);
    const texto = await fila.innerText().catch(() => "");
    const nombre = texto.match(/Passenger\n([A-Za-zÀ-ÿ' -]+)/)?.[1]?.trim() ?? `Pasajero ${i + 1}`;
    const url = await downloadBoardingPassRow(page, fila);
    resultado.push({ nombre, url });
  }
  return resultado;
}

/**
 * Captura screenshot + texto de la pantalla actual a tmpdir para diagnóstico
 * post-mortem de una falla (P1 de la auditoría 2026-07-20: cada bug real de
 * este MCP requirió reproducir a mano porque los timeouts de Playwright no
 * dicen QUÉ había en pantalla). Best-effort: nunca tira — devuelve los paths
 * escritos o null si ni siquiera se pudo capturar.
 */
export async function captureDiagnostics(
  page: Page,
  etiqueta: string,
): Promise<{ screenshotPath: string; textPath: string } | null> {
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const base = join(tmpdir(), `boa-diag-${etiqueta}-${stamp}`);
    const screenshotPath = `${base}.png`;
    const textPath = `${base}.txt`;
    await page.screenshot({ path: screenshotPath, fullPage: true });
    const frame = page.frame({ name: "responseFrame" });
    const text = frame
      ? await frame.locator("body").innerText().catch(() => "")
      : await page.locator("body").innerText().catch(() => "");
    writeFileSync(textPath, `URL: ${page.url()}\n\n${text}`);
    return { screenshotPath, textPath };
  } catch {
    return null;
  }
}
