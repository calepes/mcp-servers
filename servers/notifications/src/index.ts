#!/usr/bin/env node
// MCP server: notifications
// Envía notificaciones a Cal vía Telegram usando el bot @ClaudeCalbot.
// Token en ~/.claude/notifications/.env como NOTIF_BOT_TOKEN.
// Tools:
//   - sendNotification(message, chatId?) — envía un mensaje de texto
//   - sendNotificationWithEmoji(emoji, title, message, chatId?) — formato estándar con emoji

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

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

async function sendTelegram(token: string, chatId: string, text: string): Promise<void> {
  const url = `${TELEGRAM_API}/bot${token}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram API ${res.status}: ${body.slice(0, 200)}`);
  }
}

// ── MCP Server ──────────────────────────────────────────────────────────────

const server = new Server(
  { name: "notifications", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "sendNotification",
      description:
        "Envía una notificación a Cal vía Telegram (@ClaudeCalbot — bot de notificaciones del sistema, separado de Jano). Usar para avisos de Claude Code, tareas completadas, alertas, etc. Args: { message: string, chatId?: string (default 94137698) }.",
      inputSchema: {
        type: "object",
        properties: {
          message: { type: "string", description: "Texto de la notificación" },
          chatId: { type: "string", description: "Chat ID destino (default: Cal 94137698)" },
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
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    const token = loadToken();
    if (name === "sendNotification") {
      const { message, chatId = DEFAULT_CHAT_ID } = args as { message: string; chatId?: string };
      await sendTelegram(token, chatId, message);
      return { content: [{ type: "text", text: "Notificación enviada" }] };
    } else if (name === "sendNotificationWithEmoji") {
      const { emoji, title, message, chatId = DEFAULT_CHAT_ID } = args as {
        emoji: string; title: string; message: string; chatId?: string;
      };
      await sendTelegram(token, chatId, `${emoji} ${title}\n${message}`);
      return { content: [{ type: "text", text: "Notificación enviada" }] };
    }
    return { isError: true, content: [{ type: "text", text: `Unknown tool: ${name}` }] };
  } catch (err) {
    return { isError: true, content: [{ type: "text", text: `Error en ${name}: ${(err as Error).message}` }] };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
