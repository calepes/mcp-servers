#!/usr/bin/env node
// MCP server: achoradazos
// Gestión operativa de la Fraternidad Peruana (Santa Cruz).
// Requiere env: AIRTABLE_TOKEN
// Tools:
//   searchFraterno       — busca fraterno por nombre/apellido
//   listPendingPayments  — fraternos activos sin pago para un concepto
//   listGrupoCobros      — grupos de cobro disponibles
//   listEventos          — juntes disponibles
//   listExpensesByEvento — gastos registrados para un junte
//   registerDeposit      — registra un depósito en Registro Depositos
//   registerExpense      — registra un gasto en Registro Pagos
//   uploadReceipt        — sube imagen o PDF a litterbox, retorna URL
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
import { basename, join } from "path";

// ── Config ───────────────────────────────────────────────────────────────────

const BASE_ID = "appufIxiXnYESHhzi";
const TABLES = {
  fraternos:        "tbl4ULRpq9MCyr8hZ",
  grupoCobros:      "tblB2A27V5kvbDIP7",
  calendarioEventos:"tblTpDPaBRFN8JXOQ",
  registroDepositos:"tblBRLsVct2bKNFa3",
  registroPagos:    "tbl51ZIlMgQSgSebe",
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
  // Registro Pagos
  pago_fecha:        "fldZe7R6mBzVyNeRI",
  pago_pagadoA:      "fldjzLdfzGUlWiLMA",
  pago_concepto:     "fldNIfo88S7mTYst2",
  pago_valor:        "fldLcobCtIJds8ORZ",
  pago_constancia:   "fldPxdkaPUD2n12hq",
  pago_cuenta:       "flduIAeOvKHX9OTK6",
  pago_estado:       "fld70R4uIJGkWm5Xw",
  pago_junte:        "fldAP55GoRvwRAmFc",
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
  const full = fieldValue(fields, FIELDS.fraterno_nombre, "Fraterno");
  if (full) return full;
  const ape = fieldValue(fields, FIELDS.fraterno_apellidos, "Apellidos") ?? "";
  const nom = fieldValue(fields, FIELDS.fraterno_nombres, "Nombres") ?? "";
  return `${ape} ${nom}`.trim() || "—";
}

function fieldValue(fields: Record<string, any>, id: string, name: string): any {
  return fields[id] ?? fields[name];
}

// ── Receipt upload ────────────────────────────────────────────────────────────

