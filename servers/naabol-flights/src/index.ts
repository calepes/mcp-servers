#!/usr/bin/env node
// MCP server: naabol-flights
// Tools:
//   - getFlight({vuelo, aeropuerto?, tipo?}) — un solo vuelo
//   - getFlights({queries}) — múltiples vuelos en una llamada
//   - getAirportFlights({aeropuerto, tipo?, horaDesde?, horaHasta?, aerolinea?}) — consulta abierta
//
// Wrapper sobre el CLI Node `consultar-vuelo.mjs` en el repo Aeropuertos-Bolivia.
// El CLI hace la llamada real a NAABOL y normaliza la respuesta.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { spawn } from "node:child_process";

const CLI_PATH = `${process.env.HOME}/Claude Projects/Personal/Apps/Aeropuertos Bolivia/cli/consultar-vuelo.mjs`;
const NODE_BIN = "/usr/local/bin/node";
const TIMEOUT_MS = 15_000;

function runCli(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(NODE_BIN, [CLI_PATH, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // already dead
      }
      reject(new Error(`naabol-flights CLI timed out after ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => {
      if (timedOut) return;
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      if (timedOut) return;
      clearTimeout(timer);
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`naabol-flights CLI exited ${code}: ${stderr.slice(0, 300)}`));
    });
  });
}

interface FlightQuery {
  vuelo: string;
  aeropuerto?: string;
  tipo?: "S" | "L";
}

async function getFlight(args: FlightQuery): Promise<unknown> {
  const cliArgs: string[] = ["--vuelo", args.vuelo];
  if (args.aeropuerto) cliArgs.push("--aeropuerto", args.aeropuerto);
  if (args.tipo) cliArgs.push("--tipo", args.tipo);
  const out = await runCli(cliArgs);
  return JSON.parse(out);
}

async function getFlights(args: { queries: FlightQuery[] }): Promise<unknown> {
  const queries = args.queries ?? [];
  if (queries.length === 0) {
    return { consultadoTs: new Date().toISOString(), fuente: "NAABOL", resultados: [] };
  }
  if (queries.length === 1) return getFlight(queries[0]!);

  const allSameAirport = queries.every((q) => q.aeropuerto === queries[0]!.aeropuerto);
  const allSameTipo = queries.every((q) => q.tipo === queries[0]!.tipo);
  if (allSameAirport && allSameTipo) {
    const cliArgs: string[] = ["--vuelo", queries.map((q) => q.vuelo).join(",")];
    if (queries[0]!.aeropuerto) cliArgs.push("--aeropuerto", queries[0]!.aeropuerto);
    if (queries[0]!.tipo) cliArgs.push("--tipo", queries[0]!.tipo);
    const out = await runCli(cliArgs);
    return JSON.parse(out);
  }
  const out = await runCli(["--json", JSON.stringify({ queries })]);
  return JSON.parse(out);
}

interface AirportFlightsArgs {
  aeropuerto: string;
  tipo?: "S" | "L";
  horaDesde?: string;
  horaHasta?: string;
  aerolinea?: string;
}

async function getAirportFlights(args: AirportFlightsArgs): Promise<unknown> {
  const cliArgs: string[] = ["--all", "--aeropuerto", args.aeropuerto];
  if (args.tipo) cliArgs.push("--tipo", args.tipo);
  if (args.horaDesde) cliArgs.push("--hora-desde", args.horaDesde);
  if (args.horaHasta) cliArgs.push("--hora-hasta", args.horaHasta);
  if (args.aerolinea) cliArgs.push("--aerolinea", args.aerolinea);
  const out = await runCli(cliArgs);
  return JSON.parse(out);
}

// ---------- MCP Server ----------

const READ_ONLY = { annotations: { readOnlyHint: true } };

const server = new Server(
  { name: "naabol-flights", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "getFlight",
      description:
        "Consulta el estado/gate/hora/retraso de UN vuelo en aeropuertos bolivianos (12 NAABOL: VVI, LPB, CBB, TJA, SRE, ORU, UYU, CIJ, RIB, RBQ, TDD, GYA). Acepta variantes de código: 'OB659', 'BOA 659', 'vuelo 659 de boa', 'el 659'. Devuelve JSON con HORA_REAL, NRO_PUERTA, OBSERVACION, estadoCategoria del endpoint NAABOL. Trigger natural: estado/gate/hora/retraso/'¿a qué hora sale/llega el X?'/'cómo va mi vuelo?'/'en qué puerta abordan?'.",
      inputSchema: {
        type: "object",
        properties: {
          vuelo: { type: "string", description: "Código de vuelo. Acepta variantes." },
          aeropuerto: {
            type: "string",
            description: "Código IATA opcional (VVI/LPB/CBB/TJA/SRE/ORU/UYU/CIJ/RIB/RBQ/TDD/GYA).",
          },
          tipo: {
            type: "string",
            enum: ["S", "L"],
            description: "S=salida, L=llegada. Omitir si ambiguo.",
          },
        },
        required: ["vuelo"],
      },
      annotations: READ_ONLY.annotations,
    },
    {
      name: "getFlights",
      description:
        "Consulta MÚLTIPLES vuelos en una sola llamada. Más eficiente que llamar getFlight N veces cuando los vuelos comparten aeropuerto/tipo (reusa fetch). Args: { queries: [{ vuelo, aeropuerto?, tipo? }, ...] }. Devuelve { consultadoTs, fuente, resultados[] }.",
      inputSchema: {
        type: "object",
        properties: {
          queries: {
            type: "array",
            items: {
              type: "object",
              properties: {
                vuelo: { type: "string" },
                aeropuerto: { type: "string" },
                tipo: { type: "string", enum: ["S", "L"] },
              },
              required: ["vuelo"],
            },
          },
        },
        required: ["queries"],
      },
      annotations: READ_ONLY.annotations,
    },
    {
      name: "getAirportFlights",
      description:
        "Consulta ABIERTA cuando NO conocés el código del vuelo. Para preguntas tipo '¿qué vuelos salen de Santa Cruz a la mañana?', '¿llegadas a La Paz hoy de tarde?', '¿vuelos de BoA hacia Cochabamba?'. Mapeo recomendado de horarios coloquiales: mañana → 06:00-12:00, mediodía → 11:00-14:00, tarde → 13:00-19:00, noche → 19:00-23:59. Devuelve { consulta, total, matches[] }.",
      inputSchema: {
        type: "object",
        properties: {
          aeropuerto: {
            type: "string",
            description: "Código IATA requerido (VVI/LPB/CBB/TJA/SRE/ORU/UYU/CIJ/RIB/RBQ/TDD/GYA).",
          },
          tipo: { type: "string", enum: ["S", "L"], description: "S=salida, L=llegada." },
          horaDesde: { type: "string", description: "HH:MM 24h, ej. '06:00'." },
          horaHasta: { type: "string", description: "HH:MM 24h, ej. '12:00'." },
          aerolinea: {
            type: "string",
            description: "Código (OB/EO/Z8/LA/H2/AV/CM/AA/UA/IB) o nombre ('BoA', 'Latam').",
          },
        },
        required: ["aeropuerto"],
      },
      annotations: READ_ONLY.annotations,
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;
  const args = (request.params.arguments ?? {}) as Record<string, unknown>;
  try {
    let result: unknown;
    if (name === "getFlight") {
      result = await getFlight(args as unknown as FlightQuery);
    } else if (name === "getFlights") {
      result = await getFlights(args as unknown as { queries: FlightQuery[] });
    } else if (name === "getAirportFlights") {
      result = await getAirportFlights(args as unknown as AirportFlightsArgs);
    } else {
      return {
        isError: true,
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
      };
    }
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  } catch (err) {
    return {
      isError: true,
      content: [{ type: "text", text: `Error en ${name}: ${(err as Error).message}` }],
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
