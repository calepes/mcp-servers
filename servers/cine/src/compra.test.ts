import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  parseAsientosDisponibles,
  agruparPorFila,
  detectarPagoConfirmado,
  extraerEntradas,
} from "./compra.js";

const seatsHtml = readFileSync(new URL("./__fixtures__/seats.html", import.meta.url), "utf8");
const premierHtml = readFileSync(
  new URL("./__fixtures__/seats-premier.html", import.meta.url),
  "utf8",
);
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

// ─────────────────────────────────────────────────────────────────────────────
// SALA PREMIER CON ASIENTO DOBLE (fixture: Sala 2, LA ODISEA 2026-08-06 20:00).
// Recon 2026-08-04: este layout renderiza las butacas DISTINTO al de sala general.
// Las 42 butacas de asiento doble NO llevan data-seat-identifier — solo aria-label
// y un icono 20x20 cuyo `fill` codifica el estado (#fff libre / #787272 ocupada).
// Solo los 3 asientos SUELTOS (B5/C5/D5) traen data-seat-identifier.
// Con la regla vieja ("seleccionable ⇔ data-seat-identifier") el parser veía 3 de
// 45 libres y rechazaba todo lo demás con "Asiento(s) no disponible(s)".
// ─────────────────────────────────────────────────────────────────────────────
describe("parseAsientosDisponibles — sala premier (asiento doble)", () => {
  it("encuentra las butacas libres SIN data-seat-identifier", () => {
    const libres = parseAsientosDisponibles(premierHtml);
    // 42 de asiento doble + 3 sueltos con identifier
    expect(libres.length).toBe(45);
    expect(libres).toContain("A1"); // doble, sin identifier
    expect(libres).toContain("B5"); // suelto, con identifier
  });

  it("excluye las butacas ocupadas (icono gris #787272)", () => {
    const libres = parseAsientosDisponibles(premierHtml);
    for (const ocupada of ["D3", "D4", "E5", "E6", "E7", "E8"]) {
      expect(libres).not.toContain(ocupada);
    }
  });

  it("excluye el asiento de acompañante", () => {
    // A7 es el "C" del mapa: icono 9x9 sin data-seat-identifier.
    expect(parseAsientosDisponibles(premierHtml)).not.toContain("A7");
  });

  it("todos los labels tienen formato de butaca y no hay duplicados", () => {
    const libres = parseAsientosDisponibles(premierHtml);
    expect(libres.every((s) => /^[A-Z]+\d+$/.test(s))).toBe(true);
    expect(new Set(libres).size).toBe(libres.length);
  });
});

describe("agruparPorFila", () => {
  it("agrupa por letra de fila y comprime los rangos contiguos", () => {
    expect(agruparPorFila(["B1", "B2", "B3", "B6", "B9", "A4"])).toEqual([
      { fila: "A", butacas: "A4" },
      { fila: "B", butacas: "B1-B3, B6, B9" },
    ]);
  });

  it("ordena las butacas por número, no alfabéticamente", () => {
    // "B10" < "B9" alfabéticamente — sin orden numérico el rango sale mal.
    expect(agruparPorFila(["B10", "B9", "B11"])).toEqual([
      { fila: "B", butacas: "B9-B11" },
    ]);
  });

  it("sobre el mapa premier real deja las 6 filas con sus huecos", () => {
    const g = agruparPorFila(parseAsientosDisponibles(premierHtml));
    expect(g.map((x) => x.fila)).toEqual(["A", "B", "C", "D", "E", "F"]);
    // Fila D: D3/D4 ocupadas y D5 libre → el hueco tiene que verse.
    expect(g.find((x) => x.fila === "D")?.butacas).toBe("D1-D2, D5-D9");
  });

  it("devuelve vacío sin butacas", () => {
    expect(agruparPorFila([])).toEqual([]);
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
