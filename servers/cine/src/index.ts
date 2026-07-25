import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createCineServer } from "./mcp-server.js";

const server = createCineServer();
const transport = new StdioServerTransport();
await server.connect(transport);
