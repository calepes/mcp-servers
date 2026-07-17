#!/usr/bin/env node
// MCP server: worldcup — Mundial 2026 (datos en vivo + predicciones)
// Datos en vivo via API-Football (env API_FOOTBALL_KEY). Predicciones via el
// Predictor Mundial (Python, spawn). syncResults conecta ambos: baja resultados
// reales y condiciona el modelo.
//
// Tools (29):
//   Vivo (API-Football): getFixtures, getStandings, getMatchDetail, getLineups,
//     getMatchStats, getLiveFixtures, getMatchEvents, getPlayerStats, getTopScorers,
//     getTopAssists, getInjuries({team?}), getH2H({teamA,teamB}), getOdds,
//     getApiPrediction, getSquad({team})
//   FIFA avanzadas (api.fifa.com + fdh-api, sin scraping): getFifaMatchStats,
//     getFifaPlayerStats, getFifaPowerRanking — Enhanced Football Intelligence
//   FIFA calendario/eventos/plantillas (api.fifa.com, sin AF): getFifaMatchTimeline,
//     getFifaLineups, getFifaTeamHistory({team,opponent?}), getFifaStandings({group?})
//   Reportes consolidados (AF+FIFA, con framework de narración `_comoPresentar`):
//     getMatchReport (partido jugado), getMatchPreview (previa)
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
import {
  getFifaMatchStats, getFifaPlayerStats, getFifaPowerRanking,
  getFifaMatchTimeline, getFifaLineups, getFifaTeamHistory, getFifaStandings,
} from "./fifa.js";
import { searchGlossary } from "./glossary.js";
import { getMatchReport, getMatchPreview } from "./report.js";

const READ_ONLY = { readOnlyHint: true };
const ok = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v) }] });

// Índice de capacidades — qué puede mostrar el MCP worldcup sobre el Mundial 2026.
// Estático (sin red). Lo consume getWorldcupCapabilities para que Jano responda
// "¿qué sabes del Mundial?" con un menú categorizado.
const WORLDCUP_CAPABILITIES = {
  torneo: "Copa Mundial de la FIFA 2026 (Canadá/México/EE.UU.) — 48 equipos, 12 grupos. Datos en vivo (API-Football), stats oficiales avanzadas (FIFA) y predicciones propias.",
  categorias: [
    { area: "📅 Calendario y resultados", muestra: "partidos por día, en vivo ahora, tablas de grupos, marcador/estado de un partido", ejemplos: ["¿qué partidos hay hoy?", "¿cómo va el grupo C?", "¿qué se está jugando ahora?", "resultado de México-Ecuador"] },
    { area: "🧾 Detalle de un partido", muestra: "alineaciones, estadísticas básicas, timeline de goles/tarjetas, ratings por jugador", ejemplos: ["alineación de Argentina", "estadísticas del Brasil-Japón", "¿quién metió los goles?"] },
    { area: "📊 Análisis completo (consolidado)", muestra: "ANÁLISIS de un partido jugado (cronología + básicas + táctico + físico + power ranking en uno) y PREVIA de un partido por jugar (predicción + historial + lesiones + cuotas)", ejemplos: ["analízame el Brasil-Japón", "dame la previa de Colombia-Ghana", "¿cómo jugó España?"] },
    { area: "🧠 Stats avanzadas FIFA", muestra: "Enhanced Football Intelligence: rupturas de línea, presiones, control por zona, datos físicos GPS (distancia, sprints, velocidad), power ranking atacante/defensivo/creativo", ejemplos: ["¿quién corrió más en el partido?", "stats avanzadas de Francia", "power ranking del México-Ecuador"] },
    { area: "🏆 Torneo y jugadores", muestra: "goleadores, asistentes, lesionados, plantillas, historial entre selecciones", ejemplos: ["¿quién va goleando?", "plantel de Brasil", "historial Argentina vs Brasil", "lesionados de Francia"] },
    { area: "🔮 Predicción y apuestas", muestra: "predicción propia (modelo Elo+mercado: 1/X/2, goles esperados, marcador probable), pronóstico del torneo (Monte Carlo: campeón/semis), predicción de API-Football, cuotas de casas de apuestas", ejemplos: ["¿quién gana Colombia-Ghana?", "¿quién va a ser campeón?", "cuánto paga la victoria de Brasil"] },
  ],
  _comoPresentar: "Presenta esto como un índice/menú amable de lo que puedo contar del Mundial, agrupado por las categorías (usa los emojis y un par de ejemplos de preguntas por categoría). Cierra invitando a Cal a pedir cualquiera. Adapta el largo al canal (en Telegram compacto).",
};

