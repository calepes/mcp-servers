import { handleMcp, type McpTool, type McpEnv } from 'worker-mcp-utils';

interface Env extends McpEnv {
  NOTIF_BOT_TOKEN: string;
}

const DEFAULT_CHAT_ID = '94137698';
const TELEGRAM_API = 'https://api.telegram.org';

async function ensureOk(res: Response, method: string) {
  if (!res.ok) throw new Error(`Telegram ${method} ${res.status}: ${await res.text().then(t => t.slice(0, 300))}`);
}

async function sendTelegram(token: string, chatId: string, text: string, parseMode?: string) {
  const body: Record<string, unknown> = { chat_id: chatId, text, disable_web_page_preview: true };
  if (parseMode) body.parse_mode = parseMode;
  const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8_000),
  });
  await ensureOk(res, 'sendMessage');
}

// Sin filesystem: media por URL / file_id (string) o base64 + filename.
async function sendMedia(
  token: string,
  method: string,
  field: string,
  opts: { value?: string; base64?: string; filename?: string; chatId: string; extra: Record<string, unknown> },
) {
  const url = `${TELEGRAM_API}/bot${token}/${method}`;
  const { value, base64, filename, chatId, extra } = opts;

  if (base64) {
    const bin = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const fd = new FormData();
    fd.append('chat_id', chatId);
    for (const [k, v] of Object.entries(extra)) if (v != null) fd.append(k, String(v));
    fd.append(field, new Blob([bin]), filename || `file_${method}`);
    const res = await fetch(url, { method: 'POST', body: fd, signal: AbortSignal.timeout(60_000) });
    await ensureOk(res, method);
    return;
  }

  if (!value) throw new Error(`${method}: falta '${field}' (URL/file_id) o 'base64'`);
  const body: Record<string, unknown> = { chat_id: chatId, [field]: value };
  for (const [k, v] of Object.entries(extra)) if (v != null) body[k] = v;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  await ensureOk(res, method);
}

const MEDIA: { tool: string; method: string; field: string; desc: string; extras?: string[] }[] = [
  { tool: 'sendPhoto', method: 'sendPhoto', field: 'photo', desc: 'foto/imagen' },
  { tool: 'sendDocument', method: 'sendDocument', field: 'document', desc: 'documento o archivo (PDF, zip, csv, etc.)' },
  { tool: 'sendVideo', method: 'sendVideo', field: 'video', desc: 'video (mp4)' },
  { tool: 'sendAudio', method: 'sendAudio', field: 'audio', desc: 'audio/música (mp3)', extras: ['title', 'performer'] },
  { tool: 'sendVoice', method: 'sendVoice', field: 'voice', desc: 'nota de voz (.ogg/opus)' },
];

function mediaSchema(field: string, extras: string[] = []) {
  const properties: Record<string, unknown> = {
    [field]: { type: 'string', description: 'URL https://… o file_id de Telegram' },
    base64: { type: 'string', description: 'Contenido del archivo en base64 (alternativa a la URL — necesario para subir archivos sin hosting)' },
    filename: { type: 'string', description: 'Nombre del archivo cuando se usa base64' },
    caption: { type: 'string', description: 'Texto que acompaña al media (opcional)' },
    parseMode: { type: 'string', description: "'HTML' o 'MarkdownV2' para formatear el caption" },
    chatId: { type: 'string', description: `Chat ID destino (default ${DEFAULT_CHAT_ID})` },
  };
  if (extras.includes('title')) properties.title = { type: 'string', description: 'Título (solo audio)' };
  if (extras.includes('performer')) properties.performer = { type: 'string', description: 'Intérprete (solo audio)' };
  return { type: 'object' as const, properties };
}

const TOOLS: McpTool[] = [
  {
    name: 'sendNotification',
    description: 'Envía notificación a Cal vía Telegram (@ClaudeCalbot)',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Texto del mensaje' },
        chatId: { type: 'string', description: `Chat ID destino (default ${DEFAULT_CHAT_ID})` },
        parseMode: { type: 'string', description: "Modo de formato Telegram: 'HTML' para renderizar <b>, <code>, etc." },
      },
      required: ['message'],
    },
  },
  {
    name: 'sendNotificationWithEmoji',
    description: 'Notificación con formato estándar: emoji + título + cuerpo',
    inputSchema: {
      type: 'object',
      properties: {
        emoji: { type: 'string' },
        title: { type: 'string' },
        message: { type: 'string' },
        chatId: { type: 'string' },
      },
      required: ['emoji', 'title', 'message'],
    },
  },
  ...MEDIA.map((m) => ({
    name: m.tool,
    description: `Envía ${m.desc} a Cal vía Telegram (@ClaudeCalbot). Fuente en '${m.field}': URL o file_id. Alternativa: 'base64' + 'filename'. Opcionales: caption, parseMode, chatId.`,
    inputSchema: mediaSchema(m.field, m.extras),
  })),
  {
    name: 'sendLocation',
    description: 'Envía una ubicación (lat/lon) a Cal vía Telegram (@ClaudeCalbot)',
    inputSchema: {
      type: 'object',
      properties: {
        latitude: { type: 'number' },
        longitude: { type: 'number' },
        chatId: { type: 'string' },
      },
      required: ['latitude', 'longitude'],
    },
  },
];

async function dispatchTool(name: string, args: unknown, env: Record<string, unknown>): Promise<unknown> {
  const e = env as unknown as Env;
  const a = (args ?? {}) as Record<string, any>;
  const token = e.NOTIF_BOT_TOKEN;
  const chatId: string = a.chatId ?? DEFAULT_CHAT_ID;

  if (name === 'sendNotification') {
    await sendTelegram(token, chatId, a.message, a.parseMode);
    return { ok: true };
  }
  if (name === 'sendNotificationWithEmoji') {
    await sendTelegram(token, chatId, `${a.emoji} ${a.title}\n\n${a.message}`);
    return { ok: true };
  }
  if (name === 'sendLocation') {
    const res = await fetch(`${TELEGRAM_API}/bot${token}/sendLocation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, latitude: a.latitude, longitude: a.longitude }),
      signal: AbortSignal.timeout(10_000),
    });
    await ensureOk(res, 'sendLocation');
    return { ok: true };
  }

  const m = MEDIA.find((x) => x.tool === name);
  if (m) {
    const extra: Record<string, unknown> = {};
    if (a.caption) extra.caption = a.caption;
    if (a.parseMode) extra.parse_mode = a.parseMode;
    if (a.title) extra.title = a.title;
    if (a.performer) extra.performer = a.performer;
    await sendMedia(token, m.method, m.field, { value: a[m.field], base64: a.base64, filename: a.filename, chatId, extra });
    return { ok: true };
  }

  throw new Error(`Unknown tool: ${name}`);
}

export default {
  fetch(req: Request, env: Env): Promise<Response> {
    return handleMcp(req, env, TOOLS, 'notifications', dispatchTool);
  },
} satisfies ExportedHandler<Env>;
