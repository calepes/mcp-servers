import { handleMcp, type McpEnv } from "worker-mcp-utils";
import { getLluviaDia, getLluviaResumen, getLluviaSerie, getPronosticoLluvia } from "./client.js";
import { TOOLS } from "./tools.js";

interface Env extends McpEnv {}

async function dispatchTool(name: string, args: unknown): Promise<unknown> {
  const a = (args ?? {}) as Record<string, unknown>;
  if (name === "getLluviaDia") {
    return getLluviaDia(a.ciudad as string, a.fecha as string | undefined);
  }
  if (name === "getLluviaSerie") {
    return getLluviaSerie(a.ciudad as string, a.desde as string, a.hasta as string);
  }
  if (name === "getLluviaResumen") {
    return getLluviaResumen(a.desde as string, a.hasta as string, a.ciudad as string | undefined);
  }
  if (name === "getPronosticoLluvia") {
    return getPronosticoLluvia(a.ciudad as string, a.dias as number | undefined);
  }
  throw new Error(`Unknown tool: ${name}`);
}

export default {
  fetch(req: Request, env: Env): Promise<Response> {
    return handleMcp(req, env, TOOLS, "lluvia-bolivia", (name, args) => dispatchTool(name, args));
  },
} satisfies ExportedHandler<Env>;
