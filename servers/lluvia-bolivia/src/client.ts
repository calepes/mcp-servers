// client.ts — lógica de fetch compartida entre worker.ts (CF Worker) e index.ts (stdio).
// Envuelve dos fuentes: la API ya existente de lluvia-bolivia (dato MEDIDO, SYNOP/Ogimet)
// y Open-Meteo Forecast API (pronóstico de modelo, NUNCA presentado como medido).

const LLUVIA_API = "https://lluvia-bolivia.carlos-cb4.workers.dev";
const TIMEOUT_MS = 10_000;

// Cloudflare bloquea (404, sin invocar destino) el fetch público a *.workers.dev
// cuando el origen es OTRO Worker (anti-SSRF) — por eso las llamadas a LLUVIA_API
// aceptan un `fetcher` opcional: worker.ts pasa el service binding a lluvia-bolivia,
// index.ts (stdio, Node) no pasa nada y usa fetch global normal.
type Fetcher = typeof fetch;

async function fetchJson<T>(url: string, fetcher: Fetcher = fetch): Promise<T> {
  const res = await fetcher(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`fetch falló: ${res.status} (${url})`);
  return (await res.json()) as T;
}

function todayLaPaz(): string {
  // Intl con timeZone da YYYY-MM-DD directo en locale en-CA — evita hacer aritmética
  // de offset a mano (ver gotcha "nunca derivar fecha con toISOString().slice()" de
  // Jano/CLAUDE.md, que aplica igual acá aunque este archivo corra también en el Worker).
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/La_Paz" }).format(new Date());
}

export interface DiaContexto {
  etiqueta: string;
  detalle: string;
  percentil: number | null;
  max_hist: number;
}

export interface DiaResponse {
  fecha: string;
  ciudad: string;
  total: number | null;
  contexto?: DiaContexto | null;
  [key: string]: unknown;
}

export async function getLluviaDia(ciudad: string, fecha?: string, fetcher?: Fetcher): Promise<DiaResponse> {
  const f = fecha ?? todayLaPaz();
  const url = `${LLUVIA_API}/api/dia?fecha=${encodeURIComponent(f)}&ciudad=${encodeURIComponent(ciudad)}`;
  return fetchJson<DiaResponse>(url, fetcher);
}

export async function getLluviaSerie(ciudad: string, desde: string, hasta: string, fetcher?: Fetcher): Promise<unknown> {
  const url = `${LLUVIA_API}/api/lluvia?desde=${encodeURIComponent(desde)}&hasta=${encodeURIComponent(hasta)}&ciudad=${encodeURIComponent(ciudad)}`;
  return fetchJson(url, fetcher);
}

export async function getLluviaResumen(desde: string, hasta: string, ciudad?: string, fetcher?: Fetcher): Promise<unknown> {
  const params = new URLSearchParams({ desde, hasta });
  if (ciudad) params.set("ciudad", ciudad);
  return fetchJson(`${LLUVIA_API}/api/resumen?${params.toString()}`, fetcher);
}

export interface CiudadCoord {
  lat: number;
  lon: number;
}

// Coordenadas públicas de las 11 estaciones/aeropuertos que ya cubre lluvia-bolivia
// (verificadas contra fuentes de aviación públicas — metar-taf.com, SkyVector,
// world-airport-codes — el 2026-08-16). Nombres EXACTOS del campo `ciudad` en D1
// (ver lluvia_bolivia.py STATIONS).
export const CIUDADES: Record<string, CiudadCoord> = {
  "La Paz": { lat: -16.5103, lon: -68.1894 },
  "Santa Cruz": { lat: -17.6448, lon: -63.1354 },
  "Santa Cruz (centro)": { lat: -17.8116, lon: -63.1715 },
  "Cochabamba": { lat: -17.4211, lon: -66.1771 },
  "Oruro": { lat: -17.9626, lon: -67.0762 },
  "Tarija": { lat: -21.5557, lon: -64.7013 },
  "Trinidad": { lat: -14.8208, lon: -64.9167 },
  "Cobija": { lat: -11.0403, lon: -68.7833 },
  "Riberalta": { lat: -11.0083, lon: -66.075 },
  "Potosí": { lat: -19.5431, lon: -65.7236 },
  "Sucre": { lat: -19.0069, lon: -65.2886 },
};

export interface EstimacionCategoria {
  etiqueta: string;
  percentil_aprox: number;
  max_hist: number;
}

export interface PronosticoDia {
  fecha: string;
  mm_estimado: number;
  probabilidad_pct: number | null;
  estimacion: EstimacionCategoria | null;
}

