// client.ts — lógica de fetch compartida entre worker.ts (CF Worker) e index.ts (stdio).
// Envuelve dos fuentes: la API ya existente de lluvia-bolivia (dato MEDIDO, SYNOP/Ogimet)
// y Open-Meteo Forecast API (pronóstico de modelo, NUNCA presentado como medido).

const LLUVIA_API = "https://lluvia-bolivia.carlos-cb4.workers.dev";
const TIMEOUT_MS = 10_000;

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
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

export async function getLluviaDia(ciudad: string, fecha?: string): Promise<DiaResponse> {
  const f = fecha ?? todayLaPaz();
  const url = `${LLUVIA_API}/api/dia?fecha=${encodeURIComponent(f)}&ciudad=${encodeURIComponent(ciudad)}`;
  return fetchJson<DiaResponse>(url);
}

export async function getLluviaSerie(ciudad: string, desde: string, hasta: string): Promise<unknown> {
  const url = `${LLUVIA_API}/api/lluvia?desde=${encodeURIComponent(desde)}&hasta=${encodeURIComponent(hasta)}&ciudad=${encodeURIComponent(ciudad)}`;
  return fetchJson(url);
}

export async function getLluviaResumen(desde: string, hasta: string, ciudad?: string): Promise<unknown> {
  const params = new URLSearchParams({ desde, hasta });
  if (ciudad) params.set("ciudad", ciudad);
  return fetchJson(`${LLUVIA_API}/api/resumen?${params.toString()}`);
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

export interface PronosticoDia {
  fecha: string;
  mm_estimado: number;
  probabilidad_pct: number | null;
}

export interface PronosticoResult {
  ciudad: string;
  fuente: string;
  dias: PronosticoDia[];
}

interface OpenMeteoResponse {
  daily: {
    time: string[];
    precipitation_sum: number[];
    precipitation_probability_max?: number[];
  };
}

export async function getPronosticoLluvia(ciudad: string, dias?: number): Promise<PronosticoResult> {
  const coord = CIUDADES[ciudad];
  if (!coord) {
    throw new Error(`Ciudad desconocida: "${ciudad}". Ciudades válidas: ${Object.keys(CIUDADES).join(", ")}`);
  }
  const n = Math.min(Math.max(dias ?? 7, 1), 16);
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${coord.lat}&longitude=${coord.lon}` +
    `&daily=precipitation_sum,precipitation_probability_max&timezone=America%2FLa_Paz&forecast_days=${n}`;
  const data = await fetchJson<OpenMeteoResponse>(url);
  const diasResult: PronosticoDia[] = data.daily.time.map((fecha, i) => ({
    fecha,
    mm_estimado: data.daily.precipitation_sum[i],
    probabilidad_pct: data.daily.precipitation_probability_max?.[i] ?? null,
  }));
  return {
    ciudad,
    fuente: "Open-Meteo (pronóstico de modelo, NO dato medido)",
    dias: diasResult,
  };
}
