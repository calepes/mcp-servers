import { describe, it, expect, vi, beforeEach } from "vitest";
import { KuberaClient } from "../../src/clients/kubera.js";

const MOCK_TOKEN = "dGVzdDp0ZXN0";

function mockFetch(body: string, contentType = "application/json") {
  return vi.fn().mockResolvedValue({
    ok: true,
    headers: { get: () => contentType },
    text: async () => body,
  });
}

describe("KuberaClient", () => {
  let client: KuberaClient;
  const portfolioId = "6bccf4ba-e50d-442b-9f52-5cb3bc64523d";

  beforeEach(() => {
    client = new KuberaClient(MOCK_TOKEN);
  });

  it("calls correct endpoint with Basic auth", async () => {
    const fetchSpy = mockFetch(
      JSON.stringify({ result: { content: [{ text: "{}" }] } })
    );
    vi.stubGlobal("fetch", fetchSpy);

    await client.callTool("get_portfolio", { portfolioId });

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.kubera.com/api/v2/mcp",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: `Basic ${MOCK_TOKEN}`,
        }),
      })
    );
  });

  it("parses JSON response", async () => {
    const result = { content: [{ text: '{"totalValue":50000}' }] };
    vi.stubGlobal("fetch", mockFetch(JSON.stringify({ result })));

    const res = await client.callTool("get_portfolio", { portfolioId });
    expect(res).toEqual(result);
  });

  it("parses SSE response (data: lines)", async () => {
    const result = { content: [{ text: '{"totalValue":50000}' }] };
    const sseBody = `event: message\ndata: ${JSON.stringify({ result })}\n\n`;
    vi.stubGlobal(
      "fetch",
      mockFetch(sseBody, "text/event-stream")
    );

    const res = await client.callTool("get_portfolio", { portfolioId });
    expect(res).toEqual(result);
  });

  it("throws on HTTP error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => "Unauthorized" })
    );
    await expect(client.callTool("get_portfolio", {})).rejects.toThrow("Kubera HTTP 401");
  });
});
