#!/usr/bin/env node
// MCP server: youtube-transcribe
// Tool: transcribeYoutube({ url, lang?, paragraphs? })
// Pipeline: yt-dlp extrae audio WAV → whisper-cli transcribe → texto.
// Cache por videoId+lang en /tmp/yt-transcribe-cache/ para evitar re-bajar.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { spawn, execSync } from "node:child_process";
import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const YT_DLP = "/opt/homebrew/bin/yt-dlp";
const WHISPER_CLI = "/opt/homebrew/bin/whisper-cli";
const CACHE_DIR = "/tmp/yt-transcribe-cache";

function findWhisperModel(preferred: "small" | "base" = "small"): string {
  // /opt/homebrew/Cellar/whisper-cpp/<version>/share/whisper-cpp/models/ggml-<x>.bin
  const variants = preferred === "small" ? ["small", "base"] : ["base", "small"];
  for (const v of variants) {
    try {
      const out = execSync(
        `ls /opt/homebrew/Cellar/whisper-cpp/*/share/whisper-cpp/models/ggml-${v}.bin 2>/dev/null | head -1`,
        { encoding: "utf8" },
      ).trim();
      if (out) return out;
    } catch {
      // continue
    }
  }
  throw new Error("No whisper-cpp model found in /opt/homebrew/Cellar/whisper-cpp/*/share/whisper-cpp/models/");
}

function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?(?:.*&)?v=)([a-zA-Z0-9_-]{11})/,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/live\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const re of patterns) {
    const m = url.match(re);
    if (m) return m[1];
  }
  return null;
}

function runCmd(
  cmd: string,
  args: string[],
  opts: { timeoutMs?: number; cwd?: string } = {},
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let killed = false;
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          killed = true;
          child.kill("SIGKILL");
        }, opts.timeoutMs)
      : null;
    child.stdout?.on("data", (d) => (stdout += d.toString()));
    child.stderr?.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (killed) {
        reject(new Error(`Command ${cmd} timed out after ${opts.timeoutMs}ms`));
        return;
      }
      resolve({ stdout, stderr, code: code ?? -1 });
    });
  });
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

function splitParagraphs(text: string, maxWordsPerPara = 80): string {
  const sentences = text
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.?!])\s+/);
  const paras: string[] = [];
  let buf: string[] = [];
  let words = 0;
  for (const s of sentences) {
    const wc = s.split(/\s+/).length;
    buf.push(s);
    words += wc;
    if (words >= maxWordsPerPara) {
      paras.push(buf.join(" "));
      buf = [];
      words = 0;
    }
  }
  if (buf.length) paras.push(buf.join(" "));
  return paras.join("\n\n");
}

interface TranscribeArgs {
  url: string;
  lang?: string;
  paragraphs?: boolean;
  model?: "small" | "base";
  forceWhisper?: boolean;
}

interface TranscribeResult {
  videoId: string;
  url: string;
  lang: string;
  source: "cache" | "caption" | "whisper";
  text: string;
  charCount: number;
  durationSec?: number;
  captionLang?: string;
}

function extractTextFromSrt(srt: string): string {
  // SRT block: \nNUMBER\nHH:MM:SS,mmm --> HH:MM:SS,mmm\nTEXT[\nMORE_TEXT]\n\n
  return srt
    .split(/\r?\n\r?\n/)
    .map((block) => {
      const lines = block.split(/\r?\n/);
      if (lines.length < 3) return "";
      // skip number line + timestamp line
      const text = lines
        .slice(2)
        .join(" ")
        // strip basic SRT/VTT styling tags
        .replace(/<[^>]+>/g, "")
        .replace(/\{[^}]+\}/g, "")
        .trim();
      return text;
    })
    .filter((t) => t.length > 0)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

