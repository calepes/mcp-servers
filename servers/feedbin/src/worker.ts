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
  { name: 'getTaggings', description: 'Estructura de carpetas/tags: mapeo feed_id → nombre de carpeta. Combinar con getSubscriptions para listar feeds por carpeta.', inputSchema: { type: 'object', properties: {}, required: [] }, annotations: { readOnlyHint: true } },
  { name: 'getUnreadByFeed', description: 'Conteo de entradas no leídas agrupado por feed_id. Retorna array [{feed_id, unread_count}] ordenado por más no leídos. Usar junto con getSubscriptions y getTaggings para la vista completa por carpeta/feed.', inputSchema: { type: 'object', properties: {}, required: [] }, annotations: { readOnlyHint: true } },
  { name: 'searchEntries', description: 'Buscar entradas por query', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }, annotations: { readOnlyHint: true } },
  { name: 'savePage', description: 'Guardar una URL como página en Feedbin (read-later)', inputSchema: { type: 'object', properties: { url: { type: 'string', description: 'URL a guardar' } }, required: ['url'] } },
  { name: 'addSubscription', description: 'Suscribirse a un feed RSS/Atom por URL', inputSchema: { type: 'object', properties: { feed_url: { type: 'string', description: 'URL del feed RSS/Atom' } }, required: ['feed_url'] } },
  { name: 'deleteSubscription', description: 'Cancelar suscripción por subscription_id (usar getSubscriptions para obtener el id)', inputSchema: { type: 'object', properties: { subscription_id: { type: 'number', description: 'ID de la suscripción (campo id de getSubscriptions, NO feed_id)' } }, required: ['subscription_id'] } },
  { name: 'getEntriesByFeed', description: 'Entradas NO leídas de un feed, ORDENABLES y PAGINADAS. Args: { feed_id, limit? (default 50, max 200), order? ("newest"|"oldest", default "newest"), offset? (desplazamiento para paginar, default 0) }. Devuelve { feed_id, total_unread (total real de no leídas del feed), order, offset, returned, entries:[{id,title,url,author,summary,published}] }. Para triage de un backlog grande: usar order:"oldest" e ir subiendo offset de a `limit`, o leer total_unread para decidir un markRead masivo (juntando ids).', inputSchema: { type: 'object', properties: { feed_id: { type: 'number', description: 'feed_id del feed' }, limit: { type: 'number', description: 'Máximo de entradas (default 50, max 200)' }, order: { type: 'string', enum: ['newest', 'oldest'], description: 'Orden por fecha de publicación (default newest)' }, offset: { type: 'number', description: 'Desplazamiento para paginar (default 0)' } }, required: ['feed_id'] }, annotations: { readOnlyHint: true } },
  { name: 'getEntriesByTag', description: 'Entradas no leídas de todos los feeds de una carpeta/tag con título, URL y resumen ya incluidos. Usar para listar/resumir artículos de una carpeta entera en una sola llamada.', inputSchema: { type: 'object', properties: { tag: { type: 'string', description: 'Nombre de la carpeta/tag (ej: "1. Siempre", "4. Opcional")' }, limit: { type: 'number', description: 'Máximo de entradas por feed (default 50)' } }, required: ['tag'] }, annotations: { readOnlyHint: true } },
  { name: 'markFeedRead', description: 'Marcar TODAS las entradas no leídas de un feed específico como leídas. Usar cuando el usuario pide marcar leídas un feed por nombre o ID. Una sola llamada — no requiere obtener IDs antes.', inputSchema: { type: 'object', properties: { feed_id: { type: 'number', description: 'feed_id del feed (de getUnreadByFeed o getSubscriptions)' } }, required: ['feed_id'] } },
  { name: 'markTagRead', description: 'Marcar TODAS las entradas no leídas de una carpeta/tag como leídas. Usar cuando el usuario pide marcar leída una carpeta entera (ej: "marca los opcionales como leídos"). Una sola llamada — no requiere obtener IDs antes.', inputSchema: { type: 'object', properties: { tag: { type: 'string', description: 'Nombre de la carpeta/tag (ej: "4. Opcional", "1. Siempre")' } }, required: ['tag'] } },
  { name: 'getReadEntriesByFeed', description: 'Entradas ya leídas de un feed específico con título, URL y resumen. Usar para recuperar artículos previamente leídos de un feed. Soporta paginación con el parámetro page.', inputSchema: { type: 'object', properties: { feed_id: { type: 'number', description: 'feed_id del feed' }, limit: { type: 'number', description: 'Máximo de entradas (default 50, max 1000)' }, page: { type: 'number', description: 'Página de resultados (default 1)' } }, required: ['feed_id'] }, annotations: { readOnlyHint: true } },
  { name: 'getReadEntriesByTag', description: 'Entradas ya leídas de todos los feeds de una carpeta/tag con título, URL y resumen. Usar para recuperar artículos previamente leídos de una carpeta entera en una sola llamada.', inputSchema: { type: 'object', properties: { tag: { type: 'string', description: 'Nombre de la carpeta/tag (ej: "1. Siempre", "4. Opcional")' }, limit: { type: 'number', description: 'Máximo de entradas por feed (default 50)' }, page: { type: 'number', description: 'Página de resultados por feed (default 1)' } }, required: ['tag'] }, annotations: { readOnlyHint: true } },
  { name: 'getStarredEntries', description: 'Artículos marcados con estrella (starred / favoritos) en Feedbin, con título, URL, autor y resumen, ordenados del más reciente. Args: { limit? (default 50) }. Devuelve { total, entries: [{ id, feed_id, title, url, author, summary, published }] }.', inputSchema: { type: 'object', properties: { limit: { type: 'number', description: 'Máximo de entradas (default 50)' } }, required: [] }, annotations: { readOnlyHint: true } },
  { name: 'starEntries', description: 'Marca una o varias entradas con estrella (starred) en Feedbin. Args: { ids: number[] }. Devuelve { ok, starred }.', inputSchema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'number' } } }, required: ['ids'] } },
  { name: 'unstarEntries', description: 'Quita la estrella (unstar) de una o varias entradas en Feedbin. Args: { ids: number[] }. Devuelve { ok, unstarred }.', inputSchema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'number' } } }, required: ['ids'] } },
  { name: 'createTagging', description: 'Asigna un feed a una carpeta/tag (lo agrega; un feed puede estar en varias). Args: { feed_id, name (nombre de la carpeta/tag) }. Si la carpeta no existe, Feedbin la crea. Devuelve el tagging creado { id, feed_id, name }.', inputSchema: { type: 'object', properties: { feed_id: { type: 'number', description: 'feed_id del feed' }, name: { type: 'string', description: 'Nombre de la carpeta/tag' } }, required: ['feed_id', 'name'] } },
  { name: 'deleteTagging', description: 'Quita un feed de una carpeta/tag (borra la asignación, NO el feed). Args: { tagging_id (campo id de getTaggings, NO feed_id) }. Para mover un feed: deleteTagging del viejo + createTagging del nuevo.', inputSchema: { type: 'object', properties: { tagging_id: { type: 'number', description: 'id del tagging (de getTaggings)' } }, required: ['tagging_id'] } },
  { name: 'renameTag', description: 'Renombra una carpeta/tag en TODOS los feeds que la tienen. Args: { old_name, new_name }.', inputSchema: { type: 'object', properties: { old_name: { type: 'string' }, new_name: { type: 'string' } }, required: ['old_name', 'new_name'] } },
  { name: 'deleteTag', description: 'Borra una carpeta/tag de todos los feeds (los feeds quedan sin esa carpeta, no se borran). Args: { name }.', inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
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
    case 'getTaggings':
      return apiFetch('/taggings.json', e);
    case 'getUnreadByFeed': {
      const counts: Record<number, number> = {};
      let page = 1;
      while (true) {
        const entries = await apiFetch(`/entries.json?read=false&per_page=1000&page=${page}`, e) as Array<{ id: number; feed_id: number }>;
        if (entries.length === 0) break;
        for (const entry of entries) {
          counts[entry.feed_id] = (counts[entry.feed_id] ?? 0) + 1;
        }
        if (entries.length < 1000) break;
        page++;
      }
      return Object.entries(counts)
        .map(([feed_id, unread_count]) => ({ feed_id: Number(feed_id), unread_count }))
        .sort((a, b) => b.unread_count - a.unread_count);
    }
    case 'searchEntries':
      return apiFetch(`/entries.json?q=${encodeURIComponent(a.query as string)}`, e);
    case 'savePage':
      return apiFetch('/pages.json', e, { method: 'POST', body: JSON.stringify({ url: a.url }) });
    case 'addSubscription':
      return apiFetch('/subscriptions.json', e, { method: 'POST', body: JSON.stringify({ feed_url: a.feed_url }) });
    case 'getEntriesByFeed': {
      const limit = Math.min((a.limit as number) ?? 50, 200);
      const offset = Math.max((a.offset as number) ?? 0, 0);
      const order = (a.order as string) === 'oldest' ? 'oldest' : 'newest';
      const targetFeedId = Number(a.feed_id);
      // Endpoint POR-FEED (eficiente): trae solo las no leídas de ESTE feed, paginado de a 100.
      // (El método viejo paginaba TODO el unread global newest-first y cortaba antes de llegar a
      //  los viejos del feed → no se podían pedir los más antiguos.)
      const all: Array<{ id: number; title: string | null; url: string; author: string | null; summary: string | null; published: string }> = [];
      let page = 1;
      while (true) {
        const entries = await apiFetch(`/feeds/${targetFeedId}/entries.json?read=false&per_page=100&page=${page}`, e) as Array<{ id: number; title: string | null; url: string; author: string | null; summary: string | null; published: string }>;
        if (!Array.isArray(entries) || entries.length === 0) break;
        all.push(...entries.map(en => ({ id: en.id, title: en.title, url: en.url, author: en.author, summary: en.summary, published: en.published })));
        if (entries.length < 100) break;
        page++;
        if (page > 50) break; // tope de seguridad (≤5000 entradas)
      }
      all.sort((x, y) => order === 'oldest'
        ? new Date(x.published).getTime() - new Date(y.published).getTime()
        : new Date(y.published).getTime() - new Date(x.published).getTime());
      const slice = all.slice(offset, offset + limit);
      return { feed_id: targetFeedId, total_unread: all.length, order, offset, returned: slice.length, entries: slice };
    }
    case 'getEntriesByTag': {
      const limit = (a.limit as number) ?? 50;
      const taggings = await apiFetch('/taggings.json', e) as Array<{ feed_id: number; name: string }>;
      const tagLower = (a.tag as string).toLowerCase();
      const feedIdSet = new Set(taggings.filter(t => t.name.toLowerCase().includes(tagLower)).map(t => t.feed_id));
      if (feedIdSet.size === 0) return [];
      const results: Array<{ id: number; feed_id: number; title: string | null; url: string; summary: string | null; published: string }> = [];
      let page = 1;
      while (true) {
        const entries = await apiFetch(`/entries.json?read=false&per_page=1000&page=${page}`, e) as Array<{ id: number; feed_id: number; title: string | null; url: string; author: string | null; summary: string | null; published: string }>;
        if (entries.length === 0) break;
        results.push(...entries.filter(en => feedIdSet.has(en.feed_id)).map(en => ({ id: en.id, feed_id: en.feed_id, title: en.title, url: en.url, summary: en.summary, published: en.published })));
        if (entries.length < 1000) break;
        page++;
      }
      return results.sort((a, b) => new Date(b.published).getTime() - new Date(a.published).getTime());
    }
    case 'markFeedRead': {
      const targetFeedId = Number(a.feed_id);
      const allIds: number[] = [];
      let page = 1;
      while (true) {
        const entries = await apiFetch(`/entries.json?read=false&per_page=1000&page=${page}`, e) as Array<{ id: number; feed_id: number }>;
        if (entries.length === 0) break;
        allIds.push(...entries.filter(en => en.feed_id === targetFeedId).map(en => en.id));
        if (entries.length < 1000) break;
        page++;
      }
      if (allIds.length === 0) return { marked: 0, feed_id: a.feed_id };
      await apiDelete('/unread_entries.json', e, { unread_entries: allIds });
      return { marked: allIds.length, feed_id: a.feed_id };
    }
    case 'markTagRead': {
      const taggings = await apiFetch('/taggings.json', e) as Array<{ feed_id: number; name: string }>;
      const tagLower = (a.tag as string).toLowerCase();
      const feedIdSet = new Set(taggings.filter(t => t.name.toLowerCase().includes(tagLower)).map(t => t.feed_id));
      if (feedIdSet.size === 0) return { marked: 0, error: `No feeds found for tag: ${a.tag}` };
      const allIds: number[] = [];
      let page = 1;
      while (true) {
        const entries = await apiFetch(`/entries.json?read=false&per_page=1000&page=${page}`, e) as Array<{ id: number; feed_id: number }>;
        if (entries.length === 0) break;
        allIds.push(...entries.filter(en => feedIdSet.has(en.feed_id)).map(en => en.id));
        if (entries.length < 1000) break;
        page++;
      }
      if (allIds.length === 0) return { marked: 0, tag: a.tag };
      await apiDelete('/unread_entries.json', e, { unread_entries: allIds });
      return { marked: allIds.length, tag: a.tag, feeds_affected: feedIdSet.size };
    }
    case 'getReadEntriesByFeed': {
      const limit = (a.limit as number) ?? 50;
      const page = (a.page as number) ?? 1;
      const entries = await apiFetch(`/entries.json?read=true&feed_id=${a.feed_id}&per_page=${Math.min(limit, 1000)}&page=${page}`, e) as Array<{ id: number; feed_id: number; title: string | null; url: string; author: string | null; summary: string | null; published: string }>;
      return entries.map(en => ({ id: en.id, title: en.title, url: en.url, author: en.author, summary: en.summary, published: en.published }));
    }
    case 'getReadEntriesByTag': {
      const limit = (a.limit as number) ?? 50;
      const page = (a.page as number) ?? 1;
      const taggings = await apiFetch('/taggings.json', e) as Array<{ feed_id: number; name: string }>;
      const tagLower = (a.tag as string).toLowerCase();
      const feedIds = taggings.filter(t => t.name.toLowerCase().includes(tagLower)).map(t => t.feed_id);
      if (feedIds.length === 0) return [];
      const results: Array<{ id: number; feed_id: number; title: string | null; url: string; summary: string | null; published: string }> = [];
      for (const feedId of feedIds) {
        const entries = await apiFetch(`/entries.json?read=true&feed_id=${feedId}&per_page=${Math.min(limit, 1000)}&page=${page}`, e) as Array<{ id: number; feed_id: number; title: string | null; url: string; author: string | null; summary: string | null; published: string }>;
        results.push(...entries.map(en => ({ id: en.id, feed_id: en.feed_id, title: en.title, url: en.url, summary: en.summary, published: en.published })));
      }
      return results.sort((a, b) => new Date(b.published).getTime() - new Date(a.published).getTime());
    }
    case 'getStarredEntries': {
      const limit = (a.limit as number) ?? 50;
      const ids = await apiFetch('/starred_entries.json', e) as number[];
      if (ids.length === 0) return { total: 0, entries: [] };
      // /starred_entries.json devuelve solo IDs (sin orden de fecha garantizado) → traer las
      // entradas en lotes de 100 (límite de Feedbin) y ordenar por publicación descendente.
      const entries: Array<{ id: number; feed_id: number; title: string | null; url: string; author: string | null; summary: string | null; published: string }> = [];
      for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100);
        const part = await apiFetch(`/entries.json?ids=${chunk.join(',')}&per_page=100`, e) as typeof entries;
        entries.push(...part);
      }
      entries.sort((x, y) => new Date(y.published).getTime() - new Date(x.published).getTime());
      return {
        total: ids.length,
        entries: entries.slice(0, limit).map(en => ({ id: en.id, feed_id: en.feed_id, title: en.title, url: en.url, author: en.author, summary: en.summary, published: en.published })),
      };
    }
    case 'starEntries':
      await apiFetch('/starred_entries.json', e, { method: 'POST', body: JSON.stringify({ starred_entries: a.ids }) });
      return { ok: true, starred: (a.ids as number[]).length };
    case 'unstarEntries':
      await apiDelete('/starred_entries.json', e, { starred_entries: a.ids });
      return { ok: true, unstarred: (a.ids as number[]).length };
    case 'createTagging':
      return apiFetch('/taggings.json', e, { method: 'POST', body: JSON.stringify({ feed_id: a.feed_id, name: a.name }) });
    case 'deleteTagging': {
      const auth = btoa(`${e.FEEDBIN_USERNAME}:${e.FEEDBIN_PASSWORD}`);
      const res = await fetch(`${BASE}/taggings/${a.tagging_id}.json`, {
        method: 'DELETE',
        headers: { Authorization: `Basic ${auth}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok && res.status !== 204) throw new Error(`Feedbin DELETE tagging ${res.status}`);
      return { ok: true, deleted: a.tagging_id };
    }
    case 'renameTag':
      return apiFetch('/tags.json', e, { method: 'POST', body: JSON.stringify({ old_name: a.old_name, new_name: a.new_name }) });
    case 'deleteTag':
      await apiDelete('/tags.json', e, { name: a.name });
      return { ok: true, name: a.name };
    case 'deleteSubscription': {
      const auth = btoa(`${e.FEEDBIN_USERNAME}:${e.FEEDBIN_PASSWORD}`);
      const res = await fetch(`${BASE}/subscriptions/${a.subscription_id}.json`, {
        method: 'DELETE',
        headers: { Authorization: `Basic ${auth}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok && res.status !== 204) throw new Error(`Feedbin DELETE subscription ${res.status}`);
      return { ok: true, deleted: a.subscription_id };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export default {
  fetch(req: Request, env: Env): Promise<Response> {
    return handleMcp(req, env, TOOLS, 'feedbin', dispatchTool);
  },
} satisfies ExportedHandler<Env>;
