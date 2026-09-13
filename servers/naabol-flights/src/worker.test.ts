import { describe, expect, it } from "vitest";
import worker from "./worker.js";

describe("NAABOL MCP Worker", () => {
  it("publica sus dos herramientas de consulta como solo lectura", async () => {
    const request = new Request("https://naabol.test/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });

    const response = await worker.fetch(request, {});
    const body = await response.json() as {
      result: { tools: Array<{ name: string; annotations?: { readOnlyHint?: boolean } }> };
    };

    expect(response.status).toBe(200);
    expect(body.result.tools.map((tool) => tool.name)).toEqual(["getAirportFlights", "getFlight"]);
    expect(body.result.tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);
  });
});
