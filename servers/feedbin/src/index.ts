#!/usr/bin/env node
// MCP server: feedbin
// Tools:
//   - getUnreadCount()          — cantidad de entradas sin leer
//   - getUnreadEntries(opts)    — entradas sin leer con metadata (paginado, con filtro feed/tag)
//   - getEntryContent(entryId)  — contenido completo via Mercury Parser (extract endpoint)
//   - markRead(entryIds)        — marcar entradas como leídas
//   - markUnread(entryIds)      — marcar entradas como no leídas
//   - getSubscriptions()        — lista de feeds suscritos con tags
//   - searchEntries(query)      — busca en entradas por texto
//   - deleteSubscription(id)     — elimina suscripción por subscription ID
//   - savePage(url)              — guarda artículo individual como read-later (pages)
//   - addSubscription(feedUrl)  — suscribe a un feed RSS/Atom dado un URL

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const BASE_URL = "https://api.feedbin.com/v2";
const CACHE_TTL_MS = 30_000;

// Credentials from env
const USERNAME = process.env.FEEDBIN_USERNAME ?? "";
const PASSWORD = process.env.FEEDBIN_PASSWORD ?? "";

if (!USERNAME || !PASSWORD) {
  process.stderr.write(
    "[feedbin-mcp] WARNING: FEEDBIN_USERNAME or FEEDBIN_PASSWORD not set\n",
  );
}

function authHeader(): string {
  return "Basic " + Buffer.from(`${USERNAME}:${PASSWORD}`).toString("base64");
}

