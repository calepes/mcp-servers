# agent-learnings

Sistema de aprendizajes persistentes por agente. Guarda y recupera lecciones aprendidas entre sesiones, almacenadas en Cloudflare KV.

**Worker URL:** `https://mcp-agent-learnings.carlos-cb4.workers.dev/mcp`
**MCP namespace:** `mcp__agent-learnings__*`
**Auth:** ninguna (namespace KV protegido a nivel de wrangler)

## Agentes soportados

`jano`, `vesta`, `pecunia`

## Tools

### `addLearning`

Guarda un aprendizaje persistente para futuras sesiones del agente. Cada entry se guarda con timestamp `[YYYY-MM-DD]`.

**Params:**
- `agent` (string `"jano"|"vesta"|"pecunia"`, requerido): nombre del agente
- `text` (string 5–500 chars, requerido): texto del aprendizaje

**Returns:** `{ ok: true, agent: "jano" }` o `{ ok: false, reason: "Unknown agent: X" }`

---

### `getLearnings`

Retorna todos los aprendizajes guardados de un agente como texto Markdown con lista de bullet points.

**Params:**
- `agent` (string `"jano"|"vesta"|"pecunia"`, requerido): nombre del agente

**Returns:**
```json
{
  "agent": "jano",
  "learnings": "\n- [2026-05-01] Texto del aprendizaje\n- [2026-05-03] Otro aprendizaje"
}
```

---

## Bot Availability

| Bot | Tools |
|-----|-------|
| Jano | `addLearning` |
| Vesta | `addLearning` |
| Pecunia | `addLearning` |

> `getLearnings` está disponible en el worker pero no figura en el allowlist de ningún bot. Está reservado para uso administrativo o debugging.
