// Cliente de las APIs públicas de FIFA para el Mundial 2026.
// NO es scraping: son endpoints JSON oficiales (api.fifa.com + fdh-api.fifa.com),
// sin auth, solo requieren un User-Agent normal. Dan las "Enhanced Football
// Intelligence" stats que API-Football NO tiene (ruptura de líneas, internadas por
// carril, presiones, datos físicos GPS por jugador, power ranking).
//
// Cadena de resolución (todo self-contained dentro del ecosistema FIFA):
//   calendar/matches?idCompetition=17&idSeason=285023  -> los 104 partidos del torneo
//     cada uno trae IdMatch + Properties.IdIFES (statsId) + equipos (multi-locale) + fecha
//   fdh stats/match/{IdIFES}/teams.json    -> 142 stats por equipo
//   fdh stats/match/{IdIFES}/players.json  -> 116 stats por jugador (sin nombre)
//   fdh powerranking/match/{IdIFES}.json   -> ranking atacante/defensivo/creativo + nombres
//   live/football/{IdMatch}                -> nombres de TODOS los jugadores (IdPlayer->nombre)
//
// El MCP worldcup es stdio LOCAL (corre en la Mac de Cal) -> IP residencial, sin el
// bloqueo de IPs de datacenter que daría 403 desde un CF Worker. No mover a edge.

const COMP = process.env.WORLDCUP_FIFA_COMP ?? "17"; // Copa Mundial
const SEASON = process.env.WORLDCUP_FIFA_SEASON ?? "285023"; // 2026
const API = "https://api.fifa.com/api/v3";
const FDH = "https://fdh-api.fifa.com/v1";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export interface FifaError {
  error: string;
}
const isErr = (x: unknown): x is FifaError =>
  !!x && typeof x === "object" && "error" in x;

async function fifaFetch<T = unknown>(url: string): Promise<T | FifaError> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20_000);
    const r = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!r.ok) return { error: `FIFA ${r.status} en ${url}` };
    return (await r.json()) as T;
  } catch (e) {
    return { error: `FIFA fetch falló (${url}): ${(e as Error).message}` };
  }
}

// --- locale helpers --------------------------------------------------------
type Loc = { Locale?: string; locale?: string; Description?: string; description?: string };
function pick(arr: Loc[] | undefined, locale = "es-ES"): string {
  if (!Array.isArray(arr)) return "";
  const get = (o: Loc) => o.Description ?? o.description ?? "";
  const loc = (o: Loc) => o.Locale ?? o.locale ?? "";
  return get(arr.find((o) => loc(o) === locale) ?? arr.find((o) => loc(o) === "en-GB") ?? arr[0] ?? {});
}

// --- calendario (cache 12h) -> índice para mapear equipos+fecha -> match ---
export interface MatchEntry {
  matchId: string;
  idIFES: string | null;
  homeId: string;
  awayId: string;
  homeEs: string;
  homeEn: string;
  awayEs: string;
  awayEn: string;
  dateUTC: string;
  status: number; // MatchStatus de FIFA (0 played, 3 abandoned, etc.)
  score: [number | null, number | null];
  pens: [number | null, number | null];
  stage: string;
  group: string;
}

let calCache: MatchEntry[] | null = null;
let calExpires = 0;

// El endpoint calendar/matches devuelve UN solo locale por request (con
// language=es → es-ES; sin language → en-GB). Necesitamos ambos: es-ES para
// mostrar a Cal, en-GB para mapear a API-Football (que usa nombres en inglés).
// Por eso getCalendar hace 2 fetches y mergea por IdMatch.
function mapMatch(m: Record<string, any>, en?: Record<string, any>): MatchEntry {
  const homeEs = pick(m.Home?.TeamName, "es-ES");
  const awayEs = pick(m.Away?.TeamName, "es-ES");
  return {
    matchId: String(m.IdMatch),
    idIFES: m.Properties?.IdIFES != null ? String(m.Properties.IdIFES) : null,
    homeId: m.Home?.IdTeam != null ? String(m.Home.IdTeam) : "",
    awayId: m.Away?.IdTeam != null ? String(m.Away.IdTeam) : "",
    homeEs,
    homeEn: en ? pick(en.Home?.TeamName, "en-GB") : pick(m.Home?.TeamName, "en-GB") || homeEs,
    awayEs,
    awayEn: en ? pick(en.Away?.TeamName, "en-GB") : pick(m.Away?.TeamName, "en-GB") || awayEs,
    dateUTC: m.Date ?? "",
    status: Number(m.MatchStatus),
    score: [m.HomeTeamScore ?? null, m.AwayTeamScore ?? null],
    pens: [m.HomeTeamPenaltyScore ?? null, m.AwayTeamPenaltyScore ?? null],
    stage: pick(m.StageName),
    group: pick(m.GroupName),
  };
}

