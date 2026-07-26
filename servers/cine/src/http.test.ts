import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startCineHttpServer } from "./http.js";
import { CINE_TOOL_NAMES } from "./mcp-server.js";

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
