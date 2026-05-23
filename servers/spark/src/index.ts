#!/usr/bin/env node
// MCP server: spark — wraps Spark Desktop CLI for email/calendar/contacts access.

import { execFile } from "node:child_process";

const DEFAULT_BINARY = "/opt/homebrew/bin/spark";
const DEFAULT_TIMEOUT_MS = 30_000;

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface RunOpts {
  binaryPath?: string;
  timeout?: number;
}

export function runSpark(args: string[], opts: RunOpts = {}): Promise<RunResult> {
  const binary = opts.binaryPath ?? DEFAULT_BINARY;
  const timeout = opts.timeout ?? DEFAULT_TIMEOUT_MS;
  return new Promise((resolve) => {
    execFile(binary, args, { timeout, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const e = err as NodeJS.ErrnoException & { code?: unknown; exitCode?: unknown };
        const exitCode =
          typeof e.exitCode === "number" ? e.exitCode :
          typeof e.code === "number" ? e.code :
          1;
        resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? err.message), exitCode });
        return;
      }
      resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? ""), exitCode: 0 });
    });
  });
}

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const READ_ONLY = { annotations: { readOnlyHint: true } };

// Helper: convert RunResult to MCP response
function toMcpResponse(r: RunResult) {
  if (r.exitCode === 0) {
    return { content: [{ type: "text" as const, text: r.stdout || "(empty output)" }] };
  }
  return {
    isError: true,
    content: [{ type: "text" as const, text: r.stderr || r.stdout || `Spark CLI exited ${r.exitCode}` }],
  };
}

// Helper: collect repeatable string args (e.g., --to alice --to bob)
function repeatFlag(flag: string, values: unknown): string[] {
  if (!values) return [];
  const arr = Array.isArray(values) ? values : [values];
  return arr.flatMap((v) => [flag, String(v)]);
}

// Helper: optional flag with value
function optFlag(flag: string, value: unknown): string[] {
  if (value === undefined || value === null || value === "") return [];
  return [flag, String(value)];
}

// Helper: boolean flag (present if true)
function boolFlag(flag: string, value: unknown): string[] {
  return value === true ? [flag] : [];
}

const READ_TOOLS = [
  {
    name: "listAccounts",
    description:
      "Lista cuentas Spark con calendars, teams, shared inboxes y access level (read-only | triage). Correr primero para descubrir qué hay disponible.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: READ_ONLY.annotations,
  },
  {
    name: "listFolders",
    description:
      "Lista folders/labels con conteo de mensajes. Args: { account? } para filtrar a una cuenta específica (ej. 'carlos@lepesqueur.net').",
    inputSchema: {
      type: "object",
      properties: { account: { type: "string", description: "Email de la cuenta a filtrar" } },
      additionalProperties: false,
    },
    annotations: READ_ONLY.annotations,
  },
  {
    name: "listEmails",
    description:
      "Lista emails con metadata (ID, From, Date, Subject, Flags). Soporta filtros Gmail-style en `filter`. Folder formats: 'Inbox' (unified), 'user@x.com' (account inbox), 'user@x.com:Archive' (specific folder), '\"Team Name\"' (shared). Sin folder = Unified Inbox.",
    inputSchema: {
      type: "object",
      properties: {
        folder: { type: "string", description: "Identifier del folder (ver descripción)" },
        filter: { type: "string", description: "Gmail-style filter: from:, to:, subject:, before:, after:, newer_than:Xd, is:unread, has:attachment, etc." },
        page: { type: "number" },
        pageSize: { type: "number" },
        order: { type: "string", enum: ["ascending", "descending"] },
        newSenders: { type: "boolean", description: "Mostrar solo emails de senders nuevos (GateKeeper)" },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY.annotations,
  },
  {
    name: "searchEmails",
    description:
      "Hybrid keyword + semantic search. Devuelve hasta 20 emails con bodies completos, sorted by relevance. Usar para preguntas sobre contenido (vs listEmails que solo da metadata). Args: { about (required), filter?, in? (scope: account, team, folder o shared inbox) }.",
    inputSchema: {
      type: "object",
      properties: {
        about: { type: "string", description: "Tema a buscar" },
        filter: { type: "string", description: "Gmail-style filter adicional" },
        in: { type: "string", description: "Scope: account, team, folder o shared inbox" },
      },
      required: ["about"],
      additionalProperties: false,
    },
    annotations: READ_ONLY.annotations,
  },
  {
    name: "readThread",
    description:
      "Print thread completo: headers, full plain-text bodies, attachment info. Usar messageId de listEmails/searchEmails. downloadAttachments=true descarga via IMAP.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Message ID del thread" },
        downloadAttachments: { type: "boolean" },
      },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: READ_ONLY.annotations,
  },
  {
    name: "listEvents",
    description:
      "Lista eventos de calendario en rango temporal. Args: from/to en formato yyyy-MM-dd o yyyy-MM-ddTHH:mm. Opcional account/calendar para filtrar.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Fecha inicio" },
        to: { type: "string", description: "Fecha fin" },
        account: { type: "string" },
        calendar: { type: "string" },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY.annotations,
  },
  {
    name: "findAvailability",
    description:
      "Encuentra slots libres en rango temporal, opcionalmente intersectando con disponibilidad de attendees.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string" },
        to: { type: "string" },
        duration: { type: "string", description: "Duración del slot (ej. '30m', '1h')" },
        attendees: { type: "array", items: { type: "string" } },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY.annotations,
  },
  {
    name: "searchContacts",
    description: "Busca contactos por nombre o email.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
      additionalProperties: false,
    },
    annotations: READ_ONLY.annotations,
  },
  {
    name: "listTeams",
    description: "Info de teams, members, shared inboxes, assignments. Sin args = todos los teams.",
    inputSchema: {
      type: "object",
      properties: { team: { type: "string", description: "Nombre del team a filtrar" } },
      additionalProperties: false,
    },
    annotations: READ_ONLY.annotations,
  },
  {
    name: "listMeetings",
    description: "Lista meeting transcripts en rango temporal.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string" },
        to: { type: "string" },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY.annotations,
  },
  {
    name: "readMeeting",
    description: "Lee transcript completo de una meeting por ID.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: READ_ONLY.annotations,
  },
];

