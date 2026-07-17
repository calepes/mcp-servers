// Cliente API-Football (api-sports.io v3) para el Mundial 2026.
// Plan Pro (7500 req/día; el free NO da season 2026). Key en env API_FOOTBALL_KEY.
// League id Mundial = 1, season = 2026 (ambos configurables por env).

const BASE = "https://v3.football.api-sports.io";
const LEAGUE = Number(process.env.WORLDCUP_LEAGUE_ID ?? 1);
const SEASON = Number(process.env.WORLDCUP_SEASON ?? 2026);
// API-Football devuelve fechas en UTC por default. Cal está en Bolivia (UTC-4):
// sin esto, el filtro `date` y los `kickoff` salen desfasados -4h → "qué hay hoy"
// trae los partidos equivocados y muestra el día/hora mal. Aplica a /fixtures*.
const TZ = process.env.WORLDCUP_TZ ?? "America/La_Paz";
const TTL_MS = 5 * 60_000; // datos en vivo cambian lento; 5 min protege la cuota

const cache = new Map<string, { value: unknown; expires: number }>();

function cacheGet<T>(key: string): T | null {
  const e = cache.get(key);
  if (!e || e.expires < Date.now()) {
    cache.delete(key);
    return null;
  }
  return e.value as T;
}

export interface ApiError {
  error: string;
}

function missingKey(): ApiError {
  return {
    error:
      "Falta API_FOOTBALL_KEY. Requiere plan Pro en dashboard.api-football.com " +
      "(el free NO da la season 2026); poné la key en ~/.claude/secrets/apps.env como API_FOOTBALL_KEY.",
  };
}

async function api<T = unknown>(
  path: string,
  params: Record<string, string | number>,
): Promise<{ response: T[] } | ApiError> {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) return missingKey();

  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  // Hora local Bolivia solo en endpoints que filtran/devuelven fechas. Los sub-endpoints
  // por fixtureId (events/statistics/players/lineups) rechazan timezone ("field do not exist").
  const TZ_PATHS = new Set(["/fixtures", "/fixtures/headtohead"]);
  if (TZ_PATHS.has(path) && !url.searchParams.has("timezone")) {
    url.searchParams.set("timezone", TZ);
  }
  const ckey = url.toString();
  const hit = cacheGet<{ response: T[] }>(ckey);
  if (hit) return hit;

  try {
    const r = await fetch(url, { headers: { "x-apisports-key": key } });
    if (!r.ok) return { error: `API-Football ${r.status}: ${r.statusText}` };
    const json = (await r.json()) as { response?: T[]; errors?: unknown };
    if (json.errors && Object.keys(json.errors).length) {
      return { error: `API-Football: ${JSON.stringify(json.errors)}` };
    }
    const out = { response: json.response ?? [] };
    cache.set(ckey, { value: out, expires: Date.now() + TTL_MS });
    return out;
  } catch (e) {
    return { error: `API-Football fetch falló: ${(e as Error).message}` };
  }
}

const isErr = (x: unknown): x is ApiError => !!x && typeof x === "object" && "error" in x;

// --- tipos crudos mínimos de API-Football ---------------------------------
interface RawFixture {
  fixture: { id: number; date: string; status: { short: string; elapsed: number | null }; venue?: { name?: string; city?: string } };
  teams: { home: { id: number; name: string }; away: { id: number; name: string } };
  goals: { home: number | null; away: number | null };
  league?: { round?: string };
}

// --- tools ----------------------------------------------------------------

/**
 * Etiqueta de fecha/hora lista para renderizar, calculada EN CÓDIGO (es-BO, La_Paz).
 * El LLM debe usar esto literal — NO recalcular el día de la semana desde el ISO
 * (los LLM erran la aritmética fecha→weekday). Ej: "mar 16 jun · 21:00".
 */
