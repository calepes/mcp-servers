/**
 * Lógica PURA de selección de tramo sobre la pantalla "Your journeys" —
 * separada de flow.ts para poder testearla sin browser (vitest).
 *
 * Bug real 2026-07-20 (reserva HVKNUC, producción vía Jano): cada tarjeta de
 * tramo tiene TRES estados posibles, no dos — `selectJourney` solo distinguía
 * "hay botón Check in" / "no lo hay", y cuando no lo había reportaba "el
 * check-in todavía no está abierto"... que es FALSO si el tramo en realidad ya
 * está checkeado (botón "Manage check-in" + etiqueta "Checked in"). Eso pasó
 * exactamente: un `prepareBoaCheckin` abandonado ya había ejecutado el
 * check-in del lado de Amadeus (ver gotcha en index.ts), y todos los intentos
 * siguientes fallaron durante horas con un mensaje que decía lo contrario del
 * estado real. El incidente del 2026-07-12 ("reserva bloqueada por horas")
 * fue casi seguro este mismo bug, no un lock de Amadeus.
 */

export type JourneyEstado = "abierto" | "checkeado" | "noAbierto";

export interface JourneyInfo {
  titulo: string;
  estado: JourneyEstado;
}

const ESTADO_LABEL: Record<JourneyEstado, string> = {
  abierto: "check-in ABIERTO",
  checkeado: "check-in YA HECHO",
  noAbierto: "check-in todavía no abierto",
};

/** Título de tarjeta legible en una línea (BoA mete la fecha en un \n aparte). */
function flatTitulo(titulo: string): string {
  return titulo.replace(/\s*\n\s*/g, " — ");
}

/** "Santa Cruz to La Paz — Tue, 21 July: check-in YA HECHO | ..." */
export function describeJourneys(journeys: JourneyInfo[]): string {
  return journeys.map((j) => `${flatTitulo(j.titulo)}: ${ESTADO_LABEL[j.estado]}`).join(" | ");
}

export interface JourneyPick {
  index: number;
  estado: JourneyEstado;
}

/**
 * Elige el tramo a usar. `aceptados` define qué estados sirven para la acción
 * del caller (check-in nuevo acepta abierto Y checkeado — el caller decide qué
 * hacer con cada uno; "Manage your booking" solo acepta checkeado).
 *
 * Con `tramo`: matchea contra TODOS los tramos (exacto case-insensitive
 * primero, substring después) y valida el estado del elegido — así un tramo ya
 * checkeado produce un error/resultado que dice la VERDAD ("ya está hecho") en
 * vez de "no está abierto". Sin `tramo`: prefiere el único abierto; si no hay
 * abiertos y hay un único checkeado (y está aceptado), usa ese.
 */
export function pickJourney(
  journeys: JourneyInfo[],
  tramo: string | undefined,
  aceptados: JourneyEstado[],
): JourneyPick {
  if (tramo) {
    const t = tramo.toLowerCase();
    let matches = journeys
      .map((j, index) => ({ j, index }))
      .filter(({ j }) => j.titulo.toLowerCase() === t);
    if (matches.length === 0) {
      matches = journeys
        .map((j, index) => ({ j, index }))
        .filter(({ j }) => j.titulo.toLowerCase().includes(t));
    }
    if (matches.length === 0) {
      throw new Error(
        `\`tramo\` ("${tramo}") no matchea ningún tramo de esta reserva. Tramos: ${describeJourneys(journeys)}`,
      );
    }
    if (matches.length > 1) {
      throw new Error(
        `\`tramo\` ("${tramo}") es ambiguo — matchea ${matches.length} tramos. Usá el título COMPLETO tal como aparece acá: ${matches
          .map(({ j }) => flatTitulo(j.titulo))
          .join(" | ")}`,
      );
    }
    const { j, index } = matches[0];
    if (!aceptados.includes(j.estado)) {
      throw new Error(
        j.estado === "checkeado"
          ? `El tramo "${flatTitulo(j.titulo)}" YA tiene el check-in hecho — no corresponde esta acción. Estado de los tramos: ${describeJourneys(journeys)}`
          : `El check-in del tramo "${flatTitulo(j.titulo)}" todavía no está abierto. Estado de los tramos: ${describeJourneys(journeys)}`,
      );
    }
    return { index, estado: j.estado };
  }

  // Sin tramo: preferir el único abierto (si "abierto" está aceptado).
  const porEstado = (estado: JourneyEstado) =>
    journeys.map((j, index) => ({ j, index })).filter(({ j }) => j.estado === estado);

  if (aceptados.includes("abierto")) {
    const abiertos = porEstado("abierto");
    if (abiertos.length === 1) return { index: abiertos[0].index, estado: "abierto" };
    if (abiertos.length > 1) {
      throw new Error(
        `La reserva tiene ${abiertos.length} tramos con check-in abierto — especificá cuál con el parámetro \`tramo\` usando el título COMPLETO. Abiertos: ${abiertos
          .map(({ j }) => flatTitulo(j.titulo))
          .join(" | ")}`,
      );
    }
  }
  if (aceptados.includes("checkeado")) {
    const checkeados = porEstado("checkeado");
    if (checkeados.length === 1) return { index: checkeados[0].index, estado: "checkeado" };
    if (checkeados.length > 1) {
      throw new Error(
        `La reserva tiene ${checkeados.length} tramos con check-in hecho — especificá cuál con \`tramo\`. Ya checkeados: ${checkeados
          .map(({ j }) => flatTitulo(j.titulo))
          .join(" | ")}`,
      );
    }
  }
  throw new Error(
    aceptados.includes("abierto")
      ? `Ningún tramo de esta reserva tiene el check-in abierto ahora. Estado de los tramos: ${describeJourneys(journeys)}`
      : `Ningún tramo de esta reserva tiene el check-in hecho todavía. Estado de los tramos: ${describeJourneys(journeys)}`,
  );
}