const server = new Server(
  { name: "spark", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: READ_TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const a = (args ?? {}) as Record<string, unknown>;

  try {
    // Read-only tools
    if (name === "listAccounts") {
      return toMcpResponse(await runSpark(["accounts"]));
    }
    if (name === "listFolders") {
      const cli = ["folders", ...(a.account ? [String(a.account)] : [])];
      return toMcpResponse(await runSpark(cli));
    }
    if (name === "listEmails") {
      const cli = ["emails"];
      if (a.folder) cli.push(String(a.folder));
      cli.push(
        ...optFlag("--filter", a.filter),
        ...optFlag("--page", a.page),
        ...optFlag("--page-size", a.pageSize),
        ...optFlag("--order", a.order),
        ...boolFlag("--new-senders", a.newSenders),
      );
      return toMcpResponse(await runSpark(cli));
    }
    if (name === "searchEmails") {
      const cli = ["search", String(a.about), ...optFlag("--filter", a.filter), ...optFlag("--in", a.in)];
      return toMcpResponse(await runSpark(cli));
    }
    if (name === "readThread") {
      const cli = ["thread", ...boolFlag("--download-attachments", a.downloadAttachments), String(a.id)];
      return toMcpResponse(await runSpark(cli));
    }
    if (name === "listEvents") {
      const cli = [
        "events",
        ...optFlag("--from", a.from),
        ...optFlag("--to", a.to),
        ...optFlag("--account", a.account),
        ...optFlag("--calendar", a.calendar),
      ];
      return toMcpResponse(await runSpark(cli));
    }
    if (name === "findAvailability") {
      const cli = [
        "availability",
        ...optFlag("--from", a.from),
        ...optFlag("--to", a.to),
        ...optFlag("--duration", a.duration),
        ...repeatFlag("--attendee", a.attendees),
      ];
      return toMcpResponse(await runSpark(cli));
    }
    if (name === "searchContacts") {
      return toMcpResponse(await runSpark(["contacts", String(a.query)]));
    }
    if (name === "listTeams") {
      const cli = ["team", ...(a.team ? [String(a.team)] : [])];
      return toMcpResponse(await runSpark(cli));
    }
    if (name === "listMeetings") {
      const cli = ["meetings", ...optFlag("--from", a.from), ...optFlag("--to", a.to)];
      return toMcpResponse(await runSpark(cli));
    }
    if (name === "readMeeting") {
      return toMcpResponse(await runSpark(["meeting", String(a.id)]));
    }

    return { isError: true, content: [{ type: "text" as const, text: `Unknown tool: ${name}` }] };
  } catch (err) {
    return {
      isError: true,
      content: [{ type: "text" as const, text: `Error en ${name}: ${(err as Error).message}` }],
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