function fmtKickoff(iso: string): string {
  try {
    const parts = new Intl.DateTimeFormat("es-BO", {
      timeZone: TZ,
      weekday: "short",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date(iso));
    const g = (t: string) => (parts.find((p) => p.type === t)?.value ?? "").replace(/\./g, "");
    return `${g("weekday")} ${g("day")} ${g("month")} · ${g("hour")}:${g("minute")}`;
  } catch {
    return iso;
  }
}

/** Partidos por fecha (YYYY-MM-DD) y/o equipo (nombre en inglés, partial match). Sin filtros: todos los del torneo. */
export async function getFixtures(date?: string, team?: string) {
  const params: Record<string, string | number> = { league: LEAGUE, season: SEASON };
  if (date) params.date = date;
  const res = await api<RawFixture>("/fixtures", params);
  if (isErr(res)) return res;
  let matches = res.response;
  if (team) {
    const t = team.toLowerCase();
    matches = matches.filter((f) => {
      const home = f.teams.home.name.toLowerCase();
      const away = f.teams.away.name.toLowerCase();
      return home.includes(t) || t.includes(home) || away.includes(t) || t.includes(away);
    });
    if (!matches.length) return { error: `No encontré partidos de "${team}" en el Mundial. Prueba el nombre en inglés.` };
  }
  return {
    date: date ?? "all",
    team: team ?? undefined,
    count: matches.length,
    fixtures: matches.map((f) => ({
      id: f.fixture.id,
      kickoff: f.fixture.date,
      kickoffLabel: fmtKickoff(f.fixture.date), // día+hora ya calculados (usar literal)
      status: f.fixture.status.short, // NS=programado, 1H/HT/2H=en juego, FT=terminado
      round: f.league?.round,
      home: f.teams.home.name,
      away: f.teams.away.name,
      score: f.goals.home != null ? `${f.goals.home}-${f.goals.away}` : null,
    })),
  };
}

/** Detalle de un partido (resultado + estado). */
export async function getMatchDetail(fixtureId: number) {
  const res = await api<RawFixture>("/fixtures", { id: fixtureId });
  if (isErr(res)) return res;
  const f = res.response[0];
  if (!f) return { error: `Partido ${fixtureId} no encontrado` };
  return {
    id: f.fixture.id,
    kickoff: f.fixture.date,
    kickoffLabel: fmtKickoff(f.fixture.date),
    status: f.fixture.status.short,
    elapsed: f.fixture.status.elapsed,
    venue: f.fixture.venue?.name,
    round: f.league?.round,
    home: f.teams.home.name,
    away: f.teams.away.name,
    score: f.goals.home != null ? `${f.goals.home}-${f.goals.away}` : null,
  };
}

/** Tablas de los grupos (standings). */
export async function getStandings(group?: string) {
  interface RawStandings {
    league: { standings: Array<Array<{
      rank: number; team: { name: string }; points: number;
      goalsDiff: number; all: { played: number }; group: string;
    }>> };
  }
  const res = await api<RawStandings>("/standings", { league: LEAGUE, season: SEASON });
  if (isErr(res)) return res;
  const groups = res.response[0]?.league?.standings ?? [];
  const tables = groups.map((rows) => ({
    group: rows[0]?.group ?? "?",
    table: rows.map((r) => ({
      rank: r.rank, team: r.team.name, played: r.all.played,
      points: r.points, gd: r.goalsDiff,
    })),
  }));
  return { groups: group ? tables.filter((t) => t.group.includes(group)) : tables };
}

/** Alineaciones de un partido. */
export async function getLineups(fixtureId: number) {
  interface RawLineup {
    team: { name: string }; formation: string;
    startXI: Array<{ player: { name: string; number: number; pos: string } }>;
    substitutes: Array<{ player: { name: string; number: number; pos: string } }>;
  }
  const res = await api<RawLineup>("/fixtures/lineups", { fixture: fixtureId });
  if (isErr(res)) return res;
  if (!res.response.length) return { fixtureId, lineups: [], note: "Alineaciones aún no publicadas (suelen salir ~1h antes)." };
  return {
    fixtureId,
    lineups: res.response.map((l) => ({
      team: l.team.name,
      formation: l.formation,
      startXI: l.startXI.map((p) => `${p.player.number} ${p.player.name} (${p.player.pos})`),
      subs: l.substitutes.map((p) => p.player.name),
    })),
  };
}

/** Estadísticas de un partido (tiros, posesión, xG si disponible). */
export async function getMatchStats(fixtureId: number) {
  interface RawStats {
    team: { name: string };
    statistics: Array<{ type: string; value: number | string | null }>;
  }
  const res = await api<RawStats>("/fixtures/statistics", { fixture: fixtureId });
  if (isErr(res)) return res;
  if (!res.response.length) return { fixtureId, stats: [], note: "Stats no disponibles aún (durante/después del partido)." };
  return {
    fixtureId,
    stats: res.response.map((s) => ({
      team: s.team.name,
      ...Object.fromEntries(s.statistics.map((x) => [x.type, x.value])),
    })),
  };
}

/** Partidos terminados (FT) para alimentar el predictor (results_live.json). */
export async function getFinishedResults() {
  const res = await api<RawFixture>("/fixtures", { league: LEAGUE, season: SEASON });
  if (isErr(res)) return res;
  const played = res.response
    .filter((f) => f.fixture.status.short === "FT" && f.goals.home != null)
    .map((f) => ({
      home: f.teams.home.name,
      away: f.teams.away.name,
      hs: f.goals.home as number,
      as: f.goals.away as number,
    }));
  return { played };
}

// --- resolución nombre de equipo -> team id (cacheada con TTL) ------------
let teamMap: Map<string, number> | null = null;
let teamMapExpires = 0;
async function resolveTeamId(name: string): Promise<number | ApiError> {
  if (!teamMap || Date.now() > teamMapExpires) {
    const res = await api<{ team: { id: number; name: string } }>("/teams", { league: LEAGUE, season: SEASON });
    if (isErr(res)) return res;
    if (!res.response.length) {
      // No cachear un Map vacío (fallo parcial de la API) -> reintenta al próximo call
      return { error: "No pude cargar la lista de equipos del Mundial. Reintenta en un momento." };
    }
    teamMap = new Map(res.response.map((t) => [t.team.name.toLowerCase(), t.team.id]));
    teamMapExpires = Date.now() + 12 * 3600_000; // 12h
  }
  const low = name.toLowerCase();
  if (teamMap.has(low)) return teamMap.get(low)!;
  for (const [n, id] of teamMap) if (n.includes(low) || low.includes(n)) return id;
  return { error: `No encontré el equipo "${name}" en el Mundial. Prueba el nombre en inglés.` };
}

/** Partidos EN VIVO ahora mismo. */
export async function getLiveFixtures() {
  const res = await api<RawFixture>("/fixtures", { league: LEAGUE, season: SEASON, live: "all" });
  if (isErr(res)) return res;
  return {
    count: res.response.length,
    live: res.response.map((f) => ({
      id: f.fixture.id, minute: f.fixture.status.elapsed, status: f.fixture.status.short,
      home: f.teams.home.name, away: f.teams.away.name,
      score: f.goals.home != null ? `${f.goals.home}-${f.goals.away}` : "0-0",
    })),
  };
}

/** Eventos de un partido (goles, tarjetas, cambios — minuto a minuto). */
export async function getMatchEvents(fixtureId: number) {
  interface RawEvent {
    time: { elapsed: number; extra: number | null };
    team: { name: string }; player: { name: string | null }; assist: { name: string | null };
    type: string; detail: string;
  }
  const res = await api<RawEvent>("/fixtures/events", { fixture: fixtureId });
  if (isErr(res)) return res;
  return {
    fixtureId,
    events: res.response.map((e) => ({
      minute: e.time.elapsed + (e.time.extra ? `+${e.time.extra}` : ""),
      team: e.team.name, type: e.type, detail: e.detail,
      player: e.player.name, assist: e.assist.name ?? undefined,
    })),
  };
}

/** Rendimiento por jugador en un partido (rating, goles, tiros, pases). */
export async function getPlayerStats(fixtureId: number) {
  interface RawFP {
    team: { name: string };
    players: Array<{ player: { name: string }; statistics: Array<{
      games: { minutes: number | null; rating: string | null; position: string };
      goals: { total: number | null; assists: number | null };
      shots: { total: number | null }; passes: { total: number | null };
    }> }>;
  }
  const res = await api<RawFP>("/fixtures/players", { fixture: fixtureId });
  if (isErr(res)) return res;
  if (!res.response.length) return { fixtureId, players: [], note: "Stats por jugador no disponibles aún." };
  return {
    fixtureId,
    teams: res.response.map((t) => ({
      team: t.team.name,
      players: t.players
        .filter((p) => p.statistics[0]?.games.minutes)
        .map((p) => {
          const s = p.statistics[0];
          return {
            name: p.player.name, pos: s.games.position, min: s.games.minutes,
            rating: s.games.rating, goals: s.goals.total ?? 0, assists: s.goals.assists ?? 0,
            shots: s.shots.total ?? 0, passes: s.passes.total ?? 0,
          };
        }),
    })),
  };
}

/** Goleadores del torneo (top 20). */
export async function getTopScorers() {
  return topPlayers("/players/topscorers", "goals");
}
/** Asistentes del torneo (top 20). */
export async function getTopAssists() {
  return topPlayers("/players/topassists", "assists");
}
async function topPlayers(path: string, metric: "goals" | "assists") {
  interface RawTop {
    player: { name: string };
    statistics: Array<{ team: { name: string }; goals: { total: number | null; assists: number | null }; games: { appearences: number | null } }>;
  }
  const res = await api<RawTop>(path, { league: LEAGUE, season: SEASON });
  if (isErr(res)) return res;
  return {
    metric,
    ranking: res.response.slice(0, 20).map((p, i) => {
      const s = p.statistics[0];
      return {
        rank: i + 1, player: p.player.name, team: s.team.name,
        goals: s.goals.total ?? 0, assists: s.goals.assists ?? 0, apps: s.games.appearences ?? 0,
      };
    }),
  };
}

/** Lesionados del Mundial (todos, o de un equipo si se pasa el nombre). */
export async function getInjuries(team?: string) {
  const params: Record<string, string | number> = { league: LEAGUE, season: SEASON };
  if (team) {
    const id = await resolveTeamId(team);
    if (isErr(id)) return id;
    params.team = id;
  }
  interface RawInj {
    player: { name: string; type: string | null; reason: string | null };
    team: { name: string };
  }
  const res = await api<RawInj>("/injuries", params);
  if (isErr(res)) return res;
  return {
    count: res.response.length,
    injuries: res.response.map((i) => ({
      player: i.player.name, team: i.team.name, type: i.player.type, reason: i.player.reason,
    })),
  };
}

/** Historial entre dos selecciones (head-to-head). */
export async function getH2H(teamA: string, teamB: string) {
  const idA = await resolveTeamId(teamA);
  if (isErr(idA)) return idA;
  const idB = await resolveTeamId(teamB);
  if (isErr(idB)) return idB;
  const res = await api<RawFixture>("/fixtures/headtohead", { h2h: `${idA}-${idB}` });
  if (isErr(res)) return res;
  let winsA = 0, winsB = 0, draws = 0;
  const matches = res.response
    .filter((f) => f.goals.home != null)
    .map((f) => {
      const hs = f.goals.home as number, as = f.goals.away as number;
      const homeIsA = f.teams.home.id === idA;  // por id, no por nombre (substring-safe)
      if (hs === as) draws++;
      else if ((hs > as) === homeIsA) winsA++;
      else winsB++;
      return { date: f.fixture.date.slice(0, 10), home: f.teams.home.name, away: f.teams.away.name, score: `${hs}-${as}` };
    });
  return { teamA, teamB, summary: { [teamA]: winsA, draws, [teamB]: winsB }, matches: matches.slice(-15) };
}

/** Cuotas de casas de apuestas para un partido (Match Winner). */
export async function getOdds(fixtureId: number) {
  interface RawOdds {
    bookmakers: Array<{ name: string; bets: Array<{ name: string; values: Array<{ value: string; odd: string }> }> }>;
  }
  const res = await api<RawOdds>("/odds", { fixture: fixtureId, season: SEASON });
  if (isErr(res)) return res;
  const bk = res.response[0]?.bookmakers?.[0];
  if (!bk) return { fixtureId, note: "Cuotas no disponibles para este partido aún." };
  const mw = bk.bets.find((b) => b.name === "Match Winner");
  return {
    fixtureId, bookmaker: bk.name,
    matchWinner: mw?.values.map((v) => ({ outcome: v.value, odd: v.odd })) ?? [],
  };
}

/** Predicción propia de API-Football para un partido (benchmark). */
export async function getApiPrediction(fixtureId: number) {
  interface RawPred {
    predictions: { winner: { name: string | null; comment: string | null }; advice: string | null; percent: { home: string; draw: string; away: string } };
    teams: { home: { name: string }; away: { name: string } };
  }
  const res = await api<RawPred>("/predictions", { fixture: fixtureId });
  if (isErr(res)) return res;
  const p = res.response[0];
  if (!p) return { fixtureId, note: "Sin predicción disponible." };
  return {
    fixtureId, home: p.teams.home.name, away: p.teams.away.name,
    winner: p.predictions.winner.name, advice: p.predictions.advice,
    percent: p.predictions.percent,
  };
}

/** Plantilla (squad) de una selección. */
export async function getSquad(team: string) {
  const id = await resolveTeamId(team);
  if (isErr(id)) return id;
  interface RawSquad {
    team: { name: string };
    players: Array<{ name: string; number: number | null; position: string; age: number | null }>;
  }
  const res = await api<RawSquad>("/players/squads", { team: id });
  if (isErr(res)) return res;
  const sq = res.response[0];
  if (!sq) return { team, note: "Plantilla no disponible." };
  return {
    team: sq.team.name,
    players: sq.players.map((p) => ({ number: p.number, name: p.name, position: p.position, age: p.age })),
  };
}
