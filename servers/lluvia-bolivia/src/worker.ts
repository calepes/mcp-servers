import { handleMcp, type McpEnv } from "worker-mcp-utils";
import { getLluviaDia, getLluviaResumen, getLluviaSerie, getPronosticoLluvia } from "./client.js";
import { TOOLS } from "./tools.js";

interface Env extends McpEnv {
  // Service binding al Worker lluvia-bolivia — Cloudflare bloquea el fetch público
  // Worker→*.workers.dev (anti-SSRF), así que las llamadas a esa API van por acá.
  LLUVIA_BOLIVIA?: Fetcher;
}

async function dispatchTool(name: string, args: unknown, env: Env): Promise<unknown> {
  const a = (args ?? {}) as Record<string, unknown>;
  const fetcher = env.LLUVIA_BOLIVIA ? env.LLUVIA_BOLIVIA.fetch.bind(env.LLUVIA_BOLIVIA) : undefined;
  if (name === "getLluviaDia") {
    return getLluviaDia(a.ciudad as string, a.fecha as string | undefined, fetcher);
  }
  if (name === "getLluviaSerie") {
    return getLluviaSerie(a.ciudad as string, a.desde as string, a.hasta as string, fetcher);
  }
  if (name === "getLluviaResumen") {
    return getLluviaResumen(a.desde as string, a.hasta as string, a.ciudad as string | undefined, fetcher);
  }
  if (name === "getPronosticoLluvia") {
    return getPronosticoLluvia(a.ciudad as string, a.dias as number | undefined, fetcher);
  }
  throw new Error(`Unknown tool: ${name}`);
}

export default {
  fetch(req: Request, env: Env): Promise<Response> {
    return handleMcp(req, env, TOOLS, "lluvia-bolivia", (name, args, dispatchEnv) =>
      dispatchTool(name, args, dispatchEnv as Env));
  },
} satisfies ExportedHandler<Env>;
