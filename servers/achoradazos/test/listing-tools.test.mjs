import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

async function rpc(calls) {
  const child = spawn("node", [fileURLToPath(new URL("../dist/index.js", import.meta.url))]);
  let output = "";
  child.stdout.on("data", chunk => { output += chunk; });

  const done = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", code => code === 0 ? resolve() : reject(new Error(`MCP terminó con ${code}`)));
  });

  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1" } } }) + "\n");
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n");
  for (const call of calls) child.stdin.write(JSON.stringify(call) + "\n");
  child.stdin.end();
  await done;
  return output.trim().split("\n").filter(Boolean).map(JSON.parse);
}

test("lista grupos de cobro y juntes legibles", async () => {
  const replies = await rpc([
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "listGrupoCobros", arguments: {} } },
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "listEventos", arguments: {} } },
  ]);
  const response = id => replies.find(reply => reply.id === id);
  const names = response(2).result.tools.map(tool => tool.name);
  assert.ok(names.includes("listGrupoCobros"));
  assert.ok(names.includes("listEventos"));
  assert.ok(names.includes("registerExpense"));
  assert.ok(names.includes("listExpensesByEvento"));
  assert.match(response(2).result.tools.find(tool => tool.name === "uploadReceipt").description, /PDF/);
  assert.ok(response(2).result.tools.find(tool => tool.name === "registerExpense").inputSchema.properties.constanciaFilename);

  const grupos = JSON.parse(response(3).result.content[0].text);
  const eventos = JSON.parse(response(4).result.content[0].text);
  assert.ok(grupos.every(group => group.id && group.nombre));
  assert.ok(eventos.every(event => event.id && event.nombre && event.fecha));
});

test("consulta gastos registrados de un junte", async (t) => {
  const eventosReply = await rpc([
    { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "listEventos", arguments: {} } },
  ]);
  const eventos = JSON.parse(eventosReply.find(reply => reply.id === 5).result.content[0].text);
  if (!eventos[0]) return t.skip("No hay juntes para consultar");

  const gastosReply = await rpc([
    { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "listExpensesByEvento", arguments: { junteId: eventos[0].id } } },
  ]);
  const gastosText = gastosReply.find(reply => reply.id === 6).result.content[0].text;
  assert.ok(!gastosText.startsWith("Error"), gastosText);
  const gastos = JSON.parse(gastosText);
  assert.equal(gastos.junteId, eventos[0].id);
  assert.equal(gastos.cantidad, gastos.gastos.length);
  assert.equal(gastos.total, gastos.gastos.reduce((sum, gasto) => sum + gasto.valor, 0));
});
