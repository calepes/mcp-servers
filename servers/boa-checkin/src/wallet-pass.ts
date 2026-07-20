import { readFileSync } from "node:fs";
import { PKPass } from "passkit-generator";

export interface WalletPassConfig {
  passTypeIdentifier: string;
  teamIdentifier: string;
  signerCertPath: string;
  signerKeyPath: string;
  signerKeyPassphrase?: string;
  wwdrPath: string;
}

/**
 * Lee la config de firma del `.pkpass` desde env vars (apps.env). Tira error
 * explícito listando TODAS las keys que faltan — nunca arma un pase a medias
 * ni asume defaults para certificados/identificadores.
 */
export function loadWalletPassConfig(): WalletPassConfig {
  const passTypeIdentifier = process.env.BOA_WALLET_PASS_TYPE_ID;
  const teamIdentifier = process.env.BOA_WALLET_TEAM_ID;
  const signerCertPath = process.env.BOA_WALLET_SIGNER_CERT_PATH;
  const signerKeyPath = process.env.BOA_WALLET_SIGNER_KEY_PATH;
  const wwdrPath = process.env.BOA_WALLET_WWDR_PATH;

  const missing = [
    !passTypeIdentifier && "BOA_WALLET_PASS_TYPE_ID",
    !teamIdentifier && "BOA_WALLET_TEAM_ID",
    !signerCertPath && "BOA_WALLET_SIGNER_CERT_PATH",
    !signerKeyPath && "BOA_WALLET_SIGNER_KEY_PATH",
    !wwdrPath && "BOA_WALLET_WWDR_PATH",
  ].filter((v): v is string => Boolean(v));

  if (missing.length > 0) {
    throw new Error(
      `Falta configurar en apps.env: ${missing.join(", ")} — ver docs/superpowers/specs/2026-07-15-boa-wallet-pass-design.md.`,
    );
  }

  return {
    passTypeIdentifier: passTypeIdentifier!,
    teamIdentifier: teamIdentifier!,
    signerCertPath: signerCertPath!,
    signerKeyPath: signerKeyPath!,
    signerKeyPassphrase: process.env.BOA_WALLET_SIGNER_KEY_PASSPHRASE,
    wwdrPath: wwdrPath!,
  };
}

export interface WalletPassData {
  locator: string;
  passengerName: string;
  frequentFlyerNumber?: string;
  flightNumber: string;
  originCode: string;
  originName: string;
  destinationCode: string;
  destinationName: string;
  departureTime: string;
  // Sin scraping confirmado todavía contra el DOM real de BoA (el check-in
  // no siempre muestra la hora de llegada) — si falta, la fila 0 muestra
  // solo la salida, sin la columna de llegada.
  arrivalTime?: string;
  boardingTime: string;
  flightDate: string;
  seat: string;
  boardingGroup: string;
  travelClass: string;
  boardingSequence?: string;
  gate?: string;
  barcodeMessage: string;
}

interface PassField {
  key: string;
  label?: string;
  value: string;
}

export interface BoaPassFields {
  headerFields: PassField[];
  primaryFields: PassField[];
  secondaryFields: PassField[];
  auxiliaryFields: PassField[];
  backFields: PassField[];
}

/**
 * Deriva el label corto (nombre de ciudad) de un nombre de aeropuerto
 * scrapeado del check-in de BoA. El formato NO es consistente: unos vienen
 * como "Ciudad — Nombre Aeropuerto" (ej. "La Paz — El Alto Intl.") y otros
 * como "Nombre Aeropuerto, Ciudad" (ej. "Viru Viru Intl., Santa Cruz"). Un
 * split ingenuo tomando siempre el primer segmento falla en el segundo
 * formato (devolvería "VIRU VIRU INTL." en vez de "SANTA CRUZ"). Por eso:
 * si hay guión largo, la ciudad está ANTES; si no y hay coma, la ciudad
 * está DESPUÉS de la última coma.
 *
 * Asume que un nombre tiene como máximo uno de estos delimitadores — no
 * verificado contra el listado completo de aeropuertos de BoA. Si algún
 * nombre real trae AMBOS (ej. "Viru Viru Intl., Santa Cruz — Bolivia"), la
 * rama del guión largo gana primero y el resultado sale mal en silencio
 * ("VIRU VIRU INTL., SANTA CRUZ" en vez de "SANTA CRUZ").
 */
