import { handleMcp, type McpTool, type McpEnv } from 'worker-mcp-utils';

interface Env extends McpEnv {
  GOOGLE_MAPS_API_KEY: string;
}

/* ── Types ── */

interface Station {
  name: string;
  company: string;
  lat: number;
  lon: number;
  litros: number;
  capacidad: number;
}

interface StationResult extends Station {
  pct: number;
  status: string;
  distKm?: number;
  etaMin?: number;
  mapsUrl: string;
}

/* ── Proxy base (for subrequest via service binding or direct scraping) ── */
// CF error 1042: workers.dev subrequests are blocked for same-account workers.
// We replicate the scraping logic directly here instead.

const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8',
  'Accept-Language': 'es-419,es;q=0.9,en;q=0.8',
};

interface StationDef {
  name: string;
  type: 'genex' | 'ec2' | 'gasgroup' | 'gsheets';
  company: string;
  lat: number;
  lon: number;
  url: string;
  key?: string;
  fuel?: string;
  codigo?: string;
  product?: string;
}

const STATIONS: StationDef[] = [
  // Genex (comparten HTML, una sola fetch)
  { name: 'Genex Banzer', type: 'genex', company: 'Genex', lat: -17.7577, lon: -63.1779, url: 'https://genex.com.bo/estaciones/', key: 'GENEX I', fuel: 'G. ESPECIAL+' },
  { name: 'Vangas', type: 'genex', company: 'Genex', lat: -17.7772, lon: -63.2158, url: 'https://genex.com.bo/estaciones/', key: 'VANGAS', fuel: 'G. ESPECIAL+' },
  { name: 'Genex Guaracachi', type: 'genex', company: 'Genex', lat: -17.7772, lon: -63.1399, url: 'https://genex.com.bo/estaciones/', key: 'GENEX GUARACACHI', fuel: 'G. ESPECIAL+' },
  { name: 'Genex Trompillo', type: 'genex', company: 'Genex', lat: -17.8072, lon: -63.1708, url: 'https://genex.com.bo/estaciones/', key: 'GENEX TROMPILLO', fuel: 'G. ESPECIAL+' },
  { name: 'Genex III', type: 'genex', company: 'Genex', lat: -17.7752, lon: -63.1653, url: 'https://genex.com.bo/estaciones/', key: 'GENEX III', fuel: 'G. ESPECIAL+' },
  { name: 'Genex Mutualista', type: 'genex', company: 'Genex', lat: -17.7605, lon: -63.1578, url: 'https://genex.com.bo/estaciones/', key: 'GENEX MUTUALISTA', fuel: 'G. ESPECIAL+' },
  { name: 'Genex V', type: 'genex', company: 'Genex', lat: -17.8013, lon: -63.1895, url: 'https://genex.com.bo/estaciones/', key: 'GENEX V', fuel: 'G. ESPECIAL+' },
  { name: 'Genex IV', type: 'genex', company: 'Genex', lat: -17.7902, lon: -63.1649, url: 'https://genex.com.bo/estaciones/', key: 'GENEX IV', fuel: 'G. ESPECIAL+' },
  { name: 'Genex II', type: 'genex', company: 'Genex', lat: -17.7928, lon: -63.194, url: 'https://genex.com.bo/estaciones/', key: 'GENEX II', fuel: 'G. ESPECIAL+' },
  { name: 'Jarajorechi', type: 'genex', company: 'Genex', lat: -17.3194, lon: -63.2691, url: 'https://genex.com.bo/estaciones/', key: 'JARAJORECHI', fuel: 'G. ESPECIAL+' },
  { name: 'Aracataca', type: 'genex', company: 'Genex', lat: -17.3286, lon: -63.2632, url: 'https://genex.com.bo/estaciones/', key: 'ARACATACA', fuel: 'G. ESPECIAL+' },
  // Biopetrol EC2
  { name: 'Equipetrol', type: 'ec2', company: 'Biopetrol', lat: -17.7545, lon: -63.197, url: 'http://ec2-3-22-240-207.us-east-2.compute.amazonaws.com/guiasaldos/main/donde/134', key: 'EQUIPETROL' },
  { name: 'Pirai', type: 'ec2', company: 'Biopetrol', lat: -17.786, lon: -63.2045, url: 'http://ec2-3-22-240-207.us-east-2.compute.amazonaws.com/guiasaldos/main/donde/134', key: 'PIRAI' },
  { name: 'Alemana', type: 'ec2', company: 'Biopetrol', lat: -17.7691, lon: -63.171, url: 'http://ec2-3-22-240-207.us-east-2.compute.amazonaws.com/guiasaldos/main/donde/134', key: 'Alemana' },
  { name: 'López', type: 'ec2', company: 'Biopetrol', lat: -17.7257, lon: -63.1654, url: 'http://ec2-3-22-240-207.us-east-2.compute.amazonaws.com/guiasaldos/main/donde/134', key: 'Lopez' },
  { name: 'Viru Viru', type: 'ec2', company: 'Biopetrol', lat: -17.6759, lon: -63.159, url: 'http://ec2-3-22-240-207.us-east-2.compute.amazonaws.com/guiasaldos/main/donde/134', key: 'Viru Viru' },
  { name: 'Gasco', type: 'ec2', company: 'Biopetrol', lat: -17.7594, lon: -63.1796, url: 'http://ec2-3-22-240-207.us-east-2.compute.amazonaws.com/guiasaldos/main/donde/134', key: 'Gasco' },
  { name: 'Beni', type: 'ec2', company: 'Biopetrol', lat: -17.7694, lon: -63.1788, url: 'http://ec2-3-22-240-207.us-east-2.compute.amazonaws.com/guiasaldos/main/donde/134', key: 'BENI' },
  { name: 'Berea', type: 'ec2', company: 'Biopetrol', lat: -17.8377, lon: -63.2382, url: 'http://ec2-3-22-240-207.us-east-2.compute.amazonaws.com/guiasaldos/main/donde/134', key: 'BEREA' },
  { name: 'Cabezas', type: 'ec2', company: 'Biopetrol', lat: -18.7875, lon: -63.3142, url: 'http://ec2-3-22-240-207.us-east-2.compute.amazonaws.com/guiasaldos/main/donde/134', key: 'CABEZAS' },
  { name: 'La Teca', type: 'ec2', company: 'Biopetrol', lat: -17.7641, lon: -63.0714, url: 'http://ec2-3-22-240-207.us-east-2.compute.amazonaws.com/guiasaldos/main/donde/134', key: 'LA TECA' },
  { name: 'Monteverde', type: 'ec2', company: 'Biopetrol', lat: -17.3267, lon: -63.2751, url: 'http://ec2-3-22-240-207.us-east-2.compute.amazonaws.com/guiasaldos/main/donde/134', key: 'MONTEVERDE' },
  { name: 'Paraguá', type: 'ec2', company: 'Biopetrol', lat: -17.7651, lon: -63.1495, url: 'http://ec2-3-22-240-207.us-east-2.compute.amazonaws.com/guiasaldos/main/donde/134', key: 'PARAGUA' },
  { name: 'Sur Central', type: 'ec2', company: 'Biopetrol', lat: -17.7999, lon: -63.1805, url: 'http://ec2-3-22-240-207.us-east-2.compute.amazonaws.com/guiasaldos/main/donde/134', key: 'SUR CENTRAL' },
  // Gasgroup
  { name: 'Urubó', type: 'gasgroup', company: 'Orsa', lat: -17.7535, lon: -63.2213, url: 'https://gasgroup.com.bo/estaciones/santacruz', codigo: 'CTqmwWgj', product: 'GASOLINA ESPECIAL' },
  { name: 'Orsa Alemana', type: 'gasgroup', company: 'Orsa', lat: -17.7524, lon: -63.1634, url: 'https://gasgroup.com.bo/estaciones/santacruz', codigo: '39gbIJkJ', product: 'GASOLINA ESPECIAL' },
  // Rivero (Google Sheets)
  { name: 'Rivero', type: 'gsheets', company: 'Rivero', lat: -17.7625, lon: -63.1805, url: 'https://docs.google.com/spreadsheets/u/0/d/e/2CAIWO3els60V5S1vVAh0cccQxdcZ1MYZhD9A1pQ-ojCNPoNh-vJjHhJaUalVsDLQivYf_Z23Un8mEaePxSg/gviz/chartiframe?oid=1546358769&resourcekey', product: 'ESPECIAL' },
];