export async function getCalendar(): Promise<MatchEntry[] | FifaError> {
  if (calCache && Date.now() < calExpires) return calCache;
  const base = `${API}/calendar/matches?idCompetition=${COMP}&idSeason=${SEASON}&count=400`;
  const [es, en] = await Promise.all([
    fifaFetch<{ Results?: Record<string, any>[] }>(base + "&language=es"),
    fifaFetch<{ Results?: Record<string, any>[] }>(base), // sin language → en-GB
  ]);
  if (isErr(es)) return es;
  const results = es.Results ?? [];
  if (!results.length) return { error: "El calendario de FIFA llegó vacío; reintenta en un momento." };
  const enById: Record<string, Record<string, any>> = {};
  if (!isErr(en)) for (const m of en.Results ?? []) enById[String(m.IdMatch)] = m;
  calCache = results.map((m) => mapMatch(m, enById[String(m.IdMatch)]));
  calExpires = Date.now() + 12 * 3600_000;
  return calCache;
}

const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

const NAME_STOPWORDS = new Set(["and", "y", "de", "of", "the"]);
const tokenSet = (s: string) => norm(s).split(" ").filter((t) => t && !NAME_STOPWORDS.has(t));

/** Compara nombres tolerando s\u00edmbolos ("&" vs "and") y orden de palabras distinto
 * (ej. API-Football "Congo DR" vs FIFA "RD Congo"). */
function namesMatch(a: string, b: string): boolean {
  const na = norm(a), nb = norm(b);
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;
  const ta = tokenSet(a), tb = tokenSet(b);
  return ta.length > 0 && ta.length === tb.length && ta.every((t) => tb.includes(t));
}

function nameMatches(entry: MatchEntry, team: string): "home" | "away" | null {
  if (namesMatch(entry.homeEs, team) || namesMatch(entry.homeEn, team)) return "home";
  if (namesMatch(entry.awayEs, team) || namesMatch(entry.awayEn, team)) return "away";
  return null;
}

/** FIFA a veces fecha un partido con +-1 d\u00eda de diferencia respecto a API-Football
 * (distinta zona horaria de referencia) \u2014 tolerar el desfase al filtrar por fecha. */
function shiftDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Resuelve un partido por matchId (atajo exacto) o por equipos + fecha opcional. */
export async function resolveMatch(args: {
  matchId?: string | number;
  teamA?: string;
  teamB?: string;
  date?: string;
}): Promise<MatchEntry | FifaError> {
  const cal = await getCalendar();
  if (isErr(cal)) return cal;

  // Atajo: matchId exacto
  if (args.matchId != null) {
    const id = String(args.matchId);
    const hit = cal.find((m) => m.matchId === id);
    if (hit) return hit;
    // no está en cache: pedir el calendario individual para sacar el IdIFES
    const one = await fifaFetch<Record<string, any>>(`${API}/calendar/${id}?language=es`);
    if (isErr(one)) return one;
    if (!one.IdMatch) return { error: `No encontré el partido matchId=${id} en FIFA.` };
    return mapMatch(one);
  }

  // Por equipos
  if (!args.teamA || !args.teamB) {
    return { error: "Pasa { teamA, teamB, date? } o { matchId }." };
  }
  let cands = cal.filter((m) => {
    const sa = nameMatches(m, args.teamA!);
    const sb = nameMatches(m, args.teamB!);
    return sa && sb && sa !== sb; // uno local y otro visitante (en cualquier orden)
  });
  if (args.date) {
    const okDates = [args.date, shiftDate(args.date, 1), shiftDate(args.date, -1)];
    cands = cands.filter((m) => okDates.some((d) => m.dateUTC.startsWith(d)));
  }
  if (!cands.length) {
    return {
      error: `No encontré "${args.teamA}" vs "${args.teamB}"${args.date ? " el " + args.date : ""} en el Mundial. Revisa los nombres.`,
    };
  }
  if (cands.length > 1) {
    return {
      error: `Hay ${cands.length} partidos entre esos equipos; especifica date (YYYY-MM-DD). Opciones: ${cands
        .map((m) => `${m.homeEs} ${m.score[0] ?? "-"}-${m.score[1] ?? "-"} ${m.awayEs} (${m.dateUTC.slice(0, 10)}, ${m.stage})`)
        .join("; ")}`,
    };
  }
  return cands[0];
}

/** Resuelve el IdTeam numérico de FIFA a partir de un nombre (busca en el calendario). */
export async function resolveTeamId(team: string): Promise<{ id: string; name: string } | FifaError> {
  const cal = await getCalendar();
  if (isErr(cal)) return cal;
  for (const m of cal) {
    if (namesMatch(m.homeEs, team) || namesMatch(m.homeEn, team)) return { id: m.homeId, name: m.homeEs };
    if (namesMatch(m.awayEs, team) || namesMatch(m.awayEn, team)) return { id: m.awayId, name: m.awayEs };
  }
  return { error: `No encontré la selección "${team}" en el calendario del Mundial.` };
}

// --- parseo de stats -------------------------------------------------------
type StatTriple = [string, number, boolean];
function toMap(arr: StatTriple[]): Record<string, number> {
  const o: Record<string, number> = {};
  for (const s of arr) if (Array.isArray(s)) o[s[0]] = s[1];
  return o;
}
const r1 = (n: number | undefined) => (n == null ? null : Math.round(n * 10) / 10);
const pct = (n: number | undefined) => (n == null ? null : Math.round(n * 1000) / 10); // fracción 0-1 -> %
const km = (n: number | undefined) => (n == null ? null : Math.round(n / 100) / 10); // metros -> km

// Selección curada de las 142 stats de equipo (las más legibles/útiles), con etiqueta ES.
function curateTeam(s: Record<string, number>) {
  return {
    posesion_pct: pct(s.Possession),
    control_ultimo_tercio_pct: r1(s.FinalThirdPitchControl),
    xg: r1(s.XG),
    amenaza: r1(s.Threat),
    goles: s.Goals,
    goles_recibidos: s.GoalsConceded,
    remates: s.AttemptAtGoal,
    remates_a_puerta: s.AttemptAtGoalOnTarget,
    remates_dentro_area: s.AttemptAtGoalInsideThePenaltyArea,
    pases: s.Passes,
    pases_completados: s.PassesCompleted,
    centros: s.Crosses,
    centros_completados: s.CrossesCompleted,
    corners: s.Corners,
    fueras_de_juego: s.Offsides,
    faltas_cometidas: s.FoulsAgainst,
    faltas_recibidas: s.FoulsFor,
    amarillas: s.YellowCards,
    rojas: (s.DirectRedCards ?? 0) + (s.IndirectRedCards ?? 0),
    presiones_defensivas: s.DefensivePressuresApplied,
    perdidas_provocadas: s.ForcedTurnovers,
    rupturas_de_linea: s.LinebreaksCompletedAllLines,
    rupturas_intentadas: s.LinebreaksAttemptedAllLines,
    secuencias_que_terminan_en_remate: s.NumberOfShotEndingSequences,
    distancia_total_km: km(s.TotalDistance),
    distancia_sprint_alta_km: km(s.DistanceHighSpeedSprinting),
    sprints: s.Sprints,
    velocidad_punta_kmh: r1(s.TopSpeed),
    paradas_arquero: s.GoalkeeperSaves,
    pct_paradas_arquero: pct(s.GoalkeeperSavePercentage),
  };
}

