# feedbin

Gestión completa de Feedbin RSS reader: leer, marcar, buscar, suscribirse y organizar feeds.

**Worker URL:** `https://mcp-feedbin.carlos-cb4.workers.dev/mcp`
**MCP namespace:** `mcp__feedbin__*`
**Auth:** ninguna (FEEDBIN_USERNAME, FEEDBIN_PASSWORD en wrangler secrets)

## Tools

### Estructura y navegación

#### `getSubscriptions`
Lista de suscripciones activas.

**Params:** ninguno

**Returns:** array con `id` (subscription_id), `feed_id`, `title`, `feed_url`.

> ⚠️ `id` ≠ `feed_id`. Usar `id` para `deleteSubscription`, `feed_id` para todo lo demás.

---

#### `getTaggings`
Estructura de carpetas/tags: mapeo `feed_id` → nombre de carpeta. Combinar con `getSubscriptions` para listar feeds por carpeta.

**Params:** ninguno

**Returns:** `[{ feed_id: 123, name: "1. Siempre" }, ...]`

---

#### `getUnreadCount`
Número total de entradas no leídas.

**Params:** ninguno

**Returns:** `{ unreadCount: 42 }`

---

#### `getUnreadByFeed`
Conteo de entradas no leídas agrupado por `feed_id`, ordenado de más a menos unread. Útil para ver qué feeds tienen más backlog sin descargar el contenido.

**Params:** ninguno

**Returns:** `[{ feed_id: 123, unread_count: 15 }, ...]`

---

### Lectura de contenido

#### `getUnreadEntries`
IDs de entradas no leídas (sin contenido).

**Params:**
- `limit` (number, opcional): máximo de IDs a retornar (default 100)

**Returns:** `{ ids: [...], total: 150 }`

---

#### `getEntryContent`
Contenido completo de una entrada por ID (HTML completo).

**Params:**
- `id` (number, requerido): ID de la entrada

**Returns:** `{ id, feed_id, title, url, author, content, summary, published }`

> Usar `getEntriesByFeed` o `getEntriesByTag` en lugar de llamar `getEntryContent` repetidamente — devuelven resúmenes en una sola llamada.

---

#### `getEntriesByFeed`
Entradas no leídas de un feed específico con título, URL y resumen incluidos. No requiere llamadas adicionales a `getEntryContent`.

**Params:**
- `feed_id` (number, requerido): ID del feed (de `getUnreadByFeed` o `getSubscriptions`)
- `limit` (number, opcional): máximo de entradas (default 50, max 1000)

**Returns:** `[{ id, title, url, author, summary, published }, ...]` ordenado por fecha descendente.

---

#### `getEntriesByTag`
Entradas no leídas de todos los feeds de una carpeta/tag. Operación compuesta — obtiene todos los feeds de la carpeta y sus entradas en una sola llamada.

**Params:**
- `tag` (string, requerido): nombre exacto de la carpeta (ej: `"1. Siempre"`, `"4. Opcional"`)
- `limit` (number, opcional): máximo de entradas por feed (default 50)

**Returns:** `[{ id, feed_id, title, url, summary, published }, ...]` ordenado por fecha descendente global.

---

#### `searchEntries`
Busca entradas por query de texto en todo Feedbin.

**Params:**
- `query` (string, requerido): término de búsqueda

**Returns:** array de entradas coincidentes.

---

### Marcado de lectura

#### `markRead`
Marca entradas específicas como leídas.

**Params:**
- `ids` (array de number, requerido): IDs de entradas a marcar como leídas

**Returns:** `{ ok: true }`

---

#### `markUnread`
Marca entradas específicas como no leídas.

**Params:**
- `ids` (array de number, requerido): IDs de entradas

**Returns:** `{ ok: true }`

---

#### `markFeedRead`
Marca **todas** las entradas no leídas de un feed como leídas. Operación compuesta — no requiere obtener IDs previamente.

**Params:**
- `feed_id` (number, requerido): ID del feed

**Returns:** `{ marked: 45, feed_id: 123 }`

---

#### `markTagRead`
Marca **todas** las entradas no leídas de una carpeta/tag como leídas. Operación compuesta — no requiere obtener IDs previamente.

**Params:**
- `tag` (string, requerido): nombre de la carpeta (ej: `"4. Opcional"`, `"1. Siempre"`)

**Returns:** `{ marked: 120, tag: "4. Opcional", feeds_affected: 8 }`

---

### Lectura de entradas ya leídas

#### `getReadEntriesByFeed`
Entradas ya leídas de un feed específico con título, URL y resumen. Usar para recuperar artículos previamente leídos. Soporta paginación.

**Params:**
- `feed_id` (number, requerido): ID del feed (de `getSubscriptions`)
- `limit` (number, opcional): máximo de entradas (default 50, max 1000)
- `page` (number, opcional): página de resultados (default 1)

**Returns:** `[{ id, title, url, author, summary, published }, ...]` ordenado por fecha descendente.

---

#### `getReadEntriesByTag`
Entradas ya leídas de todos los feeds de una carpeta/tag con título, URL y resumen. Operación compuesta en una sola llamada.

**Params:**
- `tag` (string, requerido): nombre exacto de la carpeta (ej: `"1. Siempre"`, `"4. Opcional"`)
- `limit` (number, opcional): máximo de entradas por feed (default 50)
- `page` (number, opcional): página de resultados por feed (default 1)

**Returns:** `[{ id, feed_id, title, url, summary, published }, ...]` ordenado por fecha descendente global.

---

### Gestión de suscripciones

#### `savePage`
Guarda una URL como página en Feedbin (read-later).

**Params:**
- `url` (string, requerido): URL a guardar

---

#### `addSubscription`
Suscribirse a un feed RSS/Atom por URL.

**Params:**
- `feed_url` (string, requerido): URL del feed

---

#### `deleteSubscription`
Cancela una suscripción por `subscription_id`.

**Params:**
- `subscription_id` (number, requerido): el campo `id` de `getSubscriptions` — **NO** el `feed_id`

**Returns:** `{ ok: true, deleted: 456 }`

---

## Bot Availability

| Bot | Tools |
|-----|-------|
| Jano | Todas (18 tools) |
| Vesta | — |
| Pecunia | — |