const server = new Server(
  { name: "worldcup", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "getFixtures",
      description:
        "Partidos del Mundial 2026 por fecha y/o equipo. Args: { date?: 'YYYY-MM-DD', team?: string (inglés, ej. 'Switzerland') } (sin filtros: todos). El filtro `date`, el `kickoff` y `kickoffLabel` YA vienen en hora local de Bolivia (America/La_Paz, UTC-4) — NO reconviertas ni restes horas. Devuelve [{id, kickoff, kickoffLabel, status (NS/1H/HT/2H/FT), round, home, away, score}]. **`kickoffLabel` (ej. 'mar 16 jun · 21:00') trae día de la semana + fecha + hora ya calculados — usalo LITERAL. NUNCA calcules vos el día de la semana desde el `kickoff` (da errores).** Usar para 'qué partidos hay hoy/mañana', calendario, o para sacar TODOS los partidos jugados/programados de un equipo con `team` (NUNCA adivines rival+fecha de memoria). El `id` (fixtureId) sirve para getLineups/getMatchStats/getMatchDetail.",
      inputSchema: { type: "object", properties: { date: { type: "string" }, team: { type: "string" } }, additionalProperties: false },
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
    {
      name: "getFifaStatDictionary",
      description:
        "Diccionario ES → nombre crudo de FIFA para las 141 stats de `stats_completas` (de getFifaMatchStats/getFifaPlayerStats). Sin red, instantáneo. Args: { query: string, top?: número (default 5) } — pasa lo que Cal pidió en criollo (ej. 'qué tanto presionaron', 'rupturas de línea bajo presión', 'sprints'). Devuelve los candidatos más parecidos [{name (el key exacto a usar en stats_completas), label, def, category, score}]. **USAR SIEMPRE antes de leer un campo de `stats_completas` que no esté ya en `stats`** — NUNCA adivines el nombre PascalCase de FIFA a mano (ej. no supongas que 'presión' es 'Pressure'; es 'DefensivePressuresApplied'). Si el resultado top no calza con lo que pidió Cal, probá con otras palabras antes de rendirte.",
      inputSchema: { type: "object", properties: { query: { type: "string" }, top: { type: "number" } }, required: ["query"], additionalProperties: false },
      annotations: READ_ONLY,
    },
    {
      name: "getFifaMatchStats",
      description:
        "Estadísticas AVANZADAS oficiales de FIFA por equipo (Enhanced Football Intelligence) — datos que NO da getMatchStats: posesión, control del último tercio, xG, amenaza, rupturas de línea, presiones defensivas, pérdidas provocadas, datos físicos (distancia, sprints, velocidad punta), etc. Cada equipo trae `stats` (subconjunto curado ~30 campos, nombres en español, el de uso normal) Y `stats_completas` (las 141 stats CRUDAS que da FIFA, nombres literales en inglés tipo `LinebreaksAttemptedDefensiveLineCompletedOnly` — usar solo si `stats` no tiene el campo puntual que Cal pidió; resolvé el nombre exacto con `getFifaStatDictionary` primero, NUNCA lo adivines). Self-contained: resuelve el partido por nombre + fecha. Args: { teamA, teamB, date?: 'YYYY-MM-DD', matchId? } — pasa teamA/teamB (en español o inglés, ej. 'Argentina','Argelia'); date desambigua si hay varios cruces; matchId (id de FIFA) es atajo exacto opcional. Solo para partidos ya jugados. Usar para 'estadísticas avanzadas de X', 'cuánto corrió', 'rupturas de línea', 'presión', o cualquier stat FIFA fuera de lo curado.",
      inputSchema: { type: "object", properties: { teamA: { type: "string" }, teamB: { type: "string" }, date: { type: "string" }, matchId: { type: ["string", "number"] } }, additionalProperties: false },
      annotations: READ_ONLY,
    },
    {
      name: "getFifaPlayerStats",
      description:
        "Estadísticas AVANZADAS/físicas oficiales de FIFA por jugador en un partido (los que jugaron, ordenados por amenaza): goles, asistencias, remates, pases, rupturas de línea, presiones, distancia recorrida (km), sprints, velocidad punta — esos son los campos curados de uso normal. Cada jugador trae ADEMÁS `stats_completas` (las 112 stats CRUDAS que da FIFA por jugador, nombres literales en inglés) — usar solo si lo curado no tiene el campo puntual que Cal pidió; resolvé el nombre exacto con `getFifaStatDictionary` primero, NUNCA lo adivines. Self-contained. Args: { teamA, teamB, date?, matchId?, top?: número (default 12) }. Solo partidos jugados. Usar para 'quién corrió más', 'datos físicos de X', 'mejor jugador por stats avanzadas', o cualquier stat FIFA fuera de lo curado.",
      inputSchema: { type: "object", properties: { teamA: { type: "string" }, teamB: { type: "string" }, date: { type: "string" }, matchId: { type: ["string", "number"] }, top: { type: "number" } }, additionalProperties: false },
      annotations: READ_ONLY,
    },
    {
      name: "getFifaPowerRanking",
      description:
        "Power Ranking oficial de FIFA de un partido: rendimiento por jugador en tres dimensiones (atacante, defensivo, creativo) con rank y score. Devuelve top de cada dimensión. Self-contained. Args: { teamA, teamB, date?, matchId?, top?: número (default 5) }. Solo partidos jugados. Usar para 'quién fue el mejor atacante/defensor/creativo', 'power ranking del partido'.",
      inputSchema: { type: "object", properties: { teamA: { type: "string" }, teamB: { type: "string" }, date: { type: "string" }, matchId: { type: ["string", "number"] }, top: { type: "number" } }, additionalProperties: false },
      annotations: READ_ONLY,
    },
    {
      name: "getFifaMatchTimeline",
      description:
        "Cronología oficial de FIFA de un partido YA JUGADO: goles, asistencias, tarjetas, sustituciones y VAR, minuto a minuto con marcador parcial y descripción en español (ej. 'Messi anota de penal'). Self-contained. Args: { teamA, teamB, date?, matchId?, all?: boolean (true trae también remates/córners/faltas/paradas, no solo lo narrativo) }. Usar para 'qué pasó en el partido', 'quién metió los goles y a qué minuto', 'timeline'.",
      inputSchema: { type: "object", properties: { teamA: { type: "string" }, teamB: { type: "string" }, date: { type: "string" }, matchId: { type: ["string", "number"] }, all: { type: "boolean" } }, additionalProperties: false },
      annotations: READ_ONLY,
    },
    {
      name: "getFifaLineups",
      description:
        "Alineación oficial de FIFA de un partido: titulares + suplentes, formación (ej. '4-3-3'), cuerpo técnico, capitán. Se publica ~1h antes del partido. Self-contained. Args: { teamA, teamB, date?, matchId? }. Usar para 'quién juega', 'alineación de X', 'formación', 'quién es el capitán'.",
      inputSchema: { type: "object", properties: { teamA: { type: "string" }, teamB: { type: "string" }, date: { type: "string" }, matchId: { type: ["string", "number"] } }, additionalProperties: false },
      annotations: READ_ONLY,
    },
    {
      name: "getFifaTeamHistory",
      description:
        "Historial de una selección según FIFA: record histórico (jugados/ganados/perdidos/empatados/goles) y últimos partidos. Args: { team, opponent?: string (filtra a los cruces contra ese rival — head-to-head), limit?: número (default 10) }. OJO: la cobertura de FIFA para historial entre dos equipos específicos es más pobre que un H2H de fuente deportiva dedicada (solo rastrea Mundiales/clasificatorias/amistosos, no copas continentales) — si `opponent` no encuentra cruces, decilo tal cual, no asumas que nunca jugaron. Usar para 'cómo le ha ido a X', 'historial X vs Y'.",
      inputSchema: { type: "object", properties: { team: { type: "string" }, opponent: { type: "string" }, limit: { type: "number" } }, required: ["team"], additionalProperties: false },
      annotations: READ_ONLY,
    },
    {
      name: "getFifaStandings",
      description:
        "Tabla de posiciones de los grupos del Mundial, CALCULADA a partir de los resultados del calendario oficial de FIFA (no hay endpoint de standings dedicado — no aplica desempates especiales como fair play). Args: { group?: 'A'..'L' } (default: todos). Devuelve por grupo [{team, pj, g, e, p, gf, gc, dg, pts}] ya ordenado. Usar para 'cómo va el grupo X', 'tabla de posiciones', 'quién clasifica'.",
      inputSchema: { type: "object", properties: { group: { type: "string" } }, additionalProperties: false },
      annotations: READ_ONLY,
    },
    {
      name: "getMatchReport",
      description:
        "ANÁLISIS COMPLETO de un partido YA JUGADO en una sola llamada — junta API-Football + FIFA en secciones: cronología (goles/tarjetas), stats básicas, lectura táctica (presión, rupturas, amenaza), datos físicos (distancia/sprints/velocidad) y power ranking. Trae una guía `_comoPresentar` con el framework de narración (incl. el párrafo «el relato que las stats básicas no cuentan») — SEGUÍ esa guía al renderizar. Args: { teamA, teamB, date?, matchId? } (nombres en español o inglés; date desambigua). PREFERÍ esta tool cuando Cal pida 'análisis', 'cómo jugó', 'resumen del partido' de un partido jugado, en vez de llamar las stats sueltas.",
      inputSchema: { type: "object", properties: { teamA: { type: "string" }, teamB: { type: "string" }, date: { type: "string" }, matchId: { type: ["string", "number"] } }, additionalProperties: false },
      annotations: READ_ONLY,
    },
    {
      name: "getMatchPreview",
      description:
        "PREVIA COMPLETA de un partido (futuro o cualquiera) en una sola llamada — junta predicción del modelo propio (1/X/2, goles esperados, marcador probable), historial directo (H2H), lesiones de ambos equipos, y cuotas + alineaciones si están disponibles. Trae guía `_comoPresentar` con el framework de narración — SEGUÍ esa guía. Args: { teamA, teamB, date?, matchId? }. PREFERÍ esta tool cuando Cal pida 'previa', 'quién va a ganar', 'cómo llegan', 'análisis previo' de un partido por jugar.",
      inputSchema: { type: "object", properties: { teamA: { type: "string" }, teamB: { type: "string" }, date: { type: "string" }, matchId: { type: ["string", "number"] } }, additionalProperties: false },
      annotations: READ_ONLY,
    },
    {
      name: "getWorldcupCapabilities",
      description:
        "Índice de TODO lo que se puede consultar del Mundial 2026 con este MCP, agrupado por categoría (calendario, detalle de partido, análisis consolidado, stats avanzadas FIFA, jugadores, predicción/apuestas) con ejemplos de preguntas. Sin args. Trae `_comoPresentar`. Usar cuando Cal pregunte '¿qué sabes/puedes mostrar del Mundial?', '¿qué me puedes contar del Mundial?', 'opciones del Mundial', o pida un menú/índice de fútbol.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: READ_ONLY,
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;
  const a = (request.params.arguments ?? {}) as Record<string, unknown>;
  try {
    switch (name) {
      case "getFixtures": return ok(await getFixtures(a.date as string | undefined, a.team as string | undefined));
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
      case "getFifaStatDictionary": return ok(searchGlossary(a.query as string, (a.top as number | undefined) ?? 5));
      case "getFifaMatchStats": return ok(await getFifaMatchStats(a as any));
      case "getFifaPlayerStats": return ok(await getFifaPlayerStats(a as any));
      case "getFifaPowerRanking": return ok(await getFifaPowerRanking(a as any));
      case "getFifaMatchTimeline": return ok(await getFifaMatchTimeline(a as any));
      case "getFifaLineups": return ok(await getFifaLineups(a as any));
      case "getFifaTeamHistory": return ok(await getFifaTeamHistory(a as any));
      case "getFifaStandings": return ok(await getFifaStandings(a as any));
      case "getMatchReport": return ok(await getMatchReport(a as any));
      case "getMatchPreview": return ok(await getMatchPreview(a as any));
      case "getWorldcupCapabilities": return ok(WORLDCUP_CAPABILITIES);
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