const GASGROUP_MIN_LITROS = 1500;

/* ── Parsers ── */

function normalizeLiters(raw: string): number {
  if (!raw) return 0;
  const digits = raw.replace(/[^\d]/g, '');
  return digits ? Number(digits) : 0;
}

function parseGenex(html: string | null, key: string, fuel: string): number {
  if (!html) return 0;
  const clean = html.replace(/<[^>]*>/g, ' ').replace(/&amp;/gi, '&').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ');
  const escapedFuel = fuel.replace(/\./g, '\\.').replace(/\+/g, '\\+');
  const re = new RegExp(`${key}[\\s\\S]*?${escapedFuel}[\\s\\S]*?(\\d{1,3}(?:[\\.,]\\d{3})*|\\d+)\\s*litros`, 'i');
  const m = clean.match(re);
  return m ? normalizeLiters(m[1]) : 0;
}

function parseEC2(html: string | null, key: string): number {
  if (!html) return 0;
  const clean = html.replace(/\s+/g, ' ');
  const re = new RegExp(`${key}[\\s\\S]*?Volumen disponible[\\s\\S]*?(\\d{1,3}(?:,\\d{3})*)\\s*Lts`, 'i');
  const m = clean.match(re);
  return m ? normalizeLiters(m[1]) : 0;
}

