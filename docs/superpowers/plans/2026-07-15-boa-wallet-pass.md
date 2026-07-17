# BoA Wallet Pass (.pkpass) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `generateBoaWalletPass` tool to the `boa-checkin` MCP that produces a real, gate-scannable Apple Wallet `.pkpass` from an already-confirmed BoA boarding pass, and wire it into Jano/Vesta so Cal can ask for it in Telegram.

**Architecture:** Reuse the existing Playwright flow to reach the "Your boarding pass" screen, scrape display fields from the DOM (no BCBP parsing needed for those), download the official PDF and decode its PDF417 barcode (pdfjs-dist + `@napi-rs/canvas` render → `zxing-wasm` decode) purely to get the exact scannable barcode payload, then build and sign a `.pkpass` with `passkit-generator`. The daemons (Jano/Vesta) get a new local-file document sender so they can push the generated file to Telegram without a public URL.

**Tech Stack:** TypeScript/Node (ESM, NodeNext), Vitest, `pdfjs-dist`, `@napi-rs/canvas`, `zxing-wasm`, `passkit-generator`; `bwip-js` + `pdf-lib` as test-only fixtures.

**Reference spec:** `docs/superpowers/specs/2026-07-15-boa-wallet-pass-design.md` (this repo).

**Important divergence from the spec, flag to Cal before/while executing:** the spec said the `.p12` + password go straight into `apps.env`. `passkit-generator` signs with a separate cert PEM + key PEM (not a raw `.p12`), so Task 1 includes an `openssl` extraction step, and the resulting **signerKey.pem contains private key material — it must NOT be committed to the git repo** (unlike the public WWDR cert, which is safe to commit). It goes in `~/.claude/secrets/boa-wallet/` (chmod 600), referenced from `apps.env` by path.

---

## Task 1: Apple certificates — extract + place

**Files:**
- Create: `~/.claude/secrets/boa-wallet/signerCert.pem` (private, NOT in git)
- Create: `~/.claude/secrets/boa-wallet/signerKey.pem` (private, NOT in git)
- Create: `servers/boa-checkin/assets/AppleWWDRCAG4.pem` (public, safe to commit)

This task is manual (no code) — it turns Cal's `.p12` (from developer.apple.com, assumed already generated per the spec's "lo hago yo por mi cuenta" decision) into the files `passkit-generator` actually consumes.

- [ ] **Step 1: Create the private secrets dir**

```bash
mkdir -p ~/.claude/secrets/boa-wallet
chmod 700 ~/.claude/secrets/boa-wallet
```

- [ ] **Step 2: Extract cert + key from the `.p12`**

Ask Cal for the `.p12` path and its export password, then:

```bash
openssl pkcs12 -in /path/to/Certificates.p12 -clcerts -nokeys -legacy \
  -out ~/.claude/secrets/boa-wallet/signerCert.pem
openssl pkcs12 -in /path/to/Certificates.p12 -nocerts -legacy \
  -out ~/.claude/secrets/boa-wallet/signerKey.pem
chmod 600 ~/.claude/secrets/boa-wallet/signerCert.pem ~/.claude/secrets/boa-wallet/signerKey.pem
```

