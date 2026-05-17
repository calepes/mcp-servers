import { handleMcp, type McpTool, type McpEnv } from 'worker-mcp-utils';

interface Env extends McpEnv {
  NOTIF_BOT_TOKEN: string;
}

const DEFAULT_CHAT_ID = '94137698';
const TELEGRAM_API = 'https://api.telegram.org';

async function sendTelegram(token: string, chatId: string, text: string) {
  const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`Telegram API ${res.status}: ${await res.text().then(t => t.slice(0, 200))}`);
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
];

async function dispatchTool(name: string, args: unknown, env: Record<string, unknown>): Promise<unknown> {
  const e = env as unknown as Env;
  const a = args as Record<string, unknown>;
  if (name === 'sendNotification') {
    await sendTelegram(e.NOTIF_BOT_TOKEN, (a.chatId as string) ?? DEFAULT_CHAT_ID, a.message as string);
    return { ok: true };
  }
  if (name === 'sendNotificationWithEmoji') {
    const text = `${a.emoji} ${a.title}\n\n${a.message}`;
    await sendTelegram(e.NOTIF_BOT_TOKEN, (a.chatId as string) ?? DEFAULT_CHAT_ID, text);
    return { ok: true };
  }
  throw new Error(`Unknown tool: ${name}`);
}

export default {
  fetch(req: Request, env: Env): Promise<Response> {
    return handleMcp(req, env, TOOLS, 'notifications', dispatchTool);
  },
} satisfies ExportedHandler<Env>;
