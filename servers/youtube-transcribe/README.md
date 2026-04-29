# mcp-youtube-transcribe

MCP server para obtener transcripts de videos de YouTube. Tool único: `transcribeYoutube`.

## Estrategia 2 fases

1. **Caption fast-path (~5-30s):** baja captions del video con `yt-dlp --write-subs --write-auto-subs` (manuales o auto-generados de YouTube). Parsea SRT y devuelve texto. `source: "caption"`.
2. **Whisper fallback (1-5 min):** baja audio como WAV 16kHz mono con yt-dlp + ffmpeg post-processing, transcribe con `whisper-cli` local. `source: "whisper"`.

Cachea resultados por `videoId+lang+model` en `/tmp/yt-transcribe-cache/`. Subsecuentes lecturas → `source: "cache"`.

## Tool: `transcribeYoutube`

```jsonc
{
  "url": "https://www.youtube.com/watch?v=...",  // requerido
  "lang": "es",            // opcional, default "es" (whisper codes: es|en|pt|fr|de|it|ja|zh|...)
  "paragraphs": true,      // opcional, default true (chunks ~80 palabras separados por \n\n)
  "model": "small",        // opcional, "small" (default) | "base" — solo afecta el fallback whisper
  "forceWhisper": false    // opcional, default false. Si true, salta el caption fast-path
}
```

Retorna:

```jsonc
{
  "videoId": "dQw4w9WgXcQ",
  "url": "https://...",
  "lang": "es",
  "source": "cache" | "caption" | "whisper",
  "text": "transcript completo (con o sin párrafos según arg)",
  "charCount": 12345,
  "captionLang": "es-419",   // solo si source="caption"; idioma real del caption usado
  "durationSec": 23           // solo si source != "cache"
}
```

## Dependencias

- `yt-dlp` (`brew install yt-dlp`)
- `whisper-cli` (`brew install whisper-cpp`) + modelos `ggml-small.bin` y/o `ggml-base.bin` en `/opt/homebrew/Cellar/whisper-cpp/*/share/whisper-cpp/models/`
- `ffmpeg` (`brew install ffmpeg`)
- Node 22+

## Build

```bash
cd "~/Claude Projects/Personal/MCP Servers/mcp-servers"
npm install
npm -w mcp-youtube-transcribe run build
```

## Smoke test (stdio)

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node servers/youtube-transcribe/dist/index.js
```

Debe devolver el schema del tool.

## Registro global

`~/.claude/.mcp.json`:

```json
{
  "mcpServers": {
    "youtube-transcribe": {
      "type": "stdio",
      "command": "node",
      "args": [
        "/Users/calepes/Claude Projects/Personal/MCP Servers/mcp-servers/servers/youtube-transcribe/dist/index.js"
      ]
    }
  }
}
```

Disponible en todas las sesiones interactivas + daemons que hereden MCPs (CoS v2, Vesta v2, Pecunia v2). El nombre del tool en el cliente: `mcp__youtube-transcribe__transcribeYoutube`.

## Notas

- **Captions auto-generados de YouTube** son legibles pero no perfectos — typos, sin puntuación correcta. Si la calidad importa, usar `forceWhisper: true`.
- **Videos largos** (>1 hora) en whisper pueden tardar varios minutos y consumir RAM. El timeout interno es 10 min para whisper, 5 min para yt-dlp.
- **Cache:** se preserva entre runs. Limpiar manual si es necesario: `rm -rf /tmp/yt-transcribe-cache/`.
- **Formatos de URL soportados:** `youtube.com/watch?v=`, `youtu.be/`, `youtube.com/shorts/`, `youtube.com/embed/`, `youtube.com/live/`.
