import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { parseShowtimes, fetchCartelera } from "./cinemark-bff.js";

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

  it("ordena por hora ascendente aunque el payload venga desordenado", () => {
    // Sintético a propósito: el BFF real ya devuelve ordenado, así que con el
    // fixture este test no podría fallar nunca.
    const desordenado = {
      data: [
        { sessionDisplayDate: "2026-08-01", sessionDateTime: "2026-08-01T22:10:00.000Z", sessionFormat: "2D", theaterRoom: "3", language: { name: "Doblada" } },
        { sessionDisplayDate: "2026-08-01", sessionDateTime: "2026-08-01T09:05:00.000Z", sessionFormat: "2D", theaterRoom: "1", language: { name: "Doblada" } },
        { sessionDisplayDate: "2026-08-02", sessionDateTime: "2026-08-02T08:00:00.000Z", sessionFormat: "2D", theaterRoom: "2", language: { name: "Doblada" } },
      ],
    };
    const fns = parseShowtimes(desordenado, "2026-08-01");
    expect(fns.map((f) => f.hora)).toEqual(["09:05", "22:10"]);
  });

  it("tolera un payload vacío o sin data", () => {
    expect(parseShowtimes({ data: [] }, fechaDelFixture)).toEqual([]);
    expect(parseShowtimes({}, fechaDelFixture)).toEqual([]);
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("fetchCartelera", () => {
  it("cruza movies con showtimes y devuelve solo películas con funciones ese día", async () => {
    const fecha = fechaDelFixture;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/movies")) {
        return new Response(JSON.stringify({
          data: [
            { corporateId: "110600", title: "LA ODISEA", status: "SHOWING_NOW" },
            { corporateId: "999999", title: "PELI SIN FUNCIONES", status: "PRESALE" },
          ],
        }));
      }
      if (url.includes("movieCorporateId=110600")) return new Response(JSON.stringify(raw));
      return new Response(JSON.stringify({ data: [] }));
    }));

    const pelis = await fetchCartelera(fecha);
    expect(pelis.map((p) => p.titulo)).toEqual(["LA ODISEA"]);
    expect(pelis[0].funciones.length).toBeGreaterThan(0);
  });

  it("filtra por título cuando se pide una película", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/movies")) {
        return new Response(JSON.stringify({
          data: [{ corporateId: "110600", title: "LA ODISEA", status: "SHOWING_NOW" }],
        }));
      }
      return new Response(JSON.stringify(raw));
    }));

    expect(await fetchCartelera(fechaDelFixture, "odisea")).toHaveLength(1);
    expect(await fetchCartelera(fechaDelFixture, "batman")).toHaveLength(0);
  });

  it("lanza si el BFF no responde 200 (para que el caller haga fallback)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 403 })));
    await expect(fetchCartelera(fechaDelFixture)).rejects.toThrow(/403/);
  });

  it("lanza si la red falla", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNRESET"); }));
    await expect(fetchCartelera(fechaDelFixture)).rejects.toThrow();
  });
});
