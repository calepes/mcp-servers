import type { Page, Frame } from "playwright";

function amadeusFrame(page: Page): Frame {
  const frame = page.frame({ name: "responseFrame" });
  if (!frame) throw new Error("No se encontró el iframe de Amadeus (responseFrame).");
  return frame;
}

async function dismissCookieBanner(page: Page): Promise<void> {
  const confirmBtn = page.getByRole("button", { name: "Confirm" });
  if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await confirmBtn.click();
  }
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

  await amadeusFrame(page)
    .getByText(/Your journey|Choose how to get your boarding passes|Required information/i)
    .first()
    .waitFor({ timeout: 20000 });
}

/** Lista los pasajeros de la reserva y si cada uno ya hizo check-in. */
export async function listBoaPassengers(page: Page): Promise<{ nombre: string; yaCheckeado: boolean }[]> {
  const frame = amadeusFrame(page);
  const rows = frame.locator('li:has(input[type="checkbox"]), li:has-text("Checked in")');
  const count = await rows.count();
  const result: { nombre: string; yaCheckeado: boolean }[] = [];
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    const text = await row.innerText().catch(() => "");
    if (!text.trim()) continue;
    const nombreMatch = text.match(/^([A-Za-zÀ-ÿ' -]+)/);
    if (!nombreMatch) continue;
    result.push({
      nombre: nombreMatch[1].trim(),
      yaCheckeado: /checked in/i.test(text),
    });
  }
  return result;
}
