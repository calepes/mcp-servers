import { createCanvas } from "@napi-rs/canvas";
// pdfjs-dist's legacy Node build works without any DOM globals.
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

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