function shortAirportLabel(name: string): string {
  if (name.includes("—")) {
    return name.split("—")[0].trim().toUpperCase();
  }
  const lastComma = name.lastIndexOf(",");
  if (lastComma !== -1) {
    return name.slice(lastComma + 1).trim().toUpperCase();
  }
  return name.trim().toUpperCase();
}

/**
 * Nombres de ciudad + aeropuerto por código IATA para los destinos que
 * realmente vuela BoA — los 12 aeropuertos NAABOL de Bolivia (mismo set que
 * `naabol-flights`/`vuelos-naabol-format.ts`) más los destinos
 * internacionales confirmados (Wikipedia, 2026-07-20). Formato "Ciudad —
 * Nombre Aeropuerto" a propósito: es el que `shortAirportLabel` espera para
 * separar la ciudad del resto.
 *
 * No pretende ser exhaustivo — BoA anuncia rutas nuevas seguido. Un código no
 * mapeado cae en `lookupAirportName` al propio código (mismo criterio de
 * degradar con gracia que el resto de este archivo), nunca revienta.
 */
const AIRPORT_NAMES: Record<string, string> = {
  // Bolivia (NAABOL)
  VVI: "Santa Cruz — Viru Viru Intl.",
  LPB: "La Paz — El Alto Intl.",
  CBB: "Cochabamba — Jorge Wilstermann Intl.",
  TJA: "Tarija — Oriel Lea Plaza",
  SRE: "Sucre — Alcantarí",
  ORU: "Oruro — Juan Mendoza",
  UYU: "Uyuni — Joya Andina",
  CIJ: "Cobija — Aníbal Arab",
  RIB: "Riberalta — Riberalta",
  RBQ: "Rurrenabaque — Rurrenabaque",
  TDD: "Trinidad — Jorge Henrich Arauz",
  GYA: "Guayaramerín — Guayaramerín",
  // Internacional
  MIA: "Miami — Miami Intl.",
  EZE: "Buenos Aires — Ministro Pistarini",
  GRU: "São Paulo — Guarulhos",
  SCL: "Santiago — Arturo Merino Benítez",
  LIM: "Lima — Jorge Chávez",
  MAD: "Madrid — Barajas",
  BCN: "Barcelona — El Prat",
};

/** Nombre legible de un código IATA, o el código tal cual si no está mapeado. */
export function lookupAirportName(code: string): string {
  return AIRPORT_NAMES[code] ?? code;
}

const MONTH_TO_NUMBER: Record<string, string> = {
  ene: "01", jan: "01",
  feb: "02",
  mar: "03",
  abr: "04", apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  ago: "08", aug: "08",
  sep: "09",
  oct: "10",
  nov: "11",
  dic: "12", dec: "12",
};

/**
 * Convierte una fecha tipo "14 Jul" / "14 Jul 2026" (formato que devuelve el
 * scraping de BoA) a "14/07" (DD/MM) — a pedido de Cal (2026-07-17), que
 * quiere el mismo formato que un pase real de BoA/LATAM. Si el texto no
 * matchea el patrón esperado, lo devuelve tal cual en vez de romper — nunca
 * vimos el DOM real de BoA todavía (ver gotchas de flow.ts), así que más
 * vale degradar con gracia que asumir un formato que puede no aplicar.
 */
function toDDMM(flightDate: string): string {
  const match = flightDate.match(/(\d{1,2})\s+([A-Za-zÀ-ÿ]{3,})/);
  if (!match) return flightDate;
  const day = match[1].padStart(2, "0");
  const month = MONTH_TO_NUMBER[match[2].slice(0, 3).toLowerCase()];
  return month ? `${day}/${month}` : flightDate;
}

/**
 * Arma los grupos de campos del `pass.json` (tipo boardingPass) a partir de
 * los datos ya scrapeados del check-in — sin tocar certificados ni firmar
 * nada, para que sea testeable sin Chrome ni criptografía.
 *
 * Estructura final pedida por Cal (2026-07-17), calcando la de un pase REAL
 * de BoA que mandó como referencia (BOARDING TIME arriba; FLIGHT/DEPARTURE/
 * GATE en una fila; NAME/SEAT/GROUP/CLASS en la otra) — con el navy/blanco
 * aprobado en vez del blanco/navy-texto original de BoA. `passkit-
 * generator@3.5.7` (verificado también en el pre-release 3.6.0-alpha.1) solo
 * permite alinear campos bajo primaryFields (`row`) para pases tipo
 * `eventTicket`, tira `ValidationError` en `boardingPass` y descarta el
 * campo en silencio — por eso esta fila va en secondaryFields en vez de
 * alineada exactamente bajo cada código de aeropuerto.
 */
