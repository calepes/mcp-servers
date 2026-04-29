# Telegram Notifications MCP Server — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an MCP server on Cloudflare Workers that sends Telegram notifications (text, images, files) via a single `send_notification` tool. Monorepo structure for future MCP servers.

**Architecture:** Monorepo `mcp-servers` with npm workspaces. Each server is an independent Cloudflare Worker under `servers/`. GitHub repo with Actions CI/CD — push to main auto-deploys only the changed servers.

**Tech Stack:** TypeScript, `@modelcontextprotocol/sdk`, `@cloudflare/agents`, Zod, Cloudflare Workers, GitHub Actions

---

## File Structure

```
mcp-servers/                          # repo root
├── .github/
│   └── workflows/
│       └── deploy.yml                # CI/CD: deploy changed servers on push to main
├── servers/
│   └── telegram/
│       ├── src/
│       │   └── index.ts              # Worker entry + MCP server + send_notification tool
│       ├── wrangler.toml             # Cloudflare Worker config
│       ├── package.json              # Server-specific deps
│       └── tsconfig.json             # Server-specific TS config
├── package.json                      # Root workspace config
├── tsconfig.base.json                # Shared TS config
└── .gitignore
```

---

### Task 1: Monorepo Scaffolding

**Files:**
- Create: `package.json` (root)
- Create: `tsconfig.base.json` (root)
- Create: `.gitignore`
- Create: `servers/telegram/package.json`
- Create: `servers/telegram/tsconfig.json`
- Create: `servers/telegram/wrangler.toml`

- [ ] **Step 1: Create root `package.json`**

```json
{
  "name": "mcp-servers",
  "private": true,
  "workspaces": ["servers/*"]
}
```

- [ ] **Step 2: Create root `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  }
}
```

- [ ] **Step 3: Create `.gitignore`**

```
node_modules/
dist/
.wrangler/
.dev.vars
```

- [ ] **Step 4: Create `servers/telegram/package.json`**

```json
{
  "name": "mcp-telegram",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy"
  },
  "dependencies": {
    "@cloudflare/agents": "^0.0.50",
    "@modelcontextprotocol/sdk": "^1.12.1",
    "zod": "^3.25.0"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20250313.0",
    "typescript": "^5.7.0",
    "wrangler": "^4.0.0"
  }
}
```

- [ ] **Step 5: Create `servers/telegram/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "types": ["@cloudflare/workers-types"],
    "outDir": "dist"
  },
  "include": ["src"]
}
```

- [ ] **Step 6: Create `servers/telegram/wrangler.toml`**

```toml
name = "mcp-telegram"
main = "src/index.ts"
compatibility_date = "2025-03-14"
compatibility_flags = ["nodejs_compat"]

[durable_objects]
bindings = [
  { name = "MCP_TELEGRAM", class_name = "TelegramMCP" }
]

[[migrations]]
tag = "v1"
new_classes = ["TelegramMCP"]

# Secrets (set via: wrangler secret put TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)
```

- [ ] **Step 7: Install dependencies**

Run: `cd mcp-servers && npm install`
Expected: `node_modules/` created, no errors.

- [ ] **Step 8: Init repo and first commit**

```bash
git init
git add .
git commit -m "chore: scaffold mcp-servers monorepo with telegram server"
```

---

### Task 2: Implement `send_notification` Tool

**Files:**
- Create: `servers/telegram/src/index.ts`

- [ ] **Step 1: Create `servers/telegram/src/index.ts`**

```typescript
import { McpAgent } from "@cloudflare/agents/mcp";
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

export class TelegramMCP extends McpAgent<Env, unknown, unknown> {
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
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd servers/telegram && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add servers/telegram/src/index.ts
git commit -m "feat: implement send_notification MCP tool with Telegram API"
```

---

### Task 3: GitHub Repo + CI/CD

**Files:**
- Create: `.github/workflows/deploy.yml`

- [ ] **Step 1: Create GitHub repo**

```bash
gh repo create calepes/mcp-servers --private --source=. --remote=origin
```

- [ ] **Step 2: Create `.github/workflows/deploy.yml`**

```yaml
name: Deploy MCP Servers

on:
  push:
    branches: [main]

jobs:
  detect-changes:
    runs-on: ubuntu-latest
    outputs:
      telegram: ${{ steps.filter.outputs.telegram }}
    steps:
      - uses: actions/checkout@v4
      - uses: dorny/paths-filter@v3
        id: filter
        with:
          filters: |
            telegram:
              - 'servers/telegram/**'

  deploy-telegram:
    needs: detect-changes
    if: needs.detect-changes.outputs.telegram == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - run: npm ci
      - run: npx wrangler deploy
        working-directory: servers/telegram
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
```

- [ ] **Step 3: Commit and push**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: add GitHub Actions deploy workflow with change detection"
git push -u origin main
```

- [ ] **Step 4: Add `CLOUDFLARE_API_TOKEN` secret to GitHub repo**

```bash
gh secret set CLOUDFLARE_API_TOKEN
```
(Pegar el API token de Cloudflare cuando lo pida)

---

### Task 4: Deploy and Configure Secrets

- [ ] **Step 1: First deploy from local**

```bash
cd servers/telegram && npx wrangler deploy
```
Expected: Worker deployed, URL shown.

- [ ] **Step 2: Set Telegram secrets**

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
```
(Pegar valores cuando lo pida)

- [ ] **Step 3: Test with curl**

```bash
curl https://mcp-telegram.<subdomain>.workers.dev/
```
Expected: "MCP Telegram Server"

---

### Task 5: Configure in Claude Code

- [ ] **Step 1: Add MCP server to Claude Code settings**

Add to `~/.claude/settings.json` under `mcpServers`:

```json
{
  "telegram": {
    "type": "url",
    "url": "https://mcp-telegram.<subdomain>.workers.dev/sse"
  }
}
```

- [ ] **Step 2: Restart Claude Code and verify `send_notification` tool appears**

- [ ] **Step 3: Test end-to-end — send a test notification**
