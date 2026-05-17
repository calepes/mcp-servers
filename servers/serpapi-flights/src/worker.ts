import { handleMcp, type McpTool, type McpEnv } from 'worker-mcp-utils';

interface Env extends McpEnv {
  SERPAPI_KEY: string;
}

const SERPAPI_BASE = 'https://serpapi.com/search.json';

async function searchFlightsApi(params: Record<string, string>, apiKey: string) {
  const url = new URL(SERPAPI_BASE);
  url.searchParams.set('engine', 'google_flights');
  url.searchParams.set('api_key', apiKey);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`SerpAPI ${res.status}: ${await res.text().then(t => t.slice(0, 200))}`);
  return res.json();
}

const TOOLS: McpTool[] = [
  {
    name: 'searchFlights',
    description: 'Busca vuelos de ida usando Google Flights vía SerpAPI',
    inputSchema: {
      type: 'object',
      properties: {
        departure_id: { type: 'string', description: 'IATA del aeropuerto de salida (ej: VVI)' },
        arrival_id: { type: 'string', description: 'IATA del aeropuerto de llegada (ej: LPB)' },
        outbound_date: { type: 'string', description: 'Fecha de salida YYYY-MM-DD' },
        adults: { type: 'number', description: 'Número de adultos (default 1)' },
        currency: { type: 'string', description: 'Moneda (default USD)' },
        hl: { type: 'string', description: 'Idioma (default es)' },
      },
      required: ['departure_id', 'arrival_id', 'outbound_date'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'getReturnFlights',
    description: 'Obtiene vuelos de regreso para un booking token existente',
    inputSchema: {
      type: 'object',
      properties: {
        departure_token: { type: 'string', description: 'Token del vuelo de ida de searchFlights' },
        return_date: { type: 'string', description: 'Fecha de regreso YYYY-MM-DD' },
      },
      required: ['departure_token', 'return_date'],
    },
    annotations: { readOnlyHint: true },
  },
];

async function dispatchTool(name: string, args: unknown, env: Record<string, unknown>): Promise<unknown> {
  const e = env as unknown as Env;
  const a = args as Record<string, unknown>;
  if (name === 'searchFlights') {
    return searchFlightsApi({
      departure_id: a.departure_id as string,
      arrival_id: a.arrival_id as string,
      outbound_date: a.outbound_date as string,
      adults: String(a.adults ?? 1),
      currency: (a.currency as string) ?? 'USD',
      hl: (a.hl as string) ?? 'es',
      type: '2',
    }, e.SERPAPI_KEY);
  }
  if (name === 'getReturnFlights') {
    return searchFlightsApi({
      departure_token: a.departure_token as string,
      outbound_date: a.return_date as string,
      type: '3',
    }, e.SERPAPI_KEY);
  }
  throw new Error(`Unknown tool: ${name}`);
}

export default {
  fetch(req: Request, env: Env): Promise<Response> {
    return handleMcp(req, env, TOOLS, 'serpapi-flights', dispatchTool);
  },
} satisfies ExportedHandler<Env>;