function curatePlayer(s: Record<string, number>) {
  return {
    minutos: r1(s.TimePlayed),
    goles: s.Goals,
    asistencias: s.Assists,
    remates: s.AttemptAtGoal,
    remates_a_puerta: s.AttemptAtGoalOnTarget,
    pases: s.Passes,
    pases_completados: s.PassesCompleted,
    rupturas_de_linea: s.LinebreaksCompletedAllLines,
    presiones_defensivas: s.DefensivePressuresApplied,
    perdidas_provocadas: s.ForcedTurnovers,
    amenaza: r1(s.Threat),
    distancia_km: km(s.TotalDistance),
    sprints: s.Sprints,
    velocidad_punta_kmh: r1(s.TopSpeed),
  };
}

// --- catálogo COMPLETO (las 141/112 stats crudas, sin curar) ----------------
// Nombres literales de FIFA (PascalCase) como key — son el identificador canónico
// de cada stat, documentado en el catálogo (ver reference_mcp_worldcup_tools).
// Solo 2 fracciones 0-1 conocidas (->%) y 6 distancias en metros (->km); el resto
// (incl. PhaseAggregate*, PitchControl, AvgSpeed, TopSpeed, Threat, XG) ya vienen
// en su escala final — pasan tal cual, solo redondeadas si son float.
const FRACTION_TO_PCT = new Set(["Possession", "GoalkeeperSavePercentage"]);
const METERS_TO_KM = new Set([
  "TotalDistance", "DistanceHighSpeedRunning", "DistanceHighSpeedSprinting",
  "DistanceJogging", "DistanceLowSpeedSprinting", "DistanceWalking",
]);
function convertStat(name: string, value: number): number | null {
  if (value == null) return null;
  if (FRACTION_TO_PCT.has(name)) return pct(value);
  if (METERS_TO_KM.has(name)) return km(value);
  return Number.isInteger(value) ? value : r1(value);
}
function curateAll(s: Record<string, number>) {
  const out: Record<string, number | null> = {};
  for (const [name, value] of Object.entries(s)) out[name] = convertStat(name, value);
  return out;
}

interface MatchCtx {
  match: MatchEntry;
  idIFES: string;
}
async function ensureStatsId(args: {
  matchId?: string | number;
  teamA?: string;
  teamB?: string;
  date?: string;
}): Promise<MatchCtx | FifaError> {
  const m = await resolveMatch(args);
  if (isErr(m)) return m;
  if (!m.idIFES) {
    return { error: `El partido ${m.homeEs} vs ${m.awayEs} no tiene stats avanzadas publicadas todavía (sin IdIFES).` };
  }
  return { match: m, idIFES: m.idIFES };
}

const matchLabel = (m: MatchEntry) =>
  `${m.homeEs} ${m.score[0] ?? "-"}-${m.score[1] ?? "-"} ${m.awayEs}` +
  (m.pens[0] != null ? ` (pen ${m.pens[0]}-${m.pens[1]})` : "") +
  ` · ${m.stage}${m.group ? " " + m.group : ""}`;

/** Stats avanzadas por EQUIPO (Enhanced Football Intelligence). */
export async function getFifaMatchStats(args: { matchId?: string | number; teamA?: string; teamB?: string; date?: string }) {
  const ctx = await ensureStatsId(args);
  if (isErr(ctx)) return ctx;
  const data = await fifaFetch<Record<string, StatTriple[]>>(`${FDH}/stats/match/${ctx.idIFES}/teams.json`);
  if (isErr(data)) return data;

  // teamId numérico (FIFA) -> nombre vía live/football
  const live = await fifaFetch<Record<string, any>>(`${API}/live/football/${ctx.match.matchId}?language=es`);
  const nameByTeam: Record<string, string> = {};
  if (!isErr(live)) {
    for (const side of ["HomeTeam", "AwayTeam"] as const) {
      const tm = live[side];
      if (tm?.IdTeam) nameByTeam[String(tm.IdTeam)] = pick(tm.TeamName) || (side === "HomeTeam" ? ctx.match.homeEs : ctx.match.awayEs);
    }
  }
  const teams = Object.entries(data).map(([teamId, arr]) => {
    const raw = toMap(arr);
    return {
      team: nameByTeam[teamId] ?? teamId,
      stats: curateTeam(raw),
      stats_completas: curateAll(raw),
    };
  });
  return { match: matchLabel(ctx.match), matchId: ctx.match.matchId, teams };
}

