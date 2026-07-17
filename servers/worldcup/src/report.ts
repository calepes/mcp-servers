// Reportes consolidados de un partido: juntan API-Football + FIFA en una sola
// llamada y devuelven datos estructurados POR SECCIONES + una guía de narración
// (`_comoPresentar`) que viaja con los datos, para que cualquier consumidor
// (Jano, sesión interactiva, otro bot) produzca el MISMO formato de análisis sin
// tener que pedírselo. Patrón mcp-consumer-pattern.
//
//   getMatchReport  -> partido JUGADO: cronología + básicas (AF) + táctico + físico
//                      + power ranking (FIFA). El análisis "cómo y por qué" pasó.
//   getMatchPreview -> partido (futuro o no): predicción (Predictor) + historial +
//                      forma + lesiones + cuotas + alineaciones. La previa.

import {
  getFixtures, getMatchEvents, getMatchStats, getMatchDetail,
  getH2H, getInjuries, getOdds, getLineups,
} from "./apifootball.js";
import {
  resolveMatch, getFifaMatchStats, getFifaPlayerStats, getFifaPowerRanking,
} from "./fifa.js";
import { predictMatch } from "./predictor.js";

const isErr = (x: unknown): x is { error: string } =>
  !!x && typeof x === "object" && "error" in x;
const ok = <T>(x: T | { error: string }): T | null => (isErr(x) ? null : (x as T));

