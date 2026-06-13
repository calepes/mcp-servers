#!/usr/bin/env node
// MCP server: worldcup — Mundial 2026 (datos en vivo + predicciones)
// Datos en vivo via API-Football (env API_FOOTBALL_KEY). Predicciones via el
// Predictor Mundial (Python, spawn). syncResults conecta ambos: baja resultados
// reales y condiciona el modelo.
//
// Tools (18):
//   Vivo (API-Football): getFixtures, getStandings, getMatchDetail, getLineups,
//     getMatchStats, getLiveFixtures, getMatchEvents, getPlayerStats, getTopScorers,
//     getTopAssists, getInjuries({team?}), getH2H({teamA,teamB}), getOdds,
//     getApiPrediction, getSquad({team})
//   Predicción (spawn Python): predictMatch({teamA,teamB}), forecastTournament({sims?})
//   Integración: syncResults() — baja resultados reales → el modelo condiciona

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import {
  getFixtures, getStandings, getMatchDetail, getLineups, getMatchStats, getFinishedResults,
  getLiveFixtures, getMatchEvents, getPlayerStats, getTopScorers, getTopAssists,
  getInjuries, getH2H, getOdds, getApiPrediction, getSquad,
} from "./apifootball.js";
import { predictMatch, forecastTournament, writeResultsLive } from "./predictor.js";

const READ_ONLY = { readOnlyHint: true };
const ok = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v) }] });