async function tryGetCaptions(
  url: string,
  lang: string,
  tmpDir: string,
): Promise<{ text: string; lang: string } | null> {
  const subPrefix = path.join(tmpDir, "captions");
  // Priorizamos: idioma exacto, variantes (es-419, en-US), auto-translate, cualquiera
  const langPriority = [lang, `${lang}-orig`, `${lang}-.*`, "en", "en-.*"].join(",");
  const res = await runCmd(
    YT_DLP,
    [
      "--impersonate", "Safari-18.0",
      "--skip-download",
      "--write-subs",
      "--write-auto-subs",
      "--sub-langs",
      langPriority,
      "--convert-subs",
      "srt",
      "--no-playlist",
      "-o",
      `${subPrefix}.%(ext)s`,
      url,
    ],
    { timeoutMs: 60_000 },
  );
  if (res.code !== 0) return null;

  const files = await fs.readdir(tmpDir);
  // Match: captions.<lang>.srt — preferimos el idioma solicitado primero
  const srtFiles = files.filter((f) => f.startsWith("captions.") && f.endsWith(".srt"));
  if (srtFiles.length === 0) return null;

  const preferred =
    srtFiles.find((f) => f.startsWith(`captions.${lang}.`)) ??
    srtFiles.find((f) => f.startsWith(`captions.${lang}-`)) ??
    srtFiles[0];

  const langMatch = preferred.match(/^captions\.([^.]+)\.srt$/);
  const captionLang = langMatch ? langMatch[1] : "unknown";

  const srt = await fs.readFile(path.join(tmpDir, preferred), "utf8");
  const text = extractTextFromSrt(srt);
  if (text.length === 0) return null;

  return { text, lang: captionLang };
}

