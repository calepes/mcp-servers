# notifications

Envío de notificaciones a Cal vía Telegram (@ClaudeCalbot). Canal genérico del sistema Claude Code.

**Worker URL:** `https://mcp-notifications.carlos-cb4.workers.dev/mcp`
**MCP namespace:** `mcp__notifications__*`
**Auth:** ninguna (NOTIF_BOT_TOKEN en wrangler secrets)

**Bot:** @ClaudeCalbot — canal de notificaciones del sistema (no es un bot de agente).
**Chat ID default:** `94137698` (Cal)

## Tools

### `sendNotification`

Envía un mensaje de texto libre.

**Params:**
- `message` (string, requerido): texto del mensaje
- `chatId` (string, opcional): chat ID destino (default `94137698`)

**Returns:** `{ ok: true }`

---

### `sendNotificationWithEmoji`

Envía una notificación con formato estándar: `{emoji} {title}\n\n{message}`.

**Params:**
- `emoji` (string, requerido): emoji de cabecera (ej: `"✅"`, `"⚠️"`)
- `title` (string, requerido): título del mensaje
- `message` (string, requerido): cuerpo del mensaje
- `chatId` (string, opcional): chat ID destino (default `94137698`)

**Returns:** `{ ok: true }`

---

## Bot Availability

Este MCP es exclusivo para notificaciones del sistema Claude Code y no está en el allowlist de ningún bot de agente.

| Bot | Tools |
|-----|-------|
| Jano | — |
| Vesta | — |
| Pecunia | — |

> Usado por scripts del sistema (`~/.claude/hooks/`), crons launchd y sesiones interactivas de Claude Code. Cada bot de agente (Jano, Vesta, Pecunia) tiene su propio canal de respuesta vía Telegram Bot API directa.
