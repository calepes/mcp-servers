#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import * as db from "./notion.js";
import type { Sticker } from "./notion.js";

// --- Section name resolution ---

const KNOWN_SECTIONS = [
  "Introducción", "Algeria", "Argentina", "Australia", "Austria", "Belgium",
  "Bosnia y Herzegovina", "Brazil", "Canada", "Cape Verde", "Colombia", "Congo DR",
  "Croatia", "Curaçao", "Czechia", "Ecuador", "Egypt", "England", "France",
  "Germany", "Ghana", "Haiti", "Iran", "Iraq", "Ivory Coast", "Japan", "Jordan",
  "Mexico", "Morocco", "Netherlands", "New Zealand", "Norway", "Panama", "Paraguay",
  "Portugal", "Qatar", "Saudi Arabia", "Scotland", "Senegal", "South Africa",
  "South Korea", "Spain", "Sweden", "Switzerland", "Tunisia", "Turkey", "Uruguay",
  "USA", "Uzbekistan",
];

const ALIASES: Record<string, string> = {
  intro: "Introducción", introduccion: "Introducción", introducción: "Introducción",
  fwc: "Introducción",
  brasil: "Brazil", alemania: "Germany", españa: "Spain", espana: "Spain",
  francia: "France", holanda: "Netherlands", "paises bajos": "Netherlands",
  "países bajos": "Netherlands",
  "corea del sur": "South Korea",
  "sudafrica": "South Africa", "sudáfrica": "South Africa",
  "marruecos": "Morocco", "costa de marfil": "Ivory Coast",
  "cabo verde": "Cape Verde", "arabia saudita": "Saudi Arabia",
  "nueva zelanda": "New Zealand", "nueva zelandia": "New Zealand",
  escocia: "Scotland", belgica: "Belgium", "bélgica": "Belgium",
  turquia: "Turkey", "turquía": "Turkey", suecia: "Sweden", suiza: "Switzerland",
  noruega: "Norway", panama: "Panama", japon: "Japan", "japón": "Japan",
  egipto: "Egypt", haiti: "Haiti", haití: "Haiti",
  croacia: "Croatia", argelia: "Algeria", iran: "Iran", "irán": "Iran",
  irak: "Iraq", jordania: "Jordan", uzbekistan: "Uzbekistan",
  "uzbekistán": "Uzbekistan",
  "bosnia y herzegovina": "Bosnia y Herzegovina",
  "bosnia and herzegovina": "Bosnia y Herzegovina",
  "bosnia & herzegovina": "Bosnia y Herzegovina",
};

function resolveSection(input: string): string | null {
  const norm = input.toLowerCase().trim();
  if (ALIASES[norm]) return ALIASES[norm];
  return KNOWN_SECTIONS.find((s) => s.toLowerCase() === norm) ?? null;
}

function normalizeCode(code: string): string {
  const upper = code.trim().toUpperCase();
  const m = upper.match(/^([A-Z]+)(\d+)$/);
  return m ? `${m[1]} ${m[2]}` : upper;
}

function sortByCode(a: Sticker, b: Sticker): number {
  if (a.seccion !== b.seccion) return a.seccion.localeCompare(b.seccion);
  const na = parseInt(a.codigo.split(" ").pop() ?? "0");
  const nb = parseInt(b.codigo.split(" ").pop() ?? "0");
  return na - nb;
}

function stickerLine(s: Sticker, showSection = false): string {
  const foil = s.tipo === "Foil" ? " ⭐" : "";
  const estado = s.cantidad === 0 ? "❌" : s.cantidad === 1 ? "✅" : `🔁×${s.cantidad - 1}`;
  const gr = s.grupo ? ` · Grupo ${s.grupo}` : "";
  const pg = s.pagina ? ` · p.${s.pagina}` : "";
  const sec = showSection ? ` (${s.seccion}${gr}${pg})` : "";
  return `${s.codigo}${foil} — ${s.descripcion}${sec} ${estado}`;
}

// --- Tool handlers ---

