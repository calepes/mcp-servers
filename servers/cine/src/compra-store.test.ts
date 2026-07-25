import { describe, it, expect, beforeEach } from "vitest";
import {
  createSession,
  getSession,
  getActiveSession,
  updateSession,
  endSession,
  claimCompletion,
  reapStaleSessions,
  nuevoPurchaseId,
  _resetAll,
  _count,
  type PurchaseSession,
} from "./compra-store.js";

// El browser real no hace falta para testear el store: solo se le pide close().
function fakeSession(over: Partial<PurchaseSession> = {}): PurchaseSession {
  return {
    purchaseId: over.purchaseId ?? nuevoPurchaseId(),
    browser: { close: async () => {} } as never,
    page: {} as never,
    estado: "asientos",
    funcion: { pelicula: "TOY STORY 5", hora: "20:30", formato: "2D" },
    cantidad: 2,
    seatDeadline: Date.now() + 8 * 60_000,
    createdAt: Date.now(),
    ...over,
  };
}

beforeEach(() => _resetAll());

describe("compra-store", () => {
  it("genera purchaseIds únicos", () => {
    expect(nuevoPurchaseId()).not.toBe(nuevoPurchaseId());
    expect(nuevoPurchaseId()).toMatch(/^cine-/);
  });

  it("guarda y recupera por purchaseId", () => {
    const s = fakeSession();
    createSession(s);
    expect(getSession(s.purchaseId)?.funcion.pelicula).toBe("TOY STORY 5");
  });

  it("rechaza una segunda compra activa", () => {
    createSession(fakeSession());
    expect(() => createSession(fakeSession())).toThrow(/ya hay una compra activa/i);
  });

  it("getActiveSession recupera el hilo sin conocer el id", () => {
    const s = fakeSession();
    createSession(s);
    expect(getActiveSession()?.purchaseId).toBe(s.purchaseId);
  });

  it("getActiveSession devuelve undefined si no hay nada", () => {
    expect(getActiveSession()).toBeUndefined();
  });

  it("permite una compra nueva después de cerrar la anterior", async () => {
    const s = fakeSession();
    createSession(s);
    await endSession(s.purchaseId, "cancelado");
    expect(_count()).toBe(0);
    expect(() => createSession(fakeSession())).not.toThrow();
  });

  it("updateSession aplica el patch", () => {
    const s = fakeSession();
    createSession(s);
    updateSession(s.purchaseId, { estado: "pago", total: 120 });
    expect(getSession(s.purchaseId)).toMatchObject({ estado: "pago", total: 120 });
  });

  it("claimCompletion solo deja pasar al primero", () => {
    const s = fakeSession({ estado: "pago" });
    createSession(s);
    expect(claimCompletion(s.purchaseId)).toBe(true);
    expect(claimCompletion(s.purchaseId)).toBe(false);
  });

  it("claimCompletion no aplica fuera del estado 'pago'", () => {
    const s = fakeSession({ estado: "asientos" });
    createSession(s);
    expect(claimCompletion(s.purchaseId)).toBe(false);
  });

  it("el reaper cierra las sesiones vencidas", async () => {
    createSession(fakeSession({ seatDeadline: Date.now() - 120_000 }));
    expect(await reapStaleSessions()).toBe(1);
    expect(_count()).toBe(0);
  });

  it("el reaper respeta las sesiones vigentes", async () => {
    createSession(fakeSession({ seatDeadline: Date.now() + 300_000 }));
    expect(await reapStaleSessions()).toBe(0);
    expect(_count()).toBe(1);
  });

  it("el reaper no toca una compra completada", async () => {
    createSession(fakeSession({ estado: "completado", seatDeadline: Date.now() - 120_000 }));
    expect(await reapStaleSessions()).toBe(0);
  });
});
