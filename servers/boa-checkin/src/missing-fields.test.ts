import { describe, it, expect } from "vitest";
import { missingBoaFields } from "./missing-fields.js";
import type { BoaTraveler } from "./travelers.js";

const complete: BoaTraveler = {
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
  lugarNacimiento: "Palmira, Colombia",
  pasaporte: { numero: "AU443240", paisEmisor: "CO", vencimiento: "12/01/2028" },
};

describe("missingBoaFields", () => {
  it("returns empty array when everything BoA needs is present", () => {
    expect(missingBoaFields(complete)).toEqual([]);
  });

  it("flags lugarNacimiento when absent", () => {
    const { lugarNacimiento, ...rest } = complete;
    expect(missingBoaFields(rest as typeof complete)).toContain("lugarNacimiento");
  });

  it("flags each missing pasaporte sub-field individually", () => {
    const t = { ...complete, pasaporte: { numero: "", paisEmisor: "CO", vencimiento: "" } };
    const missing = missingBoaFields(t);
    expect(missing).toContain("pasaporte.numero");
    expect(missing).toContain("pasaporte.vencimiento");
    expect(missing).not.toContain("pasaporte.paisEmisor");
  });

  it("flags the whole pasaporte block when absent", () => {
    const { pasaporte, ...rest } = complete;
    const missing = missingBoaFields(rest as typeof complete);
    expect(missing).toEqual(
      expect.arrayContaining(["pasaporte.numero", "pasaporte.paisEmisor", "pasaporte.vencimiento"]),
    );
  });
});
