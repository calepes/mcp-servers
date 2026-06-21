# Spark MCP Server — Design Spec

**Status:** Approved (Cal, 2026-05-23)
**Author:** Cal + Claude
**Scope:** Wrap Spark CLI (Readdle Spark Desktop IPC client) as an MCP stdio server. Initial consumer: Jano (CoS daemon). Vesta/Pecunia pueden adoptar después sin refactor.

## Contexto

Spark Desktop (Readdle) instalado en macOS expone email + calendar + contactos vía un binario IPC: `/opt/homebrew/bin/spark` (symlink a `/Applications/Spark Desktop.app/Contents/MacOS/SparklyRemote`). El CLI fue **diseñado por Readdle explícitamente para agentes AI** — su output ya viene formateado para LLMs (tablas, IDs claros, headers consistentes, instrucciones de error con remediation).

Jano (daemon Node con `@anthropic-ai/claude-agent-sdk`) tiene `Bash` en `DISALLOWED_BUILTINS` por seguridad. No puede invocar `spark` directamente. Necesita un MCP wrapper.

## Objetivo

Exponer las 15 capacidades de Spark CLI como tools MCP (`mcp__spark__*`) consumibles por agentes Cal. Mantener output passthrough sin re-formateo — el CLI ya está optimizado para LLMs.

## No-objetivos

- No es un wrapper de la API REST de Spark (no existe — Spark es IPC-only)
- No replica funcionalidad del MCP heredado de Gmail (`mcp__claude_ai_Gmail__*`) — Spark expone *múltiples cuentas* (Lepesqueur + Gmail) unificadas, además de calendar y contactos
- No persiste estado propio — todo passthrough al desktop running
- **No migrable a Cloudflare Workers** — Spark CLI es IPC local al Spark Desktop app. Se suma a la lista de MCPs Mac-only (junto con `apple-reminders` y `youtube-transcribe`). Si Pecunia migra a Durable Object (Fase 2 del spec pecunia-cloud), pierde acceso a Spark; decisión de ese spec, no de este.

## Arquitectura

```
~/Claude Projects/Personal/MCP Servers/mcp-servers/
└── servers/
    └── spark/
        ├── package.json          # workspace member (npm workspaces del monorepo)
        ├── tsconfig.json         # extends ../../tsconfig.base.json
        ├── src/
        │   ├── index.ts          # MCP server entrypoint (stdio transport)
        │   ├── tools.ts          # 15 tool definitions
        │   └── runner.ts         # execFile helper: spawn + timeout + error mapping
        └── README.md
```

**Transport:** stdio (estándar para MCPs en el monorepo).
**Runtime:** Node 20+ (heredado del monorepo).
**Dependencias:** `@modelcontextprotocol/sdk` (ya en el monorepo). Sin Zod — schemas mínimos JSON-schema directos.

## Componentes

### `runner.ts`
Helper único:
```ts
async function runSpark(args: string[], opts?: { timeout?: number }): Promise<{ stdout: string; stderr: string; exitCode: number }>
```
- `execFile('/opt/homebrew/bin/spark', args, { timeout: opts?.timeout ?? 30_000 })`
- Captura stdout + stderr + exit code
- No throw — error handling sube al tool wrapper

### `tools.ts`
15 funciones tool, cada una:
1. Define `name`, `description`, `inputSchema`
2. Recibe args, los traduce a array `[command, ...flags]` para `spark`
3. Llama `runSpark()`
4. Mapea resultado:
   - `exitCode === 0` → `{ content: [{ type: 'text', text: stdout }] }`
   - `exitCode !== 0` → `{ isError: true, content: [{ type: 'text', text: stderr || stdout }] }`

### `index.ts`
Boilerplate MCP estándar del monorepo: crea `Server`, registra `list_tools` y `call_tool` handlers contra `tools.ts`, conecta stdio transport.

## Inventario de tools

### Read-only (11) — habilitadas inmediatamente

