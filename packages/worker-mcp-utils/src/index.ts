export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

export type ToolDispatcher = (
  name: string,
  args: unknown,
  env: Record<string, unknown>,
) => Promise<unknown>;

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number | null;
  method: string;
  params?: unknown;
}

export interface McpEnv {
  MCP_AUTH_TOKEN: string;
}

export async function handleMcp(
  req: Request,
  env: McpEnv,
  tools: McpTool[],
  serverName: string,
  dispatchTool: ToolDispatcher,
): Promise<Response> {
  const url = new URL(req.url);

  const auth = req.headers.get('Authorization');
  if (auth !== `Bearer ${env.MCP_AUTH_TOKEN}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  if (url.pathname !== '/mcp') {
    return new Response('Not Found', { status: 404 });
  }

  if (req.method === 'GET') {
    return jsonOk(null, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: serverName, version: '0.1.0' },
    });
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  let body: JsonRpcRequest;
  try {
    body = await req.json() as JsonRpcRequest;
  } catch {
    return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
  }

  switch (body.method) {
    case 'initialize':
      return jsonOk(body.id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: serverName, version: '0.1.0' },
      });

    case 'ping':
      return jsonOk(body.id, {});

    case 'tools/list':
      return jsonOk(body.id, { tools });

    case 'tools/call': {
      const { name, arguments: args } = body.params as { name: string; arguments: unknown };
      try {
        const result = await dispatchTool(name, args, env as unknown as Record<string, unknown>);
        const text = typeof result === 'string' ? result : JSON.stringify(result);
        return jsonOk(body.id, { content: [{ type: 'text', text }] });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonOk(body.id, {
          content: [{ type: 'text', text: `Error: ${message}` }],
          isError: true,
        });
      }
    }

    default:
      return Response.json({
        jsonrpc: '2.0',
        id: body.id,
        error: { code: -32601, message: `Method not found: ${body.method}` },
      });
  }
}

function jsonOk(id: string | number | null, result: unknown): Response {
  return Response.json({ jsonrpc: '2.0', id, result });
}
