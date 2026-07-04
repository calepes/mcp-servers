import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { homedir } from "node:os";
import { join } from "node:path";
import { openBoaBrowserSession } from "./browser.js";
import {
  resolveBoaTraveler,
  saveBoaTravelerExtras,
  type BoaPasaporte,
} from "./travelers.js";
import { missingBoaFields } from "./missing-fields.js";
import {
  searchBoaReservation,
  listBoaPassengers,
  fillRequiredInfo,
  getSeatOptions,
  confirmSeatAndContinue,
  getBoardingPassUrl,
} from "./flow.js";

const TRAVELERS_PATH = join(homedir(), ".claude", "datos-viaje.json");

function asText(result: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
}

interface PrepareArgs {
  locator: string;
  apellido: string;
  pasajeros?: string[];
  datosAdicionales?: Record<string, { lugarNacimiento?: string; pasaporte?: BoaPasaporte }>;
}

interface ConfirmArgs {
  locator: string;
  apellido: string;
  pasajeros?: string[];
  asientos?: Record<string, string>;
}

async function prepareBoaCheckin(args: PrepareArgs) {
  if (args.datosAdicionales) {
    for (const [key, extras] of Object.entries(args.datosAdicionales)) {
      saveBoaTravelerExtras(TRAVELERS_PATH, key, extras);
    }
  }

  const session = await openBoaBrowserSession();
  try {
    await searchBoaReservation(session.page, args.locator, args.apellido);
    const passengers = await listBoaPassengers(session.page);
    const filtered = args.pasajeros?.length
      ? passengers.filter((p) => args.pasajeros!.some((n) => p.nombre.toLowerCase().includes(n.toLowerCase())))
      : passengers;

    const statuses: { nombre: string; yaCheckeado: boolean; faltantes: string[] }[] = [];
    for (const p of filtered) {
      if (p.yaCheckeado) {
        statuses.push({ nombre: p.nombre, yaCheckeado: true, faltantes: [] });
        continue;
      }
      const key = p.nombre.split(" ")[0];
      const traveler = resolveBoaTraveler(TRAVELERS_PATH, key);
      const faltantes = traveler ? missingBoaFields(traveler) : ["viajero_no_registrado"];
      statuses.push({ nombre: p.nombre, yaCheckeado: false, faltantes });
    }

    const todoListo = statuses.every((s) => s.yaCheckeado || s.faltantes.length === 0);
    if (!todoListo) {
      return asText({ pasajeros: statuses, asientos: null });
    }

    // Todos listos: llenar y avanzar hasta el mapa de asientos.
    const asientos: Record<string, unknown> = {};
    for (const s of statuses) {
      if (s.yaCheckeado) continue;
      const traveler = resolveBoaTraveler(TRAVELERS_PATH, s.nombre.split(" ")[0])!;
      await fillRequiredInfo(session.page, traveler);
      asientos[s.nombre] = await getSeatOptions(session.page);
    }
    return asText({ pasajeros: statuses, asientos });
  } finally {
    await session.close();
  }
}

async function confirmBoaCheckin(args: ConfirmArgs) {
  const session = await openBoaBrowserSession();
  try {
    await searchBoaReservation(session.page, args.locator, args.apellido);
    const passengers = await listBoaPassengers(session.page);
    const filtered = args.pasajeros?.length
      ? passengers.filter((p) => args.pasajeros!.some((n) => p.nombre.toLowerCase().includes(n.toLowerCase())))
      : passengers;

    const resultados: { nombre: string; boardingPassUrl: string }[] = [];
    for (const p of filtered) {
      if (!p.yaCheckeado) {
        const traveler = resolveBoaTraveler(TRAVELERS_PATH, p.nombre.split(" ")[0]);
        if (!traveler) throw new Error(`Viajero "${p.nombre}" no está en datos-viaje.json`);
        await fillRequiredInfo(session.page, traveler);
        await getSeatOptions(session.page);
        await confirmSeatAndContinue(session.page, args.asientos?.[p.nombre]);
      }
      const url = await getBoardingPassUrl(session.page);
      resultados.push({ nombre: p.nombre, boardingPassUrl: url });
    }
    return asText({ pasajeros: resultados });
  } finally {
    await session.close();
  }
}

const server = new Server(
  { name: "boa-checkin", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "prepareBoaCheckin",
      description:
        "Busca una reserva de BoA (Boliviana de Aviación) por locator+apellido y prepara el check-in de todos sus pasajeros (o el subconjunto en `pasajeros`). Rellena datos personales/pasaporte desde datos-viaje.json. Devuelve por pasajero { nombre, yaCheckeado, faltantes } y, si a todos no les falta nada, además los asientos preseleccionados/alternativas. Si faltan datos, pedíselos a Cal y volvé a llamar esta tool pasando `datosAdicionales` con las respuestas — se guardan para la próxima vez.",
      inputSchema: {
        type: "object",
        properties: {
          locator: { type: "string" },
          apellido: { type: "string" },
          pasajeros: { type: "array", items: { type: "string" } },
          datosAdicionales: { type: "object" },
        },
        required: ["locator", "apellido"],
        additionalProperties: false,
      },
    },
    {
      name: "confirmBoaCheckin",
      description:
        "Confirma el check-in (asientos + submit) de los pasajeros de una reserva ya preparada con prepareBoaCheckin, y devuelve la URL pública del boarding pass de cada uno (para mandar con sendDocument). `asientos` es opcional: { [nombre]: 'código de asiento' } para pisar el preseleccionado de alguien puntual.",
      inputSchema: {
        type: "object",
        properties: {
          locator: { type: "string" },
          apellido: { type: "string" },
          pasajeros: { type: "array", items: { type: "string" } },
          asientos: { type: "object" },
        },
        required: ["locator", "apellido"],
        additionalProperties: false,
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    if (name === "prepareBoaCheckin") return await prepareBoaCheckin(args as unknown as PrepareArgs);
    if (name === "confirmBoaCheckin") return await confirmBoaCheckin(args as unknown as ConfirmArgs);
    return { isError: true, content: [{ type: "text", text: `Unknown tool: ${name}` }] };
  } catch (err) {
    return { isError: true, content: [{ type: "text", text: `Error en ${name}: ${(err as Error).message}` }] };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