| Tool | Comando spark | Args principales |
|---|---|---|
| `listAccounts` | `accounts` | — |
| `listFolders` | `folders` | `account?` |
| `listEmails` | `emails [folder]` | `folder?`, `filter?`, `page?`, `pageSize?`, `order?`, `newSenders?` |
| `searchEmails` | `search <about>` | `about` (req), `filter?`, `in?` |
| `readThread` | `thread <id>` | `id` (req), `downloadAttachments?` |
| `listEvents` | `events` | `from?`, `to?`, `account?`, `calendar?` |
| `findAvailability` | `availability` | `from`, `to`, `duration`, `attendees?` |
| `searchContacts` | `contacts <query>` | `query` (req) |
| `listTeams` | `team` | `team?` |
| `listMeetings` | `meetings` | `from?`, `to?` |
| `readMeeting` | `meeting <id>` | `id` (req) |

### Write (4) — requieren `triage` access (devolverán error natural hasta que Cal active)

| Tool | Comando spark | Args principales |
|---|---|---|
| `createDraft` | `draft` | `to?`, `cc?`, `bcc?`, `subject?`, `body?`, `account?`, `replyTo?`, `forward?`, `edit?`, `attach?` |
| `postComment` | `comment <threadId>` | `threadId` (req), `body`, `team?`, `users?`, `attach?` |
| `emailAction` | `action <action> <messageId>` | `action` (req: archive\|pin\|snooze\|assign\|...), `messageId` (req), `args?` |
| `contactAction` | `contact-action <action> <email>` | `action` (req: block\|accept\|categorize\|...), `email` (req), `args?` |

## Decisiones técnicas

### 1. Output passthrough raw
- **Decisión:** devolver `stdout` del CLI tal cual como `text` content block
- **Por qué:** Spark CLI fue diseñado por Readdle para AI agents — formato ya optimizado (tablas con IDs en columna fija, headers consistentes, errores con remediation embebida)
- **Trade-off:** los agentes deben leer texto humano-friendly en lugar de JSON estructurado. Aceptable porque LLMs lo parsean nativamente y evitamos drift de schema si Readdle actualiza el CLI

### 2. Sin Zod, schemas JSON mínimos
- Cada parámetro = `{ type: 'string', description: '...' }`. Booleanos donde aplique.
- El CLI valida sus propios argumentos; si algo falla, stderr fluye al LLM
- Mantiene el código corto (< 300 líneas total)

### 3. Timeout 30s default, override por tool
- `searchEmails` y `listEvents` pueden tardar (semantic search, calendar fetch)
- Configurable via parámetro `timeout` opcional por tool si llega a ser problema
- No agregar env var ahora — YAGNI

### 4. Error mapping nativo
- `exitCode !== 0` → `isError: true` con stderr crudo
- Cubre los casos:
  - "Spark CLI can't access your Spark Desktop application" → user debe abrir Spark Desktop
  - "Requires triage access" → user debe subir level en Settings
  - Argumentos malformados → guidance del CLI
- El LLM puede leer el mensaje y guiar al user

### 5. Naming: camelCase
- `mcp__spark__listEmails`, no `mcp__spark__list-emails` ni `mcp__spark__emails`
- Matchea convención de otros MCPs custom del monorepo (apple-reminders usa `listReminders`, feedbin usa `getUnreadCount`)

### 6. Binary path hardcoded
- `/opt/homebrew/bin/spark` (Apple Silicon) hardcoded en `runner.ts`
- Comentario: si se rompe (path change), revisar symlink
- No env var override — YAGNI; agregar si Vesta/Pecunia corren en otro Mac con setup distinto

### 7. Sin caching
- Spark Desktop ya es la fuente de verdad y maneja caching interno
- Re-llamar es O(IPC), no O(network)

## Wire en Jano

En `~/Claude Projects/Personal/Agents/Jano/daemon-v2/src/agent-options.ts`:

