// Wrapper del Predictor Mundial 2026 (proyecto Python externo).
// Spawnea los scripts con su venv y devuelve JSON. Sin shell (args array) → paths
// con espacios y args del LLM no inyectan.

import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { homedir } from "node:os";

const PRED_DIR =
  process.env.PREDICTOR_DIR ?? `${homedir()}/Claude Projects/Personal/Apps/Predictor Mundial`;
const PY = `${PRED_DIR}/.venv/bin/python`;

function run(args: string[], timeoutMs: number): Record<string, unknown> {
  const r = spawnSync(PY, args, {
    cwd: PRED_DIR, encoding: "utf8", timeout: timeoutMs, maxBuffer: 5_000_000,
  });
  if (r.error) return { error: "No se pudo ejecutar el predictor", detail: String(r.error) };
  if (r.status !== 0) {
    try { return JSON.parse(r.stdout); } // predict.py emite {error} en stdout para nombre inválido
    catch { return { error: "El predictor falló", detail: (r.stderr || r.stdout || "").trim().slice(0, 400) }; }
  }
  try { return JSON.parse(r.stdout); }
  catch { return { error: "Salida no parseable", detail: r.stdout.slice(0, 400) }; }
}

/** Predicción de un partido. Nombres en inglés canónico ("Spain","DR Congo"). */
export function predictMatch(teamA: string, teamB: string): Record<string, unknown> {
  return run([`${PRED_DIR}/src/predict.py`, "--json", teamA, teamB], 30_000);
}

/** Pronóstico del torneo (Monte Carlo). Refleja results_live.json si existe. */
export function forecastTournament(sims?: number): Record<string, unknown> {
  const n = sims ? Math.min(50_000, Math.max(1000, Math.floor(sims))) : 10_000;
  return run([`${PRED_DIR}/src/simulate.py`, "--json", String(n)], 60_000);
}

/** Escribe los partidos jugados a results_live.json para que el sim condicione. */
export function writeResultsLive(played: Array<Record<string, unknown>>): number {
  const out = {
    _meta: "Partidos jugados (auto desde API-Football via MCP worldcup). simulate.py condiciona.",
    played,
  };
  writeFileSync(`${PRED_DIR}/data/results_live.json`, JSON.stringify(out, null, 2), "utf8");
  return played.length;
}
