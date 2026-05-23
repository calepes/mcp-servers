# mcp-spark

MCP stdio server que envuelve [Spark CLI](https://sparkmailapp.com/help/spark-cli) — el cliente IPC del app de Spark Desktop (Readdle).

## Requirements

- macOS con Spark Desktop instalado (`brew install --cask readdle-spark`)
- Binario `spark` en `/opt/homebrew/bin/spark` (symlink al binario dentro del app bundle)
- Spark Desktop CLI activado: app abierta → Settings → AI Agents → "Setup CLI"

Sin Spark Desktop corriendo, todas las tools devuelven error claro indicando que la app debe estar abierta.

## Setup

```bash
cd ~/Claude\ Projects/Personal/MCP\ Servers/mcp-servers
npm install
npm -w mcp-spark run build
```

## Tools

15 tools agrupadas en read-only (11) y write (4). Las write requieren `triage` access (configurable por cuenta en Spark Desktop → Settings → AI Agents).

### Read-only

| Tool | Comando spark | Uso |
|---|---|---|
| `listAccounts` | `accounts` | Inventario de cuentas + access levels |
| `listFolders` | `folders` | Folders/labels con counts |
| `listEmails` | `emails` | List emails con filtros Gmail-style |
| `searchEmails` | `search` | Hybrid keyword+semantic con bodies |
| `readThread` | `thread` | Thread completo |
| `listEvents` | `events` | Calendar events |
| `findAvailability` | `availability` | Slots libres |
| `searchContacts` | `contacts` | Buscar contactos |
| `listTeams` | `team` | Info de teams |
| `listMeetings` | `meetings` | Transcripts list |
| `readMeeting` | `meeting` | Transcript completo |

### Write (requires triage)

| Tool | Comando spark | Uso |
|---|---|---|
| `createDraft` | `draft` | Crear/editar drafts |
| `postComment` | `comment` | Team comment en thread |
| `emailAction` | `action` | archive/pin/snooze/assign/etc |
| `contactAction` | `contact-action` | block/accept/categorize |

## Troubleshooting

**"Spark CLI can't access your Spark Desktop application"**
→ Abrir Spark Desktop. Si la app está abierta, ir a Settings → AI Agents → confirmar que "CLI" está activado.

**Write tool devuelve "requires triage access"**
→ Spark Desktop → Settings → AI Agents → subir access level de read-only a triage para esa cuenta/shared inbox.

**`/opt/homebrew/bin/spark: No such file or directory`**
→ El symlink se rompió. Recrear:
```bash
ln -sf '/Applications/Spark Desktop.app/Contents/MacOS/SparklyRemote' /opt/homebrew/bin/spark
```

## Architecture

Single file `src/index.ts` envuelve `execFile('/opt/homebrew/bin/spark', ...)`. Output passthrough — stdout va raw al LLM (Spark CLI está diseñado por Readdle para AI agents, ya viene formateado). Errores (exit !== 0) van como `isError: true` con stderr para que el LLM razone.

## Tests

```bash
npm -w mcp-spark test
```

Tests cubren el helper `runSpark` (happy path, error, timeout). Las tools son wrappers 1:1 del CLI — no se testan unitariamente; integration testing se hace contra Spark Desktop real.