function parseGasGroup(json: any, product: string, codigo: string): number {
  if (!json?.estaciones) return 0;
  const estacion = json.estaciones.find((e: any) => e.codigo === codigo);
  if (!estacion?.tanques) return 0;
  let total = 0;
  for (const t of estacion.tanques) {
    if (t.producto?.toUpperCase().includes(product)) total += t.litros || 0;
  }
  const rounded = Math.round(total);
  return rounded >= GASGROUP_MIN_LITROS ? rounded : 0;
}

function parseChartJson(html: string | null, product: string): number {
  if (!html) return 0;
  const upper = product.toUpperCase();
  const m = html.match(/'chartJson'\s*:\s*'((?:[^'\\]|\\.)*)'/);
  if (!m) return 0;
  try {
    const unescaped = m[1].replace(/\\(x([0-9a-fA-F]{2})|.)/g, (_match: string, esc: string, hex: string) => {
      if (hex) return String.fromCharCode(parseInt(hex, 16));
      if (esc === '\\') return '\\';
      if (esc === "'") return "'";
      if (esc === 'n') return '\n';
      return esc;
    });
    const chart = JSON.parse(unescaped);
    const rows = chart?.dataTable?.rows;
    if (rows) {
      for (const row of rows) {
        const cells = row.c || [];
        const hasProduct = cells.some((c: any) => typeof c?.v === 'string' && c.v.toUpperCase().includes(upper));
        if (!hasProduct) continue;
        for (const c of cells) {
          if (typeof c?.v === 'number' && c.v > 0) return Math.round(c.v);
        }
      }
    }
  } catch (_) {}
  return 0;
}

/* ── Fetch all stations from sources ── */

