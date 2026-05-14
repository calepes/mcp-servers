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

    const raw = await response.text();

    if (!response.ok) {
      throw new Error(`Kubera HTTP ${response.status}: ${raw}`);
    }

    const contentType = response.headers.get("content-type") ?? "";

    if (contentType.includes("text/event-stream")) {
      // Take first data: line (Kubera returns single-payload SSE events)
      for (const line of raw.split("\n")) {
        if (line.startsWith("data:")) {
          try {
            const parsed = JSON.parse(line.slice(5).trim());
            return parsed.result;
          } catch (e) {
            throw new Error(`Kubera SSE: failed to parse JSON data: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      }
      throw new Error("Kubera SSE: no data line found in response");
    }

    try {
      const parsed = JSON.parse(raw);
      return parsed.result;
    } catch (e) {
      throw new Error(`Kubera: failed to parse JSON response: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Convenience: extract text content from MCP result
  static extractText(result: unknown): string {
    if (!result || typeof result !== "object") {
      throw new Error("Kubera: result is not an object");
    }
    const r = result as Record<string, unknown>;
    if (!Array.isArray(r["content"])) {
      throw new Error("Kubera: result.content is not an array");
    }
    const content = r["content"] as Array<Record<string, unknown>>;
    const block = content.find((c) => c["type"] === "text" && typeof c["text"] === "string");
    if (!block) throw new Error("Kubera: no text content in result");
    return block["text"] as string;
  }
}
