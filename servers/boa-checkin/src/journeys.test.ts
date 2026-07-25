import { describe, it, expect } from "vitest";
import { pickJourney, describeJourneys, type JourneyInfo } from "./journeys.js";

// Títulos como los devuelve BoA de verdad: "ruta\nfecha" (caso real HVKNUC).
const IDA: JourneyInfo = { titulo: "Santa Cruz to La Paz\nTue, 21 July", estado: "checkeado" };
const VUELTA: JourneyInfo = { titulo: "La Paz to Santa Cruz\nThu, 23 July", estado: "checkeado" };

describe("describeJourneys", () => {
  it("aplana los títulos y nombra el estado real de cada tramo", () => {
    const s = describeJourneys([{ ...IDA }, { ...VUELTA, estado: "noAbierto" }]);
    expect(s).toBe(
      "Santa Cruz to La Paz — Tue, 21 July: check-in YA HECHO | La Paz to Santa Cruz — Thu, 23 July: check-in todavía no abierto",
    );
  });
});

describe("pickJourney con tramo", () => {
  it("match exacto gana aunque otro tramo contenga el substring", () => {
    const journeys: JourneyInfo[] = [
      { titulo: "Santa Cruz to La Paz", estado: "abierto" },
      { titulo: "La Paz to Santa Cruz", estado: "abierto" },
    ];
    const pick = pickJourney(journeys, "la paz to santa cruz", ["abierto"]);
    expect(pick).toEqual({ index: 1, estado: "abierto" });
  });

  it("substring ambiguo (solo una ciudad) tira error pidiendo el título completo", () => {
    const journeys: JourneyInfo[] = [
      { titulo: "Santa Cruz to La Paz", estado: "abierto" },
      { titulo: "La Paz to Santa Cruz", estado: "abierto" },
    ];
    expect(() => pickJourney(journeys, "Santa Cruz", ["abierto"])).toThrow(/ambiguo/);
  });

  it("tramo checkeado se devuelve como tal si 'checkeado' está aceptado (caso HVKNUC)", () => {
    const pick = pickJourney([IDA, VUELTA], "La Paz to Santa Cruz\nThu, 23 July", [
      "abierto",
      "checkeado",
    ]);
    expect(pick).toEqual({ index: 1, estado: "checkeado" });
  });

  it("tramo checkeado con acción que exige abierto dice 'YA hecho', no 'no está abierto'", () => {
    expect(() => pickJourney([IDA, VUELTA], "Santa Cruz to La Paz\nTue, 21 July", ["abierto"])).toThrow(
      /YA tiene el check-in hecho/,
    );
  });

  it("tramo todavía no abierto lo dice explícitamente con el estado de todos", () => {
    const journeys: JourneyInfo[] = [
      { titulo: "Santa Cruz to La Paz", estado: "noAbierto" },
      { titulo: "La Paz to Santa Cruz", estado: "abierto" },
    ];
    expect(() => pickJourney(journeys, "Santa Cruz to La Paz", ["abierto", "checkeado"])).toThrow(
      /todavía no está abierto.*check-in ABIERTO/s,
    );
  });

  it("tramo inexistente lista los tramos reales con su estado", () => {
    expect(() => pickJourney([IDA, VUELTA], "Cochabamba", ["abierto"])).toThrow(
      /no matchea ningún tramo/,
    );
  });
});

describe("pickJourney sin tramo", () => {
  it("prefiere el único abierto aunque haya otro checkeado", () => {
    const journeys: JourneyInfo[] = [IDA, { titulo: "La Paz to Santa Cruz", estado: "abierto" }];
    expect(pickJourney(journeys, undefined, ["abierto", "checkeado"])).toEqual({
      index: 1,
      estado: "abierto",
    });
  });

  it("sin abiertos y con un único checkeado, devuelve el checkeado (prepare idempotente)", () => {
    const journeys: JourneyInfo[] = [{ titulo: "Santa Cruz to La Paz", estado: "checkeado" }];
    expect(pickJourney(journeys, undefined, ["abierto", "checkeado"])).toEqual({
      index: 0,
      estado: "checkeado",
    });
  });

  it("dos abiertos sin tramo tira error de desambiguación", () => {
    const journeys: JourneyInfo[] = [
      { titulo: "Santa Cruz to La Paz", estado: "abierto" },
      { titulo: "La Paz to Santa Cruz", estado: "abierto" },
    ];
    expect(() => pickJourney(journeys, undefined, ["abierto", "checkeado"])).toThrow(/especificá cuál/);
  });

  it("dos checkeados sin tramo (caso HVKNUC hoy) pide tramo en vez de mentir 'no abierto'", () => {
    expect(() => pickJourney([IDA, VUELTA], undefined, ["abierto", "checkeado"])).toThrow(
      /check-in hecho — especificá cuál/,
    );
  });

  it("nada abierto ni checkeado reporta el estado real de cada tramo", () => {
    const journeys: JourneyInfo[] = [
      { titulo: "Santa Cruz to La Paz", estado: "noAbierto" },
      { titulo: "La Paz to Santa Cruz", estado: "noAbierto" },
    ];
    expect(() => pickJourney(journeys, undefined, ["abierto", "checkeado"])).toThrow(
      /Ningún tramo.*abierto ahora.*todavía no abierto/s,
    );
  });

  it("solo-checkeado (openManageBooking): sin checkeados dice que falta el check-in", () => {
    const journeys: JourneyInfo[] = [{ titulo: "Santa Cruz to La Paz", estado: "abierto" }];
    expect(() => pickJourney(journeys, undefined, ["checkeado"])).toThrow(
      /Ningún tramo.*check-in hecho todavía/s,
    );
  });
});
