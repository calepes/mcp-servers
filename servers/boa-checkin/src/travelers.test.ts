import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  resolveBoaTraveler,
  saveBoaTravelerExtras,
  type TravelersFile,
} from "./travelers.js";

const sample: TravelersFile = {
  viajeros: {
    cal: {
      alias: ["cal", "carlos"],
      nombres: "CARLOS ANDRES",
      apellido1: "LEPESQUEUR",
      apellido2: "DE LEON",
      sexo: "M",
      fechaNacimiento: "20/02/1980",
      nacionalidad: "E",
      paisNacionalidad: "CO",
      docTipo: "o",
      docEspecifique: "CI",
      docNumero: "17513894",
      ocupacion: "INGENIERO",
    },
  },
};

describe("resolveBoaTraveler / saveBoaTravelerExtras", () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "boa-checkin-test-"));
    file = join(dir, "datos-viaje.json");
    writeFileSync(file, JSON.stringify(sample));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("resolves a traveler by alias", () => {
    const t = resolveBoaTraveler(file, "carlos");
    expect(t?.apellido1).toBe("LEPESQUEUR");
  });

  it("returns null for unknown traveler", () => {
    expect(resolveBoaTraveler(file, "nadie")).toBeNull();
  });

  it("returns no pasaporte before it's saved", () => {
    const t = resolveBoaTraveler(file, "cal");
    expect(t?.pasaporte).toBeUndefined();
  });

  it("saves pasaporte + lugarNacimiento and merges into the existing traveler", () => {
    saveBoaTravelerExtras(file, "cal", {
      lugarNacimiento: "Palmira, Colombia",
      pasaporte: {
        numero: "AU443240",
        paisEmisor: "CO",
        vencimiento: "12/01/2028",
      },
    });
    const t = resolveBoaTraveler(file, "cal");
    expect(t?.lugarNacimiento).toBe("Palmira, Colombia");
    expect(t?.pasaporte?.numero).toBe("AU443240");
    // datos pre-existentes no se pisan
    expect(t?.apellido1).toBe("LEPESQUEUR");
  });
});