export function buildBoaPassFields(data: WalletPassData): BoaPassFields {
  // Labels en inglés (no español) — a pedido de Cal (2026-07-17): son más
  // cortos ("NAME" vs "PASAJERO", "SEAT" vs "ASIENTO"), lo que le da más
  // espacio de columna a valores largos como el nombre completo del
  // pasajero. Mismo criterio que un pase real de BoA/LATAM (100% en inglés).
  const backFields: PassField[] = [
    { key: "locator", label: "BOOKING REFERENCE", value: data.locator },
    { key: "sequence", label: "SEQUENCE", value: data.boardingSequence ?? "—" },
    { key: "originFull", label: "FROM", value: `${data.originName} (${data.originCode})` },
    { key: "destinationFull", label: "TO", value: `${data.destinationName} (${data.destinationCode})` },
    { key: "contact", label: "CONTACT", value: "Boliviana de Aviación · boa.bo" },
  ];
  if (data.arrivalTime) {
    backFields.push({ key: "arrival", label: "ARRIVAL", value: data.arrivalTime });
  }
  if (data.frequentFlyerNumber) {
    backFields.push({ key: "frequentFlyer", label: "FREQUENT FLYER", value: data.frequentFlyerNumber });
  }

  return {
    headerFields: [{ key: "boarding", label: "BOARDING TIME", value: `${data.boardingTime} ${toDDMM(data.flightDate)}` }],
    primaryFields: [
      { key: "origin", label: shortAirportLabel(data.originName), value: data.originCode },
      { key: "destination", label: shortAirportLabel(data.destinationName), value: data.destinationCode },
    ],
    secondaryFields: [
      { key: "flightNumber", label: "FLIGHT", value: data.flightNumber },
      { key: "departure", label: "DEPARTURE", value: data.departureTime },
      { key: "gate", label: "GATE", value: data.gate ?? "—" },
    ],
    auxiliaryFields: [
      { key: "passenger", label: "NAME", value: data.passengerName },
      { key: "seat", label: "SEAT", value: data.seat },
      { key: "group", label: "GROUP", value: data.boardingGroup || "—" },
      { key: "class", label: "CLASS", value: data.travelClass },
    ],
    backFields,
  };
}

/**
 * Lee un archivo de certificado del filesystem para pasarlo a `passkit-generator`.
 * Envuelve `readFileSync` con un error explícito (path + qué config key tocar)
 * en vez de dejar pasar el `ENOENT` crudo de Node — mismo criterio que
 * `loadWalletPassConfig` ya aplica para env vars faltantes.
 */
function readCertFile(path: string, label: string): Buffer {
  try {
    return readFileSync(path);
  } catch (err) {
    throw new Error(
      `No se pudo leer ${label} en "${path}" — revisar el path en apps.env. Error original: ${(err as Error).message}`,
    );
  }
}

/**
 * NO tiene test unitario con cripto real (el `.p12`/certs de Cal no viven en
 * el repo) — se valida con el flujo E2E una vez que Cal tenga certificado
 * real de Apple Developer (ver docs/superpowers/specs/2026-07-15-boa-wallet-
 * pass-design.md). Arma y firma el `.pkpass` final; a diferencia de
 * `buildBoaPassFields`, esto SÍ toca certificados.
 *
 * Verificado contra `passkit-generator@3.5.7` (README + lib/types/*.d.ts):
 * - `certificates` SÍ espera `wwdr`/`signerCert`/`signerKey` como PEM
 *   separados (+ `signerKeyPassphrase` opcional) — no un único `.p12`. Esto
 *   confirma que el shape de `WalletPassConfig` (Task 5) es correcto, no
 *   hace falta rediseñarlo.
 * - Constructor real: `new PKPass(buffers, certificates, props)` — 3 args
 *   posicionales, en ese orden (confirmado en `PKPass.d.ts` y en el ejemplo
 *   "Buffer Model" del README). `buffers` es `{}` porque las imágenes se
 *   agregan después vía `addBuffer`.
 * - `pass.type`/`pass.transitType` son setters reales (no van en el
 *   constructor). `boardingPass` + `PKTransitTypeAir` dan el ícono de avión
 *   y el divisor perforado nativos — se probó `"generic"` primero (Cal
 *   pidió diferenciarlo de BoA, 2026-07-17) pero perdía ambos; una captura
 *   real de un pase de LATAM confirmó que son features del estilo
 *   `boardingPass`, no algo exclusivo del layout de BoA — se revirtió.
 * - `headerFields`/`primaryFields`/etc. son GETTERS que devuelven un
 *   `FieldsArray` (subclase de `Array` con `push` real) — no hay setter,
 *   pero `.push(...)` sí muta el pass. Tal cual estaba en el plan.
 * - `setBarcodes` acepta `(...barcodes: Barcode[])` — pasar un solo objeto
 *   funciona porque es variádico.
 * - `addBuffer(pathName, buffer)` existe con esa firma exacta.
 * - `getAsBuffer()` es SÍNCRONO (devuelve `Buffer`, no `Promise<Buffer>`).
 *   Como esta función ya es `async`, el `return` lo envuelve en una promesa
 *   resuelta sin problema — no hace falta `await`.
 *
 * Sin deviaciones respecto al snippet del plan: la única duda real (¿p12
 * único vs PEMs separados?) se resolvió a favor del plan.
 */
