export interface FuncionCine {
  hora: string;
  formato: string;
  idioma: string;
  sala?: string;
  asientosDisponibles?: number;
}

interface BffSession {
  movieName?: string;
  sessionDateTime?: string;
  sessionDisplayDate?: string;
  sessionFormat?: string;
  theaterRoom?: string;
  language?: { name?: string };
  occupation?: { availableSeats?: number };
}

/**
 * Filtra las funciones del BFF por fecha (YYYY-MM-DD).
 *
 * `sessionDateTime` viene como hora LOCAL etiquetada con Z (ej. "2026-07-25T10:20:00.000Z"
 * es la función de las 10:20 de Santa Cruz, no de las 06:20). Por eso la hora se saca con
 * slice de string y NUNCA con `new Date()`, que la correría 4 horas.
 */
export function parseShowtimes(payload: unknown, fecha: string): FuncionCine[] {
  const data = (payload as { data?: BffSession[] })?.data;
  if (!Array.isArray(data)) return [];

  return data
    .filter((s) => s.sessionDisplayDate === fecha && typeof s.sessionDateTime === "string")
    .map((s) => ({
      hora: s.sessionDateTime!.slice(11, 16),
      formato: s.sessionFormat ?? "",
      idioma: s.language?.name ?? "",
      sala: s.theaterRoom,
      asientosDisponibles: s.occupation?.availableSeats,
    }))
    .sort((a, b) => a.hora.localeCompare(b.hora));
}