```ts
// 1. Agregar al objeto mcpServers de BASE_OPTIONS
spark: {
  type: 'stdio',
  command: 'node',
  args: ['/Users/calepes/Claude Projects/Personal/MCP Servers/mcp-servers/servers/spark/dist/index.js'],
}

// 2. Agregar las 15 tools a CLAUDE_AI_COS_TOOLS allowlist
'mcp__spark__listAccounts',
'mcp__spark__listFolders',
'mcp__spark__listEmails',
'mcp__spark__searchEmails',
'mcp__spark__readThread',
'mcp__spark__listEvents',
'mcp__spark__findAvailability',
'mcp__spark__searchContacts',
'mcp__spark__listTeams',
'mcp__spark__listMeetings',
'mcp__spark__readMeeting',
'mcp__spark__createDraft',
'mcp__spark__postComment',
'mcp__spark__emailAction',
'mcp__spark__contactAction',
```

En `~/Claude Projects/Personal/Agents/Jano/daemon-v2/src/system-prompt.ts`:
- Nueva sección "Spark (email + calendar)" con:
  - Cuándo usar Spark vs Gmail MCP heredado (Spark = unified inbox + calendar nativo + contactos; Gmail MCP = solo Gmail labels)
  - Ejemplos de queries comunes: "qué emails urgentes" → `listEmails --filter "is:unread newer_than:1d"`, "agenda mañana" → `listEvents`
  - Gotcha: cuentas en read-only, drafts/actions fallan hasta activar triage
  - Folder identifier formats (bare name, email, email:Folder, Team Name)

## Documentación adicional

- `~/Claude Projects/Personal/MCP Servers/mcp-servers/servers/spark/README.md` — setup local (Spark Desktop running, CLI toggle activado), troubleshooting comunes, lista de tools
- Update `~/Claude Projects/Personal/MCP Servers/mcp-servers/CLAUDE.md` con entrada en tabla de MCPs custom
- `~/Claude Projects/Personal/Agents/Jano/docs/decisions/2026-05-23-spark-mcp-integration.md` — decisión técnica (3 alternativas, elegida, trade-offs) usando formato de Decision Capture del Paweł Model

## Plan de validación (post-implementación)

1. `npm -w mcp-spark run build` — compila sin errores
2. `echo '{}' | node servers/spark/dist/index.js` — server arranca, responde a stdio (smoke test)
3. Reiniciar daemon Jano (`launchctl bootout` + `bootstrap`)
4. Verificar en `/Users/calepes/.cos-agent/logs/agent.log` que el MCP arranca sin "permissions not granted"
5. Vía Telegram a Jano: "qué emails me llegaron hoy" → debe invocar `mcp__spark__listEmails` con filter
6. Vía Telegram a Jano: "qué tengo mañana en el calendario" → debe invocar `mcp__spark__listEvents`
7. Vía Telegram: "busca emails sobre Yape" → debe invocar `mcp__spark__searchEmails`
8. Tool de write (`createDraft`): debe devolver error claro indicando que necesita triage access

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Spark Desktop crashea / no corre | Error claro del CLI; user debe relanzar app |
| Cal cambia paths del Spark.app (rename) | symlink en `/opt/homebrew/bin/spark` rompe; documentar en README cómo re-linkear |
| Readdle cambia output format del CLI | Passthrough raw → LLM se adapta. Si rompe drásticamente, agregar parsing por comando |
| CLI requiere update post macOS upgrade | Actualizar Spark Desktop desde App Store, re-activar CLI toggle si se desactiva |
| Drift entre versiones de Spark Desktop (e.g. nuevos comandos) | `spark skill > ~/.claude/skills/use-spark/SKILL.md` periódicamente para refrescar referencia |

## Out of scope (futuro)

- Wire en Vesta (familia): puede tener sentido para "qué tareas familiares mandó Noe por email"
- Wire en Pecunia: probable que NO — finanzas tienen mejor signal en notifs de banco
- Auto-archive de newsletters via `emailAction` triggered por reglas
- Sync de meetings transcripts a Notion (combinando `listMeetings` + Notion MCP)
