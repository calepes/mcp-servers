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
import type { Page } from "playwright";
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
  changeSeatFromManage,
  getBoardingPassUrl,
  getAllBoardingPasses,
  getWalletPassScrapeData,
  captureDiagnostics,
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

/**
 * Abre la sesión de Chrome, corre `fn`, y si algo falla captura screenshot +
 * texto de la pantalla a tmpdir ANTES de cerrar el browser, adjuntando los
 * paths al mensaje de error (auditoría 2026-07-20: todos los bugs reales de
 * este MCP requirieron reproducción manual porque el timeout de Playwright no
 * dice qué había en pantalla). La captura es best-effort — nunca enmascara el
 * error original.
 */
async function withBoaSession<T>(toolName: string, fn: (page: Page) => Promise<T>): Promise<T> {
  const session = await openBoaBrowserSession();
  try {
    return await fn(session.page);
  } catch (err) {
    const diag = await captureDiagnostics(session.page, toolName);
    if (diag) {
      (err as Error).message += ` [diagnóstico: ${diag.screenshotPath} · ${diag.textPath}]`;
    }
    throw err;
  } finally {
    await session.close();
  }
}

/**
 * Post-condición de asiento (lección 2026-07-13, tercera aparición del patrón
 * "ok:true sin verificar"): leer el asiento REAL del PDF ya emitido, vía el
 * BCBP del código de barras — la única fuente que refleja lo que persistió el
 * backend de Amadeus. Best-effort: null si no se pudo verificar (no rompe la
 * entrega del boarding pass por una falla de verificación).
 */
async function verifySeatFromPdf(url: string, locatorCode: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const pdf = Buffer.from(await res.arrayBuffer());
    const bcbp = await decodeBoardingPassBarcode(pdf);
    return parseBcbpEssentials(bcbp, locatorCode).seat || null;
  } catch {
    return null;
  }
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

  return withBoaSession("prepare", async (page) => {
    await searchBoaReservation(page, args.locator, args.apellido);
    const sel = await selectJourney(page, args.tramo);
    if (sel.yaCheckeado) {
      // Bug real 2026-07-20: prepareBoaCheckin EJECUTA el check-in del lado de
      // Amadeus (ver description de la tool) — un prepare abandonado deja el
      // tramo checkeado, y antes este caso fallaba con el mensaje falso "el
      // check-in todavía no está abierto". Ahora se reporta la verdad y se
      // devuelven los boarding passes ya emitidos.
      const pases = await getAllBoardingPasses(page);
      return asText({
        yaCheckeado: true,
        mensaje:
          "Este tramo YA tiene el check-in hecho — no hay nada que preparar. Adjunto los boarding passes emitidos. Para cambiar un asiento, usar confirmBoaCheckin con `asientos` o manageBoaSeat.",
        boardingPasses: pases.map((p) => ({ nombre: p.nombre, boardingPassUrl: p.url })),
      });
    }
    const passengers = await listBoaPassengers(page);
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
    await advancePastPassengerSelection(page);
    const asientos: Record<string, unknown> = {};
    for (const s of statuses) {
      if (s.yaCheckeado) continue;
      const traveler = resolveBoaTraveler(TRAVELERS_PATH, s.nombre.split(" ")[0])!;
      await fillRequiredInfo(page, traveler);
      asientos[s.nombre] = await getSeatOptions(page);
    }
    return asText({ pasajeros: statuses, asientos });
  });
}

