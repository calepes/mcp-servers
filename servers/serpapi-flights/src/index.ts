#!/usr/bin/env node
// MCP server: serpapi-flights
// Tools:
//   - searchFlights: busca vuelos via SerpAPI Google Flights
//   - getReturnFlights: segunda llamada con departure_token para ver vuelos de regreso de un itinerario
//
// API key: env SERPAPI_KEY (archivo ~/.serpapi-flights/.env o inyectada por el daemon)

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const SERPAPI_BASE = "https://serpapi.com/search";

function getApiKey(): string {
  const key = process.env.SERPAPI_KEY;
  if (!key) throw new Error("SERPAPI_KEY no está configurada en el entorno");
  return key;
}

// ---------- Types ----------

interface FlightLeg {
  departure_airport: { name: string; id: string; time: string };
  arrival_airport: { name: string; id: string; time: string };
  duration: number;
  airplane: string;
  airline: string;
  airline_logo: string;
  travel_class: string;
  flight_number: string;
  legroom?: string;
  overnight?: boolean;
}

interface Layover {
  duration: number;
  name: string;
  id: string;
  overnight?: boolean;
}

interface FlightOption {
  flights: FlightLeg[];
  layovers?: Layover[];
  total_duration: number;
  carbon_emissions?: { this_flight: number; typical_for_this_route: number; difference_percent: number };
  price: number;
  type: string;
  airline_logo: string;
  departure_token?: string;
  booking_token?: string;
}

interface PriceInsights {
  lowest_price?: number;
  price_level?: string;
  typical_range?: [number, number];
  price_history?: Array<[number, number]>;
}

interface SearchFlightsArgs {
  origin: string;
  destination: string;
  outbound_date: string;
  return_date?: string;
  type?: 1 | 2 | 3;
  adults?: number;
  children?: number;
  travel_class?: 1 | 2 | 3 | 4;
  stops?: 0 | 1 | 2 | 3;
  currency?: string;
  max_price?: number;
  sort_by?: 1 | 2 | 3 | 4 | 5 | 6;
  gl?: string;
  hl?: string;
}

interface GetReturnFlightsArgs {
  departure_token: string;
  origin: string;
  destination: string;
  outbound_date: string;
  return_date: string;
  adults?: number;
  children?: number;
  travel_class?: 1 | 2 | 3 | 4;
  currency?: string;
  gl?: string;
  hl?: string;
}

// ---------- API calls ----------

async function callSerpApi(params: Record<string, string | number>): Promise<unknown> {
  const url = new URL(SERPAPI_BASE);
  url.searchParams.set("engine", "google_flights");
  url.searchParams.set("api_key", getApiKey());
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }

  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`SerpAPI error ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

function formatFlightResult(data: Record<string, unknown>): object {
  return {
    best_flights: (data.best_flights as FlightOption[] | undefined) ?? [],
    other_flights: (data.other_flights as FlightOption[] | undefined) ?? [],
    price_insights: (data.price_insights as PriceInsights | undefined) ?? null,
    airports: (data.airports as unknown[] | undefined) ?? [],
  };
}

async function searchFlights(args: SearchFlightsArgs): Promise<object> {
  const params: Record<string, string | number> = {
    departure_id: args.origin,
    arrival_id: args.destination,
    outbound_date: args.outbound_date,
    type: args.type ?? (args.return_date ? 1 : 2),
    adults: args.adults ?? 1,
    currency: args.currency ?? "USD",
  };

  if (args.return_date) params.return_date = args.return_date;
  if (args.children) params.children = args.children;
  if (args.travel_class) params.travel_class = args.travel_class;
  if (args.stops !== undefined) params.stops = args.stops;
  if (args.max_price) params.max_price = args.max_price;
  if (args.sort_by) params.sort_by = args.sort_by;
  if (args.gl) params.gl = args.gl;
  if (args.hl) params.hl = args.hl;

  const data = await callSerpApi(params) as Record<string, unknown>;
  return formatFlightResult(data);
}

async function getReturnFlights(args: GetReturnFlightsArgs): Promise<object> {
  const params: Record<string, string | number> = {
    departure_id: args.origin,
    arrival_id: args.destination,
    outbound_date: args.outbound_date,
    return_date: args.return_date,
    type: 1,
    adults: args.adults ?? 1,
    currency: args.currency ?? "USD",
    departure_token: args.departure_token,
  };

  if (args.children) params.children = args.children;
  if (args.travel_class) params.travel_class = args.travel_class;
  if (args.gl) params.gl = args.gl;
  if (args.hl) params.hl = args.hl;

  const data = await callSerpApi(params) as Record<string, unknown>;
  return formatFlightResult(data);
}

// ---------- MCP Server ----------

const server = new Server(
  { name: "serpapi-flights", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

const READ_ONLY = { annotations: { readOnlyHint: true } };

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "searchFlights",
      description: `Busca vuelos via Google Flights (SerpAPI). Devuelve best_flights, other_flights, price_insights y airports.

