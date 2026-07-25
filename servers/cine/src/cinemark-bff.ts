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

const BFF = "https://bff.cinemark.com.bo/api/cinema";
const THEATER = "2800"; // Único Cinemark de Bolivia (Ventura Mall, Santa Cruz).

// Verificado 2026-07-24: el BFF responde 200 SIN headers. Se mandan igual por si el
// WAF se activa por IP/rate — pero no asumas que un fallo es siempre 403.
const HEADERS = {
  country: "BO",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Referer: "https://www.cinemark.com.bo/",
};

export interface PeliculaBff {
  titulo: string;
  corporateId: string;
  funciones: FuncionCine[];
}

function norm(s: string): string {
  // \u0300-\u036f = marcas diacríticas combinantes. Escrito con escapes y NO con los
  // caracteres literales, que son invisibles en el editor y se corrompen al copiar.
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

async function getJson(path: string): Promise<unknown> {
  const res = await fetch(`${BFF}${path}`, { headers: HEADERS, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`BFF Cinemark respondió ${res.status} en ${path}`);
  return res.json();
}

/**
 * Cartelera de Cinemark para una fecha. Lanza ante cualquier fallo — el caller
 * (cartelera.ts) decide si cae al scraping.
 *
 * OJO: el BFF omite las funciones que YA EMPEZARON. Pedir "hoy" a las 22:00 devuelve
 * pocas o ninguna función y eso es CORRECTO — no es un fallo que amerite fallback.
 */
export async function fetchCartelera(fecha: string, pelicula?: string): Promise<PeliculaBff[]> {
  const movies = (await getJson(`/movies?theater=${THEATER}`)) as {
    data?: { corporateId?: string; title?: string }[];
  };
  const candidatas = (movies.data ?? []).filter(
    (m) => m.corporateId && m.title && (!pelicula || norm(m.title).includes(norm(pelicula))),
  );

  const resultados = await Promise.all(
    candidatas.map(async (m) => {
      const st = await getJson(`/showtimes?movieCorporateId=${m.corporateId}&theater=${THEATER}`);
      return { titulo: m.title!, corporateId: m.corporateId!, funciones: parseShowtimes(st, fecha) };
    }),
  );

  return resultados.filter((p) => p.funciones.length > 0);
}
