import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
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
  selectJourney,
  advancePastPassengerSelection,
  listBoaPassengers,
  fillRequiredInfo,
  getSeatOptions,
  openSeatChangeForJourney,
  getBoardingPassForJourney,
  setFrequentFlyer,
  confirmSeatAndContinue,
  getBoardingPassUrl,
  getWalletPassScrapeData,
} from "./flow.js";
import { decodeBoardingPassBarcode, parseBcbpEssentials } from "./wallet-pdf417.js";
import { loadWalletPassConfig, signAndPackagePass, lookupAirportName } from "./wallet-pass.js";
import { renderPassCardImage } from "./wallet-image.js";

const ASSETS_DIR = join(import.meta.dirname, "..", "assets");

function readAssetFile(filename: string): Buffer {
  try {
    return readFileSync(join(ASSETS_DIR, filename));
  } catch (err) {
    throw new Error(
      `No se pudo leer el asset "${filename}" en ${ASSETS_DIR} — probablemente todavía no se generaron/aprobaron los assets de marca de BoA. Error original: ${(err as Error).message}`,
    );
  }
}

const TRAVELERS_PATH = join(homedir(), ".claude", "datos-viaje.json");

function asText(result: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
}

// Todas las tools comparten un único perfil de Chrome (PROFILE_DIR fijo en
// browser.ts) — dos sesiones concurrentes colisionan (Chrome fuerza single-
// instance por perfil) y corrompen el estado de la página a medio navegar.
// Serializa toda llamada a las tools de este server, sin importar cuántas
// lance el LLM en paralelo.
let chain: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.catch(() => {}).then(fn);
  chain = run.catch(() => {});
  return run;
}

interface PrepareArgs {
  locator: string;
  apellido: string;
  tramo?: string;
  pasajeros?: string[];
  datosAdicionales?: Record<string, { lugarNacimiento?: string; pasaporte?: BoaPasaporte }>;
}

interface ConfirmArgs {
  locator: string;
  apellido: string;
  tramo?: string;
  pasajeros?: string[];
  asientos?: Record<string, string>;
}

interface SeatChangeArgs {
  locator: string;
  apellido: string;
  tramo?: string;
  asiento?: string;
}

interface BoardingPassArgs {
  locator: string;
  apellido: string;
  tramo?: string;
}

interface FrequentFlyerArgs {
  locator: string;
  apellido: string;
  tramo?: string;
  pasajero?: string;
  numero: string;
}

interface WalletPassArgs {
  locator: string;
  apellido: string;
  tramo?: string;
  pasajero?: string;
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
    await selectJourney(session.page, args.tramo);
    const passengers = await listBoaPassengers(session.page);
    if (passengers.length === 0) {
      throw new Error(
        "BoA no devolvió ningún pasajero para esta reserva/tramo — revisar locator/apellido, o si el tramo elegido es el correcto.",
      );
    }
    const filtered = args.pasajeros?.length
      ? passengers.filter((p) => args.pasajeros!.some((n) => p.nombre.toLowerCase().includes(n.toLowerCase())))
      : passengers;
    if (filtered.length === 0) {
      throw new Error(
        `El filtro \`pasajeros\` no matcheó a nadie. Pasajeros de la reserva: ${passengers.map((p) => p.nombre).join(", ")}`,
      );
    }

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

    // Todos listos: pasar la selección de pasajeros/declaración y avanzar hasta el mapa de asientos.
    await advancePastPassengerSelection(session.page);
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
    await selectJourney(session.page, args.tramo);
    const passengers = await listBoaPassengers(session.page);
    if (passengers.length === 0) {
      throw new Error(
        "BoA no devolvió ningún pasajero para esta reserva/tramo — revisar locator/apellido, o si el tramo elegido es el correcto.",
      );
    }
    const filtered = args.pasajeros?.length
      ? passengers.filter((p) => args.pasajeros!.some((n) => p.nombre.toLowerCase().includes(n.toLowerCase())))
      : passengers;
    if (filtered.length === 0) {
      throw new Error(
        `El filtro \`pasajeros\` no matcheó a nadie. Pasajeros de la reserva: ${passengers.map((p) => p.nombre).join(", ")}`,
      );
    }

