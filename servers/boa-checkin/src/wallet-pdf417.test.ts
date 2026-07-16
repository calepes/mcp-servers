import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import bwipjs from "bwip-js";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import {
  renderPdfFirstPageToImageData,
  decodePdf417FromImageData,
  decodeBoardingPassBarcode,
} from "./wallet-pdf417.js";

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

describe("decodePdf417FromImageData", () => {
  it("recovers the original string encoded in a PDF417 barcode", async () => {
    const barcodePng = await bwipjs.toBuffer({
      bcid: "pdf417",
      text: "M1LEPESQUEUER/CARLOS  EXK9F2P OB682 190 25C0014 147>",
      scale: 3,
      height: 12,
      includetext: false,
    });
    const img = await loadImage(barcodePng);
    const canvas = createCanvas(img.width, img.height);
    const ctx = canvas.getContext("2d");
    // bwip-js renders PDF417 PNGs with a transparent background (only the bars are
    // opaque) — @napi-rs/canvas starts fully transparent too, so without an opaque
    // white fill first, the "white" quiet zone stays alpha=0 and zxing-wasm's RGB->gray
    // conversion reads it as black, collapsing the whole barcode into a solid blob.
    // A real render (e.g. renderPdfFirstPageToImageData) always has an opaque page
    // background, so this fill just matches what a genuine rendered image looks like.
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, img.width, img.height);
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, img.width, img.height);

    const text = await decodePdf417FromImageData({
      data: imageData.data as Uint8ClampedArray,
      width: imageData.width,
      height: imageData.height,
    });

    expect(text).toBe("M1LEPESQUEUER/CARLOS  EXK9F2P OB682 190 25C0014 147>");
  });
});

describe("decodeBoardingPassBarcode", () => {
  it("decodes a PDF417 embedded as an image in a PDF page", async () => {
    const bcbp = "M1LEPESQUEUER/CARLOS  EXK9F2P OB682 190 25C0014 147>";
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