export async function signAndPackagePass(
  data: WalletPassData,
  config: WalletPassConfig,
  assets: { iconPng: Buffer; icon2xPng: Buffer; logoPng: Buffer; logo2xPng: Buffer },
): Promise<Buffer> {
  const fields = buildBoaPassFields(data);

  const pass = new PKPass(
    {},
    {
      wwdr: readCertFile(config.wwdrPath, "el certificado WWDR"),
      signerCert: readCertFile(config.signerCertPath, "el cert de firma"),
      signerKey: readCertFile(config.signerKeyPath, "la clave de firma"),
      signerKeyPassphrase: config.signerKeyPassphrase,
    },
    {
      passTypeIdentifier: config.passTypeIdentifier,
      teamIdentifier: config.teamIdentifier,
      // Sanitiza espacios de las 3 partes (locator/flightNumber pueden traer
      // espacios, ej. "OB 601") — Apple no restringe el formato de
      // serialNumber, esto es solo para evitar espacios sueltos en el string.
      serialNumber: [data.locator, data.flightNumber, data.passengerName]
        .map((part) => part.replace(/\s+/g, ""))
        .join("-"),
      organizationName: "Boliviana de Aviación",
      description: `Boarding pass ${data.flightNumber} ${data.originCode}-${data.destinationCode}`,
      formatVersion: 1,
      // Paleta navy/dorado aprobada por Cal (mockup 2026-07-15,
      // https://claude.ai/code/artifact/9adb2360-3a2c-48c1-bb01-b500421d75a2).
      // Sin esto Wallet usa blanco/negro por default — no hay fallback visual
      // razonable a estos 3 valores, tienen que ir siempre.
      backgroundColor: "rgb(10, 31, 61)", // --boa-navy-deep #0a1f3d
      foregroundColor: "rgb(245, 247, 250)", // --boa-white #f5f7fa
      labelColor: "rgb(138, 151, 179)", // --boa-slate #8a97b3
    },
  );

  // boardingPass (no generic): confirmado con una captura real de un pase
  // de LATAM (2026-07-17) que el ícono de avión y el divisor perforado son
  // features NATIVAS de este estilo con transitType seteado — no hacía
  // falta abandonarlo para lograr un layout distinto al de BoA.
  pass.type = "boardingPass";
  pass.transitType = "PKTransitTypeAir";
  pass.headerFields.push(...fields.headerFields);
  pass.primaryFields.push(...fields.primaryFields);
  pass.secondaryFields.push(...fields.secondaryFields);
  pass.auxiliaryFields.push(...fields.auxiliaryFields);
  pass.backFields.push(...fields.backFields);
  pass.setBarcodes({
    format: "PKBarcodeFormatPDF417",
    message: data.barcodeMessage,
    messageEncoding: "iso-8859-1",
    altText: `${data.flightNumber} · ${data.originCode} ${data.destinationCode} · ${data.seat}`,
  });

  pass.addBuffer("icon.png", assets.iconPng);
  pass.addBuffer("icon@2x.png", assets.icon2xPng);
  pass.addBuffer("logo.png", assets.logoPng);
  pass.addBuffer("logo@2x.png", assets.logo2xPng);

  return pass.getAsBuffer();
}
