import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  parseAsientosDisponibles,
  detectarPagoConfirmado,
  extraerEntradas,
} from "./compra.js";

const seatsHtml = readFileSync(new URL("./__fixtures__/seats.html", import.meta.url), "utf8");
const entradasHtml = readFileSync(
  new URL("./__fixtures__/entradas.html", import.meta.url),
  "utf8",
);

// NOTA: el count 272 y los 278 aria-label son ESPECÍFICOS de este fixture (sala
// de Moana, recon 2026-07-24). El parser es dinámico — no asume layout ni cantidad;
// estos números solo validan el parseo contra ESTE HTML concreto. Otras salas
// (premier/VIP/DBOX/accesible) tienen distinto layout y cantidad de butacas.
describe("parseAsientosDisponibles", () => {
  it("extrae los labels de las butacas con data-seat-identifier", () => {
    const libres = parseAsientosDisponibles(seatsHtml);
    expect(libres.length).toBe(272); // count real del fixture (recon 2026-07-24)
    expect(libres.every((s) => /^[A-Z]+\d+$/.test(s))).toBe(true);
    expect(new Set(libres).size).toBe(libres.length); // sin duplicados
  });

  it("no incluye butacas sin data-seat-identifier (accesibles/acompañante)", () => {
    const libres = parseAsientosDisponibles(seatsHtml);
    // el fixture tiene 278 aria-label pero 272 seleccionables → menos que el total de aria-label
    const totalAriaLabels = (seatsHtml.match(/aria-label="[A-Z]+\d+"/g) || []).length;
    expect(totalAriaLabels).toBe(278);
    expect(libres.length).toBeLessThan(totalAriaLabels);
  });
});

describe("detectarPagoConfirmado", () => {
  it("true cuando el HTML muestra la confirmación", () => {
    expect(detectarPagoConfirmado(entradasHtml)).toBe(true);
  });
  it("false en una pantalla que no es la confirmación (mapa de asientos)", () => {
    expect(detectarPagoConfirmado(seatsHtml)).toBe(false);
  });
});

describe("extraerEntradas", () => {
  it("extrae código de retiro, sala y asiento del HTML de confirmación", () => {
    const e = extraerEntradas(entradasHtml);
    expect(e.codigoRetiro).toMatch(/^[A-Z0-9]{6,}$/); // TESTCODE1 en el fixture
    expect(e.codigoRetiro).toBe("TESTCODE1");
    expect(e.sala).toBe("5");
    expect(e.asiento).toMatch(/^[A-Z]+-?\d+$/); // "X-99"
    expect(e.asiento).toBe("X-99");
  });
});
