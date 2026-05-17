import { describe, it, expect } from 'vitest';
import { handleMcp, type McpTool } from './index.js';

const TOOLS: McpTool[] = [
  {
    name: 'myTool',
    description: 'A test tool',
    inputSchema: { type: 'object', properties: { x: { type: 'number' } }, required: ['x'] },
  },
];

async function dispatch(name: string, args: unknown): Promise<unknown> {
  if (name === 'myTool') return { result: (args as any).x * 2 };
  throw new Error(`Unknown tool: ${name}`);
}

function makeReq(body: unknown, token = 'secret'): Request {
  return new Request('https://example.com/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

const ENV = { MCP_AUTH_TOKEN: 'secret' };

describe('handleMcp', () => {
  it('rejects missing auth', async () => {
    const req = new Request('https://example.com/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    });
    const res = await handleMcp(req, ENV, TOOLS, 'test-server', dispatch);
    expect(res.status).toBe(401);
  });

  it('rejects wrong token', async () => {
    const req = makeReq({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, 'wrong');
    const res = await handleMcp(req, ENV, TOOLS, 'test-server', dispatch);
    expect(res.status).toBe(401);
  });

  it('returns 404 for non-/mcp path', async () => {
    const req = new Request('https://example.com/healthz', {
      method: 'GET',
      headers: { Authorization: 'Bearer secret' },
    });
    const res = await handleMcp(req, ENV, TOOLS, 'test-server', dispatch);
    expect(res.status).toBe(404);
  });

  it('handles initialize', async () => {
    const req = makeReq({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    const res = await handleMcp(req, ENV, TOOLS, 'test-server', dispatch);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.result.protocolVersion).toBe('2024-11-05');
    expect(body.result.serverInfo.name).toBe('test-server');
  });

  it('handles tools/list', async () => {
    const req = makeReq({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const res = await handleMcp(req, ENV, TOOLS, 'test-server', dispatch);
    const body = await res.json() as any;
    expect(body.result.tools).toHaveLength(1);
    expect(body.result.tools[0].name).toBe('myTool');
  });

  it('handles tools/call success', async () => {
    const req = makeReq({
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'myTool', arguments: { x: 5 } },
    });
    const res = await handleMcp(req, ENV, TOOLS, 'test-server', dispatch);
    const body = await res.json() as any;
    expect(body.result.isError).toBeFalsy();
    const content = JSON.parse(body.result.content[0].text);
    expect(content.result).toBe(10);
  });

  it('handles tools/call error', async () => {
    const req = makeReq({
      jsonrpc: '2.0', id: 4, method: 'tools/call',
      params: { name: 'unknownTool', arguments: {} },
    });
    const res = await handleMcp(req, ENV, TOOLS, 'test-server', dispatch);
    const body = await res.json() as any;
    expect(body.result.isError).toBe(true);
  });

  it('returns -32601 for unknown method', async () => {
    const req = makeReq({ jsonrpc: '2.0', id: 5, method: 'notifications/initialized', params: {} });
    const res = await handleMcp(req, ENV, TOOLS, 'test-server', dispatch);
    const body = await res.json() as any;
    expect(body.error.code).toBe(-32601);
  });
});
