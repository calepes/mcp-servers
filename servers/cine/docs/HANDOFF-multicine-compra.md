# Handoff — Habilitar compra automatizada en Multicine (Las Brisas)

**Fecha:** 2026-07-26 · **Estado:** recon en vivo EN CURSO — paso 3 completo, 2 de 3 preguntas de
factibilidad respondidas (falta ver si entrega QR).

## Objetivo
Agregar compra de entradas de **Multicine** (Las Brisas) al MCP cine. Hoy el MCP solo compra en
**Cinemark**; Multicine y Cine Center son cartelera-only. Multicine quedó fuera en el diseño v2
porque el recon del 2026-07-24 se frenó en un "formulario de comprador obligatorio" (nunca se
confirmó si exige cuenta ni si entrega QR). Este trabajo retoma ese recon con datos en vivo para
decidir factibilidad y, si va, escribir el adapter.

## Hallazgos del recon (verificados hoy, en vivo)

1. **El WAF CINEsync se pasa con Chrome real** (`chromium.launch({ channel: "chrome" })`), igual que
   la cartelera. `403? false`. **NO usar el Chromium propio de Playwright** (da 403), ni el MCP
   Browser in-app / plugin Playwright si corren Chromium.

2. **El flujo de compra es navegación por URLs Next.js/CINEsync, no clicks opacos** — se puede
   pilotar por `page.goto()`:
   - buy-tickets: `https://www.multicine.com.bo/es-BO/buy-tickets?location=santa-cruz&locationKey=5`
   - Cada horario es un `<a class="pc-show-time">` con `href` directo al seat-plan:
     `/es-BO/movies/{slug}/showtimes/{YYYY-MM-DD}/santa-cruz/seat-plan?showtime={token}`
   - ⚠️ El `showtime={token}` es **efímero** (base64, caduca) → tomarlo **fresco** de buy-tickets
     justo antes de navegar, no cachearlo.
   - El `slug` de película es el de CINEsync (ej. `the-odyssey-2026`), distinto del título. Sale del
     `href` de `.pc-movie-image-wrap` / `.pc-show-time` en la row de la película, no hay que
     adivinarlo.

3. **seat-plan** (`.../seat-plan?showtime=...`): mapa con ~1434 nodos, contenedor
   `.seatmapcontainer`, leyenda `Disponible / No disponible / Seleccionado / Asiento estándar`,
   contador `Entradas totales: N`, botones `<a>Atrás</a>` y `<a>Continuar</a>` (clase `btn-disable`
   hasta seleccionar al menos un asiento). El header global tiene un link "Iniciar sesión" — **falta
   confirmar si el login es obligatorio en el checkout o solo un extra del nav.**

## Recon paso 3 — COMPLETO (2026-07-26)

Flujo real de principio a fin, verificado en vivo con `recon4-multicine.mjs` (sucesor de recon3,
mismo directorio):

buy-tickets → seat-plan (selecciona asiento) → **Continuar** → select-tickets (elegir tipo/cantidad
de entrada, botón `+` es `button.circularPrimary`) → **Continuar** → `/concession/{ciudad}` (candy
bar opcional) → **Continuar** (esto SOLO abre un panel/modal client-side "Mi pedido" — la URL no
cambia; el botón real está DENTRO de `.myorderwrap`, no en la barra fija de abajo, que tiene otro
`Continuar` casi en el mismo Y que confunde a un click por posición) → **Continuar** (el de dentro
del modal) → navega a `/order/{orderId}/redemptions` → **acá está el "formulario obligatorio"**.

**Las 3 preguntas de factibilidad:**
1. **¿Login obligatorio o invitado?** → **Invitado. NO es obligatorio crear cuenta.** La página
   tiene un login opcional arriba ("Acceso") pero el botón real para seguir sin cuenta es
   **`Continúa como invitado`** (visible y funcional, no bloqueado).
2. **Campos que pide:** `firstName`, `lastName` (con selector de título "Sr."), `email`, `phone`
   (+591 preseteado), `documentType` (select: Carnet de identidad / Tarjeta de identidad de
   extranjeros / Pasaporte / Otro documento de identidad / NIT), `documentValue`, `companyName`
   (solo si NIT), checkbox opcional de newsletter. Ninguno tenía `required` en el DOM (validación
   probablemente client-side al submit, no confirmado cuáles son realmente obligatorios).
3. **¿Entrega QR?** → **AÚN SIN RESPONDER** — es el siguiente paso pendiente. Hay que llenar el
   form de invitado con datos de prueba y click "Continúa como invitado" para ver si lleva a un QR
   de pago (como Cinemark) o a una pasarela externa.

