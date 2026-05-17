import { handleMcp, type McpTool, type McpEnv } from 'worker-mcp-utils';

interface Env extends McpEnv {}

// ---------------------------------------------------------------------------
// Constants — ported from consultar-vuelo.mjs
// ---------------------------------------------------------------------------

const AIRPORTS: Record<string, { name: string; city: string; query: string }> = {
  VVI: { name: 'Viru Viru', city: 'Santa Cruz', query: 'Viru Viru' },
  LPB: { name: 'El Alto', city: 'La Paz', query: 'El Alto' },
  CBB: { name: 'Jorge Wilstermann', city: 'Cochabamba', query: 'Jorge Wilstermann' },
  TJA: { name: 'Tarija', city: 'Tarija', query: 'Tarija' },
  SRE: { name: 'Sucre', city: 'Sucre', query: 'Sucre' },
  ORU: { name: 'Oruro', city: 'Oruro', query: 'Oruro' },
  UYU: { name: 'Uyuni', city: 'Uyuni', query: 'Uyuni' },
  CIJ: { name: 'Cobija', city: 'Cobija', query: 'Cobija' },
  RIB: { name: 'Riberalta', city: 'Riberalta', query: 'Riberalta' },
  RBQ: { name: 'Rurrenabaque', city: 'Rurrenabaque', query: 'Rurrenabaque' },
  TDD: { name: 'Trinidad', city: 'Trinidad', query: 'Trinidad' },
  GYA: { name: 'Guayaramerin', city: 'Guayaramerín', query: 'Guayaramerin' },
};

const AIRLINE_IATA: Record<string, string> = {
  'BOLIVIANA DE AVIACION': 'OB',
  'BOLIVIANA DE AVIACIÓN': 'OB',
  BOA: 'OB',
  ECOJET: 'EO',
  'ECO JET': 'EO',
  AMASZONAS: 'Z8',
  LATAM: 'LA',
  'LATAM AIRLINES': 'LA',
  'LATAM AIRLINES GROUP': 'LA',
  LAN: 'LA',
  'LAN AIRLINES': 'LA',
  SKY: 'H2',
  AVIANCA: 'AV',
  COPA: 'CM',
  'AMERICAN AIRLINES': 'AA',
  UNITED: 'UA',
  IBERIA: 'IB',
  FLYBONDI: 'FU',
};

const NAABOL_BASE = 'https://fids.naabol.gob.bo/Fids/itin/vuelos';
const FETCH_TIMEOUT_MS = 8_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function airlineToIata(nombre: string): string | null {
  const key = (nombre || '').trim().toUpperCase();
  return AIRLINE_IATA[key] || null;
}

function parseFlightCode(input: string): { iata: string | null; numero: string | null } {
  const raw = String(input || '').trim().toUpperCase();
  if (!raw) return { iata: null, numero: null };
  const m = raw.match(/^([A-Z]{2,4})\s*(\d{1,5})$/);
  if (m) {
    const prefix = m[1];
    const numero = m[2];
    const iata = AIRLINE_IATA[prefix] || (prefix.length === 2 ? prefix : null);
    return { iata, numero };
  }
  if (/^\d{1,5}$/.test(raw)) return { iata: null, numero: raw };
  return { iata: null, numero: null };
}

function categorizeStatus(obsEs: string, obsEn: string): string {
  const en = (obsEn || '').trim().toUpperCase();
  const es = (obsEs || '').trim().toUpperCase();
  if (en.includes('CANCEL') || es.includes('CANCEL')) return 'cancelled';
  if (en.includes('PRE-BOARD') || en.includes('PRE BOARD') || es.includes('PRE-EMBARQUE') || es.includes('PRE EMBARQUE')) return 'pre-boarding';
  if (en.includes('BOARDING') || es.includes('ABORDANDO') || es.includes('EMBARQUE')) return 'boarding';
  if (en.includes('DELAY') || es.includes('RETRAS') || es.includes('DEMORA')) return 'delayed';
  if (en.includes('LANDED') || en.includes('TIERRA') || es.includes('ATERRIZ') || es.includes('EN TIERRA')) return 'landed';
  if (en.includes('DEPARTED') || es.includes('DESPACH') || es.includes('DESPEG')) return 'departed';
  if (en.includes('CHECK')) return 'check-in';
  if (en === '' || en.includes('ON TIME') || en.includes('CONFIRMED') || es === '' || es.includes('A TIEMPO') || es.includes('CONFIRMADO')) return 'on-time';
  return 'other';
}