async function apiFetch(
  path: string,
  opts: RequestInit = {},
): Promise<Response> {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json; charset=utf-8",
      ...(opts.headers ?? {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  return res;
}

// Simple in-memory cache
const cache = new Map<string, { value: unknown; expires: number }>();

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry || entry.expires < Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.value as T;
}

function setCached(key: string, value: unknown): void {
  cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
}

// ---- Types ----

interface FeedbinEntry {
  id: number;
  feed_id: number;
  title: string | null;
  url: string;
  author: string | null;
  summary: string | null;
  content: string | null;
  published: string;
  created_at: string;
}

interface FeedbinSubscription {
  id: number;
  feed_id: number;
  title: string;
  feed_url: string;
  site_url: string;
}

interface FeedbinTagging {
  id: number;
  feed_id: number;
  name: string;
}

interface ExtractResult {
  title: string | null;
  author: string | null;
  content: string | null;
  date_published: string | null;
  lead_image_url: string | null;
  dek: string | null;
  next_page_url: string | null;
  url: string;
  domain: string | null;
  excerpt: string | null;
  word_count: number | null;
  direction: string | null;
  total_pages: number | null;
  rendered_pages: number | null;
}

// ---- API functions ----

async function fetchUnreadIds(): Promise<number[]> {
  const cached = getCached<number[]>("unread-ids");
  if (cached) return cached;
  const res = await apiFetch("/unread_entries.json");
  if (!res.ok) throw new Error(`Feedbin getUnreadIds: ${res.status}`);
  const ids = (await res.json()) as number[];
  setCached("unread-ids", ids);
  return ids;
}

async function fetchSubscriptions(): Promise<FeedbinSubscription[]> {
  const cached = getCached<FeedbinSubscription[]>("subscriptions");
  if (cached) return cached;
  const res = await apiFetch("/subscriptions.json");
  if (!res.ok) throw new Error(`Feedbin subscriptions: ${res.status}`);
  const subs = (await res.json()) as FeedbinSubscription[];
  setCached("subscriptions", subs);
  return subs;
}

async function fetchTaggings(): Promise<FeedbinTagging[]> {
  const cached = getCached<FeedbinTagging[]>("taggings");
  if (cached) return cached;
  const res = await apiFetch("/taggings.json");
  if (!res.ok) throw new Error(`Feedbin taggings: ${res.status}`);
  const taggings = (await res.json()) as FeedbinTagging[];
  setCached("taggings", taggings);
  return taggings;
}

async function fetchEntriesByIds(ids: number[]): Promise<FeedbinEntry[]> {
  // Feedbin allows up to 100 IDs per request
  const chunks: number[][] = [];
  for (let i = 0; i < ids.length; i += 100) {
    chunks.push(ids.slice(i, i + 100));
  }
  const results: FeedbinEntry[] = [];
  for (const chunk of chunks) {
    const res = await apiFetch(`/entries.json?ids=${chunk.join(",")}&per_page=100`);
    if (!res.ok) throw new Error(`Feedbin entries: ${res.status}`);
    const entries = (await res.json()) as FeedbinEntry[];
    results.push(...entries);
  }
  return results;
}

// ---- Tool handlers ----

async function getUnreadCount(): Promise<{ count: number }> {
  const ids = await fetchUnreadIds();
  return { count: ids.length };
}

async function getUnreadEntries(opts: {
  limit?: number;
  tag?: string;
  feedId?: number;
  includeContent?: boolean;
}): Promise<{
  total_unread: number;
  returned: number;
  entries: Array<{
    id: number;
    feed_id: number;
    feed_title?: string;
    tags?: string[];
    title: string | null;
    url: string;
    author: string | null;
    summary: string | null;
    content?: string | null;
    published: string;
  }>;
}> {
  const limit = Math.min(opts.limit ?? 20, 100);
  const [allIds, subs, taggings] = await Promise.all([
    fetchUnreadIds(),
    fetchSubscriptions(),
    fetchTaggings(),
  ]);

  // Build feed_id → subscription + tags index
  const subMap = new Map<number, FeedbinSubscription>();
  for (const sub of subs) subMap.set(sub.feed_id, sub);

  const tagsByFeed = new Map<number, string[]>();
  for (const t of taggings) {
    const existing = tagsByFeed.get(t.feed_id) ?? [];
    existing.push(t.name);
    tagsByFeed.set(t.feed_id, existing);
  }

  let ids = allIds;

  // Filter by tag
  if (opts.tag) {
    const tagLower = opts.tag.toLowerCase();
    const feedIdsWithTag = new Set(
      taggings
        .filter((t) => t.name.toLowerCase().includes(tagLower))
        .map((t) => t.feed_id),
    );
    // We can't filter by feed_id from IDs alone — need to fetch entries first
    // Strategy: fetch a sample and filter. Take 3x limit to have room after filter.
    const sample = ids.slice(0, limit * 3);
    const entries = await fetchEntriesByIds(sample);
    const filtered = entries.filter((e) => feedIdsWithTag.has(e.feed_id));
    const sliced = filtered.slice(0, limit);
    return {
      total_unread: allIds.length,
      returned: sliced.length,
      entries: sliced.map((e) => ({
        id: e.id,
        feed_id: e.feed_id,
        feed_title: subMap.get(e.feed_id)?.title,
        tags: tagsByFeed.get(e.feed_id),
        title: e.title,
        url: e.url,
        author: e.author,
        summary: e.summary,
        content: opts.includeContent ? e.content : undefined,
        published: e.published,
      })),
    };
  }

  // Filter by feedId
  if (opts.feedId) {
    // Still need to fetch entries to get their feed_id
    const sample = ids.slice(0, limit * 5);
    const entries = await fetchEntriesByIds(sample);
    const filtered = entries.filter((e) => e.feed_id === opts.feedId);
    const sliced = filtered.slice(0, limit);
    return {
      total_unread: allIds.length,
      returned: sliced.length,
      entries: sliced.map((e) => ({
        id: e.id,
        feed_id: e.feed_id,
        feed_title: subMap.get(e.feed_id)?.title,
        tags: tagsByFeed.get(e.feed_id),
        title: e.title,
        url: e.url,
        author: e.author,
        summary: e.summary,
        content: opts.includeContent ? e.content : undefined,
        published: e.published,
      })),
    };
  }

  // No filter — take most recent (IDs are ordered newest-first by Feedbin)
  const slicedIds = ids.slice(0, limit);
  const entries = await fetchEntriesByIds(slicedIds);
  // Sort newest-first by published
  entries.sort(
    (a, b) => new Date(b.published).getTime() - new Date(a.published).getTime(),
  );

  return {
    total_unread: allIds.length,
    returned: entries.length,
    entries: entries.map((e) => ({
      id: e.id,
      feed_id: e.feed_id,
      feed_title: subMap.get(e.feed_id)?.title,
      tags: tagsByFeed.get(e.feed_id),
      title: e.title,
      url: e.url,
      author: e.author,
      summary: e.summary,
      content: opts.includeContent ? e.content : undefined,
      published: e.published,
    })),
  };
}

async function getEntryContent(entryId: number): Promise<ExtractResult> {
  const res = await apiFetch(`/entries/${entryId}/extract.json`);
  if (!res.ok) throw new Error(`Feedbin extract ${entryId}: ${res.status}`);
  return (await res.json()) as ExtractResult;
}

async function markRead(entryIds: number[]): Promise<{ marked: number }> {
  const res = await apiFetch("/unread_entries.json", {
    method: "DELETE",
    body: JSON.stringify({ unread_entries: entryIds }),
  });
  if (res.status !== 200 && res.status !== 204)
    throw new Error(`Feedbin markRead: ${res.status}`);
  // Invalidate cache
  cache.delete("unread-ids");
  return { marked: entryIds.length };
}

async function markUnread(entryIds: number[]): Promise<{ marked: number }> {
  const res = await apiFetch("/unread_entries.json", {
    method: "POST",
    body: JSON.stringify({ unread_entries: entryIds }),
  });
  if (!res.ok) throw new Error(`Feedbin markUnread: ${res.status}`);
  cache.delete("unread-ids");
  return { marked: entryIds.length };
}

async function getSubscriptions(): Promise<{
  total: number;
  subscriptions: Array<{
    feed_id: number;
    title: string;
    site_url: string;
    tags: string[];
  }>;
}> {
  const [subs, taggings] = await Promise.all([
    fetchSubscriptions(),
    fetchTaggings(),
  ]);
  const tagsByFeed = new Map<number, string[]>();
  for (const t of taggings) {
    const existing = tagsByFeed.get(t.feed_id) ?? [];
    existing.push(t.name);
    tagsByFeed.set(t.feed_id, existing);
  }
  return {
    total: subs.length,
    subscriptions: subs.map((s) => ({
      subscription_id: s.id,
      feed_id: s.feed_id,
      title: s.title,
      site_url: s.site_url,
      tags: tagsByFeed.get(s.feed_id) ?? [],
    })),
  };
}

async function searchEntries(opts: {
  query: string;
  limit?: number;
}): Promise<{
  returned: number;
  entries: Array<{
    id: number;
    feed_id: number;
    title: string | null;
    url: string;
    author: string | null;
    summary: string | null;
    published: string;
  }>;
}> {
  const limit = Math.min(opts.limit ?? 20, 100);
  const params = new URLSearchParams({
    q: opts.query,
    per_page: String(limit),
  });
  const res = await apiFetch(`/entries.json?${params.toString()}`);
  if (!res.ok) throw new Error(`Feedbin search: ${res.status}`);
  const entries = (await res.json()) as FeedbinEntry[];
  return {
    returned: entries.length,
    entries: entries.map((e) => ({
      id: e.id,
      feed_id: e.feed_id,
      title: e.title,
      url: e.url,
      author: e.author,
      summary: e.summary,
      published: e.published,
    })),
  };
}

async function savePage(url: string): Promise<{
  id: number;
  title: string | null;
  url: string;
  published: string;
}> {
  const res = await apiFetch("/pages.json", {
    method: "POST",
    body: JSON.stringify({ url }),
  });
  if (!res.ok) throw new Error(`Feedbin savePage: ${res.status}`);
  const entry = (await res.json()) as FeedbinEntry;
  return { id: entry.id, title: entry.title, url: entry.url, published: entry.published };
}

async function deleteSubscription(subscriptionId: number): Promise<{ deleted: number }> {
  const res = await apiFetch(`/subscriptions/${subscriptionId}.json`, { method: "DELETE" });
  if (res.status !== 200 && res.status !== 204)
    throw new Error(`Feedbin deleteSubscription: ${res.status}`);
  cache.delete("subscriptions");
  cache.delete("taggings");
  return { deleted: subscriptionId };
}

async function getUnreadByFeed(): Promise<
  Array<{
    feed_id: number;
    feed_title: string;
    tags: string[];
    unread_count: number;
  }>
> {
  const [allIds, subs, taggings] = await Promise.all([
    fetchUnreadIds(),
    fetchSubscriptions(),
    fetchTaggings(),
  ]);
  if (allIds.length === 0) return [];

  const subMap = new Map<number, FeedbinSubscription>();
  for (const sub of subs) subMap.set(sub.feed_id, sub);

  const tagsByFeed = new Map<number, string[]>();
  for (const t of taggings) {
    const existing = tagsByFeed.get(t.feed_id) ?? [];
    existing.push(t.name);
    tagsByFeed.set(t.feed_id, existing);
  }

  // Fetch unread entries with feed_id via ?read=false (avoids long IDs URL)
  const res = await apiFetch("/entries.json?read=false&per_page=1000");
  if (!res.ok) throw new Error(`Feedbin entries: ${res.status}`);
  const entries = (await res.json()) as FeedbinEntry[];

  const counts: Record<number, number> = {};
  for (const entry of entries) {
    counts[entry.feed_id] = (counts[entry.feed_id] ?? 0) + 1;
  }

  return Object.entries(counts)
    .map(([feed_id_str, unread_count]) => {
      const feed_id = Number(feed_id_str);
      return {
        feed_id,
        feed_title: subMap.get(feed_id)?.title ?? "Unknown",
        tags: tagsByFeed.get(feed_id) ?? [],
        unread_count,
      };
    })
    .sort((a, b) => b.unread_count - a.unread_count);
}

async function addSubscription(feedUrl: string): Promise<{
  feed_id: number;
  title: string;
  feed_url: string;
  site_url: string;
}> {
  const res = await apiFetch("/subscriptions.json", {
    method: "POST",
    body: JSON.stringify({ feed_url: feedUrl }),
  });
  if (res.status === 302) {
    // Already subscribed — Feedbin returns 302 with existing subscription
    const existing = (await res.json()) as FeedbinSubscription;
    cache.delete("subscriptions");
    return { feed_id: existing.feed_id, title: existing.title, feed_url: existing.feed_url, site_url: existing.site_url };
  }
  if (!res.ok) throw new Error(`Feedbin addSubscription: ${res.status}`);
  const sub = (await res.json()) as FeedbinSubscription;
  cache.delete("subscriptions");
  return { feed_id: sub.feed_id, title: sub.title, feed_url: sub.feed_url, site_url: sub.site_url };
}

// ---- MCP Server ----

const server = new Server(
  { name: "feedbin", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

const READ_ONLY = { annotations: { readOnlyHint: true } };

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "getUnreadCount",
      description:
        "Cantidad total de artículos sin leer en Feedbin. Rápido — no descarga entradas. Usar para responder '¿cuántos no leídos tengo?'.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: READ_ONLY.annotations,
    },
    {
      name: "getUnreadEntries",
      description:
        "Lista artículos sin leer de Feedbin con metadata. Args: { limit? (max 100, default 20), tag? (filtrar por tag/categoría, partial match), feedId? (filtrar por feed específico), includeContent? (bool, incluir HTML del feed si está disponible — más lento) }. Devuelve { total_unread, returned, entries: [{ id, feed_id, feed_title, tags, title, url, author, summary, content?, published }] }. Para contenido completo limpio usar getEntryContent.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number" },
          tag: { type: "string" },
          feedId: { type: "number" },
          includeContent: { type: "boolean" },
        },
        additionalProperties: false,
      },
      annotations: READ_ONLY.annotations,
    },
    {
      name: "getEntryContent",
      description:
        "Obtiene el contenido completo y limpio de un artículo via Mercury Parser (extractor Feedbin). Args: { entryId: number }. Devuelve { title, author, content (HTML limpio), date_published, excerpt, word_count, url }. Usar cuando el summary no alcanza o el feed solo da excerpt.",
      inputSchema: {
        type: "object",
        properties: {
          entryId: { type: "number" },
        },
        required: ["entryId"],
        additionalProperties: false,
      },
      annotations: READ_ONLY.annotations,
    },
    {
      name: "markRead",
      description:
        "Marca una o varias entradas de Feedbin como leídas. Args: { entryIds: number[] }. Devuelve { marked: N }.",
      inputSchema: {
        type: "object",
        properties: {
          entryIds: { type: "array", items: { type: "number" } },
        },
        required: ["entryIds"],
        additionalProperties: false,
      },
    },
    {
      name: "markUnread",
      description:
        "Marca una o varias entradas de Feedbin como no leídas. Args: { entryIds: number[] }. Devuelve { marked: N }.",
      inputSchema: {
        type: "object",
        properties: {
          entryIds: { type: "array", items: { type: "number" } },
        },
        required: ["entryIds"],
        additionalProperties: false,
      },
    },
    {
      name: "getSubscriptions",
      description:
        "Lista todos los feeds suscritos en Feedbin con sus tags/categorías. Devuelve { total, subscriptions: [{ feed_id, title, site_url, tags }] }. Útil para identificar feed_ids antes de filtrar getUnreadEntries.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: READ_ONLY.annotations,
    },
    {
      name: "searchEntries",
      description:
        "Busca artículos en Feedbin por texto (título, contenido). Args: { query: string, limit? (default 20, max 100) }. Devuelve entradas con metadata básica.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "number" },
        },
        required: ["query"],
        additionalProperties: false,
      },
      annotations: READ_ONLY.annotations,
    },
    {
      name: "deleteSubscription",
      description:
        "Elimina una suscripción de Feedbin. Args: { subscriptionId: number }. Usar el campo `subscription_id` que devuelve getSubscriptions() — NO el `feed_id` (son distintos). Para borrar por nombre: primero getSubscriptions() para encontrar el subscription_id, luego deleteSubscription.",
      inputSchema: {
        type: "object",
        properties: {
          subscriptionId: { type: "number" },
        },
        required: ["subscriptionId"],
        additionalProperties: false,
      },
    },
    {
      name: "savePage",
      description:
        "Guarda un artículo/URL individual en Feedbin para leer después (equivalente a read-later). Args: { url: string }. Crea una entrada de tipo 'page' en el feed. Devuelve { id, title, url, published }. Usar cuando el usuario quiere guardar un artículo específico, NO suscribirse a un feed.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string" },
        },
        required: ["url"],
        additionalProperties: false,
      },
    },
    {
      name: "getUnreadByFeed",
      description:
        "Conteo de artículos no leídos agrupado por feed, con título del feed y sus carpetas/tags. Devuelve [{ feed_id, feed_title, tags, unread_count }] ordenado de mayor a menor. Usar para responder 'cuántos no leídos por feed' o 'dame mis feeds por carpeta con conteo'.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: READ_ONLY.annotations,
    },
    {
      name: "addSubscription",
      description:
        "Suscribe a un feed RSS/Atom en Feedbin dado un URL. Args: { feedUrl: string }. Si ya estaba suscrito, devuelve la suscripción existente. Devuelve { feed_id, title, feed_url, site_url }.",
      inputSchema: {
        type: "object",
        properties: {
          feedUrl: { type: "string" },
        },
        required: ["feedUrl"],
        additionalProperties: false,
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const a = (args ?? {}) as Record<string, unknown>;
  try {
    if (name === "getUnreadCount") {
      return { content: [{ type: "text", text: JSON.stringify(await getUnreadCount()) }] };
    }
    if (name === "getUnreadEntries") {
      const result = await getUnreadEntries({
        limit: a.limit as number | undefined,
        tag: a.tag as string | undefined,
        feedId: a.feedId as number | undefined,
        includeContent: a.includeContent as boolean | undefined,
      });
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
    if (name === "getEntryContent") {
      const result = await getEntryContent(a.entryId as number);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
    if (name === "markRead") {
      const result = await markRead(a.entryIds as number[]);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
    if (name === "markUnread") {
      const result = await markUnread(a.entryIds as number[]);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
    if (name === "getSubscriptions") {
      const result = await getSubscriptions();
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
    if (name === "searchEntries") {
      const result = await searchEntries({
        query: a.query as string,
        limit: a.limit as number | undefined,
      });
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
    if (name === "deleteSubscription") {
      const result = await deleteSubscription(a.subscriptionId as number);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
    if (name === "savePage") {
      const result = await savePage(a.url as string);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
    if (name === "addSubscription") {
      const result = await addSubscription(a.feedUrl as string);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
    return {
      isError: true,
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
    };
  } catch (err) {
    return {
      isError: true,
      content: [{ type: "text", text: `Error en ${name}: ${(err as Error).message}` }],
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