**Gotcha de automatización (importante para el adapter):** el flujo tiene DOS controles de texto
"Continuar" simultáneos en varias pantallas — uno en la barra fija inferior y otro (real) dentro de
overlays/modales que se abren client-side sin cambiar la URL. Un selector genérico
`text=Continuar` con `.first()` engancha el equivocado. Hay que acotar por contenedor
(`.myorderwrap` para el modal "Mi pedido") o por posición runtime, no por orden de aparición en el
DOM. Mismo patrón puede repetirse en el paso del formulario de invitado — verificar antes de asumir.

**Timer de reserva:** ~10 min ("minutos restantes") corriendo desde que se selecciona el asiento —
igual que Cinemark, la sesión de recon debe ser rápida o el asiento se libera solo.

**Reservas verificadas hoy (liberadas solas, no se completó pago):** Asientos A26, A27, B26, B28,
B27 (una por cada corrida de prueba) en La Odisea, función de hoy 11:00 Sala 1.

## Recon paso 5 — hallazgo importante (2026-07-26): invitado SÍ, pero con verificación OTP por email

Llenar el formulario (`recon5-multicine.mjs`) y click en el botón real —el texto es **"Continua
como invitado"**, SIN tilde, un selector con tilde no matchea— avanza, pero antes de cualquier
pantalla de pago aparece:

> **Verifique su ID de correo electrónico** — Se ha enviado una contraseña de un solo uso (OTP) a
> su correo electrónico. Ingrese el código a continuación para verificar su correo electrónico y
> continuar. `Código de verificación*` + botón `Verificar` / `Reenviar`.

Es decir: **el "invitado" de Multicine no es anónimo puro — exige poder recibir y leer un código
OTP en la casilla de correo indicada**, antes de llegar a cualquier pantalla de pago/QR. Con el
email de prueba (`recon.multicine@example.com`, no real) el recon se frena acá — no hay forma de
verificar. **No se sabe todavía si después del OTP aparece un QR (como Cinemark) o una pasarela de
tarjeta**, porque no se pudo pasar ese paso.

**Esto cambia la factibilidad:** para automatizar la compra completa hay que decidir con Cal:
- Usar un email real que el MCP pueda leer en vivo (IMAP/API) para sacar el código OTP —agrega una
  dependencia nueva (cuenta + credenciales de esa casilla) que Cinemark no necesitó.
- O aceptar que este último tramo (ingresar el código OTP) lo haga Cal a mano, como el pago mismo.

**Actualización (mismo día): recon completado hasta el final — respuesta a la pregunta 3.**

Con el email real de Cal (`carlos@lepesqueur.net`) y `spark` (CLI de Spark Desktop) para leer el
OTP en vivo, se pasó el paso de verificación (`spark emails ... --filter "from:noreply@multicine.com.bo"`
→ `spark thread <id>` → el código viene en negrita: `"...minutos:** 128066**"`, extraído con
`/\*\*\s*(\d{4,8})\s*\*\*/`. Gotcha: pedir el correo MÁS NUEVO que un `baselineId` tomado ANTES de
disparar el envío — si no, se puede reusar por error el OTP de una corrida anterior y falla con
"Código OTP no válido").

Tras el OTP se llega a `/order/{id}/checkout`, con:

```
Seleccione su opción de pago para continuar
[pago en línea]
☐ No soy un robot   (reCAPTCHA v2 checkbox, visible)
[Paga Bs69.50 ahora]  (deshabilitado hasta marcar el checkbox)
Pago garantizado por  VISA  Mastercard  AMEX
```

