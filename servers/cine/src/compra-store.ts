import type { Browser, Page } from "playwright";

export type EstadoCompra = "asientos" | "resumen" | "pago" | "completado" | "cancelado";

export interface Funcion {
  pelicula: string;
  hora: string;
  formato: string;
}

export interface PurchaseSession {
  purchaseId: string;
  browser: Browser;
  page: Page;
  estado: EstadoCompra;
  funcion: Funcion;
  cantidad: number;
  asientos?: string[];
  total?: number;
  seatDeadline: number;   // epoch ms
  createdAt: number;
}

// Key: purchaseId — UNA compra activa por instancia del MCP (o sea, por bot).
const sessions = new Map<string, PurchaseSession>();

// El MCP no conoce el chat de Telegram, así que el id lo genera él y el LLM lo
// arrastra entre turnos.
let seq = 0;
export function nuevoPurchaseId(): string {
  seq += 1;
  return `cine-${Date.now()}-${seq}`;
}

export function getSession(purchaseId: string): PurchaseSession | undefined {
  return sessions.get(purchaseId);
}

// Recupera el hilo de compra sin conocer el id (si el LLM lo perdió por
// compactación o /reset). Solo hay una compra activa por proceso MCP.
export function getActiveSession(): PurchaseSession | undefined {
  return [...sessions.values()].find((s) => s.estado !== "completado" && s.estado !== "cancelado");
}

export function createSession(s: PurchaseSession): void {
  if (getActiveSession()) {
    throw new Error("Ya hay una compra activa. Cancélala antes de iniciar otra.");
  }
  sessions.set(s.purchaseId, s);
}

export function updateSession(purchaseId: string, patch: Partial<PurchaseSession>): void {
  const s = sessions.get(purchaseId);
  if (!s) return;
  sessions.set(purchaseId, { ...s, ...patch });
}

export async function endSession(purchaseId: string, estado: EstadoCompra): Promise<void> {
  const s = sessions.get(purchaseId);
  if (!s) return;
  try {
    await s.browser.close();
  } catch {
    // browser ya cerrado / crasheado — ignorar
  }
  sessions.delete(purchaseId);
}

// Claim atómico para evitar doble-entrega (race entre dos confirmaciones del
// mismo pago): devuelve true SOLO al primer llamador que encuentre la sesión aún
// en estado "pago" y la marca "completado" en el mismo tick síncrono. El segundo
// ve != "pago" → false.
// (JS es single-threaded: entre el get y el set no corre otro callback.)
export function claimCompletion(purchaseId: string): boolean {
  const s = sessions.get(purchaseId);
  if (!s || s.estado !== "pago") return false;
  sessions.set(purchaseId, { ...s, estado: "completado" });
  return true;
}

// Reaper: cierra las sesiones cuya retención de asiento ya venció (con `graceMs`
// de margen), en CUALQUIER estado. Cubre el caso "usuario inició compra y se
// distrajo": sin esto el Chrome headless quedaría vivo indefinidamente — es la
// única red de seguridad, no hay ningún otro mecanismo que lo cierre. Debe
// llamarse periódicamente desde el proceso que hospeda el store.
export async function reapStaleSessions(graceMs = 60_000): Promise<number> {
  const now = Date.now();
  const vencidas = [...sessions.values()].filter(
    (s) => s.estado !== "completado" && now > s.seatDeadline + graceMs,
  );
  for (const s of vencidas) {
    await endSession(s.purchaseId, "cancelado");
  }
  return vencidas.length;
}

// Solo para tests.
export function _resetAll(): void {
  sessions.clear();
}

// Solo para tests: cuántas sesiones vivas hay.
export function _count(): number {
  return sessions.size;
}