const norm = (s: string) =>
  (s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
function teamHit(afName: string, ...candidates: string[]): boolean {
  const a = norm(afName);
  return candidates.some((c) => {
    const n = norm(c);
    return n && (a === n || a.includes(n) || n.includes(a));
  });
}

// Encuentra el fixture de API-Football por nombres (en cualquier orden), probando
// los nombres en-GB e es-ES que trae FIFA. Devuelve el fixture procesado o null.
async function findAfFixture(homeEn: string, homeEs: string, awayEn: string, awayEs: string) {
  const fx = ok(await getFixtures());
  if (!fx) return null;
  return (
    (fx as any).fixtures.find((f: any) => {
      const homeOk = teamHit(f.home, homeEn, homeEs);
      const awayOk = teamHit(f.away, awayEn, awayEs);
      const swapOk = teamHit(f.home, awayEn, awayEs) && teamHit(f.away, homeEn, homeEs);
      return (homeOk && awayOk) || swapOk;
    }) ?? null
  );
}

type Args = { matchId?: string | number; teamA?: string; teamB?: string; date?: string };

// ---------------------------------------------------------------------------
const REPORT_GUIA =
  "Renderiza un análisis del partido con estas secciones EN ESTE ORDEN (usa los emojis). " +
  "1) Título con banderas + marcador (y penales si hubo). " +
  "2) 📅 Cronología: goles y tarjetas por minuto (de `cronologia`). " +
  "3) 📊 Básicas: tabla con posesión, tiros (a puerta), xG, córners, faltas (de `basicas`). " +
  "4) 🧠 Lectura táctica: tabla con control último tercio, presiones, pérdidas provocadas, amenaza (de `tactico`), " +
  "Y un párrafo titulado «el relato que las stats básicas no cuentan» que CONTRASTE quién presionó/corrió más vs quién dominó la zona de peligro. " +
  "5) 🏃 Físico: top de distancia recorrida y de velocidad punta (de `fisico`). " +
  "6) ⭐ Power ranking: mejor atacante / defensivo / creativo (de `powerRanking`). " +
  "Cierra con 1-2 frases de conclusión. Adapta el largo al canal (en Telegram más corto y con menos tablas). " +
  "Usa SOLO datos presentes en este objeto; NO inventes. Las secciones en null = fuente no disponible, omítelas.";

const PREVIEW_GUIA =
  "Renderiza una PREVIA del partido con estas secciones EN ESTE ORDEN (usa los emojis). " +
  "1) Título con banderas + fecha/hora Bolivia + fase + sede. " +
  "2) 🔮 Predicción (de `prediccion`): probabilidades 1/X/2, goles esperados y marcador más probable; aclara que el 1/X/2 es lo confiable. " +
  "3) 📈 Historial directo (de `historial`): resumen de victorias y últimos cruces. " +
  "4) 🩹 Bajas/lesiones (de `lesiones`) de cada equipo. " +
  "5) 💰 Cuotas (de `cuotas`) y 👥 alineaciones (de `alineaciones`) SOLO si no son null. " +
  "Cierra con una frase de pronóstico equilibrado. Adapta el largo al canal. " +
  "Usa SOLO datos presentes; NO inventes. Secciones null = no disponible, omítelas.";

// ---------------------------------------------------------------------------
/** Reporte completo de un partido JUGADO (API-Football + FIFA). */
export async function getMatchReport(args: Args) {
  const fm = await resolveMatch(args);
  if (isErr(fm)) return fm;
  if (!fm.idIFES) {
    return { error: `${fm.homeEs} vs ${fm.awayEs} no tiene stats avanzadas FIFA todavía (no jugado o sin publicar). Para la previa usa getMatchPreview.` };
  }

  const [fifaStats, fifaPlayers, fifaPR, afFix] = await Promise.all([
    getFifaMatchStats({ matchId: fm.matchId }),
    getFifaPlayerStats({ matchId: fm.matchId, top: 6 }),
    getFifaPowerRanking({ matchId: fm.matchId, top: 3 }),
    findAfFixture(fm.homeEn, fm.homeEs, fm.awayEn, fm.awayEs),
  ]);

  // API-Football por fixtureId (si lo encontramos)
  let cronologia: any = null, basicas: any = null, sede: string | null = null, horaBolivia: string | null = null, estado: string | null = null;
  if (afFix) {
    const [ev, st, det] = await Promise.all([
      getMatchEvents(afFix.id), getMatchStats(afFix.id), getMatchDetail(afFix.id),
    ]);
    const evd = ok(ev), std = ok(st), detd = ok(det) as any;
    if (evd) cronologia = (evd as any).events.filter((e: any) => e.type === "Goal" || e.type === "Card");
    if (std) basicas = (std as any).stats;
    if (detd) { sede = detd.venue ?? null; estado = detd.status ?? null; }
    horaBolivia = afFix.kickoffLabel ?? null;
  }

  // táctico + físico desde las stats FIFA por equipo
  const teams = (ok(fifaStats) as any)?.teams ?? [];
  const tactico = teams.map((t: any) => ({
    team: t.team,
    control_ultimo_tercio_pct: t.stats.control_ultimo_tercio_pct,
    presiones_defensivas: t.stats.presiones_defensivas,
    perdidas_provocadas: t.stats.perdidas_provocadas,
    rupturas_de_linea: `${t.stats.rupturas_de_linea}/${t.stats.rupturas_intentadas}`,
    amenaza: t.stats.amenaza,
  }));
  const fisico = {
    por_equipo: teams.map((t: any) => ({
      team: t.team, distancia_total_km: t.stats.distancia_total_km,
      sprints: t.stats.sprints, velocidad_punta_kmh: t.stats.velocidad_punta_kmh,
    })),
    jugadores: (ok(fifaPlayers) as any)?.players ?? null,
  };

  return {
    cabecera: {
      partido: (ok(fifaStats) as any)?.match ??
        `${fm.homeEs} ${fm.score[0] ?? "-"}-${fm.score[1] ?? "-"} ${fm.awayEs}`,
      fase: `${fm.stage}${fm.group ? " " + fm.group : ""}`,
      sede, hora_bolivia: horaBolivia, estado,
      matchId: fm.matchId, fixtureId: afFix?.id ?? null,
    },
    cronologia,
    basicas,
    tactico,
    fisico,
    powerRanking: ok(fifaPR),
    _comoPresentar: REPORT_GUIA,
    _fuentes: { cronologia_basicas: "API-Football", tactico_fisico_powerRanking: "FIFA" },
  };
}

// ---------------------------------------------------------------------------
/** Previa de un partido (futuro o cualquiera): predicción + historial + forma + lesiones + cuotas. */
export async function getMatchPreview(args: Args) {
  const fm = await resolveMatch(args);
  if (isErr(fm)) return fm;

  const afFix = await findAfFixture(fm.homeEn, fm.homeEs, fm.awayEn, fm.awayEs);

  const [h2h, injA, injB] = await Promise.all([
    getH2H(fm.homeEn, fm.awayEn),
    getInjuries(fm.homeEn),
    getInjuries(fm.awayEn),
  ]);

  // predicción del Predictor Python (nombres en inglés canónico de FIFA)
  let prediccion: any = null;
  try {
    const p = predictMatch(fm.homeEn, fm.awayEn) as any;
    prediccion = p && !p.error ? p : null;
  } catch { prediccion = null; }

  // cuotas + alineaciones solo si hay fixture AF
  let cuotas: any = null, alineaciones: any = null;
  if (afFix) {
    const [od, lu] = await Promise.all([getOdds(afFix.id), getLineups(afFix.id)]);
    cuotas = ok(od);
    const lud = ok(lu) as any;
    alineaciones = lud && lud.lineups?.length ? lud.lineups : null;
  }

  return {
    cabecera: {
      partido: `${fm.homeEs} vs ${fm.awayEs}`,
      fase: `${fm.stage}${fm.group ? " " + fm.group : ""}`,
      hora_bolivia: afFix?.kickoffLabel ?? null,
      sede: null,
      matchId: fm.matchId, fixtureId: afFix?.id ?? null,
    },
    prediccion,
    historial: ok(h2h),
    lesiones: { [fm.homeEs]: ok(injA), [fm.awayEs]: ok(injB) },
    cuotas,
    alineaciones,
    _comoPresentar: PREVIEW_GUIA,
    _fuentes: { prediccion: "Predictor (modelo propio)", historial_lesiones_cuotas_alineaciones: "API-Football" },
  };
}
