import {
  createServer as createNodeHttpServer,
  type IncomingMessage,
  type Server as NodeHttpServer,
  type ServerResponse,
} from "node:http";
import { pathToFileURL } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createCineServer } from "./mcp-server.js";

export interface CineHttpServerOptions {
  port: number;
  host?: string;
}

export interface CineHttpServerHandle {
  httpServer: NodeHttpServer;
  stop: () => Promise<void>;
}

/**
 * Expone el MCP de cine por HTTP en modo STATELESS (sessionIdGenerator:
 * undefined) — no hace falta sesión a nivel de protocolo MCP porque el
 * estado real de la compra ya vive en compra-store.ts como memoria de
 * módulo: mientras este proceso no se reinicie, esa memoria persiste sin
 * importar cuántos pares Server/Transport de protocolo MCP se creen para
 * atender cada request individual (ver por qué abajo).
 *
 * DESVIACIÓN DEL PLAN ORIGINAL, verificada en runtime contra el SDK 1.26.0
 * instalado (no es un ajuste cosmético — son límites duros de la librería
 * real, no de este código):
 *
 * 1. Un `StreamableHTTPServerTransport` en modo stateless
 *    (`sessionIdGenerator: undefined`) SOLO puede atender UNA request HTTP
 *    por instancia — la segunda tira "Stateless transport cannot be reused
 *    across requests" (guard `_hasHandledRequest` en
 *    `webStandardStreamableHttp.js`). Reproducido en vivo: con un solo
 *    Transport para todo el proceso, `initialize` respondía 200 pero la
 *    siguiente request (`notifications/initialized`, la que manda el propio
 *    SDK Client automáticamente tras conectar) volvía 500.
 * 2. `Protocol.connect()` (la clase base de `Server`) tira si ya hay un
 *    Transport conectado ("Already connected to a transport. Call close()
 *    before connecting to a new transport") — así que ni siquiera alcanza
 *    con reusar UN Server con un Transport nuevo por request: dos requests
 *    concurrentes al mismo proceso (ej. Jano y Vesta pegándole a la vez)
 *    chocarían si la primera todavía no cerró su Transport.
 * 3. El propio ejemplo oficial del SDK para este modo
 *    (`examples/server/simpleStatelessStreamableHttp.js`, bundleado en el
 *    paquete instalado) crea un Server Y un Transport NUEVOS en cada POST —
 *    exactamente el patrón que se usa acá.
 *
 * Por eso `createCineServer()` se llama UNA VEZ POR REQUEST, no una sola vez
 * por proceso. Esto NO compromete la garantía del reaper: el guard de
 * `ensureReaperStarted()` (`mcp-server.ts`) es un flag a nivel de módulo
 * explícitamente diseñado para tolerar múltiples llamadas a
 * `createCineServer()` en el mismo proceso — solo la primera invocación real
 * arranca el `setInterval`, todas las siguientes son no-op. El estado de
 * compra (`compra-store.ts`) también es memoria de módulo compartida entre
 * TODAS las instancias de Server del proceso, así que un Server "nuevo" por
 * request no pierde ningún estado de negocio — solo re-registra el wiring
 * de protocolo MCP (tools, handlers), que es barato.
 */
export async function startCineHttpServer(
  opts: CineHttpServerOptions,
): Promise<CineHttpServerHandle> {
  const httpServer = createNodeHttpServer((req, res) => {
    if (req.url !== "/mcp") {
      res.writeHead(404).end();
      return;
    }
    void handleMcpRequest(req, res);
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(opts.port, opts.host ?? "127.0.0.1", () => {
      httpServer.off("error", reject);
      resolve();
    });
  });
  // Errores post-arranque (ej. ECONNRESET de un socket individual) no deben
  // tirar una excepción no capturada — loguear y seguir vivo.
  httpServer.on("error", (err) => console.error("[cine-http] server error:", err));

  return {
    httpServer,
    async stop() {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}

async function handleMcpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const server = createCineServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res);
  } catch (err) {
    console.error("[cine-http] error manejando request:", err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" }).end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        }),
      );
    }
  } finally {
    await transport.close().catch(() => {});
  }
}

// Entry point real: node dist/http.js — requiere CINE_MCP_PORT (sin default:
// mejor fallar fuerte que escuchar en un puerto adivinado y pisar otra cosa).
//
// Gotcha real (encontrado corriendo esto, no solo teórico): el patrón típico
// `new URL(import.meta.url).pathname === process.argv[1]` asume que
// `process.argv[1]` ya viene absoluto — pero al invocar `node dist/http.js`
// desde este mismo directorio, Node deja `process.argv[1]` TAL CUAL se pasó
// en la línea de comandos ("dist/http.js", relativo), nunca resuelto a
// absoluto. Comparado contra el pathname absoluto de `import.meta.url` nunca
// matchea, y el bloque de arranque queda mudo (el proceso importa el módulo
// y termina solo, sin loguear nada ni levantar el server) — el mismo síntoma
// silencioso que el gotcha de espacios en el path documentado en
// `Jano/CLAUDE.md`, pero con causa distinta. `pathToFileURL()` resuelve la
// ruta relativa al cwd Y codifica espacios como `%20` de la misma forma que
// `import.meta.url` — soluciona ambos problemas con una sola comparación.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const portEnv = process.env.CINE_MCP_PORT;
  if (!portEnv) {
    console.error("[cine-http] Falta CINE_MCP_PORT en el entorno.");
    process.exit(1);
  }
  const port = Number(portEnv);
  if (!Number.isInteger(port) || port <= 0) {
    console.error(`[cine-http] CINE_MCP_PORT inválido: "${portEnv}"`);
    process.exit(1);
  }
  await startCineHttpServer({ port, host: "127.0.0.1" });
  console.error(`[cine-http] escuchando en http://127.0.0.1:${port}/mcp`);
}
