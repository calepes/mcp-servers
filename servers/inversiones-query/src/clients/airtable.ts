import type { Transaction, TransactionType } from "../types.js";

interface AirtableRecord {
  id: string;
  fields: Record<string, unknown>;
}

interface ReferenceMap {
  securities: Map<string, string>; // recordId → ticker
  brokers: Map<string, string>;    // recordId → name
}

export class AirtableClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;

  constructor(token: string, baseId: string) {
    this.baseUrl = `https://api.airtable.com/v0/${baseId}`;
    this.headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  }

  private async fetchTable(table: string, params?: URLSearchParams): Promise<AirtableRecord[]> {
    const all: AirtableRecord[] = [];
    let offset: string | undefined;

    do {
      const p = new URLSearchParams(params);
      if (offset) p.set("offset", offset);
      const url = `${this.baseUrl}/${encodeURIComponent(table)}?${p}`;
      const res = await fetch(url, { headers: this.headers });
      if (!res.ok) {
        throw new Error(`Airtable HTTP ${res.status}: ${await res.text()}`);
      }
      const data = await res.json() as { records: AirtableRecord[]; offset?: string };
      all.push(...data.records);
      offset = data.offset;
    } while (offset);

    return all;
  }

  private async getReference(): Promise<ReferenceMap> {
    const [secRecords, brokerRecords] = await Promise.all([
      this.fetchTable("Securities"),
      this.fetchTable("Brokers"),
    ]);
    const securities = new Map<string, string>(
      secRecords.map((r) => [r.id, String(r.fields["Ticker"] ?? r.fields["Name"] ?? r.id)])
    );
    const brokers = new Map<string, string>(
      brokerRecords.map((r) => [r.id, String(r.fields["Nombre"] ?? r.fields["Name"] ?? r.id)])
    );
    return { securities, brokers };
  }

  async getTransactions(): Promise<Transaction[]> {
    const [records, ref] = await Promise.all([
      this.fetchTable("Transacciones", new URLSearchParams({ "sort[0][field]": "Fecha", "sort[0][direction]": "desc" })),
      this.getReference(),
    ]);

    return records.map((r) => {
      const f = r.fields;
      // "Ticket" is a lookup field that already resolves the ticker string (["SPY"]).
      // Fallback: dereference "Activo Financiero" linked record via securities map.
      const ticketLookup = f["Ticket"] as string[] | string | undefined;
      const activoIds = (f["Activo Financiero"] as string[] | undefined) ?? [];
      const ticker = Array.isArray(ticketLookup) && ticketLookup.length > 0
        ? ticketLookup[0]
        : typeof ticketLookup === "string" && ticketLookup
        ? ticketLookup
        : activoIds.length > 0 ? (ref.securities.get(activoIds[0]) ?? "") : "";

      const brokerIds = (f["Broker"] as string[] | undefined) ?? [];
      const broker = brokerIds.length > 0 ? (ref.brokers.get(brokerIds[0]) ?? brokerIds[0]) : "";

      const shares = Number(f["Cuotas"] ?? 0);
      const price = Number(f["PU - Transaccion"] ?? 0);
      const fee = Number(f["Fee  ($)"] ?? 0);
      const totalAmount = Number(f["Valor Transaccion ($)"] ?? (price * Math.abs(shares) + fee));

      return {
        date: String(f["Fecha"] ?? ""),
        ticker,
        type: String(f["Tipo de Transaccion"] ?? "Compra") as TransactionType,
        shares,
        pricePerShare: price,
        totalAmount: Number(totalAmount.toFixed(2)),
        fee,
        broker,
        notes: String(f["Notas"] ?? ""),
      };
    });
  }
}
