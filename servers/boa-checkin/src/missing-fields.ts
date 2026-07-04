import type { BoaTraveler } from "./travelers.js";

/**
 * Campos que BoA pide en "Required information" y que no vienen ya resueltos
 * por datos-viaje.json (nacionalidad/país/fecha de nacimiento/sexo siempre están).
 */
export function missingBoaFields(traveler: BoaTraveler): string[] {
  const missing: string[] = [];
  if (!traveler.lugarNacimiento || !traveler.lugarNacimiento.trim()) {
    missing.push("lugarNacimiento");
  }
  const p = traveler.pasaporte;
  if (!p) {
    missing.push("pasaporte.numero", "pasaporte.paisEmisor", "pasaporte.vencimiento");
    return missing;
  }
  if (!p.numero?.trim()) missing.push("pasaporte.numero");
  if (!p.paisEmisor?.trim()) missing.push("pasaporte.paisEmisor");
  if (!p.vencimiento?.trim()) missing.push("pasaporte.vencimiento");
  return missing;
}
