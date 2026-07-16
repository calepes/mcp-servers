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
