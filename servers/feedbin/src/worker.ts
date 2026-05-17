import { handleMcp, type McpTool, type McpEnv } from 'worker-mcp-utils';

interface Env extends McpEnv {
  FEEDBIN_USERNAME: string;
  FEEDBIN_PASSWORD: string;
}

const BASE = 'https://api.feedbin.com/v2';

async function apiFetch(path: string, env: Env, opts: RequestInit = {}) {
  const auth = btoa(`${env.FEEDBIN_USERNAME}:${env.FEEDBIN_PASSWORD}`);
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
      ...((opts.headers as Record<string, string>) ?? {}),
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Feedbin API ${res.status}: ${await res.text().then(t => t.slice(0, 200))}`);
  return res.json();
}

async function apiDelete(path: string, env: Env, body: unknown) {
  const auth = btoa(`${env.FEEDBIN_USERNAME}:${env.FEEDBIN_PASSWORD}`);
  const res = await fetch(`${BASE}${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok && res.status !== 204) throw new Error(`Feedbin DELETE ${res.status}`);
}

const TOOLS: McpTool[] = [
  { name: 'getUnreadCount', description: 'Número de entradas no leídas en Feedbin', inputSchema: { type: 'object', properties: {}, required: [] }, annotations: { readOnlyHint: true } },
  { name: 'getUnreadEntries', description: 'IDs de entradas no leídas', inputSchema: { type: 'object', properties: { limit: { type: 'number' } }, required: [] }, annotations: { readOnlyHint: true } },
  { name: 'getEntryContent', description: 'Contenido completo de una entrada por ID', inputSchema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] }, annotations: { readOnlyHint: true } },
  { name: 'markRead', description: 'Marcar entradas como leídas', inputSchema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'number' } } }, required: ['ids'] } },
  { name: 'markUnread', description: 'Marcar entradas como no leídas', inputSchema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'number' } } }, required: ['ids'] } },
  { name: 'getSubscriptions', description: 'Lista de suscripciones activas', inputSchema: { type: 'object', properties: {}, required: [] }, annotations: { readOnlyHint: true } },
  { name: 'searchEntries', description: 'Buscar entradas por query', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }, annotations: { readOnlyHint: true } },
];

async function dispatchTool(name: string, args: unknown, env: Record<string, unknown>): Promise<unknown> {
  const e = env as unknown as Env;
  const a = args as Record<string, unknown>;
  switch (name) {
    case 'getUnreadCount': {
      const ids = await apiFetch('/unread_entries.json', e) as number[];
      return { unreadCount: ids.length };
    }
    case 'getUnreadEntries': {
      const limit = (a.limit as number) ?? 100;
      const ids = await apiFetch('/unread_entries.json', e) as number[];
      return { ids: ids.slice(0, limit), total: ids.length };
    }
    case 'getEntryContent':
      return apiFetch(`/entries/${a.id}.json`, e);
    case 'markRead':
      await apiDelete('/unread_entries.json', e, { unread_entries: a.ids });
      return { ok: true };
    case 'markUnread':
      await apiFetch('/unread_entries.json', e, { method: 'POST', body: JSON.stringify({ unread_entries: a.ids }) });
      return { ok: true };
    case 'getSubscriptions':
      return apiFetch('/subscriptions.json', e);
    case 'searchEntries':
      return apiFetch(`/entries.json?q=${encodeURIComponent(a.query as string)}`, e);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export default {
  fetch(req: Request, env: Env): Promise<Response> {
    return handleMcp(req, env, TOOLS, 'feedbin', dispatchTool);
  },
} satisfies ExportedHandler<Env>;
