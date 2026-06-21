#!/usr/bin/env node
// MCP server: notifications
// Envía notificaciones y media a Cal vía Telegram usando el bot @ClaudeCalbot.
// Token en ~/.claude/notifications/.env como NOTIF_BOT_TOKEN.
// Tools de texto:  sendNotification, sendNotificationWithEmoji
// Tools de media:  sendPhoto, sendDocument, sendVideo, sendAudio, sendVoice, sendLocation
//   Cada media acepta en su campo principal: URL https://…, ruta local (/abs o ~/…,
//   se sube automáticamente), o file_id de Telegram. Alternativa: base64 + filename.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join, basename, resolve } from "path";

const DEFAULT_CHAT_ID = "94137698";
const TELEGRAM_API = "https://api.telegram.org";

function loadToken(): string {
  const envPath = join(homedir(), ".claude", "notifications", ".env");
  try {
    const content = readFileSync(envPath, "utf8");
    const match = content.match(/^NOTIF_BOT_TOKEN=(.+)$/m);
    if (match) return match[1].trim();
  } catch {}
  const env = process.env.NOTIF_BOT_TOKEN;
  if (env) return env;
  throw new Error("NOTIF_BOT_TOKEN not found in ~/.claude/notifications/.env or env");
}

function expandPath(p: string): string {
  if (p.startsWith("~")) return join(homedir(), p.slice(1));
  return resolve(p);
}