    await advancePastPassengerSelection(session.page);
    const resultados: { nombre: string; boardingPassUrl: string }[] = [];
    for (const p of filtered) {
      if (!p.yaCheckeado) {
        const traveler = resolveBoaTraveler(TRAVELERS_PATH, p.nombre.split(" ")[0]);
        if (!traveler) throw new Error(`Viajero "${p.nombre}" no está en datos-viaje.json`);
        await fillRequiredInfo(session.page, traveler);
        await getSeatOptions(session.page);
        await confirmSeatAndContinue(session.page, args.asientos?.[p.nombre]);
      }
      const url = await getBoardingPassUrl(session.page, p.nombre);
      resultados.push({ nombre: p.nombre, boardingPassUrl: url });
    }
    return asText({ pasajeros: resultados });
  } finally {
    await session.close();
  }
}

/**
 * Cambia el asiento de un pasajero cuyo check-in YA está confirmado (flujo
 * "Manage your booking > Change seats" — distinto de prepareBoaCheckin, que
 * es para check-in nuevo). Sin `asiento`, solo lee el mapa actual (preselec-
 * cionado + alternativas libres) sin tocar nada — el LLM debe mostrárselo a
 * Cal y confirmar el código elegido ANTES de volver a llamar con `asiento`.
 */
async function manageBoaSeat(args: SeatChangeArgs) {
  const session = await openBoaBrowserSession();
  try {
    await searchBoaReservation(session.page, args.locator, args.apellido);
    const opciones = await openSeatChangeForJourney(session.page, args.tramo);
    if (!args.asiento) {
      return asText({ actual: opciones.preseleccionado, alternativas: opciones.alternativas });
    }
    await confirmSeatAndContinue(session.page, args.asiento);
    return asText({ actualizado: true, nuevoAsiento: args.asiento });
  } finally {
    await session.close();
  }
}

/**
 * Recupera el boarding pass de TODOS los pasajeros de un tramo de BoA YA
 * confirmado — sin volver a hacer check-in ni tocar el asiento. Gap real
 * encontrado 2026-07-04: Cal pidió "dame el boarding" para un vuelo ya
 * checkeado y no había tool para eso, así que el LLM alucinaba que el
 * check-in no estaba abierto en vez de simplemente ir a buscar el PDF.
 * Bug real #2 (mismo día, producción vía Vesta): una reserva de 3 pasajeros
 * devolvía un solo PDF — arreglado devolviendo un array, uno por pasajero
 * (ver `getAllBoardingPasses` en flow.ts).
 */
async function getBoaBoardingPass(args: BoardingPassArgs) {
  const session = await openBoaBrowserSession();
  try {
    await searchBoaReservation(session.page, args.locator, args.apellido);
    const pases = await getBoardingPassForJourney(session.page, args.tramo);
    return asText({ boardingPasses: pases.map((p) => ({ nombre: p.nombre, boardingPassUrl: p.url })) });
  } finally {
    await session.close();
  }
}

/**
 * Carga o edita el número de viajero frecuente (Elévate) de un pasajero en un
 * tramo YA checkeado. Gap real encontrado 2026-07-04 (mismo patrón que
 * getBoaBoardingPass): Cal pidió agregar su número y no había tool para eso.
 */
async function setBoaFrequentFlyer(args: FrequentFlyerArgs) {
  const session = await openBoaBrowserSession();
  try {
    await searchBoaReservation(session.page, args.locator, args.apellido);
    await setFrequentFlyer(session.page, args.numero, { tramo: args.tramo, pasajero: args.pasajero });
    return asText({ actualizado: true, numero: args.numero });
  } finally {
    await session.close();
  }
}

/**
 * Genera un archivo .pkpass (Apple Wallet) del boarding pass de UN pasajero de
 * un tramo de BoA YA checkeado. El código de barras es el BCBP real del PDF
 * oficial, decodificado del PDF417 (ver wallet-pdf417.ts) — no un placeholder.
 * Requiere config de certificado (BOA_WALLET_* en apps.env, ver wallet-pass.ts)
 * y los assets de imagen en `assets/` (icon/logo, aún pendientes de aprobar).
 */
