# Spec: MCP Panini Mundial 2026

**Fecha:** 2026-05-10  
**Proyecto:** MCP Panini Mundial 2026  
**Repo:** `~/Claude Projects/Personal/MCP Servers/mcp-servers/servers/panini-mundial/`

---

## Contexto

Cal y Noe están completando el álbum Panini oficial del FIFA World Cup 2026. Necesitan un MCP que permita a los agentes Vesta y Jano gestionar el seguimiento de láminas: cuáles tienen, cuáles faltan y cuáles están repetidas para intercambiar.

El álbum tiene 980 láminas en total (48 selecciones × 20 láminas + sección introductoria FWC).

---

## Modelo de datos — Notion DB

**Nombre DB:** Álbum Panini Mundial 2026  
**Ubicación:** Notion workspace de Cal (creada por `seed.ts`)

### Schema

| Campo | Tipo | Valores | Descripción |
|---|---|---|---|
| `Código` | Title | `ARG 5`, `FWC 3`, `BRA 13` | Clave única. Formato: `{CÓDIGO_FIFA} {NÚMERO}` |
| `Sección` | Select | `Introducción`, `Argentina`, `Brazil`… | Nombre de la selección o "Introducción" para FWC |
| `Descripción` | Text | `Lionel Messi — Delantero` | Nombre del jugador, "Escudo", "Foto grupal", etc. |
| `Tipo` | Select | `Normal`, `Foil` | Foil = escudos de equipo y láminas especiales FWC |
| `Cantidad` | Number | 0, 1, 2… | 0=falta, 1=tengo, ≥2=repetida para intercambio |

### Reglas de negocio
- `Cantidad = 0` → lámina faltante (nunca conseguida)
- `Cantidad = 1` → lámina obtenida (se asume pegada o por pegar)
- `Cantidad ≥ 2` → tiene repetidas disponibles para intercambiar

### Seeding (980 filas)

**Sección Introducción (20 láminas):**
- `FWC 00` — Panini Logo (Foil)
- `FWC 1` a `FWC 8` — Emblemas oficiales, mascota, slogan, balón, sedes (Canada, Mexico, USA)
- `FWC 9` a `FWC 19` — Historia del Mundial (campeones 1934–2022, Foil)

**48 selecciones × 20 láminas = 960 láminas:**

Cada selección tiene el formato `{CODE} 1` a `{CODE} 20`:
- Pos 1: Escudo del equipo (Foil)
- Pos 2–12: Jugadores (Normal)
- Pos 13: Foto grupal (Normal)
- Pos 14–20: Jugadores (Normal)

Selecciones incluidas (código FIFA → nombre):
```
ALG=Algeria, ARG=Argentina, AUS=Australia, AUT=Austria, BEL=Belgium,
BIH=Bosnia & Herzegovina, BRA=Brazil, CAN=Canada, CPV=Cape Verde,
COL=Colombia, COD=Congo DR, CRO=Croatia, CUW=Curaçao, CZE=Czechia,
ECU=Ecuador, EGY=Egypt, ENG=England, FRA=France, GER=Germany,
GHA=Ghana, HAI=Haiti, IRN=Iran, IRQ=Iraq, CIV=Ivory Coast,
JPN=Japan, JOR=Jordan, MEX=Mexico, MAR=Morocco, NED=Netherlands,
NZL=New Zealand, NOR=Norway, PAN=Panama, PAR=Paraguay, POR=Portugal,
QAT=Qatar, KSA=Saudi Arabia, SCO=Scotland, SEN=Senegal, KOR=South Korea,
ESP=Spain, SWE=Sweden, SUI=Switzerland, TUN=Tunisia, TUR=Turkey,
URU=Uruguay, USA=USA, UZB=Uzbekistan
```

*Nota: Bolivia no clasificó al Mundial 2026, por lo tanto no tiene sección en el álbum.*

---

## MCP Server

**Package:** `mcp-panini-mundial`  
**Ruta:** `servers/panini-mundial/`  
**Entry:** `src/index.ts`

### Dependencias
- `@modelcontextprotocol/sdk` (igual que otros servers del monorepo)
- `@notionhq/client`

### Variables de entorno
- `NOTION_TOKEN` — Integration token de Notion con acceso a la DB
- `PANINI_DB_ID` — ID de la DB creada por `seed.ts`

