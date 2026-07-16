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
    secondaryFields: [{ key: "departure", label: "SALIDA", value: data.departureTime }],
    auxiliaryFields: [
      { key: "group", label: "GRUPO", value: data.boardingGroup },
      { key: "gate", label: "PUERTA", value: data.gate ?? "—" },
      { key: "seat", label: "ASIENTO", value: data.seat },
    ],
    backFields: [
      { key: "locator", label: "CÓDIGO DE RESERVA", value: data.locator },
      { key: "sequence", label: "SECUENCIA DE ABORDAJE", value: data.boardingSequence ?? "—" },
      { key: "originFull", label: "ORIGEN", value: `${data.originName} (${data.originCode})` },
      { key: "destinationFull", label: "DESTINO", value: `${data.destinationName} (${data.destinationCode})` },
      { key: "contact", label: "CONTACTO", value: "Boliviana de Aviación · consultas: boa.bo" },
    ],
  };
}