function adjustForDelay(category: string, horaProgramada: string | null, horaReal: string | null, thresholdMin = 15): string {
  if (category !== 'on-time') return category;
  if (!horaProgramada || !horaReal) return category;
  const [hp, mp] = horaProgramada.split(':').map(Number);
  const [hr, mr] = horaReal.split(':').map(Number);
  if ([hp, mp, hr, mr].some((n) => Number.isNaN(n))) return category;
  let diff = hr * 60 + mr - (hp * 60 + mp);
  if (diff < -12 * 60) diff += 24 * 60;
  if (diff > thresholdMin) return 'delayed';
  return category;
}

function hhmmToMinutes(s: string | null): number | null {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d{1,2}):?(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const mi = parseInt(m[2], 10);
  if (isNaN(h) || isNaN(mi) || h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

// ---------------------------------------------------------------------------
// NAABOL raw record type
// ---------------------------------------------------------------------------

interface NaabolRecord {
  NRO_VUELO: string | number;
  NOMBRE_AEROLINEA: string;
  RUTA0?: string;
  RUTA?: string;
  HORA_REAL?: string;
  NRO_PUERTA?: string | number;
  OBSERVACION?: string;
  OBSERVACION_INGLES?: string;
  HORA_ESTIMADA?: string;
  AEROPUERTO?: string;
  FECHA?: string;
}

interface FlightMatch {
  vuelo: string;
  numero: string;
  aerolinea: string | null;
  aerolineaIata: string | null;
  aeropuerto: string;
  aeropuertoNombre: string | null;
  tipo: string;
  tipoLabel: string;
  ruta: string;
  fecha: string | null;
  horaProgramada: string | null;
  horaReal: string | null;
  gate: string | null;
  estado: string | null;
  estadoIngles: string | null;
  estadoCategoria: string;
  fuente: string;
}

function recordToMatch(rec: NaabolRecord, iata: string, tipo: string): FlightMatch {
  const aerolineaIata = airlineToIata(rec.NOMBRE_AEROLINEA);
  const ruta = (rec.RUTA0 || rec.RUTA || '').trim();
  const horaReal = (rec.HORA_REAL || '').trim() || null;
  const gate = (rec.NRO_PUERTA || '').toString().trim() || null;
  const obsEs = (rec.OBSERVACION || '').trim();
  const obsEn = (rec.OBSERVACION_INGLES || '').trim();
  const horaProgramada = (rec.HORA_ESTIMADA || '').trim() || null;
  const baseCategory = categorizeStatus(obsEs, obsEn);
  const estadoCategoria = adjustForDelay(baseCategory, horaProgramada, horaReal);
  return {
    vuelo: aerolineaIata ? `${aerolineaIata}${rec.NRO_VUELO}` : `${rec.NRO_VUELO}`,
    numero: String(rec.NRO_VUELO || ''),
    aerolinea: rec.NOMBRE_AEROLINEA || null,
    aerolineaIata,
    aeropuerto: iata,
    aeropuertoNombre: rec.AEROPUERTO || AIRPORTS[iata]?.name || null,
    tipo,
    tipoLabel: tipo === 'S' ? 'salida' : 'llegada',
    ruta,
    fecha: (rec.FECHA || '').slice(0, 10) || null,
    horaProgramada,
    horaReal,
    gate,
    estado: obsEs || null,
    estadoIngles: obsEn || null,
    estadoCategoria,
    fuente: 'naabol-itinerario',
  };
}

function matchesQuery(rec: NaabolRecord, target: { iata: string | null; numero: string | null }): boolean {
  if (target.numero && String(rec.NRO_VUELO || '').replace(/^0+/, '') !== target.numero.replace(/^0+/, '')) {
    return false;
  }
  if (target.iata) {
    const recIata = airlineToIata(rec.NOMBRE_AEROLINEA);
    if (recIata !== target.iata) return false;
  }
  return true;
}

async function fetchAirport(iata: string, tipo: string): Promise<NaabolRecord[]> {
  const ap = AIRPORTS[iata];
  if (!ap) throw new Error(`Aeropuerto desconocido: ${iata}`);
  const url = `${NAABOL_BASE}?aero=${encodeURIComponent(ap.query)}&tipo=${tipo}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? (data as NaabolRecord[]) : [];
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

interface GetAirportFlightsArgs {
  aeropuerto: string;
  tipo: string;
  aerolinea?: string;
  horaDesde?: string;
  horaHasta?: string;
}

async function getAirportFlights(args: GetAirportFlightsArgs) {
  const ap = (args.aeropuerto || '').toUpperCase();
  if (!AIRPORTS[ap]) {
    return { error: `aeropuerto desconocido: "${args.aeropuerto}"`, validos: Object.keys(AIRPORTS) };
  }
  const tipo = (args.tipo || 'S').toUpperCase();
  if (!['S', 'L'].includes(tipo)) {
    return { error: 'tipo debe ser S (salidas) o L (llegadas)' };
  }
  const desdeMin = hhmmToMinutes(args.horaDesde || null);
  const hastaMin = hhmmToMinutes(args.horaHasta || null);
  const aerolineaFilter = args.aerolinea
    ? (AIRLINE_IATA[args.aerolinea.toUpperCase()] || args.aerolinea.toUpperCase())
    : null;

  const errors: Array<{ aeropuerto: string; tipo: string; error: string }> = [];
  const allMatches: FlightMatch[] = [];

  try {
    const records = await fetchAirport(ap, tipo);
    for (const rec of records) {
      const match = recordToMatch(rec, ap, tipo);
      if (aerolineaFilter && match.aerolineaIata !== aerolineaFilter) continue;
      if (desdeMin !== null || hastaMin !== null) {
        const recMin = hhmmToMinutes(match.horaProgramada);
        if (recMin === null) continue;
        if (desdeMin !== null && recMin < desdeMin) continue;
        if (hastaMin !== null && recMin > hastaMin) continue;
      }
      allMatches.push(match);
    }
  } catch (err) {
    errors.push({ aeropuerto: ap, tipo, error: String((err as Error).message || err) });
  }

  // Sort by horaProgramada (sin hora al final)
  allMatches.sort((a, b) => {
    const am = hhmmToMinutes(a.horaProgramada);
    const bm = hhmmToMinutes(b.horaProgramada);
    if (am === null && bm === null) return 0;
    if (am === null) return 1;
    if (bm === null) return -1;
    return am - bm;
  });

  const output: Record<string, unknown> = {
    consultadoTs: new Date().toISOString(),
    fuente: 'NAABOL',
    consulta: {
      modo: 'all',
      aeropuerto: ap,
      tipo,
      horaDesde: args.horaDesde || null,
      horaHasta: args.horaHasta || null,
      aerolinea: aerolineaFilter,
    },
    total: allMatches.length,
    matches: allMatches,
  };
  if (allMatches.length === 0) {
    output.nota = 'Sin resultados en el itinerario NAABOL para esta consulta. Verificá código de aeropuerto o filtros.';
  }
  if (errors.length) output.errors = errors;
  return output;
}

interface GetFlightArgs {
  vuelo: string;
  aeropuerto?: string;
  tipo?: string;
}

async function getFlight(args: GetFlightArgs) {
  const parsed = parseFlightCode(args.vuelo);
  if (!parsed.numero) {
    return {
      found: false,
      matches: [],
      razon: `código no parseable: "${args.vuelo}"`,
    };
  }

  const ap = args.aeropuerto ? args.aeropuerto.toUpperCase() : null;
  if (ap && !AIRPORTS[ap]) {
    return { error: `aeropuerto desconocido: "${args.aeropuerto}"`, validos: Object.keys(AIRPORTS) };
  }

  const aps = ap ? [ap] : Object.keys(AIRPORTS);
  const tipos = args.tipo ? [args.tipo.toUpperCase()] : ['S', 'L'];

  // Build unique fetch keys
  const fetchKeys = new Set<string>();
  for (const a of aps) for (const t of tipos) fetchKeys.add(`${a}|${t}`);

  const fetched: Record<string, NaabolRecord[]> = {};
  const errors: Array<{ aeropuerto: string; tipo: string; error: string }> = [];

  await Promise.all([...fetchKeys].map(async (key) => {
    const [a, t] = key.split('|');
    try {
      fetched[key] = await fetchAirport(a, t);
    } catch (err) {
      fetched[key] = [];
      errors.push({ aeropuerto: a, tipo: t, error: String((err as Error).message || err) });
    }
  }));

  const matches: FlightMatch[] = [];
  for (const a of aps) {
    for (const t of tipos) {
      const records = fetched[`${a}|${t}`] || [];
      for (const rec of records) {
        if (matchesQuery(rec, parsed)) {
          matches.push(recordToMatch(rec, a, t));
        }
      }
    }
  }

  const output: Record<string, unknown> = {
    consultadoTs: new Date().toISOString(),
    fuente: 'NAABOL',
    consulta: {
      vuelo: args.vuelo,
      vueloParseado: parsed,
      aeropuerto: ap,
      tipo: args.tipo || null,
    },
    found: matches.length > 0,
    matches,
  };
  if (matches.length === 0) {
    output.nota = `Vuelo "${args.vuelo}" no aparece en ${aps.length} aeropuerto(s) × ${tipos.length} tipo(s). Verificá código de vuelo o aeropuerto.`;
  }
  if (errors.length) output.errors = errors;
  return output;
}

// ---------------------------------------------------------------------------
// MCP tool definitions
// ---------------------------------------------------------------------------

const TOOLS: McpTool[] = [
  {
    name: 'getAirportFlights',
    description: 'Consulta salidas o llegadas de un aeropuerto boliviano en tiempo real (NAABOL FIDS)',
    inputSchema: {
      type: 'object',
      properties: {
        aeropuerto: { type: 'string', description: 'Código IATA (VVI, LPB, CBB, TJA, SRE, ORU, UYU, CIJ, RIB, RBQ, TDD, GYA)' },
        tipo: { type: 'string', enum: ['S', 'L'], description: 'S=Salidas, L=Llegadas' },
        aerolinea: { type: 'string', description: 'Filtrar por código IATA aerolínea (ej: OB)' },
        horaDesde: { type: 'string', description: 'Filtrar desde hora HH:MM' },
        horaHasta: { type: 'string', description: 'Filtrar hasta hora HH:MM' },
      },
      required: ['aeropuerto', 'tipo'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'getFlight',
    description: 'Estado de un vuelo específico por código (ej: OB657)',
    inputSchema: {
      type: 'object',
      properties: {
        vuelo: { type: 'string', description: 'Código de vuelo (ej: OB657, BOA657)' },
        aeropuerto: { type: 'string', description: 'IATA del aeropuerto (opcional, busca todos si se omite)' },
        tipo: { type: 'string', enum: ['S', 'L'], description: 'S=Salida, L=Llegada (opcional, busca ambos si se omite)' },
      },
      required: ['vuelo'],
    },
    annotations: { readOnlyHint: true },
  },
];

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

async function dispatchTool(name: string, args: Record<string, unknown>) {
  if (name === 'getAirportFlights') return getAirportFlights(args as unknown as GetAirportFlightsArgs);
  if (name === 'getFlight') return getFlight(args as unknown as GetFlightArgs);
  throw new Error(`Unknown tool: ${name}`);
}

// ---------------------------------------------------------------------------
// Worker export
// ---------------------------------------------------------------------------

export default {
  fetch(req: Request, env: Env): Promise<Response> {
    return handleMcp(req, env, TOOLS, 'naabol-flights', (name, args) => dispatchTool(name, args as Record<string, unknown>));
  },
} satisfies ExportedHandler<Env>;
