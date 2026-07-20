import { createCanvas } from "@napi-rs/canvas";
// pdfjs-dist's legacy Node build works without any DOM globals.
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { readBarcodes } from "zxing-wasm/reader";

class NodeCanvasFactory {
  create(width: number, height: number) {
    const canvas = createCanvas(width, height);
    const context = canvas.getContext("2d");
    return { canvas, context };
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
    try {
      // pdfjs-dist 6.x ya no acepta `canvasFactory` en render() (API vieja) —
      // ahora toma el canvas/contexto directo. `canvas` queda null porque
      // usamos `canvasContext` (contexto 2D de @napi-rs/canvas) explícito.
      await page.render({
        canvas: null,
        canvasContext: canvasAndContext.context,
        viewport,
      }).promise;
      const imageData = canvasAndContext.context.getImageData(0, 0, viewport.width, viewport.height);
      return { data: imageData.data, width: imageData.width, height: imageData.height };
    } finally {
      canvasFactory.destroy(canvasAndContext);
    }
  } finally {
    // En pdfjs-dist 6.1.200, destroy() vive en loadingTask, no en el
    // PDFDocumentProxy resuelto (pdfDocument.destroy no existe).
    await loadingTask.destroy();
  }
}

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

export interface BcbpEssentials {
  originCode: string;
  destinationCode: string;
  carrier: string;
  flightNumber: string;
  seat: string;
}

/**
 * Extrae origen/destino/vuelo/asiento del mensaje BCBP crudo (formato "M1",
 * IATA Bar Coded Boarding Pass) anclando la lectura en el PNR/locator YA
 * conocido, en vez de offsets absolutos fijos desde el inicio del mensaje.
 *
 * Bug real 2026-07-20 (reserva HVKNUC): la primera versión de esta función
 * usaba offsets absolutos calibrados contra UN decode real. Funcionó para
 * ese decode, pero en un segundo decode del MISMO PNR (después de un cambio
 * de asiento) el campo de nombre del pasajero salió 1 carácter más corto
 * ("LEPESQUEUR" en vez de "LEPESQUEUER" — ruido del decode PDF417, no un
 * dato real distinto) y corrió todos los campos siguientes una posición:
 * origen/destino salieron "VIL"/"PBO" en vez de "VVI"/"LPB". El campo de
 * nombre NO tiene largo confiable entre lecturas; el PNR sí lo conocemos de
 * antemano (`args.locator`) y es angosto — buscarlo con `indexOf` da un
 * ancla confiable. El PNR ocupa 7 caracteres justo antes de From/To, así
 * que el resto de los campos se leen relativos a `pnrIndex + 7`. Validado
 * contra ambos decodes reales de HVKNUC (el corrupto y el limpio) — los dos
 * dan VVI/LPB/OB663 con este anclaje.
 *
 * Degrada con gracia (campos vacíos, nunca throw) si no encuentra el PNR o
 * el mensaje es más corto que lo esperado — mismo criterio que el resto del
 * scraping best-effort de este MCP.
 */
export function parseBcbpEssentials(message: string, pnrCode: string): BcbpEssentials {
  const empty = { originCode: "", destinationCode: "", carrier: "", flightNumber: "", seat: "" };
  const pnrIndex = message.indexOf(pnrCode.toUpperCase());
  if (pnrIndex === -1) return empty;

  const routeStart = pnrIndex + 7; // el campo PNR (7 chars) termina justo antes de From/To
  if (message.length < routeStart + 22) return empty;

  const carrier = message.slice(routeStart + 6, routeStart + 9).trim();
  const flightDigits = message.slice(routeStart + 9, routeStart + 14).trim().replace(/^0+/, "");
  const seatRow = message.slice(routeStart + 18, routeStart + 21).replace(/^0+/, "");
  const seatLetter = message.slice(routeStart + 21, routeStart + 22);
  return {
    originCode: message.slice(routeStart, routeStart + 3),
    destinationCode: message.slice(routeStart + 3, routeStart + 6),
    carrier,
    flightNumber: flightDigits ? `${carrier}${flightDigits}` : "",
    seat: seatRow && seatLetter ? `${seatRow}${seatLetter}` : "",
  };
}
