# mcp-worldcup

MCP local del Mundial 2026: **datos en vivo** (API-Football) + **predicciones**
(Predictor Mundial, Python). Reemplaza los wrappers que vivían en Jano.

## Tools

| Tool | Fuente | Qué da |
|---|---|---|
| `getFixtures({date?})` | API-Football | partidos por día |
| `getStandings({group?})` | API-Football | tablas de grupos |
| `getMatchDetail({fixtureId})` | API-Football | resultado/estado/minuto |
| `getLineups({fixtureId})` | API-Football | alineaciones (~1h antes) |
| `getMatchStats({fixtureId})` | API-Football | tiros, posesión, xG si hay |
| `predictMatch({teamA,teamB})` | Predictor (spawn) | 1/X/2 + marcadores |
| `forecastTournament({sims?})` | Predictor (spawn) | Monte Carlo campeón/semis + mercado |
| `syncResults()` | ambos | baja resultados reales → condiciona el modelo |

`syncResults` es el pegamento: escribe `results_live.json` del predictor con los
partidos jugados (API-Football) → `forecastTournament` simula solo lo que falta.

## Env

- **`API_FOOTBALL_KEY`** — requerido para las 5 tools de datos en vivo. Free tier
  (100 req/día) en dashboard.api-football.com. Sin key, esas tools devuelven un
  error claro; las de predicción funcionan igual. Vive en `~/.claude/secrets/apps.env`.
- `WORLDCUP_LEAGUE_ID` (default 1), `WORLDCUP_SEASON` (default 2026) — opcionales.
- `PREDICTOR_DIR` (default `~/Claude Projects/Personal/Apps/Predictor Mundial`).

## Dependencias

- **Predictor Python** en `PREDICTOR_DIR` con su `.venv` (numpy+scipy). Las tools de
  predicción spawnnean `<venv>/bin/python src/{predict,simulate}.py --json`. Sin shell.
- Caché in-memory 5 min en el cliente API-Football (protege la cuota de 100 req/día).

## Build / registro

```bash
npm run build   # tsc -> dist/
```

- **Jano (daemon):** wired en `BASE_OPTIONS.mcpServers` de `daemon-v2/src/index.ts`
  (el SDK librería NO lee `.mcp.json`), con las 8 tools en `CLAUDE_AI_COS_TOOLS`.
- **Sesiones interactivas:** registrado en `~/.claude/.mcp.json` como node stdio local
  (no CF Worker — necesita filesystem + spawn de Python).
