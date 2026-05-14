export class KuberaClient {
  private readonly endpoint = "https://api.kubera.com/api/v2/mcp";
  private readonly token: string;

  constructor(token: string) {
    this.token = token;
  }

  async callTool(name: string, arguments_: Record<string, unknown>): Promise<unknown> {
    const payload = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: arguments_ },
    });

    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Basic ${this.token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: payload,
    });

    if (!response.ok) {
      throw new Error(`Kubera HTTP ${response.status}: ${await response.text()}`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    const raw = await response.text();

    if (contentType.includes("text/event-stream")) {
      for (const line of raw.split("\n")) {
        if (line.startsWith("data:")) {
          const parsed = JSON.parse(line.slice(5).trim());
          return parsed.result;
        }
      }
      throw new Error("Kubera SSE: no data line found in response");
    }

    const parsed = JSON.parse(raw);
    return parsed.result;
  }

  // Convenience: extract text content from MCP result
  static extractText(result: unknown): string {
    const r = result as { content: Array<{ type: string; text: string }> };
    const block = r.content.find((c) => c.type === "text");
    if (!block) throw new Error("Kubera: no text content in result");
    return block.text;
  }
}