async function paniniProgress(): Promise<string> {
  const all = await db.queryAll();
  const total = all.length;
  const pegadas = all.filter((s) => s.cantidad >= 1).length;
  const faltantes = all.filter((s) => s.cantidad === 0).length;
  const repetidas = all.reduce((n, s) => n + Math.max(0, s.cantidad - 1), 0);
  const pct = total > 0 ? ((pegadas / total) * 100).toFixed(1) : "0.0";

  const bySection = new Map<string, { total: number; have: number }>();
  for (const s of all) {
    if (!bySection.has(s.seccion)) bySection.set(s.seccion, { total: 0, have: 0 });
    const g = bySection.get(s.seccion)!;
    g.total++;
    if (s.cantidad >= 1) g.have++;
  }
  let topLabel = "N/A";
  let topPct = -1;
  for (const [sec, g] of bySection) {
    if (sec === "Introducción") continue;
    const p = g.total > 0 ? g.have / g.total : 0;
    if (p > topPct) { topPct = p; topLabel = `${sec} (${g.have}/${g.total})`; }
  }

  return [
    `Total: ${total} | Pegadas: ${pegadas} | Faltantes: ${faltantes} | Repetidas disponibles: ${repetidas}`,
    `Progreso: ${pct}%`,
    `Sección más completa: ${topLabel}`,
  ].join("\n");
}

async function paniniSection(section: string): Promise<string> {
  const resolved = resolveSection(section);
  if (!resolved) return `Sección "${section}" no encontrada. Usa el nombre del país en español o inglés.`;

  const stickers = await db.queryBySeccion(resolved);
  if (!stickers.length) return `No se encontraron láminas para "${resolved}".`;

  stickers.sort(sortByCode);
  const gr = stickers[0].grupo ? ` · Grupo ${stickers[0].grupo}` : "";
  const lines = [`${resolved}${gr}`, ""];
  for (const s of stickers) {
    const foil = s.tipo === "Foil" ? " ⭐" : "";
    const estado = s.cantidad === 0 ? "❌" : s.cantidad === 1 ? "✅" : `🔁×${s.cantidad - 1}`;
    lines.push(`${s.codigo}${foil}  ${s.descripcion}  ${estado}`);
  }
  const have = stickers.filter((s) => s.cantidad >= 1).length;
  lines.push("", `${have}/${stickers.length} láminas`);
  return lines.join("\n");
}

async function paniniMissing(section?: string): Promise<string> {
  let resolved: string | undefined;
  if (section) {
    const r = resolveSection(section);
    if (!r) return `Sección "${section}" no encontrada.`;
    resolved = r;
  }

  const missing = await db.queryMissing(resolved);
  if (!missing.length) {
    return resolved
      ? `¡${resolved} completa! No faltan láminas.`
      : "¡Álbum completo! No faltan láminas.";
  }

  missing.sort(sortByCode);
  const lines = [`Faltantes${resolved ? ` — ${resolved}` : ""}: ${missing.length}`, ""];
  let cur = "";
  for (const s of missing) {
    if (s.seccion !== cur) {
      cur = s.seccion;
      const gr = s.grupo ? ` (Grupo ${s.grupo})` : "";
      lines.push(`${s.seccion}${gr}:`);
    }
    const foil = s.tipo === "Foil" ? " ⭐" : "";
    lines.push(`  ${s.codigo}${foil} — ${s.descripcion}`);
  }
  return lines.join("\n");
}

async function paniniDuplicates(): Promise<string> {
  const dups = await db.queryDuplicates();
  if (!dups.length) return "No hay láminas repetidas disponibles para intercambio.";

  dups.sort(sortByCode);
  const lines = [`Repetidas para intercambio: ${dups.length}`, ""];
  let cur = "";
  for (const s of dups) {
    if (s.seccion !== cur) {
      cur = s.seccion;
      lines.push(`${s.seccion}:`);
    }
    const foil = s.tipo === "Foil" ? " ⭐" : "";
    const disp = s.cantidad - 1;
    lines.push(`  ${s.codigo}${foil} — ${s.descripcion} (×${disp} para dar)`);
  }
  return lines.join("\n");
}

async function paniniRegister(codes: string[]): Promise<string> {
  const results: string[] = [];
  for (const raw of codes) {
    const code = normalizeCode(raw);
    const s = await db.findByCode(code);
    if (!s) {
      results.push(`❌ ${code} — no encontrada en la DB`);
      continue;
    }
    const newQty = s.cantidad + 1;
    await db.setCantidad(s.id, newQty);
    const label = newQty === 1 ? "pegada ✅" : `repetida ×${newQty - 1} 🔁`;
    results.push(`${code} — ${label} (total: ${newQty})`);
  }
  return results.join("\n");
}

