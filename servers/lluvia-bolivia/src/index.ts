#!/usr/bin/env node
// MCP server: lluvia-bolivia
// Envuelve la API de lluvia-bolivia.carlos-cb4.workers.dev (dato MEDIDO, SYNOP/Ogimet,
// 11 ciudades) + Open-Meteo Forecast API (pronóstico, NO medido).
// Este es el entry point que consume el daemon de Jano (registrado como stdio local en
// daemon-v2/src/index.ts) — worker.ts es el entry point que usan .mcp.json/sesiones
// interactivas vía mcp-remote, mismo patrón "dos entry points" que exchange-rate-bolivia.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { getLluviaDia, getLluviaResumen, getLluviaSerie, getPronosticoLluvia } from "./client.js";
import { TOOLS } from "./tools.js";

const server = new Server({ name: "lluvia-bolivia", version: "0.1.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;
  const args = (request.params.arguments ?? {}) as Record<string, unknown>;
  try {
    let result: unknown;
    if (name === "getLluviaDia") {
      result = await getLluviaDia(args.ciudad as string, args.fecha as string | undefined);
    } else if (name === "getLluviaSerie") {
      result = await getLluviaSerie(args.ciudad as string, args.desde as string, args.hasta as string);
    } else if (name === "getLluviaResumen") {
      result = await getLluviaResumen(args.desde as string, args.hasta as string, args.ciudad as string | undefined);
    } else if (name === "getPronosticoLluvia") {
      result = await getPronosticoLluvia(args.ciudad as string, args.dias as number | undefined);
    } else {
      return { isError: true, content: [{ type: "text", text: `Unknown tool: ${name}` }] };
    }
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  } catch (err) {
    return { isError: true, content: [{ type: "text", text: `Error en ${name}: ${(err as Error).message}` }] };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
