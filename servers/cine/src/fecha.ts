const TZ = "America/La_Paz";

/** Fecha de hoy en Bolivia como YYYY-MM-DD, sin depender del TZ del proceso. */
export function hoyLaPaz(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function sumarDias(iso: string, dias: number): string {
  // Mediodía UTC evita que el shift de zona cruce de día.
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/**
 * Acepta 'hoy', 'mañana'/'manana', o una fecha YYYY-MM-DD. Sin argumento → hoy.
 * Cualquier otra cosa lanza: el LLM debe pasar una fecha concreta, no prosa.
 */
export function resolverFecha(fecha?: string): string {
  if (!fecha) return hoyLaPaz();
  const f = fecha.trim().toLowerCase();
  if (f === "hoy") return hoyLaPaz();
  if (f === "mañana" || f === "manana") return sumarDias(hoyLaPaz(), 1);
  if (/^\d{4}-\d{2}-\d{2}$/.test(f)) return f;
  throw new Error(`No entendí la fecha '${fecha}'. Usá 'hoy', 'mañana' o YYYY-MM-DD.`);
}