async function transcribeYoutube(args: TranscribeArgs): Promise<TranscribeResult> {
  const lang = args.lang ?? "es";
  const paragraphs = args.paragraphs ?? true;
  const modelChoice = args.model ?? "small";

  const videoId = extractVideoId(args.url);
  if (!videoId) {
    throw new Error(`No pude extraer videoId de la URL: ${args.url}`);
  }

  await ensureDir(CACHE_DIR);
  const cacheFile = path.join(CACHE_DIR, `${videoId}-${lang}-${modelChoice}.txt`);

  if (existsSync(cacheFile)) {
    const cached = await fs.readFile(cacheFile, "utf8");
    return {
      videoId,
      url: args.url,
      lang,
      source: "cache",
      text: paragraphs ? splitParagraphs(cached) : cached,
      charCount: cached.length,
    };
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `yt-transcribe-${videoId}-`));
  const audioOut = path.join(tmpDir, "audio.wav");
  const wakeStart = Date.now();

  try {
    // 1) Caption fast path: intentar bajar subtítulos del video (manuales o auto)
    if (!args.forceWhisper) {
      const captions = await tryGetCaptions(args.url, lang, tmpDir);
      if (captions) {
        await fs.writeFile(cacheFile, captions.text, "utf8");
        return {
          videoId,
          url: args.url,
          lang,
          source: "caption",
          text: paragraphs ? splitParagraphs(captions.text) : captions.text,
          charCount: captions.text.length,
          durationSec: Math.round((Date.now() - wakeStart) / 1000),
          captionLang: captions.lang,
        };
      }
    }

    // 2) Whisper fallback: bajar audio + transcribir
    const modelPath = findWhisperModel(modelChoice);

    const dlpRes = await runCmd(
      YT_DLP,
      [
        "--impersonate", "Safari-18.0",
        "-x",
        "--audio-format",
        "wav",
        "--postprocessor-args",
        "ffmpeg:-ar 16000 -ac 1",
        "--no-playlist",
        "-o",
        path.join(tmpDir, "audio.%(ext)s"),
        args.url,
      ],
      { timeoutMs: 5 * 60 * 1000 },
    );
    if (dlpRes.code !== 0) {
      throw new Error(`yt-dlp falló (code ${dlpRes.code}): ${dlpRes.stderr.slice(-500)}`);
    }
    if (!existsSync(audioOut)) {
      // yt-dlp puede generar otro nombre si el video tiene caracteres especiales
      const files = await fs.readdir(tmpDir);
      const wav = files.find((f) => f.endsWith(".wav"));
      if (!wav) {
        throw new Error(`yt-dlp no produjo .wav en ${tmpDir}. Files: ${files.join(", ")}`);
      }
      await fs.rename(path.join(tmpDir, wav), audioOut);
    }

    // 2) whisper-cli: transcribir
    const outPrefix = path.join(tmpDir, "out");
    const whisperRes = await runCmd(
      WHISPER_CLI,
      [
        "-m",
        modelPath,
        "-l",
        lang,
        "-nt", // no timestamps
        "-otxt",
        "-of",
        outPrefix,
        "-f",
        audioOut,
      ],
      { timeoutMs: 10 * 60 * 1000 },
    );
    if (whisperRes.code !== 0) {
      throw new Error(`whisper-cli falló (code ${whisperRes.code}): ${whisperRes.stderr.slice(-500)}`);
    }

    const txtFile = `${outPrefix}.txt`;
    if (!existsSync(txtFile)) {
      throw new Error(`whisper-cli no produjo ${txtFile}`);
    }
    const transcriptRaw = (await fs.readFile(txtFile, "utf8")).trim();

    // Cache fresh result
    await fs.writeFile(cacheFile, transcriptRaw, "utf8");

    return {
      videoId,
      url: args.url,
      lang,
      source: "whisper",
      text: paragraphs ? splitParagraphs(transcriptRaw) : transcriptRaw,
      charCount: transcriptRaw.length,
      durationSec: Math.round((Date.now() - wakeStart) / 1000),
    };
  } finally {
    // Cleanup tmp dir (cache se preserva aparte)
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

// ---------- MCP Server ----------

const server = new Server(
  {
    name: "youtube-transcribe",
    version: "0.1.0",
  },
  {
    capabilities: { tools: {} },
  },
);

const TOOL_SCHEMA = {
  type: "object",
  properties: {
    url: {
      type: "string",
      description: "URL de YouTube (formato youtube.com/watch?v=, youtu.be/, shorts/, embed/, live/).",
    },
    lang: {
      type: "string",
      description: "Idioma del audio (códigos whisper: es, en, pt, fr, de, it, ja, zh, etc.). Default: es.",
    },
    paragraphs: {
      type: "boolean",
      description: "Si true (default), parte el transcript en párrafos de ~80 palabras separados por \\n\\n. Si false, devuelve el texto crudo en una sola línea.",
    },
    model: {
      type: "string",
      enum: ["small", "base"],
      description: "Modelo whisper-cpp para el fallback (solo se usa si el video no tiene captions). small = mejor precisión (default), base = más rápido y menor uso RAM.",
    },
    forceWhisper: {
      type: "boolean",
      description: "Si true, salta el fast-path de captions y va directo a whisper. Útil si los captions auto-generados son de mala calidad. Default: false.",
    },
  },
  required: ["url"],
} as const;

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "transcribeYoutube",
      description:
        "Obtiene el transcript de un video de YouTube. Estrategia en 2 fases: (1) intenta primero bajar los captions del video (manuales o auto-generados de YouTube) — esto es instantáneo (~5-30s); (2) si no hay captions disponibles, cae al fallback de bajar el audio y transcribirlo con whisper-cpp local (1-5 min según duración). Cachea resultados por videoId+lang+model en /tmp/yt-transcribe-cache/. Devuelve { videoId, text, charCount, source: 'cache'|'caption'|'whisper', captionLang?, durationSec? }. Cuando source='caption', captionLang indica el idioma real del caption usado (puede ser distinto al lang solicitado si solo había en otro idioma).",
      inputSchema: TOOL_SCHEMA,
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "transcribeYoutube") {
    return {
      isError: true,
      content: [{ type: "text", text: `Unknown tool: ${request.params.name}` }],
    };
  }

  const args = (request.params.arguments ?? {}) as unknown as TranscribeArgs;
  if (!args.url || typeof args.url !== "string") {
    return {
      isError: true,
      content: [{ type: "text", text: "Argumento 'url' requerido (string)." }],
    };
  }

  try {
    const result = await transcribeYoutube(args);
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
    };
  } catch (err) {
    return {
      isError: true,
      content: [{ type: "text", text: `Error transcribiendo: ${(err as Error).message}` }],
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
