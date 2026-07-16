# Handoff — BoA Wallet Pass (.pkpass)

**Fecha:** 2026-07-16. **Para retomar en sesión fresca.**

## Estado: código 100% listo. Bloqueado solo en insumos de Cal (Apple Developer).

Referencias: spec `docs/superpowers/specs/2026-07-15-boa-wallet-pass-design.md`, plan `docs/superpowers/plans/2026-07-15-boa-wallet-pass.md` (13 tasks, ejecutado vía subagent-driven-development).

## Completo (Tasks 2–10, 12; commits en `mcp-servers` salvo aclaración)

- **Pipeline completo del MCP `boa-checkin`**: `wallet-pdf417.ts` (render PDF→píxeles + decode PDF417 vía pdfjs-dist/@napi-rs/canvas/zxing-wasm), `wallet-pass.ts` (config loader, `buildBoaPassFields`, `signAndPackagePass` con passkit-generator — API verificada contra el paquete instalado, no adivinada), scraping en `flow.ts` (`getWalletPassScrapeData`, **sin validar contra una reserva real todavía** — regexes best-effort, marcado explícito en el código), y el tool `generateBoaWalletPass` wireado en `index.ts`.
- **Assets de marca aprobados y commiteados** (`b6435ad`): `servers/boa-checkin/assets/boa-icon.png`/`@2x` (swoosh en color, para notificaciones) y `boa-logo.png`/`@2x` (logo completo BoA en monocromo blanco, para mostrarse directo sobre el navy de la tarjeta sin marco — diseño final aprobado por Cal).
- **Jano y Vesta wireados** (`16fd99e`/`33dc19f` + fix `d320728`/`14a502c`): tool `generateBoaWalletPass` en allowedTools, nueva tool `enviarDocumentoLocal` (sube un archivo LOCAL a Telegram vía multipart — `enviarDocumentoUrl` solo sirve para URLs públicas). **Fix de seguridad aplicado**: `enviarDocumentoLocal` restringe el `path` a `tmpdir()` + patrón `boa-wallet-*.pkpass` (hallazgo bloqueante de `daemon-health-reviewer`: sin esa validación, el path venía sin restricción del LLM → lectura+exfiltración arbitraria de archivos locales vía Telegram ante un prompt-injection).
- **Bonus**: de paso se encontró y commiteó ~3 sesiones de trabajo previo sin commitear (multi-tramo de boa-checkin, auditoría de seguridad de Jano 14-15/jul con remoción de `runBriefing`, wiring espejo en Vesta) — todo verificado con build+test antes de commitear.
- **Mockup visual aprobado**: https://claude.ai/code/artifact/9adb2360-3a2c-48c1-bb01-b500421d75a2 (navy/dorado, logo BoA completo en blanco sin marco, avión apuntando al destino, reverso con tap-to-flip, número de Elévate real de Cal: **1004032503**, fuente `~/.claude/datos-viaje.md` línea 45).

## Pendiente — bloqueado por insumos de Cal

- **Task 1 — Certificado Apple**: Cal debe generar el Pass Type ID + `.p12` en developer.apple.com (decisión ya tomada: lo hace él mismo, no vía browser automation). Después extraer PEM cert+key con `openssl` (comandos exactos en el plan, Task 1) a `~/.claude/secrets/boa-wallet/` (chmod 600, **NO va al repo** — solo el WWDR público de Apple sí se commitea).
- **Task 11 — `apps.env`**: agregar `BOA_WALLET_PASS_TYPE_ID`, `BOA_WALLET_TEAM_ID`, `BOA_WALLET_SIGNER_CERT_PATH`, `BOA_WALLET_SIGNER_KEY_PATH`, `BOA_WALLET_SIGNER_KEY_PASSPHRASE`, `BOA_WALLET_WWDR_PATH` — depende de Task 1.
- **Task 13 — Verificación E2E manual**: generar el pase de un vuelo real de Cal, abrirlo en Safari/Wallet, comparar el barcode contra el PDF oficial. Acá también es donde hay que validar (y probablemente ajustar) los regexes de `getWalletPassScrapeData` contra el DOM real de BoA — no se pudo hacer antes por falta de una reserva confirmada durante la sesión.

## Primer paso al retomar

1. Preguntarle a Cal si ya tiene el Pass Type ID + `.p12`.
2. Si sí → ejecutar Task 1 (extracción openssl) → Task 11 (apps.env) → rebuild+restart de Jano o Vesta (con Cal presente, nunca autónomo) → Task 13 con una reserva real.
3. Si no → nada que hacer del lado de código; el pipeline entero ya compila y pasa tests (22/22 en `boa-checkin`, 71/71 Jano, 36/36 Vesta).

## Gotchas para la próxima sesión

- `enviarDocumentoLocal` es nueva en Jano/Vesta — solo acepta paths `boa-wallet-*.pkpass` dentro de `tmpdir()`, por diseño (seguridad). No aflojar esa validación sin pensarlo dos veces.
- El certificado de firma (`signerKey.pem`) NUNCA debe terminar en el repo git — solo en `~/.claude/secrets/boa-wallet/`.
- Los regexes de `getWalletPassScrapeData` (flow.ts) son un placeholder razonado, no probado — primera vez que se corra contra una reserva real, esperar tener que ajustar (`console.log(rowText)` y mirar el texto real).