export interface PronosticoResult {
  ciudad: string;
  fuente: string;
  nota_estimacion: string;
  dias: PronosticoDia[];
}

interface OpenMeteoResponse {
  daily: {
    time: string[];
    precipitation_sum: number[];
    precipitation_probability_max?: number[];
  };
}

interface ReferenciaCiudad {
  ciudad: string;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  p99: number;
  max_hist: number;
}

interface ReferenciaResponse {
  ciudades: ReferenciaCiudad[];
}

// La escala relativa (percentiles de días de lluvia) vive en el worker
// lluvia-bolivia (`/api/referencia`), calculada sobre lluvia MEDIDA. Cambia
// poco (se recalcula con nuevos días medidos) — cache in-memory 24h alcanza.
let referenciaCache: { data: ReferenciaResponse; ts: number } | null = null;
const REFERENCIA_TTL_MS = 24 * 3600_000;

async function getReferencia(fetcher?: Fetcher): Promise<ReferenciaResponse> {
  if (referenciaCache && Date.now() - referenciaCache.ts < REFERENCIA_TTL_MS) {
    return referenciaCache.data;
  }
  const data = await fetchJson<ReferenciaResponse>(`${LLUVIA_API}/api/referencia`, fetcher);
  referenciaCache = { data, ts: Date.now() };
  return data;
}

// Mismos cortes que `categoria()` en el worker (index.js), reimplementados acá
// porque ese endpoint solo categoriza lluvia YA medida — un valor pronosticado
// nunca pasa por esa ruta. El percentil es una interpolación lineal entre los
// puntos conocidos de la escala (p50/p75/p90/p95/p99/max_hist), no un cálculo
// exacto sobre la serie — por eso se marca siempre como aproximación.
function categorizarEstimado(mm: number, ref: ReferenciaCiudad): EstimacionCategoria | null {
  if (mm < 0.1) return null;
  const etiqueta =
    mm < ref.p50 ? "Poca" :
    mm < ref.p75 ? "Normal" :
    mm < ref.p90 ? "Considerable" :
    mm < ref.p99 ? "Fuerte" : "Excepcional";

  const puntos: [number, number][] = [
    [0, 0], [ref.p50, 50], [ref.p75, 75], [ref.p90, 90], [ref.p95, 95], [ref.p99, 99], [ref.max_hist, 100],
  ];
  let percentil_aprox = 100;
  for (let i = 1; i < puntos.length; i++) {
    const [mmPrev, pPrev] = puntos[i - 1];
    const [mmCur, pCur] = puntos[i];
    if (mm <= mmCur) {
      percentil_aprox = mmCur === mmPrev ? pCur : pPrev + ((mm - mmPrev) / (mmCur - mmPrev)) * (pCur - pPrev);
      break;
    }
  }
  return { etiqueta, percentil_aprox: Math.round(percentil_aprox), max_hist: ref.max_hist };
}

export async function getPronosticoLluvia(ciudad: string, dias?: number, fetcher?: Fetcher): Promise<PronosticoResult> {
  const coord = CIUDADES[ciudad];
  if (!coord) {
    throw new Error(`Ciudad desconocida: "${ciudad}". Ciudades válidas: ${Object.keys(CIUDADES).join(", ")}`);
  }
  const n = Math.min(Math.max(dias ?? 7, 1), 16);
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${coord.lat}&longitude=${coord.lon}` +
    `&daily=precipitation_sum,precipitation_probability_max&timezone=America%2FLa_Paz&forecast_days=${n}`;
  const [data, referencia] = await Promise.all([fetchJson<OpenMeteoResponse>(url), getReferencia(fetcher)]);
  const ref = referencia.ciudades.find((c) => c.ciudad === ciudad) ?? null;
  const diasResult: PronosticoDia[] = data.daily.time.map((fecha, i) => {
    const mm = data.daily.precipitation_sum[i];
    return {
      fecha,
      mm_estimado: mm,
      probabilidad_pct: data.daily.precipitation_probability_max?.[i] ?? null,
      estimacion: ref ? categorizarEstimado(mm, ref) : null,
    };
  });
  return {
    ciudad,
    fuente: "Open-Meteo (pronóstico de modelo, NO dato medido)",
    nota_estimacion:
      "El campo 'estimacion' de cada día es una referencia aproximada (interpolación sobre la escala " +
      "histórica de lluvia MEDIDA de la ciudad) — no hay percentil oficial para un valor pronosticado.",
    dias: diasResult,
  };
}