/** Stats avanzadas / físicas por JUGADOR (los que jugaron, ordenados por amenaza). */
export async function getFifaPlayerStats(args: { matchId?: string | number; teamA?: string; teamB?: string; date?: string; top?: number }) {
  const ctx = await ensureStatsId(args);
  if (isErr(ctx)) return ctx;
  const data = await fifaFetch<Record<string, StatTriple[]>>(`${FDH}/stats/match/${ctx.idIFES}/players.json`);
  if (isErr(data)) return data;

  // playerId -> {nombre, teamId} vía live/football (cubre 100%)
  const live = await fifaFetch<Record<string, any>>(`${API}/live/football/${ctx.match.matchId}?language=es`);
  const info: Record<string, { name: string; team: string }> = {};
  if (!isErr(live)) {
    for (const side of ["HomeTeam", "AwayTeam"] as const) {
      const tm = live[side];
      const teamName = pick(tm?.TeamName) || (side === "HomeTeam" ? ctx.match.homeEs : ctx.match.awayEs);
      for (const p of tm?.Players ?? []) {
        info[String(p.IdPlayer)] = { name: pick(p.PlayerName) || pick(p.ShortName) || String(p.IdPlayer), team: teamName };
      }
    }
  }
  const top = args.top ?? 12;
  const players = Object.entries(data)
    .map(([pid, arr]) => {
      const raw = toMap(arr);
      const st = curatePlayer(raw);
      return { player: info[pid]?.name ?? pid, team: info[pid]?.team ?? "?", ...st, stats_completas: curateAll(raw) };
    })
    .filter((p) => (p.minutos ?? 0) > 0)
    .sort((a, b) => (b.amenaza ?? 0) - (a.amenaza ?? 0))
    .slice(0, top);
  return { match: matchLabel(ctx.match), matchId: ctx.match.matchId, players };
}

/** Power ranking del partido: rendimiento atacante / defensivo / creativo por jugador. */
export async function getFifaPowerRanking(args: { matchId?: string | number; teamA?: string; teamB?: string; date?: string; top?: number }) {
  const ctx = await ensureStatsId(args);
  if (isErr(ctx)) return ctx;
  const pr = await fifaFetch<{ outfieldPlayers?: Record<string, any>[] }>(`${FDH}/powerranking/match/${ctx.idIFES}.json`);
  if (isErr(pr)) return pr;
  const top = args.top ?? 5;
  const rows = (pr.outfieldPlayers ?? []).map((p) => ({
    player: pick(p.playerName),
    team: pick(p.teamName),
    ataque: { rank: p.attackingRank, score: r1(p.attackingScore) },
    defensa: { rank: p.defensiveRank, score: r1(p.defensiveScore) },
    creatividad: { rank: p.creativityRank, score: r1(p.creativityScore) },
  }));
  const byScore = (sel: (x: typeof rows[number]) => number) =>
    [...rows].sort((a, b) => sel(b) - sel(a)).slice(0, top);
  return {
    match: matchLabel(ctx.match),
    matchId: ctx.match.matchId,
    mejores_atacantes: byScore((r) => r.ataque.score ?? 0),
    mejores_defensivos: byScore((r) => r.defensa.score ?? 0),
    mas_creativos: byScore((r) => r.creatividad.score ?? 0),
  };
}

