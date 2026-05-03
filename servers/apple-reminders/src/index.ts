#!/usr/bin/env node
// MCP server: apple-reminders
// Wraps `reminders-cli` (https://github.com/keith/reminders-cli) para exponer
// iOS Reminders como tools MCP disponibles en cualquier agente (Jano, Vesta, etc.).
//
// Requiere: `brew install keith/formulae/reminders-cli`
// TCC: ejecutar `reminders show-lists` una vez desde TTY de Cal para otorgar
//       el grant de Privacy → Reminders al binary firmado.
//
// Tools:
//   - listReminderLists()                       — listas disponibles
//   - listReminders({ list })                   — items pendientes de una lista
//   - addReminder({ list, title, notes?, dueIso? }) — crear recordatorio
//   - completeReminder({ list, externalId })    — marcar completado
//   - deleteReminder({ list, externalId })      — eliminar

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { spawn } from "node:child_process";

const REMINDERS_BIN = "/opt/homebrew/bin/reminders";
const TIMEOUT_MS = 5000;

const TCC_ERROR =
  "Reminders no disponible: falta grant TCC para 'reminders-cli'. " +
  "Ejecutar 'reminders show-lists' desde TTY de Cal una vez para disparar el prompt. " +
  "NO reintentes esta tool.";

// ── CLI wrapper ────────────────────────────────────────────────────────────

function execReminders(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(REMINDERS_BIN, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill("SIGKILL"); } catch { /* already dead */ }
      reject(new Error(TCC_ERROR));
    }, TIMEOUT_MS);
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => {
      if (timedOut) return;
      clearTimeout(timer);
      reject(new Error(
        `reminders CLI error: ${String(err)}. Verificar: brew install keith/formulae/reminders-cli`,
      ));
    });
    child.on("close", (code) => {
      if (timedOut) return;
      clearTimeout(timer);
      if (code === 0) { resolve({ stdout, stderr }); return; }
      if (stderr.includes("grant") || stderr.includes("authorize")) {
        reject(new Error(TCC_ERROR)); return;
      }
      reject(new Error(`reminders exited ${code}: ${stderr.slice(0, 300)}`));
    });
  });
}

interface RawReminder {
  externalId?: string;
  title?: string;
  notes?: string | null;
  dueDate?: string | null;
  isCompleted?: boolean;
  priority?: string | null;
}

async function listLists(): Promise<string[]> {
  const { stdout } = await execReminders(["show-lists", "-f", "json"]);
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  try {
    const data = JSON.parse(trimmed) as Array<string | { title?: string; name?: string }>;
    return data
      .map((item) => (typeof item === "string" ? item : item.title ?? item.name ?? ""))
      .filter(Boolean);
  } catch {
    return trimmed.split("\n").map((s) => s.trim()).filter(Boolean);
  }
}

async function listItems(list: string): Promise<unknown[]> {
  const { stdout } = await execReminders(["show", list, "-f", "json"]);
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  const raw = JSON.parse(trimmed) as RawReminder[];
  // complete/delete aceptan solo índice entero — siempre usar idx, no el UUID
  // que el CLI devuelve en externalId (versiones nuevas de reminders-cli).
  return raw.map((r, idx) => ({
    externalId: String(idx),
    title: r.title ?? "(sin título)",
    notes: r.notes ?? undefined,
    dueDate: r.dueDate ?? undefined,
    isCompleted: r.isCompleted ?? false,
    priority: r.priority ?? undefined,
  }));
}

async function addItem(
  list: string,
  title: string,
  notes?: string,
  dueIso?: string,
  priority?: number,
): Promise<void> {
  const args = ["add", list, title];
  if (notes?.trim()) args.push("--notes", notes);
  if (dueIso) {
    const d = new Date(dueIso);
    if (!Number.isNaN(d.getTime())) {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      const hh = String(d.getHours()).padStart(2, "0");
      const mi = String(d.getMinutes()).padStart(2, "0");
      args.push("--due-date", `${yyyy}-${mm}-${dd} ${hh}:${mi}`);
    }
  }
  if (priority !== undefined) args.push("--priority", String(priority));
  await execReminders(args);
}

