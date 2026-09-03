# Achoradazos Cobros Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir a Jano listar y crear grupos de cobro y juntes, y exigir que Cal elija ambos antes de registrar un depósito.

**Architecture:** El MCP Achoradazos conserva `registerDeposit` y los tools de creación existentes. Añade dos consultas read-only contra las tablas ya existentes. Jano expone los nuevos tools y su prompt los convierte en la única ruta previa al depósito.

**Tech Stack:** TypeScript, `@modelcontextprotocol/sdk`, Airtable REST API, Node built-in test runner, daemon Jano.

**Spec:** `docs/superpowers/specs/2026-08-27-achoradazos-cobros-design.md`

## Global Constraints

- No modificar el schema ni registros existentes de Airtable.
- No seleccionar automáticamente concepto ni junte.
- Mantener `getActiveConcepto` y `getActiveEvento` por compatibilidad, pero no usarlos para registrar depósitos.
- No reiniciar el daemon Jano sin confirmación explícita de Cal.
- No crear commits salvo pedido explícito de Cal.

---

### Task 1: Prueba de integración de las consultas MCP

**Files:**
- Create: `servers/achoradazos/test/listing-tools.test.mjs`
- Modify: `servers/achoradazos/package.json`

**Interfaces:**
- Consumes: `node servers/achoradazos/dist/index.js` mediante JSON-RPC por stdio.
- Produces: `npm -w mcp-achoradazos test`, que valida los tools read-only sin escribir en Airtable.

- [ ] **Step 1: Crear la prueba roja de tools y consultas**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";

async function callTools(calls) {
  const child = spawn("node", [new URL("../dist/index.js", import.meta.url).pathname]);
  const lines = [];
  child.stdout.on("data", chunk => lines.push(...chunk.toString().trim().split("\n").filter(Boolean)));
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1" } } }) + "\n");
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n");
  for (const call of calls) child.stdin.write(JSON.stringify(call) + "\n");
  child.stdin.end();
  await new Promise(resolve => child.on("close", resolve));
  return lines.map(JSON.parse);
}