(`-legacy` is needed on OpenSSL 3.x for Apple's older RC2/3DES-encrypted `.p12` files; if the `.p12` was created recently and `-legacy` errors with "unknown option", drop it.) Both commands will prompt for the `.p12` import password and then ask you to set an export passphrase for `signerKey.pem` — remember that passphrase, it becomes `BOA_WALLET_SIGNER_KEY_PASSPHRASE` in Task 11.

- [ ] **Step 3: Download + convert the public WWDR G4 cert**

```bash
cd "/Users/calepes/Claude Projects/Personal/MCP Servers/mcp-servers/servers/boa-checkin"
mkdir -p assets
curl -o assets/AppleWWDRCAG4.cer https://www.apple.com/certificateauthority/AppleWWDRCAG4.cer
openssl x509 -inform DER -in assets/AppleWWDRCAG4.cer -out assets/AppleWWDRCAG4.pem
rm assets/AppleWWDRCAG4.cer
```

- [ ] **Step 4: Verify all three PEMs parse**

```bash
openssl x509 -in ~/.claude/secrets/boa-wallet/signerCert.pem -noout -subject
openssl rsa -in ~/.claude/secrets/boa-wallet/signerKey.pem -passin pass:<passphrase-from-step-2> -noout -check
openssl x509 -in "/Users/calepes/Claude Projects/Personal/MCP Servers/mcp-servers/servers/boa-checkin/assets/AppleWWDRCAG4.pem" -noout -subject
```
Expected: each prints a subject line (or "RSA key ok") with no error.

- [ ] **Step 5: Commit the WWDR asset only**

```bash
cd "/Users/calepes/Claude Projects/Personal/MCP Servers/mcp-servers"
git add servers/boa-checkin/assets/AppleWWDRCAG4.pem
git commit -m "chore(boa-checkin): bundle Apple WWDR G4 cert for pass signing"
```

---

## Task 2: Add pipeline dependencies

**Files:**
- Modify: `servers/boa-checkin/package.json`

- [ ] **Step 1: Install runtime + dev dependencies**

```bash
cd "/Users/calepes/Claude Projects/Personal/MCP Servers/mcp-servers"
npm install --workspace mcp-boa-checkin passkit-generator pdfjs-dist @napi-rs/canvas zxing-wasm
npm install --workspace mcp-boa-checkin --save-dev bwip-js pdf-lib
```

- [ ] **Step 2: Confirm `package.json` picked up the new deps**

```bash
cat servers/boa-checkin/package.json
```
Expected: `dependencies` now includes `passkit-generator`, `pdfjs-dist`, `@napi-rs/canvas`, `zxing-wasm`; `devDependencies` includes `bwip-js`, `pdf-lib` (alongside the existing `@types/node`, `typescript`, `vitest`).

- [ ] **Step 3: Commit**

```bash
git add servers/boa-checkin/package.json servers/boa-checkin/package-lock.json package-lock.json 2>/dev/null
git commit -m "chore(boa-checkin): add .pkpass pipeline dependencies"
```

---

## Task 3: PDF417 decode module — render PDF page to pixels

**Files:**
- Create: `servers/boa-checkin/src/wallet-pdf417.ts`
- Test: `servers/boa-checkin/src/wallet-pdf417.test.ts`

- [ ] **Step 1: Write the failing test (render → pixel dimensions)**

```typescript
// servers/boa-checkin/src/wallet-pdf417.test.ts
import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { renderPdfFirstPageToImageData } from "./wallet-pdf417.js";

describe("renderPdfFirstPageToImageData", () => {
  it("rasterizes a one-page PDF at the requested scale", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 100]); // points
    page.drawRectangle({ x: 0, y: 0, width: 200, height: 100, color: { type: "RGB", red: 1, green: 0, blue: 0 } as any });
    const pdfBytes = await doc.save();

    const imageData = await renderPdfFirstPageToImageData(Buffer.from(pdfBytes), 2);

    // 200x100 points at scale 2 -> 400x200 pixels
    expect(imageData.width).toBe(400);
    expect(imageData.height).toBe(200);
    expect(imageData.data.length).toBe(400 * 200 * 4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run -w mcp-boa-checkin test -- wallet-pdf417`
Expected: FAIL — `renderPdfFirstPageToImageData is not a function` / module not found.

- [ ] **Step 3: Implement the renderer**

```typescript
// servers/boa-checkin/src/wallet-pdf417.ts
import { createCanvas } from "@napi-rs/canvas";
// pdfjs-dist's legacy Node build works without any DOM globals.
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

class NodeCanvasFactory {
  create(width: number, height: number) {
    const canvas = createCanvas(width, height);
    const context = canvas.getContext("2d");
    return { canvas, context };
  }
  reset(canvasAndContext: { canvas: any }, width: number, height: number) {
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  }
  destroy(canvasAndContext: { canvas: any; context: any }) {
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
    canvasAndContext.canvas = null;
    canvasAndContext.context = null;
  }
}

/**
 * Rasteriza la primera página de un PDF a píxeles crudos (RGBA). `scale`
 * sube la resolución — usar >=3 para que zxing-wasm tenga margen suficiente
 * al decodificar el PDF417 (el módulo más chico del barcode necesita varios
 * píxeles de ancho, no 1).
 */
export async function renderPdfFirstPageToImageData(
  pdfBuffer: Buffer,
  scale = 3,
): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(pdfBuffer) });
  const pdfDocument = await loadingTask.promise;
  try {
    const page = await pdfDocument.getPage(1);
    const viewport = page.getViewport({ scale });
    const canvasFactory = new NodeCanvasFactory();
    const canvasAndContext = canvasFactory.create(viewport.width, viewport.height);
    await page.render({
      canvasContext: canvasAndContext.context,
      viewport,
      canvasFactory: canvasFactory as any,
    }).promise;
    const imageData = canvasAndContext.context.getImageData(0, 0, viewport.width, viewport.height);
    canvasFactory.destroy(canvasAndContext);
    return { data: imageData.data as Uint8ClampedArray, width: imageData.width, height: imageData.height };
  } finally {
    await pdfDocument.destroy();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run -w mcp-boa-checkin test -- wallet-pdf417`
Expected: PASS. If `pdfjs-dist/legacy/build/pdf.mjs` import fails (path changed between versions), run `ls node_modules/pdfjs-dist/legacy/build/` to find the actual Node-targeted entry file and fix the import path.

- [ ] **Step 5: Commit**

```bash
git add servers/boa-checkin/src/wallet-pdf417.ts servers/boa-checkin/src/wallet-pdf417.test.ts
git commit -m "feat(boa-checkin): rasterize PDF first page to pixels (no PDF417 decode yet)"
```

---

## Task 4: PDF417 decode module — decode barcode from pixels

**Files:**
- Modify: `servers/boa-checkin/src/wallet-pdf417.ts`
- Modify: `servers/boa-checkin/src/wallet-pdf417.test.ts`

- [ ] **Step 1: Write the failing test (round-trip a known string through a real PDF417 image)**

```typescript
// append to servers/boa-checkin/src/wallet-pdf417.test.ts
import bwipjs from "bwip-js";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { decodePdf417FromImageData } from "./wallet-pdf417.js";

describe("decodePdf417FromImageData", () => {
  it("recovers the original string encoded in a PDF417 barcode", async () => {
    const barcodePng = await bwipjs.toBuffer({
      bcid: "pdf417",
      text: "M1LEPESQUEUR/CARLOS  EXK9F2P OB682 190 25C0014 147>",
      scale: 3,
      height: 12,
      includetext: false,
    });
    const img = await loadImage(barcodePng);
    const canvas = createCanvas(img.width, img.height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, img.width, img.height);

    const text = await decodePdf417FromImageData({
      data: imageData.data as Uint8ClampedArray,
      width: imageData.width,
      height: imageData.height,
    });

    expect(text).toBe("M1LEPESQUEUR/CARLOS  EXK9F2P OB682 190 25C0014 147>");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run -w mcp-boa-checkin test -- wallet-pdf417`
Expected: FAIL — `decodePdf417FromImageData is not a function`.

- [ ] **Step 3: Implement the decoder**

```typescript
// add to servers/boa-checkin/src/wallet-pdf417.ts
import { readBarcodes } from "zxing-wasm/reader";

export async function decodePdf417FromImageData(imageData: {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}): Promise<string> {
  const results = await readBarcodes(imageData, {
    tryHarder: true,
    formats: ["PDF417"],
  });
  if (results.length === 0) {
    throw new Error(
      "No se pudo decodificar ningún PDF417 en la imagen del boarding pass — probablemente la resolución del render es insuficiente. Subir `scale` en renderPdfFirstPageToImageData.",
    );
  }
  return results[0].text;
}

/** Combina render + decode: PDF del boarding pass -> string BCBP crudo. */
export async function decodeBoardingPassBarcode(pdfBuffer: Buffer): Promise<string> {
  const imageData = await renderPdfFirstPageToImageData(pdfBuffer, 3);
  return decodePdf417FromImageData(imageData);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run -w mcp-boa-checkin test -- wallet-pdf417`
Expected: PASS. If the import `zxing-wasm/reader` errors ("no such subpath export" or similar), run `cat node_modules/zxing-wasm/package.json | grep -A20 '"exports"'` to find the correct entry subpath and fix the import; the `readBarcodes` call signature (whether it takes `{data,width,height}` directly vs needs to be wrapped) is worth double-checking against `node_modules/zxing-wasm/dist/**/*.d.ts` if the test fails with a type/shape error rather than "no barcode found".

- [ ] **Step 5: Add the end-to-end test (real PDF → real barcode) and run it**

```typescript
// append to servers/boa-checkin/src/wallet-pdf417.test.ts
import { PDFDocument } from "pdf-lib";
import { decodeBoardingPassBarcode } from "./wallet-pdf417.js";

describe("decodeBoardingPassBarcode", () => {
  it("decodes a PDF417 embedded as an image in a PDF page", async () => {
    const bcbp = "M1LEPESQUEUR/CARLOS  EXK9F2P OB682 190 25C0014 147>";
    const barcodePng = await bwipjs.toBuffer({ bcid: "pdf417", text: bcbp, scale: 3, height: 12, includetext: false });

    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 150]);
    const png = await doc.embedPng(barcodePng);
    page.drawImage(png, { x: 10, y: 10, width: 280, height: 100 });
    const pdfBytes = await doc.save();

    const text = await decodeBoardingPassBarcode(Buffer.from(pdfBytes));
    expect(text).toBe(bcbp);
  });
});
```

Run: `npm run -w mcp-boa-checkin test -- wallet-pdf417`
Expected: PASS (3 tests total in this file).

- [ ] **Step 6: Commit**

```bash
git add servers/boa-checkin/src/wallet-pdf417.ts servers/boa-checkin/src/wallet-pdf417.test.ts
git commit -m "feat(boa-checkin): decode PDF417 barcode from a boarding pass PDF"
```

---

## Task 5: Wallet pass config loader

**Files:**
- Create: `servers/boa-checkin/src/wallet-pass.ts`
- Test: `servers/boa-checkin/src/wallet-pass.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// servers/boa-checkin/src/wallet-pass.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadWalletPassConfig } from "./wallet-pass.js";

const ENV_KEYS = [
  "BOA_WALLET_PASS_TYPE_ID",
  "BOA_WALLET_TEAM_ID",
  "BOA_WALLET_SIGNER_CERT_PATH",
  "BOA_WALLET_SIGNER_KEY_PATH",
  "BOA_WALLET_SIGNER_KEY_PASSPHRASE",
  "BOA_WALLET_WWDR_PATH",
] as const;

describe("loadWalletPassConfig", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("throws listing every missing key when none are set", () => {
    expect(() => loadWalletPassConfig()).toThrow(/BOA_WALLET_PASS_TYPE_ID/);
    expect(() => loadWalletPassConfig()).toThrow(/BOA_WALLET_SIGNER_CERT_PATH/);
  });

  it("returns the config object when all required keys are set", () => {
    process.env.BOA_WALLET_PASS_TYPE_ID = "pass.com.lepesqueur.boaboarding";
    process.env.BOA_WALLET_TEAM_ID = "ABCDE12345";
    process.env.BOA_WALLET_SIGNER_CERT_PATH = "/tmp/signerCert.pem";
    process.env.BOA_WALLET_SIGNER_KEY_PATH = "/tmp/signerKey.pem";
    process.env.BOA_WALLET_WWDR_PATH = "/tmp/wwdr.pem";
    // passphrase is optional — key may be unencrypted
    const config = loadWalletPassConfig();
    expect(config).toEqual({
      passTypeIdentifier: "pass.com.lepesqueur.boaboarding",
      teamIdentifier: "ABCDE12345",
      signerCertPath: "/tmp/signerCert.pem",
      signerKeyPath: "/tmp/signerKey.pem",
      signerKeyPassphrase: undefined,
      wwdrPath: "/tmp/wwdr.pem",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run -w mcp-boa-checkin test -- wallet-pass`
Expected: FAIL — module `./wallet-pass.js` not found.

- [ ] **Step 3: Implement `loadWalletPassConfig`**

```typescript
// servers/boa-checkin/src/wallet-pass.ts
export interface WalletPassConfig {
  passTypeIdentifier: string;
  teamIdentifier: string;
  signerCertPath: string;
  signerKeyPath: string;
  signerKeyPassphrase?: string;
  wwdrPath: string;
}

/**
 * Lee la config de firma del `.pkpass` desde env vars (apps.env). Tira error
 * explícito listando TODAS las keys que faltan — nunca arma un pase a medias
 * ni asume defaults para certificados/identificadores.
 */
export function loadWalletPassConfig(): WalletPassConfig {
  const passTypeIdentifier = process.env.BOA_WALLET_PASS_TYPE_ID;
  const teamIdentifier = process.env.BOA_WALLET_TEAM_ID;
  const signerCertPath = process.env.BOA_WALLET_SIGNER_CERT_PATH;
  const signerKeyPath = process.env.BOA_WALLET_SIGNER_KEY_PATH;
  const wwdrPath = process.env.BOA_WALLET_WWDR_PATH;

  const missing = [
    !passTypeIdentifier && "BOA_WALLET_PASS_TYPE_ID",
    !teamIdentifier && "BOA_WALLET_TEAM_ID",
    !signerCertPath && "BOA_WALLET_SIGNER_CERT_PATH",
    !signerKeyPath && "BOA_WALLET_SIGNER_KEY_PATH",
    !wwdrPath && "BOA_WALLET_WWDR_PATH",
  ].filter((v): v is string => Boolean(v));

  if (missing.length > 0) {
    throw new Error(
      `Falta configurar en apps.env: ${missing.join(", ")} — ver docs/superpowers/specs/2026-07-15-boa-wallet-pass-design.md.`,
    );
  }

  return {
    passTypeIdentifier: passTypeIdentifier!,
    teamIdentifier: teamIdentifier!,
    signerCertPath: signerCertPath!,
    signerKeyPath: signerKeyPath!,
    signerKeyPassphrase: process.env.BOA_WALLET_SIGNER_KEY_PASSPHRASE,
    wwdrPath: wwdrPath!,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run -w mcp-boa-checkin test -- wallet-pass`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add servers/boa-checkin/src/wallet-pass.ts servers/boa-checkin/src/wallet-pass.test.ts
git commit -m "feat(boa-checkin): wallet pass config loader with explicit missing-key errors"
```

---

## Task 6: Pass field builder (pure data, no signing)

**Files:**
- Modify: `servers/boa-checkin/src/wallet-pass.ts`
- Modify: `servers/boa-checkin/src/wallet-pass.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// append to servers/boa-checkin/src/wallet-pass.test.ts
import { buildBoaPassFields, type WalletPassData } from "./wallet-pass.js";

const sampleData: WalletPassData = {
  locator: "XK9F2P",
  passengerName: "Carlos Lepesqueur",
  frequentFlyerNumber: "EL 048213",
  flightNumber: "OB682",
  originCode: "LPB",
  originName: "La Paz — El Alto Intl.",
  destinationCode: "VVI",
  destinationName: "Viru Viru Intl., Santa Cruz",
  departureTime: "19:10",
  boardingTime: "18:40",
  flightDate: "07 jul",
  seat: "25C",
  boardingGroup: "2",
  travelClass: "Economy",
  boardingSequence: "014",
  gate: undefined,
  barcodeMessage: "M1LEPESQUEUR/CARLOS  EXK9F2P OB682 190 25C0014 147>",
};

describe("buildBoaPassFields", () => {
  it("puts the route in primaryFields and departure time in secondaryFields", () => {
    const fields = buildBoaPassFields(sampleData);
    expect(fields.primaryFields).toEqual([
      { key: "origin", label: "LA PAZ", value: "LPB" },
      { key: "destination", label: "SANTA CRUZ", value: "VVI" },
    ]);
    expect(fields.secondaryFields).toEqual([
      { key: "departure", label: "SALIDA", value: "19:10" },
    ]);
  });

  it("puts group/gate/seat in auxiliaryFields, using a placeholder for missing gate", () => {
    const fields = buildBoaPassFields(sampleData);
    expect(fields.auxiliaryFields).toEqual([
      { key: "group", label: "GRUPO", value: "2" },
      { key: "gate", label: "PUERTA", value: "—" },
      { key: "seat", label: "ASIENTO", value: "25C" },
    ]);
  });

  it("includes the frequent flyer number in headerFields when present", () => {
    const fields = buildBoaPassFields(sampleData);
    expect(fields.headerFields).toEqual([
      { key: "frequentFlyer", label: "ELÉVATE", value: "EL 048213" },
    ]);
  });

  it("omits headerFields entirely when there is no frequent flyer number", () => {
    const fields = buildBoaPassFields({ ...sampleData, frequentFlyerNumber: undefined });
    expect(fields.headerFields).toEqual([]);
  });

  it("fills backFields with locator, sequence and full airport names", () => {
    const fields = buildBoaPassFields(sampleData);
    expect(fields.backFields).toEqual([
      { key: "locator", label: "CÓDIGO DE RESERVA", value: "XK9F2P" },
      { key: "sequence", label: "SECUENCIA DE ABORDAJE", value: "014" },
      { key: "originFull", label: "ORIGEN", value: "La Paz — El Alto Intl. (LPB)" },
      { key: "destinationFull", label: "DESTINO", value: "Viru Viru Intl., Santa Cruz (VVI)" },
      {
        key: "contact",
        label: "CONTACTO",
        value: "Boliviana de Aviación · consultas: boa.bo",
      },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run -w mcp-boa-checkin test -- wallet-pass`
Expected: FAIL — `buildBoaPassFields is not a function`.

- [ ] **Step 3: Implement `buildBoaPassFields`**

```typescript
// add to servers/boa-checkin/src/wallet-pass.ts
export interface WalletPassData {
  locator: string;
  passengerName: string;
  frequentFlyerNumber?: string;
  flightNumber: string;
  originCode: string;
  originName: string;
  destinationCode: string;
  destinationName: string;
  departureTime: string;
  boardingTime: string;
  flightDate: string;
  seat: string;
  boardingGroup: string;
  travelClass: string;
  boardingSequence?: string;
  gate?: string;
  barcodeMessage: string;
}

interface PassField {
  key: string;
  label: string;
  value: string;
}

export interface BoaPassFields {
  headerFields: PassField[];
  primaryFields: PassField[];
  secondaryFields: PassField[];
  auxiliaryFields: PassField[];
  backFields: PassField[];
}

/**
 * Arma los grupos de campos del `pass.json` (tipo boardingPass) a partir de
 * los datos ya scrapeados del check-in — sin tocar certificados ni firmar
 * nada, para que sea testeable sin Chrome ni criptografía.
 */
export function buildBoaPassFields(data: WalletPassData): BoaPassFields {
  return {
    headerFields: data.frequentFlyerNumber
      ? [{ key: "frequentFlyer", label: "ELÉVATE", value: data.frequentFlyerNumber }]
      : [],
    primaryFields: [
      { key: "origin", label: data.originName.split(/[—,]/)[0].trim().toUpperCase(), value: data.originCode },
      { key: "destination", label: data.destinationName.split(/[—,]/)[0].trim().toUpperCase(), value: data.destinationCode },
    ],
    secondaryFields: [{ key: "departure", label: "SALIDA", value: data.departureTime }],
    auxiliaryFields: [
      { key: "group", label: "GRUPO", value: data.boardingGroup },
      { key: "gate", label: "PUERTA", value: data.gate ?? "—" },
      { key: "seat", label: "ASIENTO", value: data.seat },
    ],
    backFields: [
      { key: "locator", label: "CÓDIGO DE RESERVA", value: data.locator },
      { key: "sequence", label: "SECUENCIA DE ABORDAJE", value: data.boardingSequence ?? "—" },
      { key: "originFull", label: "ORIGEN", value: `${data.originName} (${data.originCode})` },
      { key: "destinationFull", label: "DESTINO", value: `${data.destinationName} (${data.destinationCode})` },
      { key: "contact", label: "CONTACTO", value: "Boliviana de Aviación · consultas: boa.bo" },
    ],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run -w mcp-boa-checkin test -- wallet-pass`
Expected: PASS (7 tests total in this file: 2 from Task 5 + 5 here).

- [ ] **Step 5: Commit**

```bash
git add servers/boa-checkin/src/wallet-pass.ts servers/boa-checkin/src/wallet-pass.test.ts
git commit -m "feat(boa-checkin): build pass.json field groups from scraped boarding pass data"
```

---

## Task 7: Sign and package the `.pkpass`

**Files:**
- Modify: `servers/boa-checkin/src/wallet-pass.ts`

This step wires the actual signing library. **Before writing the call**, run `cat node_modules/passkit-generator/README.md | sed -n '/certificates/,/^##/p' | head -80` (or open the file) to confirm the exact shape `certificates` expects — the code below is the documented v3 shape from training data, but confirm against what's actually installed before trusting it.

- [ ] **Step 1: Implement `signAndPackagePass`**

```typescript
// add to servers/boa-checkin/src/wallet-pass.ts
import { readFileSync } from "node:fs";
import { PKPass } from "passkit-generator";

/**
 * Arma y firma el `.pkpass` final. A diferencia de `buildBoaPassFields`,
 * esto SÍ toca certificados — no tiene test unitario con cripto real (el
 * `.p12` de Cal no vive en el repo); se valida con el flujo E2E del Task 12.
 */
export async function signAndPackagePass(
  data: WalletPassData,
  config: WalletPassConfig,
  assets: { iconPng: Buffer; icon2xPng: Buffer; logoPng: Buffer; logo2xPng: Buffer },
): Promise<Buffer> {
  const fields = buildBoaPassFields(data);

  const pass = new PKPass(
    {},
    {
      wwdr: readFileSync(config.wwdrPath),
      signerCert: readFileSync(config.signerCertPath),
      signerKey: readFileSync(config.signerKeyPath),
      signerKeyPassphrase: config.signerKeyPassphrase,
    },
    {
      passTypeIdentifier: config.passTypeIdentifier,
      teamIdentifier: config.teamIdentifier,
      serialNumber: `${data.locator}-${data.flightNumber}-${data.passengerName.replace(/\s+/g, "")}`,
      organizationName: "Boliviana de Aviación",
      description: `Boarding pass ${data.flightNumber} ${data.originCode}-${data.destinationCode}`,
      formatVersion: 1,
    },
  );

  pass.type = "boardingPass";
  pass.transitType = "PKTransitTypeAir";
  pass.headerFields.push(...fields.headerFields);
  pass.primaryFields.push(...fields.primaryFields);
  pass.secondaryFields.push(...fields.secondaryFields);
  pass.auxiliaryFields.push(...fields.auxiliaryFields);
  pass.backFields.push(...fields.backFields);
  pass.setBarcodes({
    format: "PKBarcodeFormatPDF417",
    message: data.barcodeMessage,
    messageEncoding: "iso-8859-1",
  });

  pass.addBuffer("icon.png", assets.iconPng);
  pass.addBuffer("icon@2x.png", assets.icon2xPng);
  pass.addBuffer("logo.png", assets.logoPng);
  pass.addBuffer("logo@2x.png", assets.logo2xPng);

  return pass.getAsBuffer();
}
```

- [ ] **Step 2: Type-check the whole package**

Run: `npm run -w mcp-boa-checkin build`
Expected: compiles with no errors. If `passkit-generator`'s types disagree with this call (e.g. `signerKeyPassphrase` typed as required, or `PKPass` constructor argument order differs), fix the call to match `node_modules/passkit-generator/lib/*.d.ts` — this is exactly the kind of mismatch the README check at the top of this task is meant to catch before it costs a debugging cycle.

- [ ] **Step 3: Run the full test suite (nothing here should have broken it)**

Run: `npm run -w mcp-boa-checkin test`
Expected: PASS, same test count as after Task 6 (this task added no new unit tests — signing needs real certs, see Task 12 for the E2E check).

- [ ] **Step 4: Commit**

```bash
git add servers/boa-checkin/src/wallet-pass.ts
git commit -m "feat(boa-checkin): sign and package the .pkpass with passkit-generator"
```

---

## Task 8: Brand assets (logo/icon) — sourcing + Cal approval

**Files:**
- Create: `servers/boa-checkin/assets/boa-icon.png` (29×29)
- Create: `servers/boa-checkin/assets/boa-icon@2x.png` (58×58)
- Create: `servers/boa-checkin/assets/boa-logo.png` (160×50 max)
- Create: `servers/boa-checkin/assets/boa-logo@2x.png` (320×100 max)

This is a manual/approval-gated task, not TDD — Apple requires a real icon (used for notifications) and logo (shown top-left of the pass) at those exact pixel sizes, and the mockup Cal already approved used a placeholder mark, not BoA's real logo.

- [ ] **Step 1: Source BoA's logo** — search for an official BoA (Boliviana de Aviación) logo image, show the candidate(s) to Cal, and get explicit approval before proceeding (same rule as any asset embedded in a shipped artifact).

- [ ] **Step 2: Produce the 4 required sizes** from the approved source image (transparent PNG background; icon square, logo max 160×50 / 320×100 keeping aspect ratio) — any image tool/script is fine, just verify the output dimensions.

```bash
file servers/boa-checkin/assets/boa-icon.png servers/boa-checkin/assets/boa-icon@2x.png servers/boa-checkin/assets/boa-logo.png servers/boa-checkin/assets/boa-logo@2x.png
```
Expected: each line shows the exact pixel dimensions above.

- [ ] **Step 3: Commit**

```bash
git add servers/boa-checkin/assets/boa-icon.png servers/boa-checkin/assets/boa-icon@2x.png servers/boa-checkin/assets/boa-logo.png servers/boa-checkin/assets/boa-logo@2x.png
git commit -m "chore(boa-checkin): add approved BoA logo/icon assets for the wallet pass"
```

---

## Task 9: Scrape wallet-pass data from the confirmed check-in

**Files:**
- Modify: `servers/boa-checkin/src/flow.ts`

No new unit test here — this function drives real Playwright/Amadeus DOM, same as every other function in `flow.ts` (none of which have unit tests; they're validated by manual E2E, see Task 12). Follow the existing style/JSDoc convention in this file.

- [ ] **Step 1: Add `getWalletPassScrapeData`**

Add near `getBoardingPassForJourney` (after it, so it can reuse `openManageBooking`):

```typescript
// add to servers/boa-checkin/src/flow.ts
import type { WalletPassData } from "./wallet-pass.js";

/**
 * Recopila TODOS los datos visuales que necesita `buildBoaPassFields` desde
 * "Manage your booking"/"Your boarding pass" — el mismo camino que ya usa
 * `getBoardingPassForJourney`. NO decodifica el BCBP (eso lo hace
 * `decodeBoardingPassBarcode` sobre el PDF descargado aparte); esto es solo
 * lo que ya está visible en pantalla.
 */
export async function getWalletPassScrapeData(
  page: Page,
  locator: string,
  tramo?: string,
  nombre?: string,
): Promise<Omit<WalletPassData, "barcodeMessage">> {
  const frame = await waitForAmadeusFrame(page);
  await openManageBooking(frame, tramo);

  const passengerRow = frame.getByRole("listitem").filter({ hasText: nombre ?? "" }).first();
  const rowText = await passengerRow.innerText();

  const flightNumber = (rowText.match(/\b(OB\d{2,4})\b/) || [])[1] ?? "";
  const route = rowText.match(/([A-Z]{3})\s*(?:to|→|-)\s*([A-Z]{3})/i);
  const originCode = route?.[1]?.toUpperCase() ?? "";
  const destinationCode = route?.[2]?.toUpperCase() ?? "";
  const seat = (rowText.match(/Seat\s*([0-9]{1,2}[A-Z])/i) || [])[1] ?? "";
  const boardingGroup = (rowText.match(/Group\s*([0-9]+)/i) || [])[1] ?? "";
  const gate = (rowText.match(/Gate\s*([A-Z0-9]+)/i) || [])[1];
  const travelClass = /business/i.test(rowText) ? "Business" : "Economy";
  const departureTime = (rowText.match(/Departure\s*([0-9]{1,2}:[0-9]{2})/i) || [])[1] ?? "";
  const boardingTime = (rowText.match(/Boarding\s*([0-9]{1,2}:[0-9]{2})/i) || [])[1] ?? "";
  const flightDate = (rowText.match(/([0-9]{1,2}\s+[A-Za-z]{3}\b)/) || [])[1] ?? "";
  const frequentFlyerMatch = rowText.match(/Elevate\s*[:#]?\s*([A-Z0-9 ]{4,})/i);

  return {
    locator,
    passengerName: (nombre ?? rowText.match(/Passenger\n([A-Za-zÀ-ÿ' -]+)/)?.[1] ?? "").trim(),
    frequentFlyerNumber: frequentFlyerMatch?.[1]?.trim(),
    flightNumber,
    originCode,
    originName: originCode, // placeholder legible — reemplazar con el mapeo IATA->nombre completo si BoA lo muestra en pantalla
    destinationCode,
    destinationName: destinationCode,
    departureTime,
    boardingTime,
    flightDate,
    seat,
    boardingGroup,
    travelClass,
    gate,
  };
}
```

**Note for whoever executes this task:** the exact regexes above are a best-effort guess at BoA's real DOM text (mirroring the parsing already done in `getAllBoardingPasses`'s `Passenger\n(name)` match a few lines up in this same file). Before trusting this in production, run it against one real confirmed reservation (`locator`/`apellido` Cal provides) and `console.log(rowText)` to see the actual text, then adjust the regexes to match — this is standard practice for every function in this file already (see the bug-fix comments throughout `flow.ts` documenting exactly this kind of iteration against the real site).

- [ ] **Step 2: Build to catch type errors**

Run: `npm run -w mcp-boa-checkin build`
Expected: compiles clean (verifies `WalletPassData` minus `barcodeMessage` lines up with what Task 6 defined).

- [ ] **Step 3: Commit**

```bash
git add servers/boa-checkin/src/flow.ts
git commit -m "feat(boa-checkin): scrape wallet-pass display fields from a confirmed check-in"
```

---

## Task 10: Wire the `generateBoaWalletPass` MCP tool

**Files:**
- Modify: `servers/boa-checkin/src/index.ts`

- [ ] **Step 1: Add the handler function**

Add near the other handlers (after `setBoaFrequentFlyer`):

```typescript
// add to servers/boa-checkin/src/index.ts
import { readFileSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeBoardingPassBarcode } from "./wallet-pdf417.js";
import { loadWalletPassConfig, signAndPackagePass } from "./wallet-pass.js";
import { getWalletPassScrapeData } from "./flow.js";

const ASSETS_DIR = join(import.meta.dirname, "..", "assets");

interface WalletPassArgs {
  locator: string;
  apellido: string;
  tramo?: string;
  pasajero?: string;
}

async function generateBoaWalletPass(args: WalletPassArgs) {
  const config = loadWalletPassConfig(); // tira error explícito y ANTES de tocar el browser si falta config

  const session = await openBoaBrowserSession();
  try {
    await searchBoaReservation(session.page, args.locator, args.apellido);
    const pases = await getBoardingPassForJourney(session.page, args.tramo);
    const targetPass = args.pasajero
      ? pases.find((p) => p.nombre.toLowerCase().includes(args.pasajero!.toLowerCase()))
      : pases[0];
    if (!targetPass) {
      throw new Error(
        `No encontré el boarding pass de "${args.pasajero ?? "el pasajero"}" — pasajeros con boarding pass en este tramo: ${pases.map((p) => p.nombre).join(", ") || "ninguno"}.`,
      );
    }

    const scrapeData = await getWalletPassScrapeData(session.page, args.locator, args.tramo, targetPass.nombre);

    const pdfRes = await fetch(targetPass.url);
    if (!pdfRes.ok) throw new Error(`No pude descargar el PDF del boarding pass (HTTP ${pdfRes.status}).`);
    const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());
    const barcodeMessage = await decodeBoardingPassBarcode(pdfBuffer);

    const assets = {
      iconPng: readFileSync(join(ASSETS_DIR, "boa-icon.png")),
      icon2xPng: readFileSync(join(ASSETS_DIR, "boa-icon@2x.png")),
      logoPng: readFileSync(join(ASSETS_DIR, "boa-logo.png")),
      logo2xPng: readFileSync(join(ASSETS_DIR, "boa-logo@2x.png")),
    };

    const pkpassBuffer = await signAndPackagePass({ ...scrapeData, barcodeMessage }, config, assets);
    const pkpassPath = join(
      tmpdir(),
      `boa-wallet-${args.locator}-${targetPass.nombre.replace(/\s+/g, "")}.pkpass`,
    );
    writeFileSync(pkpassPath, pkpassBuffer);

    return asText({ pasajero: targetPass.nombre, pkpassPath });
  } finally {
    await session.close();
  }
}
```

- [ ] **Step 2: Register the tool in `ListToolsRequestSchema`**

Add this object to the `tools` array (after the `setBoaFrequentFlyer` entry):

```typescript
{
  name: "generateBoaWalletPass",
  description:
    "Genera un archivo .pkpass (Apple Wallet) escaneable del boarding pass de UN pasajero de un tramo de BoA YA checkeado — usar SOLO cuando Cal pida explícitamente 'el pase de Wallet'/'agrégalo a Wallet' (no se genera automáticamente junto al PDF). El código de barras es el mismo BCBP real del PDF oficial (decodificado del PDF417), así que sirve igual que el PDF en el control de embarque. `pasajero` (substring de nombre) desambigua si la reserva tiene más de uno; sin él toma el primero. Devuelve { pasajero, pkpassPath } — pkpassPath es un archivo LOCAL (no URL pública), hay que mandarlo con la tool de documento LOCAL del daemon, no con enviarDocumentoUrl. Si falta configurar el certificado (BOA_WALLET_* en apps.env) o el tramo no tiene el check-in hecho, tira error explícito.",
  inputSchema: {
    type: "object",
    properties: {
      locator: { type: "string" },
      apellido: { type: "string" },
      tramo: { type: "string" },
      pasajero: { type: "string", description: "Substring del nombre del pasajero, solo necesario si la reserva tiene más de uno." },
    },
    required: ["locator", "apellido"],
    additionalProperties: false,
  },
},
```

- [ ] **Step 3: Register the tool in `CallToolRequestSchema`**

Add this line alongside the other `if (name === ...)` dispatches:

```typescript
if (name === "generateBoaWalletPass") return await withLock(() => generateBoaWalletPass(args as unknown as WalletPassArgs));
```

- [ ] **Step 4: Build + run the full test suite**

```bash
npm run -w mcp-boa-checkin build
npm run -w mcp-boa-checkin test
```
Expected: both succeed with no errors; test count unchanged from Task 6 (this task adds no new unit tests, only wiring — the browser-driven path is validated in Task 12).

- [ ] **Step 5: Smoke-test the tool list**

```bash
node -e "
const { spawn } = require('child_process');
const p = spawn('node', ['servers/boa-checkin/dist/index.js']);
p.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list',params:{}})+'\n');
p.stdout.once('data', d => { console.log(d.toString()); p.kill(); });
setTimeout(() => p.kill(), 3000);
"
```
Expected: the JSON response's `tools` array includes an entry with `"name":"generateBoaWalletPass"`.

- [ ] **Step 6: Commit**

```bash
git add servers/boa-checkin/src/index.ts
git commit -m "feat(boa-checkin): wire generateBoaWalletPass MCP tool end to end"
```

---

## Task 11: `apps.env` config keys

**Files:**
- Modify: `~/.claude/secrets/apps.env`

- [ ] **Step 1: Append the new keys** (values filled in from Task 1's output — `passTypeIdentifier`/`teamIdentifier` come from Cal's Apple Developer portal registration)

```bash
cat >> ~/.claude/secrets/apps.env << 'EOF'

# BoA Wallet pass (.pkpass) — ver docs/superpowers/specs/2026-07-15-boa-wallet-pass-design.md
BOA_WALLET_PASS_TYPE_ID=
BOA_WALLET_TEAM_ID=
BOA_WALLET_SIGNER_CERT_PATH=/Users/calepes/.claude/secrets/boa-wallet/signerCert.pem
BOA_WALLET_SIGNER_KEY_PATH=/Users/calepes/.claude/secrets/boa-wallet/signerKey.pem
BOA_WALLET_SIGNER_KEY_PASSPHRASE=
BOA_WALLET_WWDR_PATH=/Users/calepes/Claude Projects/Personal/MCP Servers/mcp-servers/servers/boa-checkin/assets/AppleWWDRCAG4.pem
EOF
```

- [ ] **Step 2: Ask Cal to fill in the three empty values** (`BOA_WALLET_PASS_TYPE_ID`, `BOA_WALLET_TEAM_ID` from the Apple Developer portal; `BOA_WALLET_SIGNER_KEY_PASSPHRASE` from Task 1 Step 2) — this file is chmod 600 and not committed to any git repo, so there's nothing to commit here. Confirm permissions are still correct:

```bash
ls -l ~/.claude/secrets/apps.env
```
Expected: `-rw-------`.

---

## Task 12: Wire into Jano and Vesta

**Files (Jano — git root `Personal/Agents/Jano`):**
- Modify: `Jano/daemon-v2/src/agent-options.ts`
- Modify: `Jano/daemon-v2/src/tools/telegram-files.ts`
- Modify: `Jano/daemon-v2/src/agent-tools.ts`
- Modify: `Jano/daemon-v2/src/system-prompt.ts`

**Files (Vesta — git root `Personal/Agents/Vesta`), same changes:**
- Modify: `Vesta/daemon-v2/src/agent-options.ts`
- Modify: `Vesta/daemon-v2/src/tools/telegram-files.ts`
- Modify: `Vesta/daemon-v2/src/agent-tools.ts`
- Modify: `Vesta/daemon-v2/src/system-prompt.ts`

- [ ] **Step 1: Allow the new tool** — in both `agent-options.ts` files, add a line right after the existing `"mcp__boa-checkin__setBoaFrequentFlyer",` entry (Jano: line 138; Vesta: line 100):

```typescript
  "mcp__boa-checkin__generateBoaWalletPass",
```

- [ ] **Step 2: Add a local-file document sender** — in both `tools/telegram-files.ts` files, append:

```typescript
/** Manda un archivo LOCAL (no URL pública) como documento — usado por el .pkpass de boa-checkin, que no tiene URL pública. */
export async function enviarDocumentoLocal(
  token: string,
  chatId: number | string,
  filePath: string,
  filename: string,
  caption?: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { readFile } = await import("node:fs/promises");
    const buf = await readFile(filePath);
    const fd = new FormData();
    fd.append("chat_id", String(chatId));
    if (caption) fd.append("caption", caption);
    fd.append("document", new Blob([new Uint8Array(buf)]), filename);
    const res = await fetch(`${TG_API}/bot${token}/sendDocument`, {
      method: "POST",
      body: fd,
      signal: AbortSignal.timeout(30000),
    });
    const data = (await res.json()) as { ok: boolean; description?: string };
    return data.ok ? { ok: true } : { ok: false, error: data.description };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
```

- [ ] **Step 3: Add the agent tool** — in both `agent-tools.ts` files, add the import (alongside the existing `telegram-files` import, if any — otherwise add a new one) and a new `tool(...)` entry next to `enviarDocumentoUrl`:

```typescript
import { enviarDocumentoLocal } from "./tools/telegram-files.js";
```

```typescript
tool(
  "enviarDocumentoLocal",
  [
    "Manda al chat, como documento, un archivo que existe LOCALMENTE en este filesystem (ej. el .pkpass que devuelve mcp__boa-checkin__generateBoaWalletPass) — NO uses esta tool para URLs públicas, para eso está enviarDocumentoUrl.",
    "Args: { path: string (path local absoluto), filename: string (nombre con el que llega a Telegram, ej. 'boarding-pass.pkpass'), caption?: string }.",
    "Después de invocar esta tool no repitas el path ni lo describas: ya se envió. Responde solo una frase corta (o el error si status != sent).",
  ].join(" "),
  {
    path: z.string(),
    filename: z.string(),
    caption: z.string().optional(),
  },
  async ({ path, filename, caption }) => {
    const chatId = deps.getCurrentChatId?.();
    const token = deps.botToken;
    if (!chatId || !token) return asText({ status: "error", error: "No chatId/token disponible" });
    try {
      await sendChatAction(token, chatId, "upload_document").catch(() => {});
      const sent = await enviarDocumentoLocal(token, chatId, path, filename, caption);
      return asText(sent.ok ? { status: "sent" } : { status: "send_failed", error: sent.error });
    } catch (err) {
      return asText({ status: "send_failed", error: String(err) });
    }
  },
),
```

- [ ] **Step 4: Add system-prompt instructions** — in both `system-prompt.ts` files, add a new bullet right after the existing Elévate/`setBoaFrequentFlyer` section (Jano: after line 390; Vesta: after line 189):

```
- **Pase de Apple Wallet:** si Cal pide "el pase de Wallet"/"agrégalo a Wallet" de un tramo YA checkeado, llamá \`mcp__boa-checkin__generateBoaWalletPass({ locator, apellido, tramo?, pasajero? })\` → devuelve \`{ pasajero, pkpassPath }\`. Mandá el archivo con \`enviarDocumentoLocal({ path: pkpassPath, filename: "boarding-pass.pkpass" })\` — **NUNCA** con \`enviarDocumentoUrl\` (pkpassPath es un archivo local, no una URL pública). Si la tool tira error de configuración faltante o de tramo sin check-in, repetí ESE mensaje a Cal, no inventes nada.
```

- [ ] **Step 5: Build both daemons**

```bash
cd "/Users/calepes/Claude Projects/Personal/Agents/Jano/daemon-v2" && npm run build
cd "/Users/calepes/Claude Projects/Personal/Agents/Vesta/daemon-v2" && npm run build
```
Expected: both compile with no errors.

- [ ] **Step 6: Commit each daemon separately**

```bash
cd "/Users/calepes/Claude Projects/Personal/Agents/Jano"
git add daemon-v2/src/agent-options.ts daemon-v2/src/tools/telegram-files.ts daemon-v2/src/agent-tools.ts daemon-v2/src/system-prompt.ts
git commit -m "feat(boa-checkin): wire generateBoaWalletPass + local document sender"

cd "/Users/calepes/Claude Projects/Personal/Agents/Vesta"
git add daemon-v2/src/agent-options.ts daemon-v2/src/tools/telegram-files.ts daemon-v2/src/agent-tools.ts daemon-v2/src/system-prompt.ts
git commit -m "feat(boa-checkin): wire generateBoaWalletPass + local document sender"
```

---

## Task 13: End-to-end manual verification

**Files:** none — this is a real-world check, not code.

- [ ] **Step 1: Rebuild and restart whichever daemon Cal will test through** (Jano or Vesta), per that daemon's existing restart procedure.

- [ ] **Step 2: Ask Cal for a locator/apellido of a real, already-checked-in BoA reservation.**

- [ ] **Step 3: In Telegram, ask the daemon for the Wallet pass** ("dame el pase de Wallet de mi vuelo a Santa Cruz") and confirm:
  - a `.pkpass` file arrives as a document (not a link/text)
  - opening it on an iPhone offers "Add to Wallet" and the card matches the approved mockup layout (route, big departure time, group/gate/seat row, Elévate number, tap-to-flip back with locator/sequence/airports)

- [ ] **Step 4: Compare the barcode payload** — decode the same PDF's PDF417 manually (any barcode scanner app) and diff against what the `.pkpass` encodes, OR simply scan both with a phone barcode reader and confirm they read identical text. This is the strongest signal the pass will actually work at a real BoA gate; scanning it at an actual gate is the only fully conclusive test, and stays a follow-up for Cal's next real flight (not blocking here).

- [ ] **Step 5: Report results to Cal** — if anything in the mockup's approved layout doesn't match (wrong field, missing gate, garbled barcode), fix the specific module (Task 6 for field text, Task 9 for scraping bugs, Task 3/4 for decode issues) rather than patching around it in `index.ts`.

---

## Self-review notes

- **Spec coverage:** all 5 pipeline steps from the spec map to tasks (1: scrape+URL → Task 9; 2: download → Task 10; 3: decode → Tasks 3–4; 4: build+sign → Tasks 5–7; 5: save+deliver → Tasks 10, 12). Elévate field (Task 6/9), back fields (Task 6/9), error handling (Task 5, and `generateBoaWalletPass`'s explicit throws in Task 10), brand assets (Task 8), daemon integration (Task 12) are all covered.
- **Divergence flagged:** the `.p12`-in-`apps.env` idea from the spec is corrected to PEM-cert-path + PEM-key-path (Task 1/5/11), with the private key explicitly kept out of git — called out at the top of this plan and in Task 1's intro, not silently changed.
- **Type consistency checked:** `WalletPassData` (Task 6) ↔ `getWalletPassScrapeData`'s return type (Task 9, `Omit<WalletPassData, "barcodeMessage">`) ↔ `generateBoaWalletPass`'s `{ ...scrapeData, barcodeMessage }` (Task 10) all line up on the same field names. `loadWalletPassConfig`'s `WalletPassConfig` (Task 5) is the same shape consumed by `signAndPackagePass` (Task 7).
- **No placeholders:** every step has real code or a real shell command; the two spots with genuine external-API uncertainty (`zxing-wasm` subpath import in Task 4, `passkit-generator`'s certificate shape in Task 7) carry a concrete verification command, not a "TBD".