// --- cronología del partido (timelines) -------------------------------------
// Tipos de evento vistos en producción (Type de FIFA): 0 Gol, 1 Asistencia,
// 2 Amarilla, 3 Doble amarilla, 4 Roja directa, 5 Sustitución, 12 Remate a
// puerta, 15 Fuera de juego, 16 Córner, 18 Falta, 26 Final de partido,
// 57 Parada, 71 VAR. Filtramos por defecto a los relevantes para narrar
// (goles/asistencias/tarjetas/cambios/VAR); `all: true` trae todo (incl. remates/faltas/córners).
const NARRATIVE_EVENT_TYPES = new Set([0, 1, 2, 3, 4, 5, 71]);

/** Cronología minuto a minuto de un partido YA JUGADO: goles, asistencias, tarjetas,
 * sustituciones, VAR (y opcionalmente remates/córners/faltas con `all: true`). */
export async function getFifaMatchTimeline(args: {
  matchId?: string | number; teamA?: string; teamB?: string; date?: string; all?: boolean;
}) {
  const m = await resolveMatch(args);
  if (isErr(m)) return m;
  const data = await fifaFetch<{ Event?: Record<string, any>[] }>(`${API}/timelines/${m.matchId}?language=es`);
  if (isErr(data)) return data;
  const events = (data.Event ?? [])
    .filter((e) => args.all || NARRATIVE_EVENT_TYPES.has(Number(e.Type)))
    .map((e) => ({
      minuto: e.MatchMinute,
      equipo: e.IdTeam === m.homeId ? m.homeEs : e.IdTeam === m.awayId ? m.awayEs : null,
      tipo: pick(e.TypeLocalized),
      detalle: pick(e.EventDescription),
      marcador: `${e.HomeGoals ?? "-"}-${e.AwayGoals ?? "-"}`,
    }))
    .sort((a, b) => parseInt(a.minuto) - parseInt(b.minuto));
  return { match: matchLabel(m), matchId: m.matchId, eventos: events };
}

// --- convocados / alineación (live/football) --------------------------------
const STATUS_LABEL: Record<number, string> = { 1: "titular", 2: "suplente", 3: "no convocado" };

function curateRoster(team: Record<string, any>, teamEsName: string) {
  const players = (team.Players ?? []).map((p: Record<string, any>) => ({
    numero: p.ShirtNumber,
    nombre: pick(p.PlayerName) || pick(p.ShortName),
    estado: STATUS_LABEL[Number(p.Status)] ?? String(p.Status),
    capitan: !!p.Captain,
  }));
  const coaches = (team.Coaches ?? []).map((c: Record<string, any>) => ({
    nombre: pick(c.Name), rol: c.Role === 1 ? "DT" : "asistente",
  }));
  return {
    equipo: teamEsName,
    formacion: team.Tactics ?? null,
    cuerpo_tecnico: coaches,
    titulares: players.filter((p: any) => p.estado === "titular"),
    suplentes: players.filter((p: any) => p.estado !== "titular"),
  };
}

/** Convocados + alineación de un partido: titulares, suplentes, formación, cuerpo técnico.
 * Se publica ~1h antes del partido; después de jugado también trae capitán y goles/tarjetas por jugador. */
export async function getFifaLineups(args: {
  matchId?: string | number; teamA?: string; teamB?: string; date?: string;
}) {
  const m = await resolveMatch(args);
  if (isErr(m)) return m;
  const live = await fifaFetch<Record<string, any>>(`${API}/live/football/${m.matchId}?language=es`);
  if (isErr(live)) return live;
  if (!live.HomeTeam?.Players?.length) {
    return { match: matchLabel(m), matchId: m.matchId, nota: "Alineación aún no publicada (suele salir ~1h antes del partido)." };
  }
  return {
    match: matchLabel(m),
    matchId: m.matchId,
    home: curateRoster(live.HomeTeam, m.homeEs),
    away: curateRoster(live.AwayTeam, m.awayEs),
  };
}

// --- historial de selección / head-to-head (teamform) ------------------------
/** Historial de una selección (record + últimos partidos rastreados por FIFA: Mundiales,
 * clasificatorias, amistosos — NO incluye copas continentales como Copa América).
 * Si se pasa `opponent`, filtra a los cruces históricos entre ambas (head-to-head parcial:
 * suele ser más pobre que un H2H de fuente deportiva dedicada). */
