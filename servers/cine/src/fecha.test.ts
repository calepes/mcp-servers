import { describe, it, expect } from "vitest";
import { resolverFecha, hoyLaPaz } from "./fecha.js";

describe("resolverFecha", () => {
  it("acepta una fecha ISO tal cual", () => {
    expect(resolverFecha("2026-07-28")).toBe("2026-07-28");
  });

  it("traduce 'hoy' al día actual en La Paz", () => {
    expect(resolverFecha("hoy")).toBe(hoyLaPaz());
  });

  it("traduce 'mañana' (con y sin tilde) al día siguiente", () => {
    const manana = resolverFecha("mañana");
    expect(manana).toBe(resolverFecha("manana"));
    expect(new Date(manana).getTime()).toBeGreaterThan(new Date(hoyLaPaz()).getTime());
  });

  it("sin argumento devuelve hoy", () => {
    expect(resolverFecha(undefined)).toBe(hoyLaPaz());
  });

  it("rechaza basura", () => {
    expect(() => resolverFecha("el jueves que viene")).toThrow(/no entendí la fecha/i);
  });

  it("hoyLaPaz devuelve formato YYYY-MM-DD", () => {
    expect(hoyLaPaz()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
