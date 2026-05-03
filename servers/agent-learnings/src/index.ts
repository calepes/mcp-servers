import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { homedir } from "node:os";

const PATH_BY_AGENT: Record<string, string> = {
  vesta: `${homedir()}/.family-agent/learnings.md`,
  jano: `${homedir()}/.cos-agent/learnings.md`,
  pecunia: `${homedir()}/.pecunia-agent/learnings.md`,
};

const server = new Server(
  { name: "agent-learnings", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "addLearning",
      description:
        "Guarda un aprendizaje persistente para futuras sesiones. Llamar cuando detectes algo genuinamente nuevo: preferencia confirmada del usuario, error a evitar, patrón descubierto. Máx 2 líneas.",
      inputSchema: {
        type: "object",
        properties: {
          agent: {
            type: "string",
            enum: ["vesta", "jano", "pecunia"],
            description: "Nombre del agente que guarda el aprendizaje",
          },
          text: {
            type: "string",
            minLength: 5,
            maxLength: 500,
            description: "Texto del aprendizaje, máx 2 líneas",
          },
        },
        required: ["agent", "text"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name !== "addLearning") {
    throw new Error(`Unknown tool: ${req.params.name}`);
  }

  const { agent, text } = req.params.arguments as { agent: string; text: string };

  const filePath = PATH_BY_AGENT[agent];
  if (!filePath) {
    return {
      content: [{ type: "text", text: JSON.stringify({ ok: false, reason: `Unknown agent: ${agent}` }) }],
    };
  }

  if (!text || text.trim().length < 5) {
    return {
      content: [{ type: "text", text: JSON.stringify({ ok: false, reason: "text too short" }) }],
    };
  }

  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const date = new Date().toISOString().slice(0, 10);
  appendFileSync(filePath, `- [${date}] ${text.trim()}\n`, "utf8");

  return {
    content: [{ type: "text", text: JSON.stringify({ ok: true, agent, saved: text.trim() }) }],
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
