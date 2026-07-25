import { describe, it, expect } from "vitest";
import { CINE_TOOL_NAMES, createCineServer } from "./mcp-server.js";

describe("mcp-server factory", () => {
  it("expone las 7 tools de cine con los nombres esperados", () => {
    expect(CINE_TOOL_NAMES).toEqual([
      "getCartelera",
      "iniciarCompraCine",
      "elegirAsientosCine",
      "confirmarCompraCine",
      "verificarPagoCine",
      "cancelarCompraCine",
      "estadoCompraCine",
    ]);
  });

  it("createCineServer() devuelve una instancia nueva cada vez (no singleton)", () => {
    const a = createCineServer();
    const b = createCineServer();
    expect(a).not.toBe(b);
  });
});