Cada vuelo incluye: segmentos (aerolínea, número de vuelo, horarios, aeropuerto, duración, clase, espacio piernas), escalas, duración total, precio, emisiones de carbono, y departure_token para llamar a getReturnFlights.

Usar para: buscar vuelos, precios de pasajes, opciones de vuelo, vuelos ida/vuelta/solo ida.

Parámetros clave:
- origin/destination: código IATA de 3 letras (ej. "VVI", "LIM", "MIA")
- outbound_date: YYYY-MM-DD
- type: 1=ida y vuelta (default si hay return_date), 2=solo ida, 3=multi-ciudad
- travel_class: 1=económica (default), 2=premium económica, 3=business, 4=primera
- stops: 0=cualquiera, 1=directo, 2=máx 1 escala, 3=máx 2 escalas
- currency: código de moneda (default "USD")
- sort_by: 1=top, 2=precio, 3=salida, 4=llegada, 5=duración, 6=emisiones`,
      inputSchema: {
        type: "object",
        properties: {
          origin: { type: "string", description: "Código IATA origen (ej. 'VVI', 'LIM')" },
          destination: { type: "string", description: "Código IATA destino (ej. 'MIA', 'BOG')" },
          outbound_date: { type: "string", description: "Fecha de salida YYYY-MM-DD" },
          return_date: { type: "string", description: "Fecha de regreso YYYY-MM-DD (ida y vuelta)" },
          type: { type: "number", enum: [1, 2, 3], description: "1=ida y vuelta, 2=solo ida, 3=multi-ciudad" },
          adults: { type: "number", description: "Número de adultos (default 1)" },
          children: { type: "number", description: "Número de niños (default 0)" },
          travel_class: { type: "number", enum: [1, 2, 3, 4], description: "1=económica, 2=premium eco, 3=business, 4=primera" },
          stops: { type: "number", enum: [0, 1, 2, 3], description: "0=cualquiera, 1=directo, 2=máx 1 escala, 3=máx 2 escalas" },
          currency: { type: "string", description: "Código de moneda (default 'USD')" },
          max_price: { type: "number", description: "Precio máximo del ticket" },
          sort_by: { type: "number", enum: [1, 2, 3, 4, 5, 6], description: "1=top, 2=precio, 3=salida, 4=llegada, 5=duración, 6=emisiones" },
          gl: { type: "string", description: "Código de país (ej. 'us', 'bo')" },
          hl: { type: "string", description: "Código de idioma (ej. 'en', 'es')" },
        },
        required: ["origin", "destination", "outbound_date"],
        additionalProperties: false,
      },
      ...READ_ONLY,
    },
    {
      name: "getReturnFlights",
      description: `Segunda llamada de Google Flights para ver vuelos de regreso de un itinerario específico de ida. Requiere el departure_token que devuelve searchFlights en cada opción de vuelo.

Usar después de searchFlights cuando Cal elige un vuelo de ida específico y quiere ver las opciones de regreso asociadas a ese itinerario.

Devuelve: best_flights, other_flights, price_insights (precio total ida+vuelta).`,
      inputSchema: {
        type: "object",
        properties: {
          departure_token: { type: "string", description: "Token del vuelo de ida elegido (de searchFlights)" },
          origin: { type: "string", description: "Código IATA origen" },
          destination: { type: "string", description: "Código IATA destino" },
          outbound_date: { type: "string", description: "Fecha de salida YYYY-MM-DD" },
          return_date: { type: "string", description: "Fecha de regreso YYYY-MM-DD" },
          adults: { type: "number", description: "Número de adultos (default 1)" },
          children: { type: "number", description: "Número de niños (default 0)" },
          travel_class: { type: "number", enum: [1, 2, 3, 4], description: "1=económica, 2=premium eco, 3=business, 4=primera" },
          currency: { type: "string", description: "Código de moneda (default 'USD')" },
          gl: { type: "string", description: "Código de país" },
          hl: { type: "string", description: "Código de idioma" },
        },
        required: ["departure_token", "origin", "destination", "outbound_date", "return_date"],
        additionalProperties: false,
      },
      ...READ_ONLY,
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    if (name === "searchFlights") {
      const result = await searchFlights(args as unknown as SearchFlightsArgs);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
    if (name === "getReturnFlights") {
      const result = await getReturnFlights(args as unknown as GetReturnFlightsArgs);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
    return {
      isError: true,
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
    };
  } catch (err) {
    return {
      isError: true,
      content: [{ type: "text", text: `Error en ${name}: ${(err as Error).message}` }],
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
