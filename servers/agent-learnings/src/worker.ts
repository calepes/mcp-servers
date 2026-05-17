import { handleMcp, type McpTool, type McpEnv } from 'worker-mcp-utils';

interface Env extends McpEnv {
  LEARNINGS: KVNamespace;
}

const VALID_AGENTS = ['vesta', 'jano', 'pecunia'] as const;
type AgentName = typeof VALID_AGENTS[number];

const TOOLS: McpTool[] = [
  {
    name: 'addLearning',
    description: 'Guarda un aprendizaje persistente para futuras sesiones del agente.',
    inputSchema: {
      type: 'object',
      properties: {
        agent: { type: 'string', enum: [...VALID_AGENTS], description: 'Nombre del agente' },
        text: { type: 'string', minLength: 5, maxLength: 500, description: 'Texto del aprendizaje' },
      },
      required: ['agent', 'text'],
    },
  },
  {
    name: 'getLearnings',
    description: 'Retorna todos los aprendizajes guardados de un agente.',
    inputSchema: {
      type: 'object',
      properties: {
        agent: { type: 'string', enum: [...VALID_AGENTS], description: 'Nombre del agente' },
      },
      required: ['agent'],
    },
  },
];

async function dispatchTool(name: string, args: unknown, env: Record<string, unknown>): Promise<unknown> {
  const e = env as unknown as Env;
  const a = args as { agent: string; text: string };
  if (name === 'addLearning') {
    if (!VALID_AGENTS.includes(a.agent as AgentName)) {
      return { ok: false, reason: `Unknown agent: ${a.agent}` };
    }
    const key = `${a.agent}:learnings`;
    const existing = (await e.LEARNINGS.get(key)) ?? '';
    const timestamp = new Date().toISOString().slice(0, 10);
    const newEntry = `\n- [${timestamp}] ${a.text.trim()}`;
    await e.LEARNINGS.put(key, existing + newEntry);
    return { ok: true, agent: a.agent };
  }
  if (name === 'getLearnings') {
    if (!VALID_AGENTS.includes(a.agent as AgentName)) {
      return { ok: false, reason: `Unknown agent: ${a.agent}` };
    }
    const key = `${a.agent}:learnings`;
    const value = (await e.LEARNINGS.get(key)) ?? '';
    return { agent: a.agent, learnings: value };
  }
  throw new Error(`Unknown tool: ${name}`);
}

export default {
  fetch(req: Request, env: Env): Promise<Response> {
    return handleMcp(req, env, TOOLS, 'agent-learnings', dispatchTool);
  },
} satisfies ExportedHandler<Env>;
