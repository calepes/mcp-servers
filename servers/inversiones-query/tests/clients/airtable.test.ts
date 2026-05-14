import { describe, it, expect, vi } from "vitest";
import { AirtableClient } from "../../src/clients/airtable.js";

const mockRecords = [
  {
    id: "recABC",
    fields: {
      Fecha: "2026-05-13",
      Activo: ["recSPY"],
      "Tipo Transaccion": "Compra",
      Cuotas: 1.42243,
      "Precio Unitario": 738.17,
      fee: 0.10545,
      Broker: ["recHapi"],
      Notas: "",
    },
  },
];

const mockSecurities = [{ id: "recSPY", fields: { Ticker: "SPY" } }];
const mockBrokers = [{ id: "recHapi", fields: { Nombre: "Hapi" } }];

function makeAirtableFetch(
  records: unknown[],
  securities: unknown[],
  brokers: unknown[]
) {
  return vi.fn().mockImplementation((url: string) => {
    if (url.includes("Transacciones")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ records, offset: undefined }),
      });
    }
    if (url.includes("Securities")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ records: securities }),
      });
    }
    if (url.includes("Brokers")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ records: brokers }),
      });
    }
    return Promise.resolve({ ok: false, status: 404, text: async () => "Not found" });
  });
}

describe("AirtableClient", () => {
  const client = new AirtableClient("fakeToken", "appFakeBase");

  it("fetches and normalizes transactions", async () => {
    vi.stubGlobal("fetch", makeAirtableFetch(mockRecords, mockSecurities, mockBrokers));

    const result = await client.getTransactions();
    expect(result).toHaveLength(1);
    expect(result[0].ticker).toBe("SPY");
    expect(result[0].broker).toBe("Hapi");
    expect(result[0].type).toBe("Compra");
    expect(result[0].shares).toBe(1.42243);
  });

  it("calculates totalAmount from (price + fee) * shares", async () => {
    vi.stubGlobal("fetch", makeAirtableFetch(mockRecords, mockSecurities, mockBrokers));
    const result = await client.getTransactions();
    const expected = (738.17 + 0.10545) * 1.42243;
    expect(result[0].totalAmount).toBeCloseTo(expected, 2);
  });

  it("throws on HTTP error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => "Unauthorized" })
    );
    await expect(client.getTransactions()).rejects.toThrow("Airtable HTTP 403");
  });
});
