# Handoff — BoA Wallet Pass (.pkpass)

**Última actualización:** 2026-07-17. **Para retomar en sesión fresca.**

## Estado: certificado activo, diseño cerrado, probado con un PDF real. Solo falta el scraping en vivo (Task 13).

Referencias: spec `docs/superpowers/specs/2026-07-15-boa-wallet-pass-design.md`, plan `docs/superpowers/plans/2026-07-15-boa-wallet-pass.md` (13 tasks, ejecutado vía subagent-driven-development).

## Completo (Tasks 1–12 + fixes posteriores; commits en `mcp-servers` salvo aclaración)

- **Certificado de Apple Developer activo** (2026-07-17): `~/.claude/secrets/boa-wallet/signerCert.pem`/`signerKey.pem` (chmod 600, NO en el repo), WWDR público commiteado en `servers/boa-checkin/assets/AppleWWDRCAG4.pem`. `apps.env` completo con `BOA_WALLET_PASS_TYPE_ID=pass.net.lepesqueur.boa-checkin`, `BOA_WALLET_TEAM_ID=Y789G689GY` + el resto de las keys.
- **Pipeline completo del MCP `boa-checkin`**: `wallet-pdf417.ts` (decode PDF417 real, verificado round-trip 100%), `wallet-pass.ts` (`buildBoaPassFields`/`signAndPackagePass` — estilo `boardingPass` + `PKTransitTypeAir`, NO `generic` — ver gotchas abajo), `wallet-image.ts` (nuevo — genera la tarjeta `.png` decorativa), scraping en `flow.ts` (`getWalletPassScrapeData`, **aún sin validar contra una reserva real** — regexes best-effort), tool `generateBoaWalletPass` en `index.ts` (devuelve `{ pasajero, pkpassPath, cardImagePath }`).
- **Probado end-to-end con un PDF real** (2026-07-17, sin pasar por scraping en vivo): boarding pass real de Cal (OB688, LPB→VVI) → barcode PDF417 decodificado del PDF oficial → `.pkpass` firmado real → abierto en Wallet de iPhone. Iteración de diseño en vivo con Cal hasta cerrar el layout final (ver "Diseño final" abajo).
- **Assets de marca**: `servers/boa-checkin/assets/boa-icon.png`/`@2x` (swoosh color) y `boa-logo.png`/`@2x` (logo completo blanco monocromo).
- **Jano y Vesta wireados**: `generateBoaWalletPass` en allowedTools; tools `enviarDocumentoLocal` (el `.pkpass`) y `enviarFotoLocal` (la tarjeta `.png`, nueva) — ambas restringen `path` a `tmpdir()` + patrón `boa-wallet-*.{pkpass,png}` con `realpath()` (resuelve symlinks antes de validar).

## Diseño final del `.pkpass` (cerrado 2026-07-17, tras iterar en vivo con Cal)

- Estilo `boardingPass` (no `generic` — se probó, pero perdía el ícono de avión y el divisor perforado, que son features NATIVAS de `boardingPass`+`transitType`, confirmado con una captura real de un pase de LATAM).
- Colores: `backgroundColor` navy `rgb(10,31,61)`, `foregroundColor` blanco `rgb(245,247,250)`, `labelColor` slate `rgb(138,151,179)` — el resto (logo, campos) sigue la estructura nativa de Wallet, que es la MISMA para cualquier aerolínea (esa parte no es personalizable, es una limitación real de Apple, no del código).
- `headerFields`: número de vuelo + fecha (arriba, como un pase real de LATAM).
- `primaryFields`: origen/destino (códigos grandes, automático).
- `secondaryFields`: salida + llegada (si `arrivalTime` está disponible — **no** alineadas bajo cada código como en LATAM: `passkit-generator@3.5.7` solo soporta `row` en pases `eventTicket`, tira error silencioso en `boardingPass`, confirmado probando).
- `auxiliaryFields`: pasajero, abordaje, puerta, grupo, asiento.
- `backFields`: código de reserva, secuencia, clase, aeropuertos completos, contacto, **Elévate** (movido de headerFields al reverso a pedido de Cal).
- **Tarjeta `.png` decorativa** (`wallet-image.ts`, nueva): sigue el mockup HTML original aprobado (navy/dorado, avión rotado, perforado, "Pasajero"+"Elévate" en una fila) — es un archivo APARTE, no reemplaza el `.pkpass`, se manda con `enviarFotoLocal`. El barcode de la imagen es el mismo BCBP real (bwip-js, verificado round-trip). Aprobada por Cal ("hermoso").

## Pendiente

- **Task 13 — Verificación E2E completa**: falta correr el flujo con una reserva real de BoA (`prepareBoaCheckin`→`confirmBoaCheckin`→`generateBoaWalletPass`), no solo con un PDF suelto — eso valida (y probablemente ajusta) los regexes de `getWalletPassScrapeData` contra el DOM real del check-in de BoA. Cal tiene un vuelo el martes (próximo, revisar fecha exacta con él) — ahí se puede probar.

## Primer paso al retomar

1. Preguntarle a Cal si ya hizo el check-in del vuelo del martes (o el que tenga próximo).
2. Pedir locator + apellido, correr `prepareBoaCheckin` → `confirmBoaCheckin` → `generateBoaWalletPass` real (no el script de prueba con PDF suelto).
3. Si `getWalletPassScrapeData` falla o trae datos raros: loguear `rowText` (ya tiene un comentario explícito en el código para esto) y ajustar los regex al texto real del DOM.
4. Confirmar con Cal que el `.pkpass` + la tarjeta llegan bien por Telegram y se ven como espera.

## Gotchas para la próxima sesión

- **`passkit-generator@3.5.7` (y el pre-release 3.6.0-alpha.1) solo permite `row` en `auxiliaryFields` para pases tipo `eventTicket`** — en `boardingPass` tira `ValidationError` y descarta el campo EN SILENCIO (no rompe el pase, simplemente el campo no aparece). Si en el futuro se quiere alinear salida/llegada bajo cada código de aeropuerto (como LATAM), habría que migrar a `eventTicket` o esperar una versión que lo soporte — no intentar `row` en `boardingPass` de nuevo sin verificar la versión instalada primero.
- **Telegram `sendPhoto` recomprime a JPEG y pierde transparencia** — por eso `enviarFotoLocal` usa `sendDocument`, no `sendPhoto`. Si se agrega algún otro envío de imagen con transparencia (esquinas redondeadas, etc.), aplicar el mismo criterio.
- **`enviarDocumentoLocal`/`enviarFotoLocal` resuelven symlinks con `realpath()`** antes de validar el path (hardening agregado 2026-07-17, hallazgo de `daemon-health-reviewer`) — no simplificar de vuelta a solo `resolve()`.
- El certificado de firma (`signerKey.pem`) NUNCA debe terminar en el repo git — solo en `~/.claude/secrets/boa-wallet/`.
- Los regexes de `getWalletPassScrapeData` (flow.ts) siguen sin validar contra el DOM real — primera vez que se corra contra una reserva real, esperar tener que ajustar.
- Playwright (para `wallet-image.ts`) ya era dependencia de `boa-checkin` (se usa también para el check-in real) — no hace falta instalar nada nuevo. `bwip-js` pasó de devDependency a dependency (ahora se usa en runtime, no solo en tests).