### Estructura de archivos
```
servers/panini-mundial/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts      — MCP server, registro de 7 tools
    ├── notion.ts     — wrapper Notion API (CRUD sobre la DB)
    └── seed.ts       — script one-shot para crear DB y poblar 980 filas
```

---

## Tools

### 1. `paniniProgress()`
Resumen general del álbum.

**Retorna:**
```
Total: 980 | Pegadas: 342 | Faltantes: 638 | Repetidas: 12
Progreso: 34.9%
Sección más completa: Argentina (18/20)
```

### 2. `paniniSection(section: string)`
Estado detallado de una selección o la introducción.

**Input:** nombre de selección en español o inglés, o "intro" / "introducción"  
**Retorna:** lista de las 20 láminas con código, descripción, tipo y cantidad

### 3. `paniniMissing(section?: string)`
Lista de láminas faltantes.

**Input:** sección opcional (si se omite, devuelve todas las faltantes)  
**Retorna:** lista de códigos + descripción de láminas con `Cantidad = 0`  
**Orden:** por sección, luego por número

### 4. `paniniDuplicates()`
Lista de láminas con repetidas para intercambio.

**Retorna:** lista de láminas con `Cantidad ≥ 2`, mostrando cuántas hay disponibles para dar (`Cantidad - 1`)

### 5. `paniniRegister(codes: string[])`
Registra láminas obtenidas. Suma +1 a `Cantidad` de cada código.

**Input:** array de códigos (ej. `["ARG 5", "BRA 3", "FWC 7"]`)  
**Fuente:** puede venir de texto plano parseado por el agente O de visión sobre una foto  
**Retorna:** confirmación con los códigos registrados y su nueva cantidad  
**Error handling:** si un código no existe en la DB, lo reporta sin fallar los demás

### 6. `paniniRemove(code: string)`
Corrige un registro erróneo. Resta -1 a `Cantidad` (mínimo 0).

**Input:** código único  
**Retorna:** confirmación con nueva cantidad

### 7. `paniniSearch(query: string)`
Busca láminas por nombre de jugador, sección o descripción.

**Input:** texto libre  
**Retorna:** hasta 10 resultados con código, descripción, sección y cantidad actual

---

## Flujo con foto (photo-to-register)

El MCP no recibe imágenes directamente. El flujo completo:

1. Cal manda foto al chat de Vesta o Jano
2. El agente (Claude, con visión multimodal) analiza la foto
3. El agente extrae los códigos de lámina visibles
4. El agente llama `paniniRegister(codes)` con los códigos extraídos
5. El agente confirma a Cal qué se registró

El prompt del agente debe incluir instrucción de que, ante fotos de láminas Panini, intente extraer los códigos y registrarlos automáticamente.

---

## Flujo con texto

Ejemplos de mensajes que el agente debe manejar:

- "pegué la ARG 5" → `paniniRegister(["ARG 5"])`
- "conseguí la 5, 8 y 13 de Argentina" → `paniniRegister(["ARG 5", "ARG 8", "ARG 13"])`
- "tengo repetida la BRA 3" → ya queda en `paniniRegister` si la cantidad pasa a 2
- "me equivoqué con la FRA 2" → `paniniRemove("FRA 2")`

El agente hace el parsing de lenguaje natural → llamada al tool.

---

## Wiring

### 1. Sesiones interactivas (`~/.claude/.mcp.json`)
```json
"panini-mundial": {
  "type": "stdio",
  "command": "node",
  "args": ["/Users/calepes/Claude Projects/Personal/MCP Servers/mcp-servers/servers/panini-mundial/dist/index.js"],
  "env": {
    "NOTION_TOKEN": "...",
    "PANINI_DB_ID": "..."
  }
}
```

### 2. Jano (`Jano/daemon-v2/src/agent-options.ts`)
Agregar a `mcpServers` y a `allowedTools`:
```
panini-mundial → paniniProgress, paniniSection, paniniMissing, paniniDuplicates, paniniRegister, paniniRemove, paniniSearch
```

### 3. Vesta (`family-agent-v2/src/agent-options.ts`)
Mismo patrón que Jano.

---

## Fuera de alcance (v1)

- Historial de cuándo se pegó cada lámina
- Multi-álbum (si en el futuro hay otro álbum)
- Intercambios acordados con terceros
- UI web
