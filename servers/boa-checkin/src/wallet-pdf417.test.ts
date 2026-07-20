import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import bwipjs from "bwip-js";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import {
  renderPdfFirstPageToImageData,
  decodePdf417FromImageData,
  decodeBoardingPassBarcode,
  parseBcbpEssentials,
} from "./wallet-pdf417.js";

describe("parseBcbpEssentials", () => {
  // Dos decodes reales del MISMO BCBP (reserva HVKNUC, OB663, Santa Cruz ->
  // La Paz, 2026-07-20 — antes y después de un cambio de asiento). El
  // segundo decode leyó el campo de nombre 1 carácter más corto
  // ("LEPESQUEUR" vs "LEPESQUEUER" — ruido del decode PDF417, no un dato
  // real distinto), lo que corría origen/destino con offsets absolutos
  // ("VIL"/"PBO" en vez de "VVI"/"LPB"). Ambos deben dar el mismo resultado
  // de ruta con el anclaje por PNR.
  const realBcbpSeat29F =
    "M1LEPESQUEUER/CARLOS   EHVKNUC VVILPBOB 0663 202Y029F0033 333>2080      B25             0    OB 1004032503      ";
  const realBcbpSeat9B =
    "M1LEPESQUEUR/CARLOS   EHVKNUC VVILPBOB 0663 202Y009B0033 333>2080      B25             0    OB 1004032503      ";

  it("extracts origin, destination, flight number and seat from a real BCBP message", () => {
    expect(parseBcbpEssentials(realBcbpSeat29F, "HVKNUC")).toEqual({
      originCode: "VVI",
      destinationCode: "LPB",
      carrier: "OB",
      flightNumber: "OB663",
      seat: "29F",
    });
  });

  it("stays correct when a shorter name field shifts every fixed-offset column by one", () => {
    expect(parseBcbpEssentials(realBcbpSeat9B, "HVKNUC")).toEqual({
      originCode: "VVI",
      destinationCode: "LPB",
      carrier: "OB",
      flightNumber: "OB663",
      seat: "9B",
    });
  });

  it("returns empty fields instead of throwing when the PNR isn't found in the message", () => {
    expect(parseBcbpEssentials("M1TOO SHORT", "HVKNUC")).toEqual({
      originCode: "",
      destinationCode: "",
      carrier: "",
      flightNumber: "",
      seat: "",
    });
  });

  it("returns empty fields when the PNR is found but the message is truncated right after it", () => {
    expect(parseBcbpEssentials("M1NAME EHVKNUC", "HVKNUC")).toEqual({
      originCode: "",
      destinationCode: "",
      carrier: "",
      flightNumber: "",
      seat: "",
    });
  });
});

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
