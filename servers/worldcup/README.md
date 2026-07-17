# mcp-worldcup

MCP local del Mundial 2026: **datos en vivo** (API-Football v3) + **stats avanzadas
oficiales de FIFA** (Enhanced Football Intelligence) + **predicciones** (Predictor
Mundial, Python). Reemplaza los wrappers que vivían en Jano. **29 tools.**

## Tools

### Vivo — API-Football (15)

| Tool | Qué da |
|---|---|
| `getFixtures({date?})` | partidos por día (kickoffLabel ya en hora Bolivia) |
| `getStandings({group?})` | tablas de grupos |
| `getMatchDetail({fixtureId})` | resultado/estado/minuto/sede |
| `getLineups({fixtureId})` | alineaciones (~1h antes) |
| `getMatchStats({fixtureId})` | tiros, posesión, córners, xG si hay |
| `getLiveFixtures()` | partidos en vivo ahora (minuto + marcador) |
| `getMatchEvents({fixtureId})` | timeline: goles, tarjetas, cambios |
| `getPlayerStats({fixtureId})` | rating/goles/tiros/pases por jugador |
| `getTopScorers()` | goleadores (top 20) |
| `getTopAssists()` | asistentes (top 20) |
| `getInjuries({team?})` | lesionados (todos o por equipo) |
| `getH2H({teamA,teamB})` | historial entre dos selecciones |
| `getOdds({fixtureId})` | cuotas de casas (Match Winner) |
| `getApiPrediction({fixtureId})` | predicción propia de API-Football (benchmark) |
| `getSquad({team})` | plantilla de una selección |

### FIFA avanzadas — `fifa.ts` (7)

APIs JSON públicas de FIFA (`api.fifa.com/api/v3` + `fdh-api.fifa.com/v1`), sin auth.
Self-contained: resuelven el partido por nombre + fecha (o `matchId` FIFA opcional).

| Tool | Qué da |
|---|---|
| `getFifaMatchStats({teamA,teamB,date?,matchId?})` | stats avanzadas por equipo. Cada equipo trae `stats` (curado ~30 campos ES) + `stats_completas` (las 141 stats CRUDAS de FIFA — ver `getFifaStatDictionary` para resolver el nombre exacto) |
| `getFifaPlayerStats({...,top?})` | ídem por jugador: `stats` curado (~14) + `stats_completas` (112 crudas) |
| `getFifaPowerRanking({...,top?})` | power ranking: atacante/defensivo/creativo por jugador |
| `getFifaMatchTimeline({...,all?})` | cronología narrada (goles/asistencias/tarjetas/subs/VAR), vía `timelines/{matchId}` |
| `getFifaLineups({...})` | titulares/suplentes/formación/cuerpo técnico, vía `live/football/{matchId}` |
| `getFifaTeamHistory({team,opponent?,limit?})` | historial de selección + H2H parcial, vía `teamform/{idTeam}` (cobertura más pobre que `getH2H` de AF) |
| `getFifaStandings({group?})` | tabla de grupo CALCULADA desde el calendario (no hay endpoint de standings oficial) |

### Diccionario — `glossary.ts` (1)

Sin red, instantáneo. Resuelve texto libre en español al nombre crudo de FIFA dentro de
`stats_completas` (matching por raíz de palabra, tolera conjugaciones, con sinónimos
curados para verbos que no comparten prefijo con la definición). Existe para que el LLM
nunca adivine el PascalCase de FIFA a mano.

| Tool | Qué da |
|---|---|
| `getFifaStatDictionary({query,top?})` | candidatos `[{name,label,def,category,score}]` para un stat pedido en criollo |

### Reportes consolidados — `report.ts` (2)

Juntan API-Football + FIFA en una sola llamada y traen un campo `_comoPresentar` con
el framework de narración (patrón `mcp-consumer-pattern`) → el LLM produce el mismo
formato sin pedírselo.

| Tool | Qué da |
|---|---|
| `getMatchReport({teamA,teamB,date?,matchId?})` | ANÁLISIS de un partido jugado (cronología + básicas + táctico + físico + power ranking) |
| `getMatchPreview({teamA,teamB,date?,matchId?})` | PREVIA (predicción + H2H + lesiones + cuotas + alineaciones) |

### Predicción — Predictor Python, spawn (2)

| Tool | Qué da |
|---|---|
| `predictMatch({teamA,teamB})` | 1/X/2 + goles esperados + marcador probable |
| `forecastTournament({sims?})` | Monte Carlo campeón/semis + cuota implícita de mercado |

### Integración + índice (2)

| Tool | Qué da |
|---|---|
| `syncResults()` | baja resultados FT (API-Football) → `results_live.json` → el predictor se condiciona |
| `getWorldcupCapabilities()` | índice/menú categorizado de todo lo consultable (sin red) |

`syncResults` es el pegamento: escribe `results_live.json` del predictor con los
partidos jugados → `forecastTournament` simula solo lo que falta.

## Env

- **`API_FOOTBALL_KEY`** — requerido para las 15 tools de datos en vivo (+ las que las
  reusan en los reportes). **Plan Pro** en dashboard.api-football.com — el free **NO**
  da la season 2026 (solo 2022-2024). Sin key, esas tools devuelven un error claro; las
  de FIFA y predicción funcionan igual. Vive en `~/.claude/secrets/apps.env`.
- `WORLDCUP_LEAGUE_ID` (default 1), `WORLDCUP_SEASON` (default 2026) — API-Football.
- `WORLDCUP_TZ` (default `America/La_Paz`) — timezone de fixtures/kickoff.
- `WORLDCUP_FIFA_COMP` (default 17), `WORLDCUP_FIFA_SEASON` (default 285023) — FIFA.
- `PREDICTOR_DIR` (default `~/Claude Projects/Personal/Apps/Predictor Mundial`).

## Dependencias / gotchas

- **Predictor Python** en `PREDICTOR_DIR` con su `.venv` (numpy+scipy). Las tools de
  predicción spawnean `<venv>/bin/python src/{predict,simulate}.py --json`. Sin shell.
- Caché in-memory: 5 min en API-Football (protege la cuota); 12h en el calendario FIFA
  y en el mapa nombre→teamId de API-Football.
- **Timezone** se inyecta SOLO en `/fixtures` y `/fixtures/headtohead` (whitelist
  `TZ_PATHS`); los sub-endpoints por fixtureId rechazan `timezone`.
- **`kickoffLabel`** viene pre-calculado (es-BO/La_Paz) — usarlo literal, no recalcular
  el día de la semana desde el ISO.
- **No mover a edge:** FIFA bloquea IPs de datacenter (403 desde CF Worker) → debe
  quedar stdio local con IP residencial.

## Build / registro

```bash
npm -w mcp-worldcup run build   # tsc -> dist/
```

- **Jano (daemon):** wired en `BASE_OPTIONS.mcpServers` de `daemon-v2/src/index.ts`
  (el SDK librería NO lee `.mcp.json`), con las tools en `CLAUDE_AI_COS_TOOLS`.
- **Sesiones interactivas:** registrado en `~/.claude/.mcp.json` como node stdio local
  (no CF Worker — necesita filesystem + spawn de Python + IP residencial para FIFA).
