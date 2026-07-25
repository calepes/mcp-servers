import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

function asText(result: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
}

const server = new Server({ name: "cine", version: "0.1.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name } = req.params;
  return { isError: true, content: [{ type: "text" as const, text: `Tool desconocida: ${name}` }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
