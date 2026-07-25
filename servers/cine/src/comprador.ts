import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Comprador {
  nombre: string;
  apellido: string;
  documento: string; // CI 17513894 — autorizado por Cal para la factura de cine (2026-07-24)
  correo: string;
  celular: string;
}

// Parser puro: combina datos-viaje (nombre/apellido) + datos-compra-cine (documento/correo/celular).
export function parseComprador(viajeros: any, compra: any, key: string): Comprador {
  const v = viajeros?.viajeros?.[key];
  if (!v) throw new Error(`No se encontró el viajero '${key}' en datos-viaje.json`);
  const c = compra?.[key];
  if (!c) throw new Error(`No se encontró '${key}' en datos-compra-cine.json`);
  const nombre = v.nombres;
  const apellido = [v.apellido1, v.apellido2].filter(Boolean).join(" ");
  const campos = { nombre, apellido, documento: c.documento, correo: c.correo, celular: c.celular };
  for (const [k, val] of Object.entries(campos)) {
    if (!val) throw new Error(`Falta el campo '${k}' del comprador '${key}'`);
  }
  return campos as Comprador;
}

export function loadComprador(key = "cal"): Comprador {
  const viajeros = JSON.parse(readFileSync(join(homedir(), ".claude", "datos-viaje.json"), "utf8"));
  const compra = JSON.parse(readFileSync(join(homedir(), ".claude", "datos-compra-cine.json"), "utf8"));
  return parseComprador(viajeros, compra, key);
}