async function fetchAllStations(): Promise<Station[]> {
  const uniqueUrls = [...new Set(STATIONS.map((s) => s.url))];
  const fetchMap = new Map<string, unknown>();

  await Promise.all(
    uniqueUrls.map(async (url) => {
      try {
        const parsed = new URL(url);
        const headers: Record<string, string> = { ...BROWSER_HEADERS };
        const isGasgroup = parsed.hostname === 'gasgroup.com.bo';
        if (isGasgroup) {
          headers['Accept'] = 'application/json';
          headers['X-Requested-With'] = 'XMLHttpRequest';
        }
        const resp = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
        if (!resp.ok) { fetchMap.set(url, null); return; }
        fetchMap.set(url, isGasgroup ? await resp.json() : await resp.text());
      } catch {
        fetchMap.set(url, null);
      }
    }),
  );

  // Build capacidad map from observed litros (max ever seen)
  const litrosMap = new Map<string, number>();

  const rawResults = STATIONS.map((s) => {
    const raw = fetchMap.get(s.url);
    let litros = 0;
    try {
      if (s.type === 'genex') litros = parseGenex(raw as string | null, s.key!, s.fuel!);
      else if (s.type === 'ec2') litros = parseEC2(raw as string | null, s.key!);
      else if (s.type === 'gasgroup') litros = parseGasGroup(raw, s.product!, s.codigo!);
      else if (s.type === 'gsheets') litros = parseChartJson(raw as string | null, s.product!);
    } catch (_) {}
    if (litros > 0) litrosMap.set(s.name, litros);
    return { name: s.name, company: s.company, lat: s.lat, lon: s.lon, litros };
  });

  // capacidad: use known static capacities from proxy KV (hardcoded from observed data)
  // Since we can't access the proxy KV directly, use litros as a lower bound
  // and track max across this request for pct calculation
  return rawResults.map((r) => ({
    ...r,
    capacidad: 0, // Will be enriched if we have historical data
  }));
}

/* ── Helpers ── */