**Corrección (Cal probó a mano en su celular, mismo día):** clickeando "Paga ahora" tras marcar el
checkbox como humano, la pasarela **SÍ ofrece QR** — redirige a `pagos.libelula.bo` (Libelula /
Todotix, agregador de pagos boliviano) con selector de método: **QR-SIMPLE** (seleccionado por
default, un QR real para escanear con la app del banco, igual patrón que Cinemark — "espere unos
segundos para que confirmemos su pago" / refresca solo), Google Pay, Visa/Mastercard (Cybersource),
BNB, TigoMoney. **Es decir: NO es pago-por-tarjeta-obligatorio como se concluyó primero** — el QR es
una opción de primer nivel, tan automatizable en teoría como el flujo de Cinemark.

## El bloqueo real: reCAPTCHA detecta el driver de automatización, no el headless

Se probó marcar el checkbox "No soy un robot" con Playwright en **dos configuraciones**:
- `headless: true` (Chrome real, `channel: "chrome"`) → reCAPTCHA presentó challenge de imágenes
  ("selecciona todas las imágenes con un autobús").
- `headless: false` (misma sesión, ventana visible) → **mismo resultado**, otro challenge
  ("selecciona todas las imágenes con automóviles").

Conclusión: el bloqueo **no es la señal `headless`** (que sí basta para otros anti-bot más simples)
— es la **detección del propio driver de automatización** (CDP/`navigator.webdriver`), que Google
reCAPTCHA v2 reconoce independientemente de si hay ventana visible. Cal, en su sesión real de
navegador (sin ningún driver de automatización), pasó el checkbox sin challenge visible.

## Conclusión de factibilidad (2026-07-26) — Multicine NO es automatizable con Playwright

El único motivo real es el reCAPTCHA v2 checkbox del checkout — no la ausencia de QR (sí hay QR,
igual que Cinemark) ni el OTP (se resuelve con `spark` leyendo el correo real). Resolver/evadir un
CAPTCHA por software no es algo que corresponda automatizar. **Recomendación:** cerrar la extensión
de Multicine con el mismo resultado que ya tenía Cine Center — **cartelera sí, compra automatizada
no, por diseño** — pero dejando registrado que la causa específica es el reCAPTCHA, no el modelo de
pago (por si en el futuro cambia el checkout y vale la pena reintentar).

Reservas verificadas hoy (liberadas solas, ningún pago completado): A26, A27×2, A28×2, B26, B27,
B28, C27, en La Odisea función 26/07 11:00 Sala 1.

## Scripts de recon (referencia, no se van a volver a correr salvo que se reabra el tema)
`recon{1..6}-multicine.mjs` en este mismo directorio — `recon6` es el que llega de punta a punta
(seat-plan → invitado → OTP real vía `spark` → checkout con reCAPTCHA).

## Decisiones / reglas (respetar)
- **Recon read-only: NO completar ningún pago.** El flujo llega hasta un QR real y bloquea butacas
  reales — la compra real requiere a Cal presente (misma regla que Cinemark).
- Seleccionar asiento + Continuar puede **reservar temporalmente** 1 butaca; se libera sola. OK para
  recon, pero no dejar sesiones colgadas.
- **Si el checkout exige crear una cuenta → reportar a Cal y parar.** Crear cuentas / ingresar
  credenciales es acción de Cal, no del asistente (regla dura). Ese fue el caso de Cine Center
  (modo invitado bugueado, pedía login).
- **Si acepta invitado + entrega QR → escribir el adapter Multicine** replicando el patrón de
  Cinemark: `iniciar → elegirAsientos → generarQr → verificarPago`, hoy placeholder en `compra.ts`.
- Antes de tocar código: presentar diseño + riesgos y esperar OK de Cal (regla de Planning).

## Archivos
- **Server (adapters de compra):** `servers/cine/src/compra.ts` — Cinemark implementado; Multicine
  es placeholder que devuelve "por ahora solo Cinemark".
- **Cartelera Multicine (referencia de selectores/WAF):** `servers/cine/src/cartelera.ts`
  (`scrapeMulticine`, ~línea 276).
- **Tools MCP:** `servers/cine/src/mcp-server.ts` (`iniciarCompraCine` etc. son Cinemark-only hoy).
- **Scripts de recon:** `servers/cine/recon/recon{1,2,3}-multicine.mjs` (portables, corren desde el
  root del monorepo con Chrome instalado).
- **Spec del diseño v2:** `Personal/Agents/Vesta/docs/superpowers/specs/2026-07-24-cine-mcp-v2-design.md`
  §7 (por qué Multicine/Cine Center quedaron fuera).
- **Gotchas técnicos del server (fuente única):** `mcp-servers/CLAUDE.md`, tabla de servidores, fila
  `cine`.

## Contexto de producción (no romper al agregar compra)
- El MCP corre como proceso HTTP persistente vía launchd, **un proceso por bot**: Jano (8791),
  Vesta (8792). Una compra activa por instancia (identificada por `purchaseId`).
- La confirmación de pago es **botón `✅ Ya pagué` en Vesta** / **por texto en Jano** (no hay
  polling). El adapter Multicine tendría que encajar en ese mismo contrato de 7 tools.
- El reaper (setInterval 2 min dentro del MCP) cierra Chrome de compras abandonadas.
