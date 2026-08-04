import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { getCartelera, type CineNombre } from "./cartelera.js";
import { resolverFecha } from "./fecha.js";
import * as compra from "./compra.js";
import { loadComprador } from "./comprador.js";
import { guardarCaptura } from "./capturas.js";
import {
  createSession,
  getSession,
  getActiveSession,
  updateSession,
  endSession,
  claimCompletion,
  nuevoPurchaseId,
  reapStaleSessions,
} from "./compra-store.js";

function asText(result: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
}

function minutosRestantes(deadline: number): number {
  return Math.max(0, Math.floor((deadline - Date.now()) / 60_000));
}

/** Falla con un mensaje que el LLM pueda accionar en vez de un undefined silencioso. */
function requireSession(purchaseId: string) {
  const s = getSession(purchaseId);
  if (s) return s;
  const activa = getActiveSession();
  throw new Error(
    activa
      ? `No existe la compra ${purchaseId}, pero hay otra activa (${activa.purchaseId}). Usá estadoCompraCine.`
      : "No hay ninguna compra activa. Iniciá una con iniciarCompraCine.",
  );
}

// Título libre → slug de la URL de Cinemark (/pelicula/{slug}).
// NO se reutiliza el `norm()` de cartelera.ts: es privado y separa con espacios,
// no con guiones. Si cambia el criterio de slug, revisar ambos.
function slugify(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

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
  {
    name: "iniciarCompraCine",
    description:
      "Inicia una compra de entradas en Cinemark Ventura Mall (Santa Cruz). SOLO Cinemark: Multicine y " +
      "Cine Center no permiten compra automatizada. Args: { pelicula, hora ('20:30'), cantidad (1-10), " +
      "fecha? ('hoy'|'mañana'|'YYYY-MM-DD', default hoy) }. Abre el checkout como invitado y llega a la " +
      "selección de asientos. Devuelve { purchaseId, mapaPath, minutosRestantes, butacasLibres, totalLibres }. " +
      "IMPORTANTE: (1) GUARDÁ el purchaseId — todas las tools siguientes lo necesitan. (2) Mandá el " +
      "archivo de mapaPath al usuario con enviarFotoLocal Y ADEMÁS escribile la lista de 'butacasLibres' " +
      "(una línea por fila, ej. 'Fila B: B1-B4, B6-B9'): el mapa NO trae los números de butaca impresos, " +
      "así que sin esa lista el usuario no puede saber cómo se llama el asiento que ve libre. " +
      "(3) Cinemark retiene las butacas ~8 minutos: avisá el tiempo restante. Solo puede haber UNA " +
      "compra activa a la vez.",
    inputSchema: {
      type: "object",
      properties: {
        pelicula: { type: "string" },
        hora: { type: "string", description: "Formato HH:MM, ej. '20:30'" },
        cantidad: { type: "integer", minimum: 1, maximum: 10 },
        fecha: { type: "string", description: "'hoy', 'mañana' o YYYY-MM-DD" },
      },
      required: ["pelicula", "hora", "cantidad"],
      additionalProperties: false,
    },
  },
  {
    name: "elegirAsientosCine",
    description:
      "Selecciona los asientos elegidos por el usuario. Args: { purchaseId, asientos (ej. ['B12','B13']) }. " +
      "Pasá UN label por entrada: en las salas premier las butacas vienen de a pares (asiento doble) pero " +
      "cada mitad es independiente, así que para 2 personas juntas hay que pedir las dos (ej. ['A1','A2']). " +
      "Devuelve { resumenPath, total, minutosRestantes }. Mandá resumenPath al usuario con enviarFotoLocal " +
      "y PEDÍ CONFIRMACIÓN EXPLÍCITA antes de llamar a confirmarCompraCine. Si un asiento ya está ocupado " +
      "devuelve error CON la lista de butacas libres por fila: mostrale esa lista y pedile que elija de ahí.",
    inputSchema: {
      type: "object",
      properties: {
        purchaseId: { type: "string" },
        asientos: { type: "array", items: { type: "string" }, minItems: 1 },
      },
      required: ["purchaseId", "asientos"],
      additionalProperties: false,
    },
  },
  {
    name: "confirmarCompraCine",
    description:
      "Genera el QR de pago. Args: { purchaseId }. LLAMAR SOLO tras un 'sí' EXPLÍCITO del usuario al " +
      "resumen — es el punto de no retorno del flujo. Devuelve { qrPath, minutosRestantes }. Mandá qrPath " +
      "con enviarFotoLocal y un teclado inline con el botón '✅ Ya pagué'. El usuario paga con su app " +
      "bancaria: vos NUNCA pagás. Cuando toque el botón, llamá a verificarPagoCine.",
    inputSchema: {
      type: "object",
      properties: { purchaseId: { type: "string" } },
      required: ["purchaseId"],
      additionalProperties: false,
    },
  },
  {
    name: "verificarPagoCine",
    description:
      "Verifica si el pago se acreditó. Args: { purchaseId }. Se llama cuando el usuario toca '✅ Ya pagué' " +
      "o dice que pagó. Devuelve { pagado: false } si todavía no se ve (decíselo y que reintente en unos " +
      "segundos), o { pagado: true, codigoRetiro, entradasPath } si sí. Cinemark entrega un CÓDIGO DE " +
      "RETIRO, no un QR de ingreso: el QR y la factura le llegan por correo. Mandá entradasPath y el " +
      "código, y aclarale lo del correo.",
    inputSchema: {
      type: "object",
      properties: { purchaseId: { type: "string" } },
      required: ["purchaseId"],
      additionalProperties: false,
    },
  },
  {
    name: "cancelarCompraCine",
    description:
      "Cancela la compra activa: cierra el navegador y libera las butacas. Args: { purchaseId }. Usar si " +
      "el usuario se arrepiente o se venció el tiempo de reserva.",
    inputSchema: {
      type: "object",
      properties: { purchaseId: { type: "string" } },
      required: ["purchaseId"],
      additionalProperties: false,
    },
  },
  {
    name: "estadoCompraCine",
    description:
      "Devuelve la compra activa si la hay: { purchaseId, estado, funcion, minutosRestantes }, o " +
      "{ activa: false }. Usala cuando el usuario hable de una compra en curso y vos NO tengas el " +
      "purchaseId a mano (por ejemplo tras un /reset o si se compactó la conversación). No requiere args.",
    inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
];

export const CINE_TOOL_NAMES = TOOLS.map((t) => t.name);

let reaperStarted = false;

/**
 * Arranca el reaper UNA sola vez por proceso, sin importar cuántas veces se
 * llame createCineServer() (relevante en el entry point stdio, donde antes
 * era código de módulo top-level que corría una vez per se — acá se guarda
 * explícito para no duplicar el setInterval si algo llegara a instanciar el
 * server más de una vez en el mismo proceso).
 */
function ensureReaperStarted(): void {
  if (reaperStarted) return;
  reaperStarted = true;
  // Cierra el Chrome de compras abandonadas. Sin polling de pago, es la ÚNICA
  // red de seguridad: si el usuario nunca confirma, nadie más cierra el browser.
  // unref() evita que el timer mantenga vivo el proceso por sí solo (en el modo
  // HTTP persistente esto no importa para mantener el proceso vivo — launchd ya
  // lo hace — pero sí evita que un test que arme el server dependa de un timer
  // colgado para terminar).
  const reaper = setInterval(() => {
    void reapStaleSessions()
      .then((n) => {
        if (n > 0) console.error(`[cine] reaper cerró ${n} compra(s) vencida(s)`);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[cine] reaper falló: ${msg}`);
      });
  }, 2 * 60_000);
  reaper.unref();
}

export function createCineServer(): Server {
  const server = new Server({ name: "cine", version: "0.1.0" }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    try {
      if (name === "getCartelera") {
        const a = args as { fecha?: string; pelicula?: string; cines?: CineNombre[] };
        const fecha = resolverFecha(a.fecha);
        return asText({ fecha, cines: await getCartelera({ ...a, fecha }) });
      }

      if (name === "iniciarCompraCine") {
        const a = args as { pelicula: string; hora: string; cantidad: number; fecha?: string };
        const fecha = resolverFecha(a.fecha);
        const purchaseId = nuevoPurchaseId();
        const r = await compra.iniciar({
          slug: slugify(a.pelicula),
          hora: a.hora,
          cantidad: a.cantidad,
          fecha,
        });
        createSession({
          purchaseId,
          browser: r.browser,
          page: r.page,
          estado: "asientos",
          funcion: { pelicula: a.pelicula, hora: a.hora, formato: "" },
          cantidad: a.cantidad,
          seatDeadline: r.seatDeadline,
          createdAt: Date.now(),
        });
        return asText({
          purchaseId,
          mapaPath: guardarCaptura("mapa", purchaseId, r.mapaScreenshot),
          minutosRestantes: minutosRestantes(r.seatDeadline),
          // El screenshot NO trae los números de butaca impresos (en sala premier
          // solo 3 de 52 muestran su etiqueta) → sin esta lista el usuario tiene
          // que adivinar el código del asiento y termina pidiendo uno inexistente.
          butacasLibres: compra.agruparPorFila(r.disponibles),
          totalLibres: r.disponibles.length,
        });
      }

      if (name === "elegirAsientosCine") {
        const a = args as { purchaseId: string; asientos: string[] };
        const s = requireSession(a.purchaseId);
        const r = await compra.elegirAsientos(
          s.page,
          a.asientos.map((x) => x.toUpperCase()),
          loadComprador("cal"),
          s.seatDeadline,
        );
        updateSession(s.purchaseId, { estado: "resumen", asientos: a.asientos, total: r.total });
        return asText({
          resumenPath: guardarCaptura("resumen", s.purchaseId, r.resumenScreenshot),
          total: r.total,
          minutosRestantes: minutosRestantes(s.seatDeadline),
        });
      }

      if (name === "confirmarCompraCine") {
        const s = requireSession((args as { purchaseId: string }).purchaseId);
        const r = await compra.generarQr(s.page, loadComprador("cal"), s.seatDeadline);
        updateSession(s.purchaseId, { estado: "pago" });
        return asText({
          qrPath: guardarCaptura("qr", s.purchaseId, r.qrScreenshot),
          minutosRestantes: minutosRestantes(s.seatDeadline),
        });
      }

      if (name === "verificarPagoCine") {
        const s = requireSession((args as { purchaseId: string }).purchaseId);
        const r = await compra.verificarPago(s.page).catch(() => ({ pagado: false as const }));
        if (!r.pagado) return asText({ pagado: false });
        // Guard atómico: dos taps rápidos de "✅ Ya pagué" no deben entregar dos veces.
        if (!claimCompletion(s.purchaseId)) return asText({ pagado: true, yaEntregado: true });
        const entradasPath = r.entradasScreenshot
          ? guardarCaptura("entradas", s.purchaseId, r.entradasScreenshot)
          : undefined;
        await endSession(s.purchaseId, "completado");
        return asText({ pagado: true, codigoRetiro: r.entradas?.codigoRetiro, entradasPath });
      }

      if (name === "cancelarCompraCine") {
        await endSession((args as { purchaseId: string }).purchaseId, "cancelado");
        return asText({ cancelado: true });
      }

      if (name === "estadoCompraCine") {
        const s = getActiveSession();
        if (!s) return asText({ activa: false });
        return asText({
          activa: true,
          purchaseId: s.purchaseId,
          estado: s.estado,
          funcion: s.funcion,
          minutosRestantes: minutosRestantes(s.seatDeadline),
        });
      }

      return { isError: true, content: [{ type: "text" as const, text: `Tool desconocida: ${name}` }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { isError: true, content: [{ type: "text" as const, text: `Error en ${name}: ${msg}` }] };
    }
  });

  ensureReaperStarted();
  return server;
}