async function generateBoaWalletPass(args: WalletPassArgs) {
  const config = loadWalletPassConfig(); // tira error explícito y ANTES de tocar el browser si falta config

  const session = await openBoaBrowserSession();
  try {
    await searchBoaReservation(session.page, args.locator, args.apellido);
    const pases = await getBoardingPassForJourney(session.page, args.tramo);
    const targetPass = args.pasajero
      ? pases.find((p) => p.nombre.toLowerCase().includes(args.pasajero!.toLowerCase()))
      : pases[0];
    if (!targetPass) {
      throw new Error(
        `No encontré el boarding pass de "${args.pasajero ?? "el pasajero"}" — pasajeros con boarding pass en este tramo: ${pases.map((p) => p.nombre).join(", ") || "ninguno"}.`,
      );
    }

    const scrapeData = await getWalletPassScrapeData(session.page, args.locator, args.tramo, targetPass.nombre);

    let pdfRes: Response;
    try {
      pdfRes = await fetch(targetPass.url);
    } catch (err) {
      throw new Error(`No pude conectar para descargar el PDF del boarding pass: ${(err as Error).message}`);
    }
    if (!pdfRes.ok) throw new Error(`No pude descargar el PDF del boarding pass (HTTP ${pdfRes.status}).`);
    const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());
    const barcodeMessage = await decodeBoardingPassBarcode(pdfBuffer);

    // El scraping de "Manage your booking" (getWalletPassScrapeData) puede
    // devolver origen/destino vacíos si el layout real de BoA no matchea el
    // regex de ruta (bug real encontrado 2026-07-20, reserva HVKNUC: origen y
    // destino salieron "" en el pkpass). El BCBP recién decodificado es el
    // documento oficial del boarding pass — más confiable que el scrape —
    // así que pisa el origen/destino scrapeado cuando el barcode trae dato.
    const bcbp = parseBcbpEssentials(barcodeMessage, args.locator);
    if (bcbp.originCode) {
      scrapeData.originCode = bcbp.originCode;
      scrapeData.originName = lookupAirportName(bcbp.originCode);
    }
    if (bcbp.destinationCode) {
      scrapeData.destinationCode = bcbp.destinationCode;
      scrapeData.destinationName = lookupAirportName(bcbp.destinationCode);
    }

    const assets = {
      iconPng: readAssetFile("boa-icon.png"),
      icon2xPng: readAssetFile("boa-icon@2x.png"),
      logoPng: readAssetFile("boa-logo.png"),
      logo2xPng: readAssetFile("boa-logo@2x.png"),
    };

    const passData = { ...scrapeData, barcodeMessage };
    const pkpassBuffer = await signAndPackagePass(passData, config, assets);
    const fileStem = `boa-wallet-${args.locator}-${targetPass.nombre.replace(/\s+/g, "")}`;
    const pkpassPath = join(tmpdir(), `${fileStem}.pkpass`);
    writeFileSync(pkpassPath, pkpassBuffer);

    // Imagen decorativa con el diseño navy/dorado aprobado por Cal — NO
    // reemplaza el .pkpass (Wallet no soporta ese nivel de diseño, ver
    // wallet-pass.ts), es un extra que Jano/Vesta mandan por separado.
    const cardImageBuffer = await renderPassCardImage(passData, assets.logoPng);
    const cardImagePath = join(tmpdir(), `${fileStem}.png`);
    writeFileSync(cardImagePath, cardImageBuffer);

    return asText({ pasajero: targetPass.nombre, pkpassPath, cardImagePath });
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
        "Busca una reserva de BoA (Boliviana de Aviación) por locator+apellido y prepara el check-in de todos sus pasajeros (o el subconjunto en `pasajeros`). Si la reserva tiene más de un tramo (ida y vuelta, multi-destino), BoA pide elegir cuál — pasá `tramo` (título COMPLETO, ej. 'Santa Cruz to La Paz', no solo la ciudad: en un ida-y-vuelta AMBOS tramos suelen mencionar la misma ciudad, así que una ciudad sola es ambigua) para desambiguar; si hay un solo tramo con check-in abierto se usa automáticamente, y si no se especifica y hay ambigüedad la tool tira error listando las opciones con sus títulos completos — usá ESE texto literal en el siguiente llamado. IMPORTANTE si hay 2+ tramos: esta tool YA avanza hasta selección de asiento en el sitio de BoA (deja un hold temporal), así que hay que procesar UN TRAMO COMPLETO por vez — prepare→mostrar a Cal→confirmBoaCheckin de ESE tramo, recién DESPUÉS pasar al siguiente. Nunca llames esta tool en paralelo ni dos veces seguidas para tramos distintos sin confirmar el primero: puede dejar la reserva bloqueada del lado de BoA (incidente real 2026-07-12, tardó horas en liberarse). Rellena datos personales/pasaporte desde datos-viaje.json. Devuelve por pasajero { nombre, yaCheckeado, faltantes } y, si a todos no les falta nada, además los asientos preseleccionados/alternativas. Si faltan datos, pedíselos a Cal y volvé a llamar esta tool pasando `datosAdicionales` con las respuestas — se guardan para la próxima vez.",
      inputSchema: {
        type: "object",
        properties: {
          locator: { type: "string" },
          apellido: { type: "string" },
          tramo: { type: "string", description: "Título COMPLETO del tramo (ej. 'Santa Cruz to La Paz'), solo necesario si la reserva tiene más de un tramo con check-in abierto simultáneamente. NO pasar solo el nombre de una ciudad — es ambiguo en ida-y-vuelta." },
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
        "Confirma el check-in (asientos + submit) de los pasajeros de una reserva ya preparada con prepareBoaCheckin, y devuelve la URL pública del boarding pass de cada uno (para mandar con sendDocument). Mismo parámetro `tramo` que prepareBoaCheckin (título COMPLETO, ej. 'Santa Cruz to La Paz' — no solo la ciudad) si la reserva tiene varios tramos abiertos. Llamala INMEDIATAMENTE después del prepareBoaCheckin de ese mismo tramo, antes de tocar cualquier otro tramo de la reserva. `asientos` es opcional: { [nombre]: 'código de asiento' } para pisar el preseleccionado de alguien puntual.",
      inputSchema: {
        type: "object",
        properties: {
          locator: { type: "string" },
          apellido: { type: "string" },
          tramo: { type: "string" },
          pasajeros: { type: "array", items: { type: "string" } },
          asientos: { type: "object" },
        },
        required: ["locator", "apellido"],
        additionalProperties: false,
      },
    },
    {
      name: "manageBoaSeat",
      description:
        "Cambia el asiento de un pasajero cuyo check-in de BoA YA está confirmado (distinto de prepareBoaCheckin/confirmBoaCheckin, que son para check-in nuevo). Sin `asiento`: solo devuelve { actual, alternativas } (asiento actual + libres) sin cambiar nada — mostrárselo a Cal y confirmar el código ANTES de volver a llamar con `asiento`. Con `asiento`: confirma el cambio y devuelve { actualizado: true, nuevoAsiento }. Mismo `tramo` que las otras tools si la reserva tiene varios tramos con check-in hecho.",
      inputSchema: {
        type: "object",
        properties: {
          locator: { type: "string" },
          apellido: { type: "string" },
          tramo: { type: "string" },
          asiento: { type: "string", description: "Código de asiento (ej. '12C'). Si se omite, la tool solo lee las opciones disponibles sin cambiar nada." },
        },
        required: ["locator", "apellido"],
        additionalProperties: false,
      },
    },
    {
      name: "getBoaBoardingPass",
      description:
        "Recupera el boarding pass de TODOS los pasajeros de un tramo de BoA YA confirmado (NO hace check-in ni cambia asiento — usar cuando pidan 'dame el boarding'/'mándame la tarjeta de embarque' de un vuelo que ya sabés que está checkeado). Devuelve { boardingPasses: [{ nombre, boardingPassUrl }] } — un item por pasajero (si la reserva tiene 3 pasajeros, devuelve 3). Mandá CADA URL como documento separado, nunca como texto/link. Mismo `tramo` que las otras tools si la reserva tiene varios tramos con check-in hecho. Si el check-in de ese tramo NO está hecho todavía, tira error explícito (no asumas fechas de apertura por tu cuenta — dejá que el error lo diga).",
      inputSchema: {
        type: "object",
        properties: {
          locator: { type: "string" },
          apellido: { type: "string" },
          tramo: { type: "string" },
        },
        required: ["locator", "apellido"],
        additionalProperties: false,
      },
    },
    {
      name: "setBoaFrequentFlyer",
      description:
        "Carga o edita el número de viajero frecuente (Elévate) de un pasajero en un tramo de BoA YA checkeado (usar cuando pidan 'agrega mi número de viajero frecuente'/'carga mi Elévate'). El programa se asume siempre BoA/Elévate. `pasajero` (substring de nombre) solo hace falta si la reserva tiene más de un pasajero. Devuelve { actualizado: true, numero }. Si el tramo no tiene el check-in hecho, tira error explícito.",
      inputSchema: {
        type: "object",
        properties: {
          locator: { type: "string" },
          apellido: { type: "string" },
          tramo: { type: "string" },
          pasajero: { type: "string", description: "Nombre (o parte) del pasajero a actualizar, solo necesario si la reserva tiene más de uno." },
          numero: { type: "string", description: "Número de viajero frecuente de Elévate (BoA)." },
        },
        required: ["locator", "apellido", "numero"],
        additionalProperties: false,
      },
    },
    {
      name: "generateBoaWalletPass",
      description:
        "Genera un archivo .pkpass (Apple Wallet) escaneable del boarding pass de UN pasajero de un tramo de BoA YA checkeado, MÁS una imagen .png de la tarjeta con el diseño navy/dorado aprobado por Cal (misma info, barcode real, solo decorativa) — usar SOLO cuando Cal pida explícitamente 'el pase de Wallet'/'agrégalo a Wallet' (no se genera automáticamente junto al PDF). El código de barras (tanto del .pkpass como de la imagen) es el mismo BCBP real del PDF oficial (decodificado del PDF417), así que sirve igual que el PDF en el control de embarque. `pasajero` (substring de nombre) desambigua si la reserva tiene más de uno; sin él toma el primero. Devuelve { pasajero, pkpassPath, cardImagePath } — ambos son archivos LOCALES (no URLs públicas): mandar pkpassPath con la tool de documento LOCAL, y cardImagePath con la tool de foto LOCAL (nunca con enviarDocumentoUrl/enviarFotoUrl). Si falta configurar el certificado (BOA_WALLET_* en apps.env) o el tramo no tiene el check-in hecho, tira error explícito.",
      inputSchema: {
        type: "object",
        properties: {
          locator: { type: "string" },
          apellido: { type: "string" },
          tramo: { type: "string" },
          pasajero: { type: "string", description: "Substring del nombre del pasajero, solo necesario si la reserva tiene más de uno." },
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
    if (name === "prepareBoaCheckin") return await withLock(() => prepareBoaCheckin(args as unknown as PrepareArgs));
    if (name === "confirmBoaCheckin") return await withLock(() => confirmBoaCheckin(args as unknown as ConfirmArgs));
    if (name === "manageBoaSeat") return await withLock(() => manageBoaSeat(args as unknown as SeatChangeArgs));
    if (name === "getBoaBoardingPass") return await withLock(() => getBoaBoardingPass(args as unknown as BoardingPassArgs));
    if (name === "setBoaFrequentFlyer") return await withLock(() => setBoaFrequentFlyer(args as unknown as FrequentFlyerArgs));
    if (name === "generateBoaWalletPass") return await withLock(() => generateBoaWalletPass(args as unknown as WalletPassArgs));
    return { isError: true, content: [{ type: "text", text: `Unknown tool: ${name}` }] };
  } catch (err) {
    return { isError: true, content: [{ type: "text", text: `Error en ${name}: ${(err as Error).message}` }] };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