function isoToCliDate(isoStr: string): string | null {
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return null;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

async function editItem(
  list: string,
  externalId: string,
  title?: string,
  notes?: string,
  dueIso?: string,
  priority?: number,
): Promise<void> {
  const idx = parseInt(externalId, 10);
  if (Number.isNaN(idx) || idx < 0)
    throw new Error(`editReminder: externalId inválido "${externalId}" — usar el index de listReminders`);
  const args = ["edit", list, String(idx)];
  if (title?.trim()) args.push("--title", title);
  if (notes?.trim()) args.push("--notes", notes);
  if (dueIso) {
    const cliDate = isoToCliDate(dueIso);
    if (cliDate) args.push("--due-date", cliDate);
  }
  if (priority !== undefined) args.push("--priority", String(priority));
  await execReminders(args);
}

async function completeItem(list: string, externalId: string): Promise<void> {
  const idx = parseInt(externalId, 10);
  if (Number.isNaN(idx) || idx < 0)
    throw new Error(`completeReminder: externalId inválido "${externalId}" — usar el index de listReminders`);
  await execReminders(["complete", list, String(idx)]);
}

async function deleteItem(list: string, externalId: string): Promise<void> {
  const idx = parseInt(externalId, 10);
  if (Number.isNaN(idx) || idx < 0)
    throw new Error(`deleteReminder: externalId inválido "${externalId}" — usar el index de listReminders`);
  await execReminders(["delete", list, String(idx)]);
}

// ── MCP Server ─────────────────────────────────────────────────────────────

const READ_ONLY = { annotations: { readOnlyHint: true } };

const server = new Server(
  { name: "apple-reminders", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "listReminderLists",
      description:
        "Devuelve los nombres de las listas de iOS Reminders disponibles. Listas comunes de Cal: 'Mercado' (compras), 'Tareas Familia', y otras personales.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      ...READ_ONLY,
    },
    {
      name: "listReminders",
      description:
        "Lista los recordatorios pendientes de una lista. Retorna [{externalId, title, notes?, dueDate?, isCompleted, priority?}]. El externalId es necesario para completeReminder/deleteReminder — siempre llamar listReminders antes de completar o borrar.",
      inputSchema: {
        type: "object",
        properties: { list: { type: "string", description: "Nombre exacto de la lista" } },
        required: ["list"],
        additionalProperties: false,
      },
      ...READ_ONLY,
    },
    {
      name: "addReminder",
      description:
        "Agrega un recordatorio a una lista de iOS Reminders. Listas comunes: 'Mercado' (compras) y 'Tareas Familia'. dueIso en ISO 8601 con offset ej: '2026-04-30T18:00:00-04:00'. priority: 0=ninguna, 1=alta, 5=media, 9=baja.",
      inputSchema: {
        type: "object",
        properties: {
          list: { type: "string" },
          title: { type: "string" },
          notes: { type: "string" },
          dueIso: { type: "string", description: "ISO 8601 con timezone offset" },
          priority: { type: "number", description: "0=ninguna 1=alta 5=media 9=baja" },
        },
        required: ["list", "title"],
        additionalProperties: false,
      },
    },
    {
      name: "completeReminder",
      description:
        "Marca un recordatorio como completado. Requiere llamar listReminders primero para obtener el externalId correcto.",
      inputSchema: {
        type: "object",
        properties: {
          list: { type: "string" },
          externalId: { type: "string", description: "Obtenido de listReminders" },
        },
        required: ["list", "externalId"],
        additionalProperties: false,
      },
    },
    {
      name: "editReminder",
      description:
        "Edita un recordatorio existente: título, notas, fecha de vencimiento y/o prioridad. Requiere externalId de listReminders. Pasar solo los campos a cambiar. priority: 0=ninguna, 1=alta, 5=media, 9=baja.",
      inputSchema: {
        type: "object",
        properties: {
          list: { type: "string" },
          externalId: { type: "string", description: "Obtenido de listReminders" },
          title: { type: "string" },
          notes: { type: "string" },
          dueIso: { type: "string", description: "ISO 8601 con timezone offset" },
          priority: { type: "number", description: "0=ninguna 1=alta 5=media 9=baja" },
        },
        required: ["list", "externalId"],
        additionalProperties: false,
      },
    },
    {
      name: "deleteReminder",
      description:
        "Elimina un recordatorio (no lo completa, lo borra permanentemente). Requiere externalId de listReminders.",
      inputSchema: {
        type: "object",
        properties: {
          list: { type: "string" },
          externalId: { type: "string" },
        },
        required: ["list", "externalId"],
        additionalProperties: false,
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    let data: unknown;
    if (name === "listReminderLists") {
      data = { lists: await listLists() };
    } else if (name === "listReminders") {
      const { list } = args as { list: string };
      data = { items: await listItems(list) };
    } else if (name === "addReminder") {
      const { list, title, notes, dueIso, priority } = args as {
        list: string; title: string; notes?: string; dueIso?: string; priority?: number;
      };
      await addItem(list, title, notes, dueIso, priority);
      data = { ok: true, list, title };
    } else if (name === "completeReminder") {
      const { list, externalId } = args as { list: string; externalId: string };
      await completeItem(list, externalId);
      data = { ok: true };
    } else if (name === "editReminder") {
      const { list, externalId, title, notes, dueIso, priority } = args as {
        list: string; externalId: string; title?: string; notes?: string;
        dueIso?: string; priority?: number;
      };
      await editItem(list, externalId, title, notes, dueIso, priority);
      data = { ok: true };
    } else if (name === "deleteReminder") {
      const { list, externalId } = args as { list: string; externalId: string };
      await deleteItem(list, externalId);
      data = { ok: true };
    } else {
      return { isError: true, content: [{ type: "text", text: `Unknown tool: ${name}` }] };
    }
    return { content: [{ type: "text", text: JSON.stringify(data) }] };
  } catch (err) {
    return { isError: true, content: [{ type: "text", text: `Error en ${name}: ${(err as Error).message}` }] };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