function uploadReceipt(imagePath: string): { url: string; filename: string } {
  const isPdf = imagePath.toLowerCase().endsWith(".pdf") || readFileSync(imagePath).subarray(0, 5).toString("ascii") === "%PDF-";
  const uploadPath = isPdf ? imagePath : "/tmp/achoradazos_receipt.jpg";
  const filename = isPdf ? (basename(imagePath).toLowerCase().endsWith(".pdf") ? basename(imagePath) : "constancia.pdf") : "constancia.jpg";
  if (!isPdf) {
    execFileSync("sips", ["-Z", "900", "-s", "format", "jpeg", "-s", "formatOptions", "80", imagePath, "--out", uploadPath]);
  }

  // Upload to litterbox (24h temp URL)
  const result = execFileSync("curl", [
    "-s", "--connect-timeout", "10", "--max-time", "60", "-F", "reqtype=fileupload", "-F", "time=24h",
    "-F", `fileToUpload=@${uploadPath};filename=${filename}`,
    LITTERBOX_URL,
  ]).toString().trim();

  if (!result.startsWith("http")) throw new Error(`Upload failed: ${result}`);
  return { url: result, filename };
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
      name: "listGrupoCobros",
      description: "Lista grupos de cobro con su monto, cantidad y estado.",
      inputSchema: {
        type: "object",
        properties: { activos: { type: "boolean", description: "Filtrar por estado activo." } },
        additionalProperties: false,
      },
    },
    {
      name: "listEventos",
      description: "Lista juntes con fecha y lugar.",
      inputSchema: {
        type: "object",
        properties: { desde: { type: "string", description: "Fecha mínima YYYY-MM-DD." } },
        additionalProperties: false,
      },
    },
    {
      name: "listExpensesByEvento",
      description: "Consulta los gastos registrados para un junte. Retorna cantidad, total y detalle de fecha, proveedor, concepto, monto y estado.",
      inputSchema: {
        type: "object",
        properties: {
          junteId: { type: "string", description: "Record ID del junte en Calendario Eventos, obtenido con listEventos." },
        },
        required: ["junteId"],
        additionalProperties: false,
      },
    },
    {
      name: "registerDeposit",
      description: "Registra un depósito de cuota en Registro Depositos de Airtable. Requiere fraternoId (de searchFraterno), conceptoId (de listGrupoCobros), junteId (de listEventos), valor, fecha (YYYY-MM-DD). Opcionales: constanciaUrl y constanciaFilename (de uploadReceipt), observacion (nro de transacción).",
      inputSchema: {
        type: "object",
        properties: {
          fraternoId:    { type: "string", description: "Record ID del fraterno (ej: recXXX)" },
          conceptoId:    { type: "string", description: "Record ID del concepto/cuota en Grupo de Cobros" },
          junteId:       { type: "string", description: "Record ID del junte en Calendario Eventos" },
          valor:         { type: "number", description: "Monto pagado en Bs" },
          fecha:         { type: "string", description: "Fecha del pago en formato YYYY-MM-DD" },
          constanciaUrl: { type: "string", description: "URL temporal de la constancia (de uploadReceipt)" },
          constanciaFilename: { type: "string", description: "Nombre de archivo de la constancia (de uploadReceipt)" },
          observacion:   { type: "string", description: "Nro de transacción u observación libre" },
        },
        required: ["fraternoId", "conceptoId", "junteId", "valor", "fecha"],
        additionalProperties: false,
      },
    },
    {
      name: "registerExpense",
      description: "Registra un gasto pagado en Registro Pagos de Airtable. Requiere pagadoA, concepto, junteId (de listEventos), valor y fecha (YYYY-MM-DD). Opcionales: constanciaUrl y constanciaFilename (de uploadReceipt, admite imagen o PDF).",
      inputSchema: {
        type: "object",
        properties: {
          pagadoA:       { type: "string", description: "Proveedor o persona a quien se pagó" },
          concepto:      { type: "string", description: "Descripción del gasto" },
          junteId:       { type: "string", description: "Record ID del junte en Calendario Eventos" },
          valor:         { type: "number", description: "Monto pagado en Bs" },
          fecha:         { type: "string", description: "Fecha del gasto en formato YYYY-MM-DD" },
          constanciaUrl: { type: "string", description: "URL temporal de la constancia (de uploadReceipt)" },
          constanciaFilename: { type: "string", description: "Nombre de archivo de la constancia (de uploadReceipt)" },
        },
        required: ["pagadoA", "concepto", "junteId", "valor", "fecha"],
        additionalProperties: false,
      },
    },
    {
      name: "uploadReceipt",
      description: "Sube un comprobante de imagen o PDF a litterbox.catbox.moe (URL temporal 24h) para adjuntarlo a Airtable. Las imágenes se comprimen; los PDF se conservan como archivo PDF. Retorna JSON con url y filename, que deben pasarse a registerExpense o registerDeposit.",
      inputSchema: {
        type: "object",
        properties: {
          imagePath: { type: "string", description: "Path absoluto a la imagen PNG/JPG o PDF del comprobante" },
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
        categoria: fieldValue(r.fields, FIELDS.fraterno_categoria, "Categoria")?.name ?? fieldValue(r.fields, FIELDS.fraterno_categoria, "Categoria") ?? "—",
        estado:    fieldValue(r.fields, FIELDS.fraterno_estado, "Estado")?.name ?? fieldValue(r.fields, FIELDS.fraterno_estado, "Estado") ?? "—",
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
      const pending = records.filter(r => !fieldValue(r.fields, FIELDS.fraterno_pagoMayo, "Pago Mayo 2026"));
      const paid    = records.filter(r =>  fieldValue(r.fields, FIELDS.fraterno_pagoMayo, "Pago Mayo 2026"));
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

    if (name === "listGrupoCobros") {
      const { activos } = args as { activos?: boolean };
      const records = await atList(token, TABLES.grupoCobros, {
        ...(activos === undefined ? {} : { filterByFormula: activos ? "{Activos}=TRUE()" : "NOT({Activos})" }),
        fields: [FIELDS.cobro_nombre, FIELDS.cobro_valorUnit, FIELDS.cobro_cantidad, FIELDS.cobro_activo].join(","),
      });
      const grupos = records.map(record => ({
        id: record.id,
        nombre: fieldValue(record.fields, FIELDS.cobro_nombre, "Name"),
        valorUnitario: fieldValue(record.fields, FIELDS.cobro_valorUnit, "Valor Unitario"),
        cantidad: fieldValue(record.fields, FIELDS.cobro_cantidad, "Cantidad"),
        activo: Boolean(fieldValue(record.fields, FIELDS.cobro_activo, "Activos")),
      }));
      return { content: [{ type: "text", text: JSON.stringify(grupos, null, 2) }] };
    }

    if (name === "listEventos") {
      const { desde } = args as { desde?: string };
      if (desde && !/^\d{4}-\d{2}-\d{2}$/.test(desde)) throw new Error("desde debe usar formato YYYY-MM-DD");
      const records = await atList(token, TABLES.calendarioEventos, {
        ...(desde ? { filterByFormula: `IS_AFTER({Inicio}, '${desde}')` } : {}),
        sort: JSON.stringify([{ field: "Inicio", direction: "desc" }]),
        fields: [FIELDS.evento_nombre, FIELDS.evento_inicio, FIELDS.evento_lugar].join(","),
      });
      const eventos = records.map(record => ({
        id: record.id,
        nombre: fieldValue(record.fields, FIELDS.evento_nombre, "Name"),
        fecha: fieldValue(record.fields, FIELDS.evento_inicio, "Inicio"),
        lugar: fieldValue(record.fields, FIELDS.evento_lugar, "Lugar")?.name ?? "—",
      }));
      return { content: [{ type: "text", text: JSON.stringify(eventos, null, 2) }] };
    }

    if (name === "listExpensesByEvento") {
      const { junteId } = args as { junteId: string };
      const records = await atList(token, TABLES.registroPagos, {
        fields: [FIELDS.pago_fecha, FIELDS.pago_pagadoA, FIELDS.pago_concepto, FIELDS.pago_valor, FIELDS.pago_estado, FIELDS.pago_junte].join(","),
        sort: JSON.stringify([{ field: "Date", direction: "desc" }]),
      });
      const gastos = records
        .filter(record => {
          const junte = fieldValue(record.fields, FIELDS.pago_junte, "Junte");
          return Array.isArray(junte) && junte.includes(junteId);
        })
        .map(record => ({
          id: record.id,
          fecha: fieldValue(record.fields, FIELDS.pago_fecha, "Date"),
          pagadoA: fieldValue(record.fields, FIELDS.pago_pagadoA, "Pagado a"),
          concepto: fieldValue(record.fields, FIELDS.pago_concepto, "Concepto"),
          valor: Number(fieldValue(record.fields, FIELDS.pago_valor, "Valor Pagado") ?? 0),
          estado: fieldValue(record.fields, FIELDS.pago_estado, "Estado Pago")?.name ?? fieldValue(record.fields, FIELDS.pago_estado, "Estado Pago"),
        }));
      return { content: [{ type: "text", text: JSON.stringify({ junteId, cantidad: gastos.length, total: gastos.reduce((sum, gasto) => sum + gasto.valor, 0), gastos }, null, 2) }] };
    }

    // ── registerDeposit ─────────────────────────────────────────────────────
    if (name === "registerDeposit") {
      const { fraternoId, conceptoId, junteId, valor, fecha, constanciaUrl, constanciaFilename, observacion } = args as {
        fraternoId: string; conceptoId: string; junteId: string;
        valor: number; fecha: string; constanciaUrl?: string; constanciaFilename?: string; observacion?: string;
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
      if (constanciaUrl) fields[FIELDS.dep_constancia] = [{ url: constanciaUrl, filename: constanciaFilename ?? "constancia.jpg" }];

      const created = await atCreate(token, TABLES.registroDepositos, fields);
      return { content: [{ type: "text", text: `Depósito #${created.fields?.Name ?? created.id} registrado.` }] };
    }

    if (name === "registerExpense") {
      const { pagadoA, concepto, junteId, valor, fecha, constanciaUrl, constanciaFilename } = args as {
        pagadoA: string; concepto: string; junteId: string;
        valor: number; fecha: string; constanciaUrl?: string; constanciaFilename?: string;
      };
      const fields: Record<string, any> = {
        [FIELDS.pago_fecha]:   fecha,
        [FIELDS.pago_pagadoA]: pagadoA,
        [FIELDS.pago_concepto]: concepto,
        [FIELDS.pago_valor]:   valor,
        [FIELDS.pago_cuenta]:  [CUENTA_BCP_ID],
        [FIELDS.pago_estado]:  "Pagado",
        [FIELDS.pago_junte]:   [junteId],
      };
      if (constanciaUrl) fields[FIELDS.pago_constancia] = [{ url: constanciaUrl, filename: constanciaFilename ?? "constancia.jpg" }];

      const created = await atCreate(token, TABLES.registroPagos, fields);
      return { content: [{ type: "text", text: `Gasto #${created.fields?.Name ?? created.id} registrado.` }] };
    }

    // ── uploadReceipt ───────────────────────────────────────────────────────
    if (name === "uploadReceipt") {
      const { imagePath } = args as { imagePath: string };
      return { content: [{ type: "text", text: JSON.stringify(uploadReceipt(imagePath)) }] };
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
            nombre: fieldValue(r.fields, FIELDS.evento_nombre, "Name"),
            fecha:  fieldValue(r.fields, FIELDS.evento_inicio, "Inicio"),
            lugar:  fieldValue(r.fields, FIELDS.evento_lugar, "Lugar")?.name ?? "—",
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
            nombre:       fieldValue(r.fields, FIELDS.cobro_nombre, "Name"),
            valorUnitario:fieldValue(r.fields, FIELDS.cobro_valorUnit, "Valor Unitario"),
            cantidad:     fieldValue(r.fields, FIELDS.cobro_cantidad, "Cantidad"),
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
        .filter(r => !fieldValue(r.fields, FIELDS.fraterno_pagoMayo, "Pago Mayo 2026"))
        .map(r => fraternoNombre(r.fields));

      const concepto = conceptoRecords[0];
      const evento   = eventoRecords[0];
      const valor    = concepto ? fieldValue(concepto.fields, FIELDS.cobro_valorUnit, "Valor Unitario") ?? 250 : 250;
      const pagoTotal= fraternos.filter(r => fieldValue(r.fields, FIELDS.fraterno_pagoMayo, "Pago Mayo 2026")).length;

      const fechaEventoValue = evento && fieldValue(evento.fields, FIELDS.evento_inicio, "Inicio");
      const fechaEvento = fechaEventoValue
        ? new Date(fechaEventoValue).toLocaleDateString("es-BO", { weekday: "long", day: "numeric", month: "long" })
        : "próxima reunión";
      const lugarEvento = evento ? fieldValue(evento.fields, FIELDS.evento_lugar, "Lugar")?.name ?? "Frater Palo Santo" : "Frater Palo Santo";

      const bullets = pending.map(n => `• ${n}`).join("\n");

      const msg = [
        `Ya van ${pagoTotal} confirmados 🔥 Falta la cuota de ${concepto ? fieldValue(concepto.fields, FIELDS.cobro_nombre, "Name") ?? "mayo" : "mayo"} de:`,
        "",
        bullets,
        "",
        `Bs ${valor} a la cuenta BCP 70152191938316 (Carlos Lepesqueur), motivo *${concepto ? fieldValue(concepto.fields, FIELDS.cobro_nombre, "Name") ?? "Cuota Mayo 2026" : "Cuota Mayo 2026"}*.`,
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
