import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { getCartelera, type CineNombre } from "./cartelera.js";
import { resolverFecha } from "./fecha.js";

function asText(result: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
}

const server = new Server({ name: "cine", version: "0.1.0" }, { capabilities: { tools: {} } });

const TOOLS: Tool[] = [
  {
    name: "getCartelera",
    description:
      "Cartelera de cine en Santa Cruz de la Sierra, Bolivia, para CUALQUIER fecha. Cubre 3 cines: " +
      "Cinemark (Ventura Mall), Multicine (Las Brisas) y Cine Center (MegaCenter/Trompillo). " +
      "Args: { fecha? ('hoy' | 'mañana' | 'YYYY-MM-DD'; default hoy), pelicula? (nombre libre; si se " +
      "omite lista toda la cartelera), cines? (subset de ['cinemark','multicine','cinecenter']; default " +
      "los 3) }. Devuelve por cine: { cine, ubicacion, ok, fuente, peliculas: [{ titulo, funciones: " +
      "[{ hora, formato, idioma, sala?, precioBs?, asientosDisponibles? }] }] }. " +
      "IMPORTANTE: la cartelera de HOY solo muestra funciones que TODAVÍA NO EMPEZARON — de noche es " +
      "normal que aparezcan pocas o ninguna, y NO es un error: si el usuario pregunta de noche, ofrecé " +
      "la cartelera de mañana. Al filtrar por 'pelicula' usá el título lo más completo posible: el " +
      "filtro es por coincidencia parcial, así que un término corto puede traer películas de más " +
      "(ej. 'la' matchea 'LA ODISEA' y 'EVIL DEAD: EN LLAMAS'). " +
      "'fuente' indica si Cinemark vino del API ('bff') o del scraping ('scraping', modo degradado); " +
      "en modo degradado y sin filtro de película, Cinemark devuelve títulos SIN horarios — ahí pedí " +
      "una película puntual para obtenerlos. Un cine con ok:false trae 'error' y los otros igual " +
      "responden. Tarda ~6-13s. Cine Center incluye precio en Bs.",
    inputSchema: {
      type: "object",
      properties: {
        fecha: { type: "string", description: "'hoy', 'mañana' o YYYY-MM-DD" },
        pelicula: { type: "string", description: "Filtro por nombre de película" },
        cines: {
          type: "array",
          items: { type: "string", enum: ["cinemark", "multicine", "cinecenter"] },
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  try {
    if (name === "getCartelera") {
      const a = args as { fecha?: string; pelicula?: string; cines?: CineNombre[] };
      const fecha = resolverFecha(a.fecha);
      return asText({ fecha, cines: await getCartelera({ ...a, fecha }) });
    }
    return { isError: true, content: [{ type: "text" as const, text: `Tool desconocida: ${name}` }] };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { isError: true, content: [{ type: "text" as const, text: `Error en ${name}: ${msg}` }] };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