async function ensureOk(res: Response, method: string): Promise<void> {
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram ${method} ${res.status}: ${body.slice(0, 300)}`);
  }
}

async function sendTelegram(token: string, chatId: string, text: string, parseMode?: string): Promise<void> {
  const url = `${TELEGRAM_API}/bot${token}/sendMessage`;
  const body: Record<string, unknown> = { chat_id: chatId, text, disable_web_page_preview: true };
  if (parseMode) body.parse_mode = parseMode;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8_000),
  });
  await ensureOk(res, "sendMessage");
}

// Envío de media. value = URL / file_id / ruta local; o base64 + filename.
async function sendMedia(
  token: string,
  method: string,
  field: string,
  opts: { value?: string; base64?: string; filename?: string; chatId: string; extra: Record<string, unknown> },
): Promise<void> {
  const url = `${TELEGRAM_API}/bot${token}/${method}`;
  const { value, base64, filename, chatId, extra } = opts;

  let buf: Buffer | null = null;
  let fname = filename;

  if (base64) {
    buf = Buffer.from(base64, "base64");
    fname = fname || `file_${method}`;
  } else if (value && !/^https?:\/\//i.test(value)) {
    // No es URL → puede ser ruta local. Si existe, subir; si no, tratar como file_id.
    const p = expandPath(value);
    if (existsSync(p)) {
      buf = readFileSync(p);
      fname = fname || basename(p);
    }
  }

  if (buf) {
    const fd = new FormData();
    fd.append("chat_id", chatId);
    for (const [k, v] of Object.entries(extra)) if (v != null) fd.append(k, String(v));
    fd.append(field, new Blob([new Uint8Array(buf)]), fname);
    const res = await fetch(url, { method: "POST", body: fd, signal: AbortSignal.timeout(60_000) });
    await ensureOk(res, method);
    return;
  }

  if (!value) throw new Error(`${method}: falta '${field}' (URL/file_id/ruta) o 'base64'`);
  const body: Record<string, unknown> = { chat_id: chatId, [field]: value };
  for (const [k, v] of Object.entries(extra)) if (v != null) body[k] = v;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  await ensureOk(res, method);
}

// ── Catálogo de media ─────────────────────────────────────────────────────────

const MEDIA: { tool: string; method: string; field: string; desc: string; extras?: string[] }[] = [
  { tool: "sendPhoto", method: "sendPhoto", field: "photo", desc: "foto/imagen" },
  { tool: "sendDocument", method: "sendDocument", field: "document", desc: "documento o archivo (PDF, zip, csv, etc.)" },
  { tool: "sendVideo", method: "sendVideo", field: "video", desc: "video (mp4)" },
  { tool: "sendAudio", method: "sendAudio", field: "audio", desc: "audio/música (mp3)", extras: ["title", "performer"] },
  { tool: "sendVoice", method: "sendVoice", field: "voice", desc: "nota de voz (.ogg/opus)" },
];

function mediaInputSchema(field: string, extras: string[] = []) {
  const properties: Record<string, unknown> = {
    [field]: { type: "string", description: "URL https://…, ruta local (/abs o ~/…), o file_id de Telegram" },
    base64: { type: "string", description: "Contenido del archivo en base64 (alternativa a la fuente por URL/ruta — útil sin filesystem)" },
    filename: { type: "string", description: "Nombre del archivo cuando se usa base64" },
    caption: { type: "string", description: "Texto que acompaña al media (opcional)" },
    parseMode: { type: "string", description: "'HTML' o 'MarkdownV2' para formatear el caption" },
    chatId: { type: "string", description: `Chat ID destino (default ${DEFAULT_CHAT_ID})` },
  };
  if (extras.includes("title")) properties.title = { type: "string", description: "Título (solo audio)" };
  if (extras.includes("performer")) properties.performer = { type: "string", description: "Intérprete (solo audio)" };
  return { type: "object", properties, additionalProperties: false };
}

// ── MCP Server ──────────────────────────────────────────────────────────────

const server = new Server(
  { name: "notifications", version: "0.2.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "sendNotification",
      description:
        "Envía una notificación a Cal vía Telegram (@ClaudeCalbot — bot de notificaciones del sistema, separado de Jano). Usar para avisos de Claude Code, tareas completadas, alertas, etc. Args: { message: string, chatId?: string (default 94137698), parseMode?: 'HTML' }.",
      inputSchema: {
        type: "object",
        properties: {
          message: { type: "string", description: "Texto de la notificación" },
          chatId: { type: "string", description: "Chat ID destino (default: Cal 94137698)" },
          parseMode: { type: "string", description: "Modo de formato Telegram: 'HTML' para renderizar etiquetas <b>, <code>, etc." },
        },
        required: ["message"],
        additionalProperties: false,
      },
    },
    {
      name: "sendNotificationWithEmoji",
      description:
        "Envía notificación con formato estándar: '{emoji} {title}\\n{message}'. Útil para mensajes de sistema con contexto visual claro. Args: { emoji, title, message, chatId? }.",
      inputSchema: {
        type: "object",
        properties: {
          emoji: { type: "string", description: "Emoji del encabezado (ej: ✅, ⚠️, 🔴)" },
          title: { type: "string", description: "Título corto" },
          message: { type: "string", description: "Cuerpo del mensaje" },
          chatId: { type: "string", description: "Chat ID destino (default: Cal 94137698)" },
        },
        required: ["emoji", "title", "message"],
        additionalProperties: false,
      },
    },
    ...MEDIA.map((m) => ({
      name: m.tool,
      description:
        `Envía ${m.desc} a Cal vía Telegram (@ClaudeCalbot). Fuente en '${m.field}': URL https://…, ruta local del archivo (se sube sola), o file_id. Alternativa: 'base64' + 'filename'. Opcionales: caption, parseMode ('HTML'/'MarkdownV2'), chatId.`,
      inputSchema: mediaInputSchema(m.field, m.extras),
    })),
    {
      name: "sendLocation",
      description: "Envía una ubicación (lat/lon) a Cal vía Telegram (@ClaudeCalbot).",
      inputSchema: {
        type: "object",
        properties: {
          latitude: { type: "number", description: "Latitud" },
          longitude: { type: "number", description: "Longitud" },
          chatId: { type: "string", description: `Chat ID destino (default ${DEFAULT_CHAT_ID})` },
        },
        required: ["latitude", "longitude"],
        additionalProperties: false,
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: rawArgs } = request.params;
  const args = (rawArgs ?? {}) as Record<string, any>;
  try {
    const token = loadToken();
    const chatId: string = args.chatId ?? DEFAULT_CHAT_ID;

    if (name === "sendNotification") {
      await sendTelegram(token, chatId, args.message, args.parseMode);
      return { content: [{ type: "text", text: "Notificación enviada" }] };
    }
    if (name === "sendNotificationWithEmoji") {
      await sendTelegram(token, chatId, `${args.emoji} ${args.title}\n${args.message}`);
      return { content: [{ type: "text", text: "Notificación enviada" }] };
    }
    if (name === "sendLocation") {
      const url = `${TELEGRAM_API}/bot${token}/sendLocation`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, latitude: args.latitude, longitude: args.longitude }),
        signal: AbortSignal.timeout(10_000),
      });
      await ensureOk(res, "sendLocation");
      return { content: [{ type: "text", text: "Ubicación enviada" }] };
    }

    const m = MEDIA.find((x) => x.tool === name);
    if (m) {
      const extra: Record<string, unknown> = {};
      if (args.caption) extra.caption = args.caption;
      if (args.parseMode) extra.parse_mode = args.parseMode;
      if (args.title) extra.title = args.title;
      if (args.performer) extra.performer = args.performer;
      await sendMedia(token, m.method, m.field, {
        value: args[m.field],
        base64: args.base64,
        filename: args.filename,
        chatId,
        extra,
      });
      return { content: [{ type: "text", text: `${m.desc} enviado` }] };
    }

    return { isError: true, content: [{ type: "text", text: `Unknown tool: ${name}` }] };
  } catch (err) {
    return { isError: true, content: [{ type: "text", text: `Error en ${name}: ${(err as Error).message}` }] };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