export async function getFifaTeamHistory(args: { team: string; opponent?: string; limit?: number }) {
  const t = await resolveTeamId(args.team);
  if (isErr(t)) return t;
  const data = await fifaFetch<Record<string, any>>(`${API}/teamform/${t.id}?language=es`);
  if (isErr(data)) return data;
  let list: Record<string, any>[] = data.MatchesList ?? [];
  if (args.opponent) {
    list = list.filter((mm) => {
      const home = pick(mm.Home?.TeamName), away = pick(mm.Away?.TeamName);
      return namesMatch(home, args.opponent!) || namesMatch(away, args.opponent!);
    });
  }
  const limit = args.limit ?? 10;
  const partidos = list.slice(0, limit).map((mm) => ({
    fecha: (mm.Date ?? "").slice(0, 10),
    local: pick(mm.Home?.TeamName),
    visita: pick(mm.Away?.TeamName),
    marcador: `${mm.Home?.Score ?? "-"}-${mm.Away?.Score ?? "-"}`,
    competicion: pick(mm.CompetitionName),
  }));
  return {
    equipo: t.name,
    record_historico: { jugados: data.MatchesPlayed, ganados: data.Wins, perdidos: data.Losses, empatados: data.Draws, gf: data.GoalsScored, gc: data.GoalsAgainst },
    partidos_vs: args.opponent ?? null,
    partidos,
    nota: args.opponent && !partidos.length
      ? "FIFA no tiene cruces históricos rastreados entre estos dos equipos (su cobertura es Mundiales/clasificatorias/amistosos, no todas las competiciones)."
      : undefined,
  };
}

// --- standings de grupo (calculado desde el calendario, sin endpoint dedicado) ---
interface GroupRow {
  team: string; pj: number; g: number; e: number; p: number;
  gf: number; gc: number; dg: number; pts: number;
}

/** Tabla de posiciones de los grupos del Mundial, CALCULADA a partir de los resultados
 * del calendario (FIFA no expone un endpoint de standings dedicado). Args: { group?: 'A'..'L' }. */
export async function getFifaStandings(args: { group?: string }) {
  const cal = await getCalendar();
  if (isErr(cal)) return cal;
  const groupStage = cal.filter((m) => m.group && m.status === 0); // solo fase de grupos, jugados
  const byGroup: Record<string, Record<string, GroupRow>> = {};
  for (const m of groupStage) {
    if (args.group && !m.group.toLowerCase().includes(args.group.toLowerCase())) continue;
    const g = (byGroup[m.group] ??= {});
    const home = (g[m.homeEs] ??= { team: m.homeEs, pj: 0, g: 0, e: 0, p: 0, gf: 0, gc: 0, dg: 0, pts: 0 });
    const away = (g[m.awayEs] ??= { team: m.awayEs, pj: 0, g: 0, e: 0, p: 0, gf: 0, gc: 0, dg: 0, pts: 0 });
    const [hs, as_] = m.score;
    if (hs == null || as_ == null) continue;
    home.pj++; away.pj++;
    home.gf += hs; home.gc += as_; away.gf += as_; away.gc += hs;
    if (hs > as_) { home.g++; home.pts += 3; away.p++; }
    else if (hs < as_) { away.g++; away.pts += 3; home.p++; }
    else { home.e++; away.e++; home.pts++; away.pts++; }
  }
  const tabla: Record<string, GroupRow[]> = {};
  for (const [g, teams] of Object.entries(byGroup)) {
    tabla[g] = Object.values(teams)
      .map((r) => ({ ...r, dg: r.gf - r.gc }))
      .sort((a, b) => b.pts - a.pts || b.dg - a.dg || b.gf - a.gf);
  }
  return { tabla, nota: "Calculada desde los resultados del calendario FIFA (no hay endpoint de standings oficial); no aplica desempates especiales (fair play, sorteo)." };
}
