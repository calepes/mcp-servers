import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { readFileSync, existsSync } from "node:fs";
import { guardarCaptura } from "./capturas.js";

describe("guardarCaptura", () => {
  it("escribe en tmpdir con el prefijo cine- y devuelve el path", () => {
    const p = guardarCaptura("mapa", "cine-123-1", Buffer.from("PNGFAKE"));
    expect(p.startsWith(tmpdir())).toBe(true);
    expect(p).toMatch(/cine-mapa-cine-123-1\.png$/);
    expect(existsSync(p)).toBe(true);
    expect(readFileSync(p).toString()).toBe("PNGFAKE");
  });

  it("sanea el purchaseId para que no escape del directorio", () => {
    const p = guardarCaptura("qr", "../../etc/passwd", Buffer.from("x"));
    expect(p.startsWith(tmpdir())).toBe(true);
    expect(p).not.toContain("..");
  });
});
