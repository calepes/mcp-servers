import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startCineHttpServer, type CineHttpServerHandle } from "./http.js";
import { CINE_TOOL_NAMES } from "./mcp-server.js";
import { createSession, nuevoPurchaseId, _resetAll, type PurchaseSession } from "./compra-store.js";

const TEST_PORT = 8793;

let stop: () => Promise<void>;

beforeAll(async () => {
  const started = await startCineHttpServer({ port: TEST_PORT, host: "127.0.0.1" });
  stop = started.stop;
});

afterAll(async () => {
  await stop();
});

describe("cine HTTP transport", () => {
  it("responde tools/list vía HTTP con las mismas 7 tools que stdio", async () => {
    const client = new Client({ name: "test-client", version: "0.0.1" });
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${TEST_PORT}/mcp`),
    );
    await client.connect(transport);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(CINE_TOOL_NAMES);
    await client.close();
  });
});

describe("cine HTTP transport — listen() maneja EADDRINUSE", () => {
  it("rechaza la promesa (en vez de crashear el proceso) si el puerto ya está en uso", async () => {
    let second: CineHttpServerHandle | undefined;
    await expect(startCineHttpServer({ port: TEST_PORT, host: "127.0.0.1" })).rejects.toMatchObject(
      { code: "EADDRINUSE" },
    );
    // Si por algún motivo la promesa igual resolviera, cerrar el handle para
    // no dejar un listener huérfano ocupando el puerto.
    await second?.stop();
  });
});

describe("cine HTTP transport — persistencia de estado entre requests", () => {
  // El estado de negocio (compra-store.ts, Map a nivel de módulo) debe
  // sobrevivir entre requests HTTP distintos, pese a que cada request cree
  // un Server MCP nuevo (ver comentario en http.ts sobre la desviación de
  // arquitectura). Este test lo prueba directamente: dos conexiones de
  // cliente MCP independientes deben ver la MISMA compra activa.
  afterEach(() => {
    _resetAll();
  });

  it("dos conexiones HTTP independientes ven la misma compra activa", async () => {
    const fakeSession: PurchaseSession = {
      purchaseId: nuevoPurchaseId(),
      browser: { close: async () => {} } as never,
      page: {} as never,
      estado: "asientos",
      funcion: { pelicula: "TOY STORY 5", hora: "20:30", formato: "2D" },
      cantidad: 2,
      seatDeadline: Date.now() + 8 * 60_000,
      createdAt: Date.now(),
    };
    createSession(fakeSession);

    async function consultarEstado(): Promise<unknown> {
      const client = new Client({ name: "test-client", version: "0.0.1" });
      const transport = new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${TEST_PORT}/mcp`),
      );
      await client.connect(transport);
      const result = await client.callTool({ name: "estadoCompraCine", arguments: {} });
      await client.close();
      const content = (result.content as Array<{ type: string; text: string }>)[0];
      return JSON.parse(content.text);
    }

    const primera = (await consultarEstado()) as { purchaseId: string };
    const segunda = (await consultarEstado()) as { purchaseId: string };

    expect(primera.purchaseId).toBe(fakeSession.purchaseId);
    expect(segunda.purchaseId).toBe(fakeSession.purchaseId);
  });
});