async function confirmBoaCheckin(args: ConfirmArgs) {
  return withBoaSession("confirm", async (page) => {
    await searchBoaReservation(page, args.locator, args.apellido);
    const sel = await selectJourney(page, args.tramo);

    if (sel.yaCheckeado) {
      // Camino idempotente (bug real 2026-07-20): el check-in ya quedó hecho —
      // típicamente por el prepareBoaCheckin previo de esta misma conversación,
      // que ejecuta el check-in real del lado de Amadeus con el asiento
      // preseleccionado. Acá solo queda ajustar el asiento si se pidió uno
      // distinto, y devolver los boarding passes emitidos.
      const pedidos = Object.entries(args.asientos ?? {});
      if (pedidos.length > 1) {
        throw new Error(
          "El camino post-checkin solo soporta cambiar UN asiento por llamada (la pantalla de BoA no permite elegir pasajero) — pedí los cambios de a uno.",
        );
      }
      const ajustes: Record<string, { cambiado: boolean; asiento: string }> = {};
      for (const [nombre, asiento] of pedidos) {
        // changeSeatFromManage además valida que la reserva tenga UN solo
        // pasajero checkeado (guard multi-pax — ver flow.ts).
        ajustes[nombre] = await changeSeatFromManage(page, asiento);
      }
      const pases = await getAllBoardingPasses(page);
      const resultados: { nombre: string; boardingPassUrl: string; asientoVerificado: string | null }[] = [];
      for (const p of pases) {
        resultados.push({
          nombre: p.nombre,
          boardingPassUrl: p.url,
          asientoVerificado: await verifySeatFromPdf(p.url, args.locator),
        });
      }
      return asText({ yaCheckeado: true, pasajeros: resultados });
    }

    const passengers = await listBoaPassengers(page);
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

    await advancePastPassengerSelection(page);
    const resultados: { nombre: string; boardingPassUrl: string; asientoPedido?: string; asientoVerificado?: string | null }[] = [];
    for (const p of filtered) {
      if (!p.yaCheckeado) {
        const traveler = resolveBoaTraveler(TRAVELERS_PATH, p.nombre.split(" ")[0]);
        if (!traveler) throw new Error(`Viajero "${p.nombre}" no está en datos-viaje.json`);
        await fillRequiredInfo(page, traveler);
        await getSeatOptions(page);
        await confirmSeatAndContinue(page, args.asientos?.[p.nombre]);
      }
      const url = await getBoardingPassUrl(page, p.nombre);
      const pedido = args.asientos?.[p.nombre];
      if (pedido) {
        // Post-condición: verificar contra el PDF real que el asiento pedido persistió.
        resultados.push({
          nombre: p.nombre,
          boardingPassUrl: url,
          asientoPedido: pedido,
          asientoVerificado: await verifySeatFromPdf(url, args.locator),
        });
      } else {
        resultados.push({ nombre: p.nombre, boardingPassUrl: url });
      }
    }
    return asText({ pasajeros: resultados });
  });
}

/**
 * Cambia el asiento de un pasajero cuyo check-in YA está confirmado (flujo
 * "Manage your booking > Change seats" — distinto de prepareBoaCheckin, que
 * es para check-in nuevo). Sin `asiento`, solo lee el mapa actual (preselec-
 * cionado + alternativas libres) sin tocar nada — el LLM debe mostrárselo a
 * Cal y confirmar el código elegido ANTES de volver a llamar con `asiento`.
 */
async function manageBoaSeat(args: SeatChangeArgs) {
  return withBoaSession("seat", async (page) => {
    await searchBoaReservation(page, args.locator, args.apellido);
    const opciones = await openSeatChangeForJourney(page, args.tramo);
    if (!args.asiento) {
      return asText({ actual: opciones.preseleccionado, alternativas: opciones.alternativas });
    }
    await confirmSeatAndContinue(page, args.asiento);
    return asText({ actualizado: true, nuevoAsiento: args.asiento });
  });
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
  return withBoaSession("boardingpass", async (page) => {
    await searchBoaReservation(page, args.locator, args.apellido);
    const pases = await getBoardingPassForJourney(page, args.tramo);
    return asText({ boardingPasses: pases.map((p) => ({ nombre: p.nombre, boardingPassUrl: p.url })) });
  });
}

/**
 * Carga o edita el número de viajero frecuente (Elévate) de un pasajero en un
 * tramo YA checkeado. Gap real encontrado 2026-07-04 (mismo patrón que
 * getBoaBoardingPass): Cal pidió agregar su número y no había tool para eso.
 */
