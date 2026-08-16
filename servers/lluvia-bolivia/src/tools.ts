// tools.ts — definición de los 4 tools, compartida entre worker.ts (CF Worker) e
// index.ts (stdio). Estructuralmente compatible con McpTool de worker-mcp-utils y con
// el formato que espera @modelcontextprotocol/sdk (mismos 3 campos: name/description/inputSchema).

import { CIUDADES } from "./client.js";

export interface McpToolSchema {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

const CIUDADES_LIST = Object.keys(CIUDADES).join(", ");
const READ_ONLY = { readOnlyHint: true };

export const TOOLS: McpToolSchema[] = [
  {
    name: "getLluviaDia",
    description:
      `Lluvia MEDIDA (SYNOP/Ogimet, no estimación) de un día en una ciudad de Bolivia, con categoría ` +
      `(Poca/Normal/Considerable/Fuerte/Excepcional) relativa al histórico de esa ciudad y su percentil. ` +
      `Ciudades: ${CIUDADES_LIST}. Sin "fecha", usa el día pluviométrico más reciente (08:00-08:00 hora Bolivia).`,
    inputSchema: {
      type: "object",
      properties: {
        ciudad: { type: "string", description: `Nombre exacto de la ciudad. Una de: ${CIUDADES_LIST}` },
        fecha: { type: "string", description: "YYYY-MM-DD, opcional" },
      },
      required: ["ciudad"],
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
  {
    name: "getLluviaSerie",
    description: "Serie diaria de lluvia MEDIDA (mm) de una ciudad de Bolivia en un rango de fechas.",
    inputSchema: {
      type: "object",
      properties: {
        ciudad: { type: "string", description: `Una de: ${CIUDADES_LIST}` },
        desde: { type: "string", description: "YYYY-MM-DD" },
        hasta: { type: "string", description: "YYYY-MM-DD" },
      },
      required: ["ciudad", "desde", "hasta"],
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
  {
    name: "getLluviaResumen",
    description: "Totales mensuales de lluvia MEDIDA por ciudad de Bolivia en un rango de fechas.",
    inputSchema: {
      type: "object",
      properties: {
        desde: { type: "string", description: "YYYY-MM-DD" },
        hasta: { type: "string", description: "YYYY-MM-DD" },
        ciudad: { type: "string", description: `Opcional (una de: ${CIUDADES_LIST}). Sin esto, trae todas las ciudades.` },
      },
      required: ["desde", "hasta"],
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
  {
    name: "getPronosticoLluvia",
    description:
      `PRONÓSTICO de lluvia (estimación de modelo Open-Meteo, NO dato medido) para los próximos días, hasta 16. ` +
      `Ciudades: ${CIUDADES_LIST}. Presentar SIEMPRE como pronóstico/estimación, nunca como dato real — a diferencia ` +
      `de getLluviaDia/getLluviaSerie/getLluviaResumen, que sí son lo realmente llovido.`,
    inputSchema: {
      type: "object",
      properties: {
        ciudad: { type: "string", description: `Una de: ${CIUDADES_LIST}` },
        dias: { type: "number", description: "1-16, default 7" },
      },
      required: ["ciudad"],
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
];