async function paniniRemove(code: string): Promise<string> {
  const normalized = normalizeCode(code);
  const s = await db.findByCode(normalized);
  if (!s) return `❌ ${normalized} — no encontrada en la DB`;
  if (s.cantidad === 0) return `${normalized} ya tiene cantidad 0, no se puede restar.`;

  const newQty = s.cantidad - 1;
  await db.setCantidad(s.id, newQty);
  const label = newQty === 0 ? "faltante ❌" : newQty === 1 ? "pegada ✅" : `repetida ×${newQty - 1}`;
  return `${normalized} — ahora ${label} (cantidad: ${newQty})`;
}

async function paniniSearch(query: string): Promise<string> {
  const stickers = await db.searchStickers(query);
  if (!stickers.length) return `Sin resultados para "${query}".`;

  const top = stickers.slice(0, 10);
  const header = stickers.length > 10
    ? `Top 10 de ${stickers.length} resultados para "${query}":`
    : `${stickers.length} resultado(s) para "${query}":`;
  const lines = [header, ""];
  for (const s of top) lines.push(stickerLine(s, true));
  return lines.join("\n");
}

// --- MCP Server ---

const server = new Server(
  { name: "panini-mundial", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

const RO = { annotations: { readOnlyHint: true } };

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "paniniProgress",
      description: "Resumen general del álbum Panini Mundial 2026: total, pegadas, faltantes, repetidas disponibles, % de progreso y sección más completa.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      ...RO,
    },
    {
      name: "paniniSection",
      description: "Estado detallado de las 20 láminas de una selección o la sección FWC. Acepta nombre en español o inglés (ej. 'Argentina', 'Francia', 'intro').",
      inputSchema: {
        type: "object",
        properties: {
          section: { type: "string", description: "Nombre del país/sección (español o inglés) o 'intro'" },
        },
        required: ["section"],
        additionalProperties: false,
      },
      ...RO,
    },
    {
      name: "paniniMissing",
      description: "Lista de láminas faltantes (Cantidad=0). Con section filtra por sección; sin section devuelve todas las faltantes del álbum.",
      inputSchema: {
        type: "object",
        properties: {
          section: { type: "string", description: "Nombre de sección opcional (español o inglés)" },
        },
        additionalProperties: false,
      },
      ...RO,
    },
    {
      name: "paniniDuplicates",
      description: "Lista de láminas repetidas disponibles para intercambio (Cantidad≥2), con cuántas hay para dar.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      ...RO,
    },
    {
      name: "paniniRegister",
      description: "Registra láminas obtenidas sumando +1 a Cantidad. Acepta array de códigos en formato '{EQUIPO} {N}' (ej. ['ARG 5', 'BRA 3', 'FWC 7']). También acepta 'ARG5' sin espacio.",
      inputSchema: {
        type: "object",
        properties: {
          codes: {
            type: "array",
            items: { type: "string" },
            description: "Códigos de láminas a registrar",
          },
        },
        required: ["codes"],
        additionalProperties: false,
      },
    },
    {
      name: "paniniRemove",
      description: "Corrige un registro erróneo restando -1 a Cantidad (mínimo 0). Usar cuando el usuario se equivocó al registrar una lámina.",
      inputSchema: {
        type: "object",
        properties: {
          code: { type: "string", description: "Código de la lámina a corregir (ej. 'ARG 5')" },
        },
        required: ["code"],
        additionalProperties: false,
      },
    },
    {
      name: "paniniSearch",
      description: "Busca láminas por nombre de jugador o descripción. Devuelve hasta 10 resultados con estado actual. Para ver una sección completa usar paniniSection.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Texto a buscar (nombre jugador, descripción)" },
        },
        required: ["query"],
        additionalProperties: false,
      },
      ...RO,
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const a = (args ?? {}) as Record<string, unknown>;
  try {
    let text: string;
    switch (name) {
      case "paniniProgress":   text = await paniniProgress(); break;
      case "paniniSection":    text = await paniniSection(a.section as string); break;
      case "paniniMissing":    text = await paniniMissing(a.section as string | undefined); break;
      case "paniniDuplicates": text = await paniniDuplicates(); break;
      case "paniniRegister":   text = await paniniRegister(a.codes as string[]); break;
      case "paniniRemove":     text = await paniniRemove(a.code as string); break;
      case "paniniSearch":     text = await paniniSearch(a.query as string); break;
      default:
        return { isError: true, content: [{ type: "text", text: `Unknown tool: ${name}` }] };
    }
    return { content: [{ type: "text", text }] };
  } catch (err) {
    return {
      isError: true,
      content: [{ type: "text", text: `Error en ${name}: ${(err as Error).message}` }],
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
