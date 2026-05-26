#!/usr/bin/env node
// MCP server: achoradazos
// Gestión operativa de la Fraternidad Peruana (Santa Cruz).
// Requiere env: AIRTABLE_TOKEN
// Tools:
//   searchFraterno       — busca fraterno por nombre/apellido
//   listPendingPayments  — fraternos activos sin pago para un concepto
//   registerDeposit      — registra un depósito en Registro Depositos
//   uploadReceipt        — comprime imagen y sube a litterbox, retorna URL
//   createEvento         — crea evento en Calendario Eventos
//   createConceptoCobro  — crea concepto de cobro en Grupo de Cobros
//   getActiveEvento      — retorna el próximo evento (más reciente)
//   getActiveConcepto    — retorna el concepto con Activos=true
//   getPendingPaymentMessage — genera mensaje WhatsApp con fraternos pendientes

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { execFileSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

// ── Config ───────────────────────────────────────────────────────────────────

const BASE_ID = "appufIxiXnYESHhzi";
const TABLES = {
  fraternos:        "tbl4ULRpq9MCyr8hZ",
  grupoCobros:      "tblB2A27V5kvbDIP7",
  calendarioEventos:"tblTpDPaBRFN8JXOQ",
  registroDepositos:"tblBRLsVct2bKNFa3",
} as const;

const FIELDS = {
  // Fraternos
  fraterno_nombre:   "fldrIzGbCZyuiZEWw",
  fraterno_nombres:  "fldinW3OqocPaSAIS",
  fraterno_apellidos:"fldZyCX1W98igvt2m",
  fraterno_categoria:"fldyYwyTL0y7xgHEG",
  fraterno_estado:   "fld8KyZoKSzS4oD5E",
  fraterno_pagoMayo: "fldhN0J7ddrpsqktm",
  // Grupo de Cobros
  cobro_nombre:      "fldvTXDbv92vGX1Pn",
  cobro_cantidad:    "fld5BnAnwzsRjLHdU",
  cobro_valorUnit:   "fldffzCookk4PKi7K",
  cobro_activo:      "fldiDizWKYjy79VwX",
  // Calendario Eventos
  evento_nombre:     "flddKJE5IuUKd6zvO",
  evento_inicio:     "fldttLFD4KrNaEWQw",
  evento_fin:        "fldsc2DWeHlGTHyOg",
  evento_lugar:      "fldEzpfwxoomQ7myD",
  // Registro Depositos
  dep_fecha:         "fldv4TBGMOLe2IFQx",
  dep_fraterno:      "fldy778JX9daaMhhj",
  dep_concepto:      "fldeCXsd1GTdkKNzK",
  dep_junte:         "fldGVJzSLKoYRMfdC",
  dep_valor:         "fldh2aVcTVVwW3fQO",
  dep_constancia:    "fldlnZ4Kf7PlRWtgf",
  dep_cuenta:        "fldElkLv3e1YvaX05",
  dep_observacion:   "fldtXQ94PrMoqUlnE",
  dep_checkPago:     "fld4nxH6Cfq2eFcFW",
} as const;

const CUENTA_BCP_ID = "recNhURjjtRHKyd8U";
const LITTERBOX_URL = "https://litterbox.catbox.moe/resources/internals/api.php";
const AIRTABLE_API  = "https://api.airtable.com/v0";

// ── Auth ─────────────────────────────────────────────────────────────────────

function loadToken(): string {
  if (process.env.AIRTABLE_TOKEN) return process.env.AIRTABLE_TOKEN;
  const appsEnv = join(homedir(), ".claude", "secrets", "apps.env");
  if (existsSync(appsEnv)) {
    const content = readFileSync(appsEnv, "utf8");
    const m = content.match(/^AIRTABLE_TOKEN=(.+)$/m);
    if (m) return m[1].trim();
  }
  throw new Error("AIRTABLE_TOKEN not found in env or ~/.claude/secrets/apps.env");
}

// ── Airtable helpers ──────────────────────────────────────────────────────────

async function atList(token: string, table: string, params: Record<string, string> = {}): Promise<any[]> {
  const url = new URL(`${AIRTABLE_API}/${BASE_ID}/${table}`);
  for (const [k, v] of Object.entries(params)) {
    if (k === "fields") {
      // Airtable requires fields[]=fldA&fields[]=fldB, not fields=fldA,fldB
      v.split(",").forEach(f => url.searchParams.append("fields[]", f.trim()));
    } else if (k === "sort") {
      // Airtable requires sort[0][field]=X&sort[0][direction]=Y
      try {
        const arr = JSON.parse(v) as Array<{ field?: string; direction?: string }>;
        arr.forEach((s, i) => {
          if (s.field) url.searchParams.set(`sort[${i}][field]`, s.field);
          if (s.direction) url.searchParams.set(`sort[${i}][direction]`, s.direction);
        });
      } catch { url.searchParams.set(k, v); }
    } else {
      url.searchParams.set(k, v);
    }
  }
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Airtable list ${table}: ${res.status} ${await res.text()}`);
  const data = await res.json() as { records: any[] };
  return data.records ?? [];
}

async function atSearch(token: string, table: string, query: string, fields: string[]): Promise<any[]> {
  const url = new URL(`${AIRTABLE_API}/${BASE_ID}/${table}`);
  url.searchParams.set("filterByFormula", `SEARCH(LOWER("${query.replace(/"/g, "")}"),LOWER(CONCATENATE(${fields.map(f => `{${f}}`).join(",")})))`);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Airtable search: ${res.status} ${await res.text()}`);
  const data = await res.json() as { records: any[] };
  return data.records ?? [];
}

async function atCreate(token: string, table: string, fields: Record<string, any>): Promise<any> {
  const res = await fetch(`${AIRTABLE_API}/${BASE_ID}/${table}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) throw new Error(`Airtable create: ${res.status} ${await res.text()}`);
  return (await res.json()) as any;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fraternoNombre(fields: Record<string, any>): string {
  const full = fields[FIELDS.fraterno_nombre];
  if (full) return full;
  const ape = fields[FIELDS.fraterno_apellidos] ?? fields["Apellidos"] ?? "";
  const nom = fields[FIELDS.fraterno_nombres]   ?? fields["Nombres"]   ?? "";
  return `${ape} ${nom}`.trim() || "—";
}

// ── Image upload ──────────────────────────────────────────────────────────────

function uploadReceipt(imagePath: string): string {
  // Compress
  const outPath = "/tmp/achoradazos_receipt.jpg";
  execFileSync("sips", ["-Z", "900", "-s", "format", "jpeg", "-s", "formatOptions", "80", imagePath, "--out", outPath]);

  // Upload to litterbox (24h temp URL)
  const result = execFileSync("curl", [
    "-s", "-F", "reqtype=fileupload", "-F", "time=24h",
    "-F", `fileToUpload=@${outPath}`,
    LITTERBOX_URL,
  ]).toString().trim();

  if (!result.startsWith("http")) throw new Error(`Upload failed: ${result}`);
  return result;
}

// ── MCP Server ────────────────────────────────────────────────────────────────

const server = new Server(
  { name: "achoradazos", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "searchFraterno",
      description: "Busca un fraterno de la Fraternidad Peruana por nombre o apellido. Retorna id, nombre completo, categoría (Fraterno/Invitado) y estado (Activo/Inactivo/Retirado).",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Nombre o apellido a buscar (ej: 'Paulini', 'Bruno', 'Valladares')" },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
    {
      name: "listPendingPayments",
      description: "Lista fraternos activos que aún no han pagado la cuota de mayo 2026. Retorna lista de nombres y el resumen (pagaron / pendientes / total).",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
    {
      name: "registerDeposit",
      description: "Registra un depósito de cuota en Registro Depositos de Airtable. Requiere fraternoId (de searchFraterno), conceptoId (de getActiveConcepto), junteId (de getActiveEvento), valor, fecha (YYYY-MM-DD). Opcionales: constanciaUrl (de uploadReceipt), observacion (nro de transacción).",
      inputSchema: {
        type: "object",
        properties: {
          fraternoId:    { type: "string", description: "Record ID del fraterno (ej: recXXX)" },
          conceptoId:    { type: "string", description: "Record ID del concepto/cuota en Grupo de Cobros" },
          junteId:       { type: "string", description: "Record ID del junte en Calendario Eventos" },
          valor:         { type: "number", description: "Monto pagado en Bs" },
          fecha:         { type: "string", description: "Fecha del pago en formato YYYY-MM-DD" },
          constanciaUrl: { type: "string", description: "URL temporal de la constancia (de uploadReceipt)" },
          observacion:   { type: "string", description: "Nro de transacción u observación libre" },
        },
        required: ["fraternoId", "conceptoId", "junteId", "valor", "fecha"],
        additionalProperties: false,
      },
    },
    {
      name: "uploadReceipt",
      description: "Comprime una imagen de comprobante y la sube a litterbox.catbox.moe (URL temporal 24h) para adjuntarla a Airtable. Retorna la URL pública.",
      inputSchema: {
        type: "object",
        properties: {
          imagePath: { type: "string", description: "Path absoluto a la imagen PNG/JPG del comprobante" },
        },
        required: ["imagePath"],
        additionalProperties: false,
      },
    },
    {
      name: "createEvento",
      description: "Crea un nuevo evento (junte/reunión) en el Calendario Eventos de la fraternidad.",
      inputSchema: {
        type: "object",
        properties: {
          nombre: { type: "string", description: "Nombre del evento (ej: '8va Reunion')" },
          fecha:  { type: "string", description: "Fecha en formato YYYY-MM-DD" },
          lugar:  { type: "string", description: "Lugar del evento (ej: 'Frater Palo Santo', 'Frater Jarichis')" },
        },
        required: ["nombre", "fecha"],
        additionalProperties: false,
      },
    },
    {
      name: "createConceptoCobro",
      description: "Crea un nuevo concepto de cobro en Grupo de Cobros (ej: 'Cuota Junio 2026'). Marca como activo automáticamente.",
      inputSchema: {
        type: "object",
        properties: {
          nombre:       { type: "string", description: "Nombre del concepto (ej: 'Cuota Junio 2026')" },
          valorUnitario:{ type: "number", description: "Monto en Bs por fraterno" },
          cantidad:     { type: "number", description: "Número de fraternos esperados" },
        },
        required: ["nombre", "valorUnitario", "cantidad"],
        additionalProperties: false,
      },
    },
    {
      name: "getActiveEvento",
      description: "Retorna el evento más reciente/próximo de la fraternidad (id, nombre, fecha, lugar). Útil para obtener el junteId al registrar depósitos.",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
    {
      name: "getActiveConcepto",
      description: "Retorna el concepto de cobro activo (Activos=true) con su id, nombre y valor unitario. Útil para obtener el conceptoId al registrar depósitos.",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
    {
      name: "getPendingPaymentMessage",
      description: "Genera el mensaje de WhatsApp listo para copiar/pegar con la lista de fraternos pendientes de pago, monto, cuenta destino y fecha del próximo junte.",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    const token = loadToken();

    // ── searchFraterno ──────────────────────────────────────────────────────
    if (name === "searchFraterno") {
      const { query } = args as { query: string };
      const records = await atSearch(token, TABLES.fraternos, query, ["Nombres", "Apellidos"]);
      if (records.length === 0) return { content: [{ type: "text", text: `No se encontró fraterno con "${query}".` }] };
      const result = records.map(r => ({
        id:        r.id,
        nombre:    fraternoNombre(r.fields),
        categoria: r.fields[FIELDS.fraterno_categoria]?.name ?? r.fields[FIELDS.fraterno_categoria] ?? "—",
        estado:    r.fields[FIELDS.fraterno_estado]?.name    ?? r.fields[FIELDS.fraterno_estado]    ?? "—",
      }));
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    // ── listPendingPayments ─────────────────────────────────────────────────
    if (name === "listPendingPayments") {
      const records = await atList(token, TABLES.fraternos, {
        filterByFormula: `AND({Estado}='Activo',{Categoria}='Fraterno')`,
        fields: [FIELDS.fraterno_nombre, FIELDS.fraterno_nombres, FIELDS.fraterno_apellidos, FIELDS.fraterno_pagoMayo].join(","),
        sort: JSON.stringify([{ field: "Apellidos", direction: "asc" }]),
      });
      const pending = records.filter(r => !r.fields[FIELDS.fraterno_pagoMayo]);
      const paid    = records.filter(r =>  r.fields[FIELDS.fraterno_pagoMayo]);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            pagaron:    paid.map(r => fraternoNombre(r.fields)),
            pendientes: pending.map(r => fraternoNombre(r.fields)),
            resumen: `${paid.length} pagaron / ${pending.length} pendientes / ${records.length} total`,
          }, null, 2),
        }],
      };
    }

    // ── registerDeposit ─────────────────────────────────────────────────────
    if (name === "registerDeposit") {
      const { fraternoId, conceptoId, junteId, valor, fecha, constanciaUrl, observacion } = args as {
        fraternoId: string; conceptoId: string; junteId: string;
        valor: number; fecha: string; constanciaUrl?: string; observacion?: string;
      };
      const fields: Record<string, any> = {
        [FIELDS.dep_fecha]:     fecha,
        [FIELDS.dep_fraterno]:  [fraternoId],
        [FIELDS.dep_concepto]:  [conceptoId],
        [FIELDS.dep_junte]:     [junteId],
        [FIELDS.dep_valor]:     valor,
        [FIELDS.dep_cuenta]:    [CUENTA_BCP_ID],
        [FIELDS.dep_checkPago]: true,
      };
      if (observacion) fields[FIELDS.dep_observacion] = observacion;
      if (constanciaUrl) fields[FIELDS.dep_constancia] = [{ url: constanciaUrl, filename: "constancia.jpg" }];

      const created = await atCreate(token, TABLES.registroDepositos, fields);
      return { content: [{ type: "text", text: `Depósito #${created.fields?.Name ?? created.id} registrado.` }] };
    }

    // ── uploadReceipt ───────────────────────────────────────────────────────
    if (name === "uploadReceipt") {
      const { imagePath } = args as { imagePath: string };
      const url = uploadReceipt(imagePath);
      return { content: [{ type: "text", text: url }] };
    }

    // ── createEvento ────────────────────────────────────────────────────────
    if (name === "createEvento") {
      const { nombre, fecha, lugar } = args as { nombre: string; fecha: string; lugar?: string };
      const fields: Record<string, any> = {
        [FIELDS.evento_nombre]: nombre,
        [FIELDS.evento_inicio]: fecha,
        [FIELDS.evento_fin]:    fecha,
      };
      if (lugar) fields[FIELDS.evento_lugar] = lugar;
      const created = await atCreate(token, TABLES.calendarioEventos, fields);
      return { content: [{ type: "text", text: JSON.stringify({ id: created.id, nombre, fecha, lugar }) }] };
    }

    // ── createConceptoCobro ─────────────────────────────────────────────────
    if (name === "createConceptoCobro") {
      const { nombre, valorUnitario, cantidad } = args as { nombre: string; valorUnitario: number; cantidad: number };
      const fields = {
        [FIELDS.cobro_nombre]:    nombre,
        [FIELDS.cobro_valorUnit]: valorUnitario,
        [FIELDS.cobro_cantidad]:  cantidad,
        [FIELDS.cobro_activo]:    true,
      };
      const created = await atCreate(token, TABLES.grupoCobros, fields);
      return { content: [{ type: "text", text: JSON.stringify({ id: created.id, nombre, valorUnitario, cantidad }) }] };
    }

    // ── getActiveEvento ─────────────────────────────────────────────────────
    if (name === "getActiveEvento") {
      const records = await atList(token, TABLES.calendarioEventos, {
        sort: JSON.stringify([{ field: "Inicio", direction: "desc" }]),
        maxRecords: "5",
        fields: [FIELDS.evento_nombre, FIELDS.evento_inicio, FIELDS.evento_lugar].join(","),
      });
      if (records.length === 0) return { content: [{ type: "text", text: "No hay eventos." }] };
      const r = records[0];
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            id:     r.id,
            nombre: r.fields[FIELDS.evento_nombre],
            fecha:  r.fields[FIELDS.evento_inicio],
            lugar:  r.fields[FIELDS.evento_lugar]?.name ?? "—",
          }),
        }],
      };
    }

    // ── getActiveConcepto ───────────────────────────────────────────────────
    if (name === "getActiveConcepto") {
      const records = await atList(token, TABLES.grupoCobros, {
        filterByFormula: `{Activos}=TRUE()`,
        fields: [FIELDS.cobro_nombre, FIELDS.cobro_valorUnit, FIELDS.cobro_cantidad].join(","),
        maxRecords: "1",
      });
      if (records.length === 0) return { content: [{ type: "text", text: "No hay concepto activo." }] };
      const r = records[0];
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            id:           r.id,
            nombre:       r.fields[FIELDS.cobro_nombre],
            valorUnitario:r.fields[FIELDS.cobro_valorUnit],
            cantidad:     r.fields[FIELDS.cobro_cantidad],
          }),
        }],
      };
    }

    // ── getPendingPaymentMessage ────────────────────────────────────────────
    if (name === "getPendingPaymentMessage") {
      const [fraternos, conceptoRecords, eventoRecords] = await Promise.all([
        atList(token, TABLES.fraternos, {
          filterByFormula: `AND({Estado}='Activo',{Categoria}='Fraterno')`,
          fields: [FIELDS.fraterno_nombre, FIELDS.fraterno_nombres, FIELDS.fraterno_apellidos, FIELDS.fraterno_pagoMayo].join(","),
          sort: JSON.stringify([{ field: "Apellidos", direction: "asc" }]),
        }),
        atList(token, TABLES.grupoCobros, {
          filterByFormula: `{Activos}=TRUE()`,
          fields: [FIELDS.cobro_nombre, FIELDS.cobro_valorUnit].join(","),
          maxRecords: "1",
        }),
        atList(token, TABLES.calendarioEventos, {
          sort: JSON.stringify([{ field: "Inicio", direction: "desc" }]),
          maxRecords: "1",
          fields: [FIELDS.evento_nombre, FIELDS.evento_inicio, FIELDS.evento_lugar].join(","),
        }),
      ]);

      const pending = fraternos
        .filter(r => !r.fields[FIELDS.fraterno_pagoMayo])
        .map(r => fraternoNombre(r.fields));

      const concepto = conceptoRecords[0];
      const evento   = eventoRecords[0];
      const valor    = concepto?.fields[FIELDS.cobro_valorUnit] ?? 250;
      const pagoTotal= fraternos.filter(r => r.fields[FIELDS.fraterno_pagoMayo]).length;

      const fechaEvento = evento?.fields[FIELDS.evento_inicio]
        ? new Date(evento.fields[FIELDS.evento_inicio]).toLocaleDateString("es-BO", { weekday: "long", day: "numeric", month: "long" })
        : "próxima reunión";
      const lugarEvento = evento?.fields[FIELDS.evento_lugar]?.name ?? "Frater Palo Santo";

      const bullets = pending.map(n => `• ${n}`).join("\n");

      const msg = [
        `Ya van ${pagoTotal} confirmados 🔥 Falta la cuota de ${concepto?.fields[FIELDS.cobro_nombre] ?? "mayo"} de:`,
        "",
        bullets,
        "",
        `Bs ${valor} a la cuenta BCP 70152191938316 (Carlos Lepesqueur), motivo *${concepto?.fields[FIELDS.cobro_nombre] ?? "Cuota Mayo 2026"}*.`,
        "",
        `${fechaEvento} — ${lugarEvento}. No se vengan sin pagar 😅`,
      ].join("\n");

      return { content: [{ type: "text", text: msg }] };
    }

    return { isError: true, content: [{ type: "text", text: `Tool desconocida: ${name}` }] };

  } catch (err) {
    return { isError: true, content: [{ type: "text", text: `Error en ${name}: ${(err as Error).message}` }] };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