function statusEmoji(litros: number, capacidad: number): string {
  if (litros === 0) return '⚪';
  if (!capacidad) return '🔵';
  const pct = litros / capacidad;
  if (pct >= 0.5) return '🟢';
  if (pct >= 0.2) return '🟠';
  return '🔴';
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatKm(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

/* ── Google Maps Distance Matrix API (hasta 25 destinos por request) ── */

async function googleDistMatrix(
  originLat: number,
  originLon: number,
  stations: Station[],
  apiKey: string,
): Promise<{ distKm: number; etaMin: number }[] | null> {
  if (!apiKey) return null;
  const results: { distKm: number; etaMin: number }[] = [];
  const BATCH = 25;

  for (let i = 0; i < stations.length; i += BATCH) {
    const batch = stations.slice(i, i + BATCH);
    const dests = batch.map((s) => `${s.lat},${s.lon}`).join('|');
    const url =
      `https://maps.googleapis.com/maps/api/distancematrix/json` +
      `?origins=${originLat},${originLon}` +
      `&destinations=${encodeURIComponent(dests)}` +
      `&mode=driving` +
      `&key=${apiKey}`;

    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      const json: any = await resp.json();
      if (json.status !== 'OK') return null;
      for (const el of json.rows[0].elements) {
        if (el.status === 'OK') {
          results.push({
            distKm: el.distance.value / 1000,
            etaMin: Math.round(el.duration.value / 60),
          });
        } else {
          results.push({ distKm: -1, etaMin: -1 });
        }
      }
    } catch {
      return null;
    }
  }
  return results;
}

/* ── Core tool ── */

async function getFuelStatus(
  args: {
    userLat?: number;
    userLon?: number;
    limit?: number;
    minPct?: number;
  },
  env: Env,
): Promise<string> {
  const limit = args.limit ?? 10;
  const minPct = args.minPct ?? 0;

  const stations = await fetchAllStations();

  // Filtrar por porcentaje mínimo (solo aplica si hay capacidad conocida)
  let filtered =
    minPct > 0
      ? stations.filter((s) => s.litros > 0 && (s.capacidad > 0 ? (s.litros / s.capacidad) * 100 >= minPct : true))
      : stations;

  // Calcular distancias si hay coordenadas
  let withDist: StationResult[];
  if (args.userLat !== undefined && args.userLon !== undefined) {
    const { userLat: lat, userLon: lon } = args;

    // Pre-ordenar por haversine para mandar solo candidatos cercanos a Google Maps
    const withHaversine = filtered
      .map((s) => ({
        ...s,
        hkm: haversineKm(lat, lon, s.lat, s.lon),
      }))
      .sort((a, b) => a.hkm - b.hkm);

    // Calcular distancias reales vía Google Maps (o fallback haversine)
    const googleDist = await googleDistMatrix(lat, lon, withHaversine, env.GOOGLE_MAPS_API_KEY);

    withDist = withHaversine
      .map((s, i) => {
        const gd = googleDist?.[i];
        const distKm = gd && gd.distKm > 0 ? gd.distKm : s.hkm;
        const etaMin = gd && gd.etaMin > 0 ? gd.etaMin : undefined;
        const pct = s.capacidad > 0 ? Math.round((s.litros / s.capacidad) * 100) : 0;
        return {
          ...s,
          pct,
          status: statusEmoji(s.litros, s.capacidad),
          distKm,
          etaMin,
          mapsUrl: `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}`,
        };
      })
      .sort((a, b) => a.distKm! - b.distKm!);
  } else {
    // Sin coordenadas: ordenar por litros descendente
    withDist = filtered.sort((a, b) => b.litros - a.litros).map((s) => {
      const pct = s.capacidad > 0 ? Math.round((s.litros / s.capacidad) * 100) : 0;
      return {
        ...s,
        pct,
        status: statusEmoji(s.litros, s.capacidad),
        mapsUrl: `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}`,
      };
    });
  }

  const top = withDist.slice(0, limit);

  if (top.length === 0) {
    return minPct > 0
      ? `No hay estaciones con más de ${minPct}% de capacidad disponibles.`
      : 'No hay datos de estaciones disponibles.';
  }

  const lines = top.map((s) => {
    const litrosStr =
      s.litros > 0
        ? `${s.litros.toLocaleString('es-BO')} L${s.pct > 0 ? ` (${s.pct}%)` : ''}`
        : 'sin datos';
    const distStr = s.distKm !== undefined ? ` · ${formatKm(s.distKm)}` : '';
    const etaStr = s.etaMin !== undefined ? ` ~${s.etaMin} min` : '';
    return `${s.status} ${s.name} (${s.company}) — ${litrosStr}${distStr}${etaStr} · 📍 ${s.mapsUrl}`;
  });

  const header =
    args.userLat !== undefined
      ? 'Estaciones más cercanas con combustible:'
      : 'Estaciones con más combustible:';

  const total = stations.filter((s) => s.litros > 0).length;
  const footer = `\n${total} de ${stations.length} estaciones con datos disponibles.`;

  return `${header}\n${lines.join('\n')}${footer}`;
}

/* ── Tools ── */

const TOOLS: McpTool[] = [
  {
    name: 'getFuelStatus',
    description:
      'Disponibilidad de Gasolina Especial en 27 estaciones de Santa Cruz de la Sierra, Bolivia. ' +
      'Si se pasan userLat/userLon, ordena por distancia real (Google Maps) y calcula ETA. ' +
      'Sin coordenadas, ordena por litros disponibles. Incluye links Google Maps por estación.',
    inputSchema: {
      type: 'object',
      properties: {
        userLat: {
          type: 'number',
          description: 'Latitud del usuario para ordenar por distancia (ej: -17.756)',
        },
        userLon: {
          type: 'number',
          description: 'Longitud del usuario (ej: -63.235)',
        },
        limit: {
          type: 'number',
          description: 'Máximo de estaciones a retornar (default 10)',
        },
        minPct: {
          type: 'number',
          description: 'Filtrar estaciones con menos de N% de capacidad (default 0)',
        },
      },
      required: [],
    },
    annotations: { readOnlyHint: true },
  },
];

/* ── Worker export ── */

export default {
  fetch(req: Request, env: Env): Promise<Response> {
    return handleMcp(req, env, TOOLS, 'combustible', async (name, args) => {
      if (name === 'getFuelStatus') return getFuelStatus(args as Parameters<typeof getFuelStatus>[0], env);
      throw new Error(`Unknown tool: ${name}`);
    });
  },
} satisfies ExportedHandler<Env>;
