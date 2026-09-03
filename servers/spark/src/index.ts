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

// ponytail: heurística de texto, no confirmada contra el mensaje real del CLI (Spark
// estaba corriendo durante el desarrollo). Si Spark deja de auto-abrirse, ajustar este regex.
const NOT_RUNNING_RE = /can.?t access|not running|no running instance|econnrefused|failed to connect/i;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function openSparkDesktop(): Promise<void> {
  return new Promise((resolve) => {
    execFile("open", ["-a", "Spark Desktop"], () => resolve());
  });
}

/** Como runSpark, pero si el fallo indica que Spark Desktop no está corriendo, lo abre y reintenta. */
export async function runSparkAutoOpen(args: string[], opts: RunOpts = {}): Promise<RunResult> {
  let result = await runSpark(args, opts);
  if (result.exitCode === 0 || !NOT_RUNNING_RE.test(`${result.stdout} ${result.stderr}`)) {
    return result;
  }
  await openSparkDesktop();
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    await sleep(1_500);
    result = await runSpark(args, opts);
    if (result.exitCode === 0 || !NOT_RUNNING_RE.test(`${result.stdout} ${result.stderr}`)) break;
  }
  return result;
}

/** Extrae message IDs de la salida tabular de `spark emails` (primera columna numérica de cada fila). */
export function parseEmailIds(output: string): string[] {
  const ids: string[] = [];
  for (const line of output.split("\n")) {
    const m = line.match(/^\s*(\d+)\s+\S/);
    if (m) ids.push(m[1]);
  }
  return ids;
}

