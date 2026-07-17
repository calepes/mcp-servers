import bwipjs from "bwip-js";
import { chromium } from "playwright";
import type { WalletPassData } from "./wallet-pass.js";

/**
 * Genera una imagen PNG de la tarjeta con el diseño navy/dorado aprobado por
 * Cal (mockup 2026-07-15, https://claude.ai/code/artifact/9adb2360-3a2c-48c1-
 * bb01-b500421d75a2) — NO reemplaza el `.pkpass` real (Wallet no soporta este
 * nivel de diseño, ver wallet-pass.ts), es un extra decorativo que se manda
 * por separado. El barcode que se ve en la imagen es el BCBP real decodificado
 * del PDF oficial — el mismo mensaje que lleva el `.pkpass` — NUNCA un
 * placeholder dibujado a mano (a diferencia del primer mockup HTML, que
 * dibujaba un patrón de barras falso).
 */
export async function renderPassCardImage(
  data: WalletPassData,
  logoWhitePng: Buffer,
): Promise<Buffer> {
  const barcodePng = await bwipjs.toBuffer({
    bcid: "pdf417",
    text: data.barcodeMessage,
    scale: 3,
    height: 12,
    includetext: false,
  });

  const html = buildCardHtml(data, logoWhitePng.toString("base64"), barcodePng.toString("base64"));

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 340, height: 508 },
      deviceScaleFactor: 3,
    });
    await page.setContent(html, { waitUntil: "networkidle" });
    // omitBackground: la captura es un rectángulo — sin esto, las esquinas
    // fuera del border-radius de .pass-face salen blancas (el fondo de la
    // página por default), en vez de transparentes.
    return await page.locator(".pass-face").screenshot({ omitBackground: true });
  } finally {
    await browser.close();
  }
}

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildCardHtml(data: WalletPassData, logoBase64: string, barcodeBase64: string): string {
  const gate = data.gate ?? "—";
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --boa-navy-deep: #0a1f3d;
      --boa-navy-mid: #12335c;
      --boa-navy-edge: #081729;
      --boa-gold: #e8a33d;
      --boa-gold-soft: #f0c07a;
      --boa-white: #f5f7fa;
      --boa-slate: #8a97b3;
      --boa-hair: rgba(245, 247, 250, 0.14);
    }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    .pass-face {
      position: relative;
      width: 340px;
      height: 508px;
      border-radius: 16px;
      background: linear-gradient(165deg, var(--boa-navy-mid) 0%, var(--boa-navy-deep) 55%, var(--boa-navy-edge) 100%);
      color: var(--boa-white);
      overflow: hidden;
    }
    .pass-header { display: flex; align-items: center; justify-content: space-between; padding: 18px 20px 14px; }
    .pass-wordmark img { height: 32px; width: auto; display: block; }
    .pass-class {
      font-size: 10.5px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase;
      color: var(--boa-gold-soft); border: 1px solid rgba(232, 163, 61, 0.45); border-radius: 999px; padding: 3px 9px;
    }
    .pass-route { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; padding: 4px 20px 6px; gap: 10px; }
    .pass-route .city { display: flex; flex-direction: column; gap: 2px; }
    .pass-route .city.dest { align-items: flex-end; text-align: right; }
    .pass-route .code { font-size: 38px; font-weight: 700; line-height: 1; letter-spacing: -0.01em; }
    .pass-route .airport { font-size: 10px; color: var(--boa-slate); letter-spacing: 0.02em; }
    .pass-route .plane { display: flex; align-items: center; justify-content: center; color: var(--boa-gold); }
    .pass-route .plane svg { width: 30.25px; height: 30.25px; transform: rotate(90deg); }
    .pass-departure { padding: 10px 20px 18px; }
    .pass-departure .label { font-size: 10px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: var(--boa-slate); margin-bottom: 4px; }
    .pass-departure .value { font-size: 46px; font-weight: 800; line-height: 1; letter-spacing: -0.01em; }
    .pass-departure .date { font-size: 12.5px; color: var(--boa-slate); margin-top: 6px; }
    .perforation { position: relative; height: 1px; background-image: repeating-linear-gradient(90deg, var(--boa-hair) 0 8px, transparent 8px 16px); }
    .pass-passenger { padding: 0 20px 18px; display: flex; align-items: flex-end; justify-content: space-between; gap: 14px; }
    .pass-passenger .field { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
    .pass-passenger .field.frequent { text-align: right; }
    .pass-passenger .label { font-size: 9.5px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: var(--boa-slate); }
    .pass-passenger .value { font-size: 15px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pass-passenger .value.frequent { font-weight: 400; color: var(--boa-white); }
    .pass-fields { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; padding: 18px 20px 16px; }
    .pass-fields .field .label { font-size: 9.5px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: var(--boa-slate); margin-bottom: 4px; }
    .pass-fields .field .value { font-size: 18px; font-weight: 700; }
    .pass-fields .field .value.muted { color: var(--boa-slate); font-weight: 600; font-size: 15px; }
    .pass-barcode { background: var(--boa-white); padding: 18px 20px 16px; display: flex; flex-direction: column; align-items: center; gap: 8px; margin-top: auto; position: absolute; bottom: 0; left: 0; right: 0; }
    .pass-barcode img { width: 100%; max-width: 260px; image-rendering: pixelated; }
    .pass-barcode .caption { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10.5px; letter-spacing: 0.08em; color: var(--boa-navy-deep); opacity: 0.55; }
  </style></head><body>
    <div class="pass-face">
      <div class="pass-header">
        <div class="pass-wordmark"><img src="data:image/png;base64,${logoBase64}" alt="Boliviana de Aviación" /></div>
        <span class="pass-class">${esc(data.travelClass)}</span>
      </div>
      <div class="pass-route">
        <div class="city">
          <span class="code">${esc(data.originCode)}</span>
          <span class="airport">${esc(data.originName)}</span>
        </div>
        <div class="plane"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2.5 1.8V22l3.5-1 3.5 1v-1.2L13 19v-5.5l8 2.5z"/></svg></div>
        <div class="city dest">
          <span class="code">${esc(data.destinationCode)}</span>
          <span class="airport">${esc(data.destinationName)}</span>
        </div>
      </div>
      <div class="pass-departure">
        <div class="label">Salida</div>
        <div class="value">${esc(data.departureTime)}</div>
        <div class="date">Vuelo ${esc(data.flightNumber)} · Abordaje ${esc(data.boardingTime)} · ${esc(data.flightDate)}</div>
      </div>
      <div class="pass-passenger">
        <div class="field">
          <span class="label">Pasajero</span>
          <span class="value">${esc(data.passengerName)}</span>
        </div>
        ${data.frequentFlyerNumber ? `<div class="field frequent">
          <span class="label">Elévate</span>
          <span class="value frequent">${esc(data.frequentFlyerNumber)}</span>
        </div>` : ""}
      </div>
      <div class="perforation"></div>
      <div class="pass-fields">
        <div class="field"><div class="label">Grupo</div><div class="value">${esc(data.boardingGroup)}</div></div>
        <div class="field"><div class="label">Puerta</div><div class="value${gate === "—" ? " muted" : ""}">${esc(gate)}</div></div>
        <div class="field"><div class="label">Asiento</div><div class="value">${esc(data.seat)}</div></div>
      </div>
      <div class="pass-barcode">
        <img src="data:image/png;base64,${barcodeBase64}" alt="barcode" />
        <span class="caption">${esc(data.flightNumber)} · ${esc(data.originCode)} ${esc(data.destinationCode)} · ${esc(data.seat)}</span>
      </div>
    </div>
  </body></html>`;
}