const server = new Server(
  { name: "worldcup", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "getFixtures",
      description:
        "Partidos del Mundial 2026 por fecha. Args: { date?: 'YYYY-MM-DD' } (default: todos). El filtro `date`, el `kickoff` y `kickoffLabel` YA vienen en hora local de Bolivia (America/La_Paz, UTC-4) — NO reconviertas ni restes horas. Devuelve [{id, kickoff, kickoffLabel, status (NS/1H/HT/2H/FT), round, home, away, score}]. **`kickoffLabel` (ej. 'mar 16 jun · 21:00') trae día de la semana + fecha + hora ya calculados — usalo LITERAL. NUNCA calcules vos el día de la semana desde el `kickoff` (da errores).** Usar para 'qué partidos hay hoy/mañana', calendario. El `id` (fixtureId) sirve para getLineups/getMatchStats/getMatchDetail.",
      inputSchema: { type: "object", properties: { date: { type: "string" } }, additionalProperties: false },
      annotations: READ_ONLY,
    },
    {
      name: "getStandings",
      description:
        "Tablas de los grupos del Mundial 2026. Args: { group?: 'A'..'L' } (default: todos). Devuelve por grupo [{rank, team, played, points, gd}]. Usar para 'cómo va el grupo X', clasificación, posiciones.",
      inputSchema: { type: "object", properties: { group: { type: "string" } }, additionalProperties: false },
      annotations: READ_ONLY,
    },
    {
      name: "getMatchDetail",
      description:
        "Detalle de un partido: resultado, estado, minuto, sede. Args: { fixtureId } (del getFixtures). Usar para el marcador/estado de un partido puntual.",
      inputSchema: { type: "object", properties: { fixtureId: { type: "number" } }, required: ["fixtureId"], additionalProperties: false },
      annotations: READ_ONLY,
    },
    {
      name: "getLineups",
      description:
        "Alineaciones de un partido (titulares + suplentes + formación). Args: { fixtureId }. Suelen publicarse ~1h antes del partido. Usar para 'quién juega', 'alineación de X'.",
      inputSchema: { type: "object", properties: { fixtureId: { type: "number" } }, required: ["fixtureId"], additionalProperties: false },
      annotations: READ_ONLY,
    },
    {
      name: "getMatchStats",
      description:
        "Estadísticas de un partido (tiros, posesión, corners, xG si está disponible). Args: { fixtureId }. Disponibles durante/después del partido. Usar para 'estadísticas de X', 'cuánta posesión tuvo Y'.",
      inputSchema: { type: "object", properties: { fixtureId: { type: "number" } }, required: ["fixtureId"], additionalProperties: false },
      annotations: READ_ONLY,
    },
    {
      name: "getLiveFixtures",
      description:
        "Partidos del Mundial EN VIVO ahora mismo (minuto + marcador). Sin args. Usar para '¿qué se está jugando?', 'partidos en vivo', 'cómo va el partido ahorita'.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: READ_ONLY,
    },
    {
      name: "getMatchEvents",
      description:
        "Timeline de un partido: goles, tarjetas, cambios minuto a minuto. Args: { fixtureId }. Usar para 'qué pasó en el partido', 'quién metió los goles', 'a qué minuto'.",
      inputSchema: { type: "object", properties: { fixtureId: { type: "number" } }, required: ["fixtureId"], additionalProperties: false },
      annotations: READ_ONLY,
    },
    {
      name: "getPlayerStats",
      description:
        "Rendimiento por jugador en un partido (rating, goles, asistencias, tiros, pases, minutos). Args: { fixtureId }. Usar para 'quién fue el mejor', 'cómo jugó X', ratings individuales.",
      inputSchema: { type: "object", properties: { fixtureId: { type: "number" } }, required: ["fixtureId"], additionalProperties: false },
      annotations: READ_ONLY,
    },
    {
      name: "getTopScorers",
      description:
        "Goleadores del Mundial (top 20, botín de oro). Sin args. Usar para '¿quién va goleando?', 'máximo goleador', 'tabla de goleadores'.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: READ_ONLY,
    },
    {
      name: "getTopAssists",
      description:
        "Asistentes del Mundial (top 20). Sin args. Usar para '¿quién da más asistencias?', 'tabla de asistencias'.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: READ_ONLY,
    },
    {
      name: "getInjuries",
      description:
        "Lesionados del Mundial. Args: { team? } (nombre en inglés; sin él, todos). Usar para 'lesionados de X', 'quién no juega por lesión', 'bajas'.",
      inputSchema: { type: "object", properties: { team: { type: "string" } }, additionalProperties: false },
      annotations: READ_ONLY,
    },
    {
      name: "getH2H",
      description:
        "Historial entre dos selecciones (head-to-head): resumen de victorias + últimos partidos. Args: { teamA, teamB } en inglés. Usar para 'historial X vs Y', 'cómo les ha ido contra'.",
      inputSchema: { type: "object", properties: { teamA: { type: "string" }, teamB: { type: "string" } }, required: ["teamA", "teamB"], additionalProperties: false },
      annotations: READ_ONLY,
    },
    {
      name: "getOdds",
      description:
        "Cuotas de casas de apuestas para un partido (Match Winner). Args: { fixtureId }. Usar para 'cuánto paga X', 'cuotas del partido', mercado de apuestas.",
      inputSchema: { type: "object", properties: { fixtureId: { type: "number" } }, required: ["fixtureId"], additionalProperties: false },
      annotations: READ_ONLY,
    },
    {
      name: "getApiPrediction",
      description:
        "Predicción propia de API-Football para un partido (% local/empate/visita + consejo). Args: { fixtureId }. Útil como benchmark contra nuestro predictMatch. Usar si Cal quiere comparar predicciones.",
      inputSchema: { type: "object", properties: { fixtureId: { type: "number" } }, required: ["fixtureId"], additionalProperties: false },
      annotations: READ_ONLY,
    },
    {
      name: "getSquad",
      description:
        "Plantilla completa de una selección (jugadores, número, posición, edad). Args: { team } en inglés. Usar para 'plantel de X', 'lista de convocados', 'quiénes están en la selección'.",
      inputSchema: { type: "object", properties: { team: { type: "string" } }, required: ["team"], additionalProperties: false },
      annotations: READ_ONLY,
    },
    {
      name: "predictMatch",
      description:
        "Predice un partido (modelo Elo+mercado+valor calibrado). Args: { teamA, teamB } en INGLÉS canónico ('Spain','Brazil','DR Congo','South Korea','USA','Ivory Coast'). Traducir del español. Devuelve p_a/p_draw/p_b (1/X/2), xg_a/xg_b (goles esperados), ml (marcador más probable), top5. El 1/X/2 es lo confiable; el marcador exacto es solo el más probable (~15%).",
      inputSchema: { type: "object", properties: { teamA: { type: "string" }, teamB: { type: "string" } }, required: ["teamA", "teamB"], additionalProperties: false },
      annotations: READ_ONLY,
    },
    {
      name: "forecastTournament",
      description:
        "Pronóstico del torneo completo (Monte Carlo, bracket FIFA real). Args: { sims? } (1000-50000, default 10000). Devuelve top-16 de campeón/finalista/semifinalista con p (modelo) y market (cuota implícita). Si ya hay resultados sincronizados (syncResults), condiciona sobre ellos. El modelo corre más caliente que el mercado en favoritos (postura propia).",
      inputSchema: { type: "object", properties: { sims: { type: "number" } }, additionalProperties: false },
      annotations: READ_ONLY,
    },
    {
      name: "syncResults",
      description:
        "Baja los partidos del Mundial ya jugados (API-Football) y los escribe para que el predictor SE CONDICIONE sobre resultados reales (simula solo lo que falta). Llamar antes de forecastTournament para un pronóstico actualizado a mitad de torneo. Devuelve { synced: n }.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;
  const a = (request.params.arguments ?? {}) as Record<string, unknown>;
  try {
    switch (name) {
      case "getFixtures": return ok(await getFixtures(a.date as string | undefined));
      case "getStandings": return ok(await getStandings(a.group as string | undefined));
      case "getMatchDetail": return ok(await getMatchDetail(a.fixtureId as number));
      case "getLineups": return ok(await getLineups(a.fixtureId as number));
      case "getMatchStats": return ok(await getMatchStats(a.fixtureId as number));
      case "getLiveFixtures": return ok(await getLiveFixtures());
      case "getMatchEvents": return ok(await getMatchEvents(a.fixtureId as number));
      case "getPlayerStats": return ok(await getPlayerStats(a.fixtureId as number));
      case "getTopScorers": return ok(await getTopScorers());
      case "getTopAssists": return ok(await getTopAssists());
      case "getInjuries": return ok(await getInjuries(a.team as string | undefined));
      case "getH2H": return ok(await getH2H(a.teamA as string, a.teamB as string));
      case "getOdds": return ok(await getOdds(a.fixtureId as number));
      case "getApiPrediction": return ok(await getApiPrediction(a.fixtureId as number));
      case "getSquad": return ok(await getSquad(a.team as string));
      case "predictMatch": return ok(predictMatch(a.teamA as string, a.teamB as string));
      case "forecastTournament": return ok(forecastTournament(a.sims as number | undefined));
      case "syncResults": {
        const r = await getFinishedResults();
        if ("error" in r) return ok(r);
        const synced = writeResultsLive(r.played);
        return ok({ synced, note: synced ? "Modelo condicionado sobre resultados reales." : "Aún no hay partidos terminados." });
      }
      default:
        return { isError: true, content: [{ type: "text" as const, text: `Unknown tool: ${name}` }] };
    }
  } catch (err) {
    return { isError: true, content: [{ type: "text" as const, text: `Error en ${name}: ${(err as Error).message}` }] };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("worldcup MCP server ready");
