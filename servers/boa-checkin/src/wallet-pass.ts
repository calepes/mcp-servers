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
  // boardingTime y flightDate no los usa buildBoaPassFields — quedan
  // reservados para los campos top-level del pass.json (description/
  // serialNumber/relevantDate) que arma signAndPackagePass.
  passengerName: string;
  frequentFlyerNumber?: string;
  flightNumber: string;
  originCode: string;
  originName: string;
  destinationCode: string;
  destinationName: string;
  departureTime: string;
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
  label: string;
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
 * Arma los grupos de campos del `pass.json` (tipo boardingPass) a partir de
 * los datos ya scrapeados del check-in — sin tocar certificados ni firmar
 * nada, para que sea testeable sin Chrome ni criptografía.
 */
export function buildBoaPassFields(data: WalletPassData): BoaPassFields {
  return {
    headerFields: data.frequentFlyerNumber
      ? [{ key: "frequentFlyer", label: "ELÉVATE", value: data.frequentFlyerNumber }]
      : [],
    primaryFields: [
      { key: "origin", label: shortAirportLabel(data.originName), value: data.originCode },
      { key: "destination", label: shortAirportLabel(data.destinationName), value: data.destinationCode },
    ],
    // Agrupamiento deliberadamente distinto al de un pase real de BoA (que
    // pone VUELO/SALIDA/PUERTA en una fila y PASAJERO/ASIENTO/GRUPO/CLASE en
    // otra) — pasajero+salida van juntos como bloque principal, y el resto
    // de la logística de vuelo (número, fecha, puerta, asiento, grupo) va
    // agrupada aparte. La clase de viaje pasa al reverso.
    secondaryFields: [
      { key: "passenger", label: "PASAJERO", value: data.passengerName },
      { key: "departure", label: "SALIDA", value: data.departureTime },
    ],
    auxiliaryFields: [
      { key: "flightNumber", label: "VUELO", value: data.flightNumber },
      { key: "flightDate", label: "FECHA", value: data.flightDate },
      { key: "gate", label: "PUERTA", value: data.gate ?? "—" },
      { key: "seat", label: "ASIENTO", value: data.seat },
      { key: "group", label: "GRUPO", value: data.boardingGroup },
    ],
    backFields: [
      { key: "locator", label: "CÓDIGO DE RESERVA", value: data.locator },
      { key: "sequence", label: "SECUENCIA DE ABORDAJE", value: data.boardingSequence ?? "—" },
      { key: "class", label: "CLASE", value: data.travelClass },
      { key: "originFull", label: "ORIGEN", value: `${data.originName} (${data.originCode})` },
      { key: "destinationFull", label: "DESTINO", value: `${data.destinationName} (${data.destinationCode})` },
      { key: "contact", label: "CONTACTO", value: "Boliviana de Aviación · consultas: boa.bo" },
    ],
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
 * - `pass.type = "boardingPass"` y `pass.transitType = "PKTransitTypeAir"`
 *   son setters reales (no van en el constructor).
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
  });

  pass.addBuffer("icon.png", assets.iconPng);
  pass.addBuffer("icon@2x.png", assets.icon2xPng);
  pass.addBuffer("logo.png", assets.logoPng);
  pass.addBuffer("logo@2x.png", assets.logo2xPng);

  return pass.getAsBuffer();
}
