import type { Page, Frame } from "playwright";
import type { BoaTraveler } from "./travelers.js";
import { missingBoaFields } from "./missing-fields.js";

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
  const appeared = await confirmBtn
    .waitFor({ state: "visible", timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  if (appeared) await confirmBtn.click();
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
    .getByText(/Your journey|Choose how to get your boarding passes|Required information/i)
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
  await frame.getByText(/Select your seat/i).waitFor({ timeout: 15000 });

  const selectedBtn = frame.locator('button[aria-label*="selected for passenger"]').first();
  const preseleccionado = (await selectedBtn.getAttribute("aria-label").catch(() => null))
    ?.match(/Seat (\w+)/)?.[1] ?? null;

  const freeButtons = frame.locator('button[aria-label*="Free of charge"]');
  const count = await freeButtons.count();
  const alternativas: string[] = [];
  for (let i = 0; i < count; i++) {
    const label = await freeButtons.nth(i).getAttribute("aria-label");
    const seat = label?.match(/Seat (\w+)/)?.[1];
    if (seat) alternativas.push(seat);
  }
  return { preseleccionado, alternativas };
}

/** Elige un asiento específico (si se pasa) o confirma el preseleccionado, y sigue. */
export async function confirmSeatAndContinue(page: Page, seatCode?: string): Promise<void> {
  const frame = await waitForAmadeusFrame(page);
  if (seatCode) {
    await frame.getByRole("button", { name: new RegExp(`Seat ${seatCode}\\b`) }).click();
  }
  await frame.getByRole("button", { name: "Confirm seat selection and continue" }).click();
  await frame.getByText(/You are checked in!/i).waitFor({ timeout: 20000 });
}

/**
 * Desde "You are checked in!" navega a la tarjeta de embarque y devuelve la
 * URL pública del PDF (checkin.si.amadeus.net/.../bp?id=...) — la misma que
 * Telegram puede consumir directo con sendDocument, sin que nosotros
 * descarguemos ni sirvamos el archivo.
 */
export async function getBoardingPassUrl(page: Page): Promise<string> {
  const frame = await waitForAmadeusFrame(page);
  await frame.getByRole("button", { name: "View boarding passes" }).click();
  const [popup] = await Promise.all([
    page.context().waitForEvent("page", { timeout: 15000 }),
    frame.getByRole("button", { name: "Download / Print" }).click(),
  ]);
  await popup.waitForLoadState("domcontentloaded");
  const url = popup.url();
  await popup.close();
  return url;
}
