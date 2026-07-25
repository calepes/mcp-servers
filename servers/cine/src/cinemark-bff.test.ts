import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseShowtimes } from "./cinemark-bff.js";

const raw = JSON.parse(
  readFileSync(new URL("./__fixtures__/bff-showtimes.json", import.meta.url), "utf8"),
);
const fechaDelFixture: string = raw.data[0].sessionDisplayDate;

describe("parseShowtimes", () => {
  it("devuelve las funciones de la fecha pedida", () => {
    const fns = parseShowtimes(raw, fechaDelFixture);
    expect(fns.length).toBeGreaterThan(0);
    expect(fns.every((f) => f.hora.match(/^\d{2}:\d{2}$/))).toBe(true);
  });

  it("filtra: una fecha sin funciones devuelve vacío", () => {
    expect(parseShowtimes(raw, "1999-01-01")).toEqual([]);
  });

  it("toma la hora del string sin convertir zona (el Z es mentira)", () => {
    const primero = raw.data[0];
    const fns = parseShowtimes(raw, primero.sessionDisplayDate);
    const esperada = primero.sessionDateTime.slice(11, 16);
    expect(fns.some((f) => f.hora === esperada)).toBe(true);
  });

  it("mapea formato, idioma y sala", () => {
    const f = parseShowtimes(raw, fechaDelFixture)[0];
    expect(f).toMatchObject({
      hora: expect.any(String),
      formato: expect.any(String),
      idioma: expect.any(String),
      sala: expect.any(String),
    });
  });

  it("ordena por hora ascendente", () => {
    const horas = parseShowtimes(raw, fechaDelFixture).map((f) => f.hora);
    expect(horas).toEqual([...horas].sort());
  });

  it("tolera un payload vacío o sin data", () => {
    expect(parseShowtimes({ data: [] }, fechaDelFixture)).toEqual([]);
    expect(parseShowtimes({}, fechaDelFixture)).toEqual([]);
  });
});
