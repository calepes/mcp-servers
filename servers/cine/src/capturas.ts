// Persistencia de screenshots de la compra de cine.
//
// El MCP NO habla con Telegram (sirve a dos bots con tokens distintos), así que
// no puede mandar las imágenes él mismo: las escribe a disco con un nombre
// predecible y devuelve el path; el daemon las sube. Mismo patrón que
// `boa-checkin` (generateBoaWalletPass → enviarFotoLocal/enviarDocumentoLocal).

import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type TipoCaptura = "mapa" | "resumen" | "qr" | "entradas";

/**
 * Escribe un screenshot a tmpdir() con nombre predecible `cine-{tipo}-{id}.png`.
 * El daemon solo acepta subir archivos que matcheen ese patrón (allowlist en
 * telegram-files.ts), así que el prefijo NO es cosmético.
 */
export function guardarCaptura(tipo: TipoCaptura, purchaseId: string, png: Buffer): string {
  const safeId = purchaseId.replace(/[^a-zA-Z0-9_-]/g, "");
  const path = join(tmpdir(), `cine-${tipo}-${safeId}.png`);
  writeFileSync(path, png);
  return path;
}
