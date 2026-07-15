# Diseño — Generador de Apple Wallet pass (.pkpass) para boarding passes BoA

## Objetivo

Agregar una tool `generateBoaWalletPass` al MCP `boa-checkin` que, a pedido (no automático), genere un archivo `.pkpass` (Apple Wallet) con el boarding pass de un pasajero cuyo check-in de BoA ya está confirmado, para que Jano/Vesta lo entreguen por Telegram junto con — o en vez de — el PDF actual.

Referencia original: handoff Notion "handoff-boa-wallet-pass" (decisiones sobre Pass Type ID, ausencia de `webServiceURL`, formato de barcode ya tomadas ahí y heredadas en este spec).

## Decisiones ya tomadas (no repreguntar)

- **Trigger:** tool separada (`generateBoaWalletPass`), llamada explícita del LLM cuando Cal pide el pase de Wallet. Las tools existentes (`confirmBoaCheckin`, `getBoaBoardingPass`) no cambian de comportamiento.
- **Barcode:** debe ser escaneable de verdad en el gate — mismo string BCBP que el PDF oficial de BoA, no un barcode decorativo. Esto implica decodificar el PDF417 del PDF real.
- **Apple Developer setup** (Pass Type ID `pass.com.lepesqueur.boaboarding` o similar, certificado `.p12`): lo resuelve Cal directamente en developer.apple.com, fuera de este flujo. Este spec asume que el `.p12` + contraseña + Pass Type ID + Team ID van a existir como secretos ya generados.
- **Secretos:** vía `apps.env` (mismo archivo compartido que el resto de tokens cross-agente), no un archivo dedicado.
- **Sin `webServiceURL`:** cada pase se genera fresco al momento del pedido; no hay push updates ni servidor de actualización.

## Arquitectura — pipeline de 5 pasos

1. **Llegar a los datos del boarding pass** reusando el mismo camino de Playwright que `getBoaBoardingPass` (`openManageBooking` → "View boarding passes" → fila del pasajero). De esa pantalla se extraen dos cosas en paralelo:
   - la URL pública del PDF (`downloadBoardingPassRow`, ya existente)
   - los campos visibles por scraping de DOM/texto: ruta (origen→destino), fecha, hora de salida, hora de abordaje, asiento, grupo de abordaje, clase. **No** se necesita un parser de BCBP para estos campos — ya están en pantalla.
2. **Descargar el PDF** desde la URL obtenida en el paso 1.
3. **Decodificar el PDF417** del PDF para obtener el string BCBP crudo — usado ÚNICAMENTE como payload del barcode del `.pkpass`, no para los campos visuales.
4. **Armar y firmar el `.pkpass`** con `passkit-generator`: `pass.json` (tipo `boardingPass`, `transitType: PKTransitTypeAir`) poblado con los campos del paso 1, barcode `{ format: "PKBarcodeFormatPDF417", message: <string del paso 3> }`, logo/ícono de BoA como assets, firmado con el cert de Cal + WWDR intermedio de Apple.
5. **Guardar el `.pkpass` en disco** (`os.tmpdir()`, nombre `boa-wallet-<locator>-<pasajero>.pkpass`) y devolver `{ pasajero, pkpassPath }` — Jano/Vesta lo entrega con `sendDocument` usando el path local (no URL pública, a diferencia del PDF).

## Componentes técnicos

### Decodificación PDF417 (paso 3)

**Elegido: pipeline 100% Node/TS**, sin subproceso Python:
- `pdfjs-dist` + `@napi-rs/canvas` — renderiza la página del PDF a imagen de alta resolución. `@napi-rs/canvas` se prefiere sobre `node-canvas` porque trae binarios precompilados para macOS ARM (evita depender de cairo/pango del sistema).
- `zxing-wasm` — decodifica el PDF417 de esa imagen vía WASM (puerto de zxing-cpp), sin instalación nativa.

**Fallback documentado (no implementar salvo que A falle en la práctica):** subprocess Python con `PyMuPDF` (render) + `zxing-cpp` bindings Python (decode) — mismo patrón ya usado en el MCP `worldcup` para invocar el Predictor Mundial.

### Armado y firma del pase (paso 4)

- `passkit-generator` (npm) maneja `pass.json`, `manifest.json` (SHA1 de cada archivo del paquete), la firma PKCS#7 con el `.p12` + WWDR, y el zip final `.pkpass`.
- Assets de marca (logo/ícono BoA): se buscan y se muestran a Cal para aprobación antes de empaquetarlos.
- Layout de campos (mockup ya descrito por Cal, pendiente de render visual):
  - Header: logo BoA
  - Primary: ruta origen→destino con ícono de avión
  - Secondary: hora de salida (grande/prominente)
  - Auxiliary: grupo de abordaje / gate / asiento
  - Barcode: PDF417 al pie

### Config / secretos

En `apps.env`:
- `BOA_WALLET_PASS_TYPE_ID`
- `BOA_WALLET_TEAM_ID`
- `BOA_WALLET_P12_PATH` (o el `.p12` en base64 si no se quiere un archivo aparte)
- `BOA_WALLET_P12_PASSWORD`

El MCP los lee como env vars, mismo patrón que otros servers (`HEALTH_API_KEY`, `SERPAPI_KEY`, etc.).

## Manejo de errores

- PDF417 no decodifica (imagen borrosa, resolución insuficiente) → error explícito. Nunca generar un pase con barcode vacío o inventado.
- Falta config (cert/Pass Type ID no seteados en `apps.env`) → error claro al llamar la tool, no fallback silencioso.
- Tramo sin check-in confirmado → reusa la misma validación/error que ya tira `getBoaBoardingPass` hoy.

## Integración con daemons

- Agregar `mcp__boa-checkin__generateBoaWalletPass` a `allowedTools` de Jano/Vesta (los daemons que ya tienen `boa-checkin` wireado).
- Instrucción de system prompt: ante pedidos tipo "dame el wallet pass"/"agrégalo a Wallet", llamar esta tool y entregar el archivo con `sendDocument` usando el path local devuelto (no tratar el resultado como URL).

## Testing

- Unit tests (mismo patrón que `travelers.test.ts`/`missing-fields.test.ts`) para el armado de `pass.json` a partir de datos de ejemplo fijos — sin depender de Chrome real ni de un PDF real.
- Prueba end-to-end manual: generar el pase de un vuelo real de Cal, abrirlo en Safari, agregarlo a Wallet, comparar visualmente contra el PDF oficial. Validación de que el barcode escanea igual que el PDF queda pendiente de una prueba en un gate real (no se puede automatizar).

## Primer paso de implementación

Generar el mockup visual (imagen) del layout descrito arriba con el skill de diseño (Gemini) para aprobación de Cal, ANTES de tocar cualquier código del pipeline. Recién después de aprobado el mockup se pasa a `writing-plans` para el plan de implementación técnico.

## Fuera de alcance (explícito)

- `webServiceURL` / push updates del pase (decisión ya tomada en el handoff original: cada pase se genera fresco, sin servidor de actualización).
- Automatizar la generación del Pass Type ID / certificado en Apple Developer (lo hace Cal manualmente).
- Validar el escaneo del barcode en un gate real de BoA (queda como prueba pendiente, no bloqueante para el resto del pipeline).