/** Extrae los emails de cuenta de la salida de `spark accounts` (líneas "Email Account: x@y.com ..."). */
export function parseAccountEmails(output: string): string[] {
  return [...output.matchAll(/^Email Account:\s+(\S+)/gm)].map((m) => m[1]);
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

const WRITE_TOOLS = [
  {
    name: "createDraft",
    description:
      "Crear o editar un draft de email. Body en markdown (convertido a HTML). Requires triage access. Usar replyTo/forward para responder/reenviar; edit para modificar draft existente.",
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "array", items: { type: "string" } },
        cc: { type: "array", items: { type: "string" } },
        bcc: { type: "array", items: { type: "string" } },
        subject: { type: "string" },
        body: { type: "string", description: "Markdown body" },
        account: { type: "string", description: "Email de la cuenta from" },
        replyTo: { type: "string", description: "Message ID al que responder" },
        forward: { type: "string", description: "Message ID a forward" },
        edit: { type: "string", description: "Draft ID a editar" },
        attach: { type: "array", items: { type: "string" }, description: "Absolute paths de archivos" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "postComment",
    description:
      "Post team comment (chat) en un thread. Si el thread no está shared, se comparte automático. Requires triage access. Args: { threadId, body, team?, users?, attach?, edit? }.",
    inputSchema: {
      type: "object",
      properties: {
        threadId: { type: "string" },
        body: { type: "string" },
        team: { type: "string" },
        users: { type: "array", items: { type: "string" } },
        attach: { type: "array", items: { type: "string" } },
        edit: { type: "string", description: "Comment ID a editar" },
      },
      required: ["threadId"],
      additionalProperties: false,
    },
  },
  {
    name: "emailAction",
    description:
      "Ejecuta acción sobre un email: archive, pin, snooze, assign, attachLabel, detachLabel, markRead, markUnread, etc. Requires triage access. Args extra dependen de la acción (e.g., snooze necesita until; assign necesita user).",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", description: "archive | pin | snooze | assign | attachLabel | detachLabel | markRead | markUnread | etc." },
        messageId: { type: "string" },
        extraArgs: { type: "array", items: { type: "string" }, description: "Args adicionales según action (ver `spark skill`)" },
      },
      required: ["action", "messageId"],
      additionalProperties: false,
    },
  },
  {
    name: "contactAction",
    description:
      "Acción sobre un contacto: blockContact, acceptContact, categorize, etc. Requires triage access.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", description: "blockContact | acceptContact | categorize | etc." },
        email: { type: "string" },
        extraArgs: { type: "array", items: { type: "string" } },
      },
      required: ["action", "email"],
      additionalProperties: false,
    },
  },
  {
    name: "triageInboxDiagnostico",
    description:
      "Triage mecánico del inbox (skill procesar-inbox, pasos 1-3). Por cada cuenta: excluye pineados, archiva AUTOMÁTICO lo que ya está LEÍDO en newsletter+notification (nunca priority/personal, nunca pineados), y devuelve sin tocar el texto crudo de: no-leídos de newsletter/notification (para armar el resumen y preguntarle a Cal qué archivar) y personal+priority (para que Cal los revise, nunca se archivan desde acá). Abre Spark Desktop solo si no está corriendo. Args: { cuentas? } — si se omite, se descubren todas las cuentas con `accounts`.",
    inputSchema: {
      type: "object",
      properties: {
        cuentas: { type: "array", items: { type: "string" }, description: "Emails de cuenta a procesar (ej. 'carlos@lepesqueur.net'). Si se omite, se descubren todas." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "archiveEmails",
    description:
      "Archiva en bulk una lista de message IDs (spark action archive). Usar SOLO con IDs que Cal confirmó explícitamente — nunca para priority/personal ni para el resto de no-leídos sin que Cal los haya visto y elegido.",
    inputSchema: {
      type: "object",
      properties: {
        messageIds: { type: "array", items: { type: "string" }, description: "IDs de mensaje a archivar" },
      },
      required: ["messageIds"],
      additionalProperties: false,
    },
  },
];

export interface DiagnosticoCuenta {
  account: string;
  pinnedCount: number;
  archivedCount: number;
  archiveError: string | null;
  unreadNewsletter: string;
  unreadNotification: string;
  personal: string;
  priority: string;
}

// ponytail: usa runSpark (sin auto-open) a propósito — el caller (dispatcher de
// triageInboxDiagnostico) ya hizo un warmup con runSparkAutoOpen antes de loopear cuentas.
// Si cada una de estas ~8 llamadas por cuenta reintentara con open+15s propio, un cold-start
// de Spark sumaría minutos en vez de una sola espera. Si se llega a llamar diagnosticoCuenta
// sin ese warmup previo, volver a runSparkAutoOpen acá.
/** Diagnóstico + archivado automático de una cuenta (skill procesar-inbox, pasos 1-3). */
export async function diagnosticoCuenta(account: string): Promise<DiagnosticoCuenta> {
  const inbox = `${account}:Inbox`;

  const pinnedRes = await runSpark(["emails", inbox, "--filter", "is:pinned", "--page-size", "50"]);
  const pinnedIds = new Set(parseEmailIds(pinnedRes.stdout));

  const readIds = new Set<string>();
  for (const cat of ["newsletter", "notification"]) {
    const r = await runSpark(["emails", inbox, "--filter", `category:${cat} is:read`, "--page-size", "200"]);
    for (const id of parseEmailIds(r.stdout)) if (!pinnedIds.has(id)) readIds.add(id);
  }

  let archivedCount = 0;
  let archiveError: string | null = null;
  if (readIds.size > 0) {
    const r = await runSpark(["action", "archive", ...readIds]);
    if (r.exitCode === 0) archivedCount = readIds.size;
    else archiveError = (r.stderr || r.stdout).slice(0, 500);
  }

  const unreadNewsletter = await runSpark(["emails", inbox, "--filter", "category:newsletter is:unread", "--page-size", "50"]);
  const unreadNotification = await runSpark(["emails", inbox, "--filter", "category:notification is:unread", "--page-size", "50"]);
  const personal = await runSpark(["emails", inbox, "--filter", "category:personal", "--page-size", "50"]);
  const priority = await runSpark(["emails", inbox, "--filter", "category:priority", "--page-size", "50"]);

  return {
    account,
    pinnedCount: pinnedIds.size,
    archivedCount,
    archiveError,
    unreadNewsletter: unreadNewsletter.stdout.trim(),
    unreadNotification: unreadNotification.stdout.trim(),
    personal: personal.stdout.trim(),
    priority: priority.stdout.trim(),
  };
}

const server = new Server(
  { name: "spark", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [...READ_TOOLS, ...WRITE_TOOLS],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const a = (args ?? {}) as Record<string, unknown>;

  try {
    // Read-only tools
    if (name === "listAccounts") {
      return toMcpResponse(await runSparkAutoOpen(["accounts"]));
    }
    if (name === "listFolders") {
      const cli = ["folders", ...(a.account ? [String(a.account)] : [])];
      return toMcpResponse(await runSparkAutoOpen(cli));
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
      return toMcpResponse(await runSparkAutoOpen(cli));
    }
    if (name === "searchEmails") {
      const cli = ["search", String(a.about), ...optFlag("--filter", a.filter), ...optFlag("--in", a.in)];
      return toMcpResponse(await runSparkAutoOpen(cli));
    }
    if (name === "readThread") {
      const cli = ["thread", ...boolFlag("--download-attachments", a.downloadAttachments), String(a.id)];
      return toMcpResponse(await runSparkAutoOpen(cli));
    }
    if (name === "listEvents") {
      const cli = [
        "events",
        ...optFlag("--from", a.from),
        ...optFlag("--to", a.to),
        ...optFlag("--account", a.account),
        ...optFlag("--calendar", a.calendar),
      ];
      return toMcpResponse(await runSparkAutoOpen(cli));
    }
    if (name === "findAvailability") {
      const cli = [
        "availability",
        ...optFlag("--from", a.from),
        ...optFlag("--to", a.to),
        ...optFlag("--duration", a.duration),
        ...repeatFlag("--attendee", a.attendees),
      ];
      return toMcpResponse(await runSparkAutoOpen(cli));
    }
    if (name === "searchContacts") {
      return toMcpResponse(await runSparkAutoOpen(["contacts", String(a.query)]));
    }
    if (name === "listTeams") {
      const cli = ["team", ...(a.team ? [String(a.team)] : [])];
      return toMcpResponse(await runSparkAutoOpen(cli));
    }
    if (name === "listMeetings") {
      const cli = ["meetings", ...optFlag("--from", a.from), ...optFlag("--to", a.to)];
      return toMcpResponse(await runSparkAutoOpen(cli));
    }
    if (name === "readMeeting") {
      return toMcpResponse(await runSparkAutoOpen(["meeting", String(a.id)]));
    }

    // Write tools (require triage access — natural error from CLI otherwise)
    if (name === "createDraft") {
      const cli = [
        "draft",
        ...repeatFlag("--to", a.to),
        ...repeatFlag("--cc", a.cc),
        ...repeatFlag("--bcc", a.bcc),
        ...optFlag("--subject", a.subject),
        ...optFlag("--body", a.body),
        ...optFlag("--account", a.account),
        ...optFlag("--reply-to", a.replyTo),
        ...optFlag("--forward", a.forward),
        ...optFlag("--edit", a.edit),
        ...repeatFlag("--attach", a.attach),
      ];
      return toMcpResponse(await runSparkAutoOpen(cli));
    }
    if (name === "postComment") {
      const cli = ["comment", String(a.threadId)];
      cli.push(
        ...optFlag("--body", a.body),
        ...optFlag("--team", a.team),
        ...repeatFlag("--user", a.users),
        ...repeatFlag("--attach", a.attach),
        ...optFlag("--edit", a.edit),
      );
      return toMcpResponse(await runSparkAutoOpen(cli));
    }
    if (name === "emailAction") {
      const extra = Array.isArray(a.extraArgs) ? a.extraArgs.map(String) : [];
      const cli = ["action", String(a.action), String(a.messageId), ...extra];
      return toMcpResponse(await runSparkAutoOpen(cli));
    }
    if (name === "contactAction") {
      const extra = Array.isArray(a.extraArgs) ? a.extraArgs.map(String) : [];
      const cli = ["contact-action", String(a.action), String(a.email), ...extra];
      return toMcpResponse(await runSparkAutoOpen(cli));
    }
    if (name === "triageInboxDiagnostico") {
      // Warmup único: garantiza que Spark esté abierto ANTES del loop de cuentas (ver
      // comentario ponytail en diagnosticoCuenta) — evita que un cold-start multiplique
      // el retry de 15s por cada una de las ~8 llamadas por cuenta.
      const accRes = await runSparkAutoOpen(["accounts"]);
      let cuentas = Array.isArray(a.cuentas) ? a.cuentas.map(String) : [];
      if (!cuentas.length) cuentas = parseAccountEmails(accRes.stdout);
      const resultados: DiagnosticoCuenta[] = [];
      for (const cuenta of cuentas) {
        try {
          resultados.push(await diagnosticoCuenta(cuenta));
        } catch (err) {
          resultados.push({
            account: cuenta,
            pinnedCount: 0,
            archivedCount: 0,
            archiveError: `Excepción procesando ${cuenta}: ${(err as Error).message}`,
            unreadNewsletter: "",
            unreadNotification: "",
            personal: "",
            priority: "",
          });
        }
      }
      return { content: [{ type: "text" as const, text: JSON.stringify({ cuentas: resultados }, null, 2) }] };
    }
    // ponytail: no valida server-side que los IDs sean de categoría newsletter/notification —
    // la regla "priority/personal nunca se archivan sin confirmación" vive solo en el prompt
    // de Jano (mismo trust model que ya tenía emailAction, no es una regresión). Si algún día
    // se ve un caso real de archivado indebido, la mitigación es un lookup de categoría acá
    // antes de archivar, rechazando priority/personal salvo un flag explícito de "confirmado".
    if (name === "archiveEmails") {
      const ids = Array.isArray(a.messageIds) ? a.messageIds.map(String) : [];
      if (!ids.length) {
        return { isError: true, content: [{ type: "text" as const, text: "messageIds vacío" }] };
      }
      return toMcpResponse(await runSparkAutoOpen(["action", "archive", ...ids]));
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