async function setBoaFrequentFlyer(args: FrequentFlyerArgs) {
  return withBoaSession("frequentflyer", async (page) => {
    await searchBoaReservation(page, args.locator, args.apellido);
    await setFrequentFlyer(page, args.numero, { tramo: args.tramo, pasajero: args.pasajero });
    return asText({ actualizado: true, numero: args.numero });
  });
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

  return withBoaSession("walletpass", async (page) => {
    await searchBoaReservation(page, args.locator, args.apellido);
    const pases = await getBoardingPassForJourney(page, args.tramo);
    const targetPass = args.pasajero
      ? pases.find((p) => p.nombre.toLowerCase().includes(args.pasajero!.toLowerCase()))
      : pases[0];
    if (!targetPass) {
      throw new Error(
        `No encontré el boarding pass de "${args.pasajero ?? "el pasajero"}" — pasajeros con boarding pass en este tramo: ${pases.map((p) => p.nombre).join(", ") || "ninguno"}.`,
      );
    }

    const scrapeData = await getWalletPassScrapeData(page, args.locator, args.tramo, targetPass.nombre);

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
  });
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
        "Busca una reserva de BoA (Boliviana de Aviación) por locator+apellido y avanza el check-in de todos sus pasajeros (o el subconjunto en `pasajeros`) hasta el mapa de asientos. ⚠️ OJO: esta tool EJECUTA el check-in real del lado de BoA/Amadeus — al pasar la pantalla de información requerida, el pasajero QUEDA CHECKEADO con el asiento preseleccionado, aunque nunca se llame confirmBoaCheckin (confirmado con reserva real 2026-07-20). confirmBoaCheckin después solo ajusta el asiento y trae el boarding pass. Por eso: NUNCA la llames en paralelo ni para dos tramos sin confirmar el primero, y si el resultado siguiente dice que el tramo 'ya está checkeado', eso es lo esperado (no un error). Si el tramo YA está checkeado, devuelve { yaCheckeado: true, boardingPasses } directamente. Si la reserva tiene más de un tramo (ida y vuelta, multi-destino), pasá `tramo` (título COMPLETO, ej. 'Santa Cruz to La Paz', no solo la ciudad — en un ida-y-vuelta ambos tramos mencionan la misma ciudad); si hay ambigüedad la tool tira error listando cada tramo con su ESTADO real (abierto / ya hecho / todavía no abre) — usá ese texto literal. Rellena datos personales/pasaporte desde datos-viaje.json. Devuelve por pasajero { nombre, yaCheckeado, faltantes } y, si no falta nada, los asientos preseleccionados/alternativas. Si faltan datos, pedíselos a Cal y volvé a llamar con `datosAdicionales` — se guardan para la próxima vez.",
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
        "Cierra el check-in iniciado con prepareBoaCheckin: aplica los asientos pedidos y devuelve la URL pública del boarding pass de cada pasajero (para mandar con sendDocument). Es IDEMPOTENTE: como prepareBoaCheckin ya deja al pasajero checkeado del lado de BoA (con el asiento preseleccionado), si al reentrar el tramo aparece como ya checkeado esta tool NO falla — cambia el asiento si `asientos` pide uno distinto del actual (solo reservas de UN pasajero; con varios tira error explícito) y devuelve los boarding passes igual, con { yaCheckeado: true }. Los resultados incluyen `asientoVerificado`: el asiento leído del BCBP del PDF real emitido (verificación post-condición). Si difiere del pedido, avisale a Cal en vez de asumir que quedó; si es null significa 'no se pudo verificar' (NO un mismatch — no lo reportes como error). Mismo parámetro `tramo` que prepareBoaCheckin (título COMPLETO, ej. 'Santa Cruz to La Paz' — no solo la ciudad) si la reserva tiene varios tramos. Llamala INMEDIATAMENTE después del prepareBoaCheckin de ese mismo tramo, antes de tocar cualquier otro tramo. `asientos` es opcional: { [nombre]: 'código de asiento' } para pisar el preseleccionado.",
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
