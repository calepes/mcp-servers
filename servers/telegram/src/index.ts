import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

interface Env {
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
}

const TELEGRAM_API = "https://api.telegram.org";

async function telegramRequest(
  env: Env,
  method: string,
  body: Record<string, unknown>
): Promise<{ ok: boolean; description?: string }> {
  const url = `${TELEGRAM_API}/bot${env.TELEGRAM_BOT_TOKEN}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, ...body }),
  });
  return res.json() as Promise<{ ok: boolean; description?: string }>;
}

export class TelegramMCP extends McpAgent<Env, Record<string, unknown>, Record<string, unknown>> {
  server = new McpServer({
    name: "mcp-telegram",
    version: "1.0.0",
  });

  async init() {
    this.server.tool(
      "send_notification",
      "Send a notification via Telegram. Supports text (Markdown), images, and files.",
      {
        message: z.string().describe("Message text (supports Markdown)"),
        image_url: z
          .string()
          .url()
          .optional()
          .describe("URL of an image to send as photo"),
        file_url: z
          .string()
          .url()
          .optional()
          .describe("URL of a file to send as document"),
      },
      async ({ message, image_url, file_url }) => {
        let result: { ok: boolean; description?: string };

        if (image_url) {
          result = await telegramRequest(this.env, "sendPhoto", {
            photo: image_url,
            caption: message,
            parse_mode: "Markdown",
          });
        } else if (file_url) {
          result = await telegramRequest(this.env, "sendDocument", {
            document: file_url,
            caption: message,
            parse_mode: "Markdown",
          });
        } else {
          result = await telegramRequest(this.env, "sendMessage", {
            text: message,
            parse_mode: "Markdown",
          });
        }

        if (!result.ok) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: ${result.description ?? "Unknown error"}`,
              },
            ],
            isError: true,
          };
        }

        return {
          content: [
            { type: "text" as const, text: "Notification sent successfully." },
          ],
        };
      }
    );
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname === "/sse" || url.pathname === "/sse/message") {
      // @ts-ignore
      return TelegramMCP.serveSSE("/sse").fetch(request, env, ctx);
    }

    if (url.pathname === "/mcp" || url.pathname === "/mcp/message") {
      // @ts-ignore
      return TelegramMCP.serve("/mcp").fetch(request, env, ctx);
    }

    return new Response("MCP Telegram Server", { status: 200 });
  },
};
