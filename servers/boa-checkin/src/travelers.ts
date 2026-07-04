import { readFileSync, writeFileSync } from "node:fs";

export interface BoaPasaporte {
  numero: string;
  paisEmisor: string; // ISO-2
  vencimiento: string; // DD/MM/YYYY
}

export interface BoaTraveler {
  alias?: string[];
  nombres: string;
  apellido1: string;
  apellido2: string;
  sexo: "M" | "F";
  fechaNacimiento: string; // DD/MM/YYYY
  nacionalidad: "B" | "E";
  paisNacionalidad: string; // ISO-2
  docTipo: string;
  docEspecifique: string;
  docNumero: string;
  ocupacion: string;
  lugarNacimiento?: string;
  pasaporte?: BoaPasaporte;
}

export interface TravelersFile {
  viajeros: Record<string, BoaTraveler>;
}

function readTravelersFile(path: string): TravelersFile {
  return JSON.parse(readFileSync(path, "utf8")) as TravelersFile;
}

/** Resuelve un viajero por key exacta o por alias, igual que qr-aduana.ts. */
export function resolveBoaTraveler(path: string, name: string): BoaTraveler | null {
  let data: TravelersFile;
  try {
    data = readTravelersFile(path);
  } catch {
    return null;
  }
  const viajeros = data.viajeros || {};
  const key = name.trim().toLowerCase();
  if (viajeros[key]) return viajeros[key];
  for (const t of Object.values(viajeros)) {
    if ((t.alias || []).some((a) => a.toLowerCase() === key)) return t;
  }
  return null;
}

export function listBoaTravelerKeys(path: string): string[] {
  try {
    return Object.keys(readTravelersFile(path).viajeros || {});
  } catch {
    return [];
  }
}

/** Guarda lugarNacimiento y/o pasaporte para un viajero, sin pisar el resto de sus datos. */
export function saveBoaTravelerExtras(
  path: string,
  key: string,
  extras: { lugarNacimiento?: string; pasaporte?: BoaPasaporte },
): void {
  const data = readTravelersFile(path);
  const normKey = key.trim().toLowerCase();
  const traveler = data.viajeros[normKey];
  if (!traveler) {
    throw new Error(`Viajero "${key}" no existe en ${path} — agregarlo primero manualmente.`);
  }
  if (extras.lugarNacimiento) traveler.lugarNacimiento = extras.lugarNacimiento;
  if (extras.pasaporte) traveler.pasaporte = extras.pasaporte;
  writeFileSync(path, JSON.stringify(data, null, 2));
}