test("lista grupos de cobro y juntes sin escribir", async () => {
  const replies = await callTools([
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "listGrupoCobros", arguments: {} } },
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "listEventos", arguments: {} } },
  ]);
  const tools = replies.find(reply => reply.id === 2).result.tools.map(tool => tool.name);
  assert.deepEqual(tools.filter(name => name.startsWith("list")), ["listPendingPayments", "listGrupoCobros", "listEventos"]);
  assert.ok(JSON.parse(replies.find(reply => reply.id === 3).result.content[0].text).every(group => group.id && group.nombre));
  assert.ok(JSON.parse(replies.find(reply => reply.id === 4).result.content[0].text).every(event => event.id && event.fecha));
});
```

- [ ] **Step 2: Agregar el script y comprobar el fallo esperado**

```json
"scripts": {
  "build": "tsc -p tsconfig.json",
  "start": "node dist/index.js",
  "test": "node --test test/*.test.mjs"
}
```

Run: `npm -w mcp-achoradazos run build && npm -w mcp-achoradazos test`

Expected: FAIL porque `listGrupoCobros` y `listEventos` aún no aparecen en `tools/list`.

### Task 2: Exponer consultas de grupos de cobro y juntes

**Files:**
- Modify: `servers/achoradazos/src/index.ts:169-281,379-421`
- Test: `servers/achoradazos/test/listing-tools.test.mjs`

**Interfaces:**
- Produces: `listGrupoCobros({ activos?: boolean }) -> Array<{id,nombre,valorUnitario,cantidad,activo}>`.
- Produces: `listEventos({ desde?: string }) -> Array<{id,nombre,fecha,lugar}>`.

- [ ] **Step 1: Añadir schemas MCP read-only**

Insertar dos definiciones en `ListToolsRequestSchema`:

```ts
{
  name: "listGrupoCobros",
  description: "Lista grupos de cobro para que Cal elija el concepto al registrar un depósito.",
  inputSchema: {
    type: "object",
    properties: { activos: { type: "boolean", description: "Filtra por estado activo; omitir para todos." } },
    required: [], additionalProperties: false,
  },
},
{
  name: "listEventos",
  description: "Lista juntes para que Cal elija la referencia operativa del depósito.",
  inputSchema: {
    type: "object",
    properties: { desde: { type: "string", description: "Filtra desde esta fecha YYYY-MM-DD; omitir para todos." } },
    required: [], additionalProperties: false,
  },
},
```

- [ ] **Step 2: Implementar consultas mínimas usando `atList` y `fieldValue`**

```ts
if (name === "listGrupoCobros") {
  const { activos } = args as { activos?: boolean };
  const records = await atList(token, TABLES.grupoCobros, {
    ...(activos === undefined ? {} : { filterByFormula: activos ? "{Activos}=TRUE()" : "NOT({Activos})" }),
    fields: [FIELDS.cobro_nombre, FIELDS.cobro_valorUnit, FIELDS.cobro_cantidad, FIELDS.cobro_activo].join(","),
  });
  return { content: [{ type: "text", text: JSON.stringify(records.map(r => ({
    id: r.id,
    nombre: fieldValue(r.fields, FIELDS.cobro_nombre, "Name"),
    valorUnitario: fieldValue(r.fields, FIELDS.cobro_valorUnit, "Valor Unitario"),
    cantidad: fieldValue(r.fields, FIELDS.cobro_cantidad, "Cantidad"),
    activo: Boolean(fieldValue(r.fields, FIELDS.cobro_activo, "Activos")),
  })), null, 2) }] };
}
```

`listEventos` consulta `Calendario Eventos` con los campos `Name`, `Inicio` y `Lugar`, orden `Inicio` descendente, y usa el mismo mapeo por `fieldValue` ya corregido. Si recibe `desde`, pasa `filterByFormula: "IS_AFTER({Inicio}, '" + desde + "')"`; no usa ese filtro cuando se omite.

- [ ] **Step 3: Ejecutar la prueba verde y typecheck**

Run: `npm -w mcp-achoradazos run build && npm -w mcp-achoradazos test`

Expected: PASS; ambos arrays contienen IDs y campos legibles de Airtable.

### Task 3: Hacer que Jano pida ambas elecciones

**Files:**
- Modify: `/Users/calepes/Claude Projects/Personal/Agents/Jano/daemon-v2/src/agent-options.ts:236-245`
- Modify: `/Users/calepes/Claude Projects/Personal/Agents/Jano/daemon-v2/src/agent.ts:123-132`
- Modify: `/Users/calepes/Claude Projects/Personal/Agents/Jano/daemon-v2/src/system-prompt.ts:680-704`

**Interfaces:**
- Consumes: `mcp__achoradazos__listGrupoCobros` and `mcp__achoradazos__listEventos`.
- Produces: una conversación que pide la elección explícita de `conceptoId` y `junteId` antes de usar `registerDeposit`.

- [ ] **Step 1: Añadir los dos nombres al allowlist y sus mensajes de progreso**

```ts
"mcp__achoradazos__listGrupoCobros",
"mcp__achoradazos__listEventos",
```

```ts
"mcp__achoradazos__listGrupoCobros": "📋 Consultando grupos de cobro...",
"mcp__achoradazos__listEventos": "📅 Consultando juntes...",
```

- [ ] **Step 2: Sustituir el paso automático del prompt**

Reemplazar el paso 3 actual por:

```md
3. Llamar `listGrupoCobros()` y `listEventos()` en paralelo. Mostrar opciones con nombre, monto/fecha e ID implícito.
4. Preguntar a Cal qué grupo de cobro y qué junte usar. Esperar su respuesta explícita; no usar `getActiveConcepto` ni `getActiveEvento` para inferirlos.
5. `uploadReceipt({ imagePath })` con el path de la imagen del comprobante.
6. `registerDeposit` únicamente con los IDs que Cal eligió.
```

- [ ] **Step 3: Compilar Jano y revisar los artefactos generados**

Run: `npm run build` desde `/Users/calepes/Claude Projects/Personal/Agents/Jano/daemon-v2`

Run: `rg -n 'listGrupoCobros|listEventos' dist/agent-options.js dist/agent.js dist/system-prompt.js`

Expected: las dos tools aparecen en los tres artefactos compilados.

### Task 4: Validación final y activación controlada

**Files:**
- Modify: `servers/achoradazos/dist/index.js` (generado por build)
- Modify: `/Users/calepes/Claude Projects/Personal/Agents/Jano/daemon-v2/dist/*.js` (generado por build)

**Interfaces:**
- Consumes: binarios compilados de Tasks 2 y 3.
- Produces: evidencia de que el MCP y la configuración compilada de Jano coinciden.

- [ ] **Step 1: Ejecutar smoke test JSON-RPC contra el binario MCP**

Run: `npm -w mcp-achoradazos test`

Expected: PASS sin escrituras Airtable.

- [ ] **Step 2: Confirmar que Jano apunta al mismo binario MCP**

Run: `rg -n 'servers/achoradazos/dist/index.js|mcp__achoradazos__listGrupoCobros|mcp__achoradazos__listEventos' /Users/calepes/Claude\ Projects/Personal/Agents/Jano/daemon-v2/dist/{index,agent-options,agent,system-prompt}.js`

Expected: el path y ambas tools están presentes.

- [ ] **Step 3: Solicitar confirmación separada antes de reiniciar producción**

No ejecutar `launchctl bootout` ni `bootstrap` sin que Cal lo pida explícitamente. Tras su confirmación, reiniciar `com.cal.cos-agent-v2` y probar por Telegram una consulta de grupos, una de juntes y un flujo de depósito detenido antes de la confirmación.
