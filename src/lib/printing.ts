import { PDFDocument, rgb } from "pdf-lib";
import { bytesToBase64 } from "./mintsoft";
import type { Settings } from "./storage";
import type { LabelKind } from "./pdfSize";
import { logPrintEvent } from "./print-history.functions";

let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;

async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import("pdfjs-dist");
      const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

export function isElectron(): boolean {
  return typeof window !== "undefined" && !!window.dispatchAPI?.isElectron;
}

export async function listInstalledPrinters(): Promise<string[]> {
  if (!isElectron()) return [];
  return window.dispatchAPI!.listPrinters();
}

export function pickPrinter(settings: Settings, kind: LabelKind): string {
  return settings.printers[kind] || settings.printers.other;
}

export type PrintMeta = {
  kind?: string;
  label?: string;
  orderId?: string;
};

function fireLog(args: {
  printer: string;
  meta?: PrintMeta;
  byteSize: number;
  status: "success" | "error";
  error?: string;
}) {
  const source: "web" | "desktop" = isElectron() ? "desktop" : "web";
  // Fire-and-forget; never block the print flow on logging.
  void logPrintEvent({
    data: {
      printer: args.printer,
      kind: args.meta?.kind ?? null,
      label: args.meta?.label ?? null,
      orderId: args.meta?.orderId ?? null,
      byteSize: args.byteSize,
      status: args.status,
      error: args.error ?? null,
      source,
    },
  }).catch(() => {
    /* logging failures must not break printing */
  });
}

async function addOpaqueWhiteBackground(bytes: Uint8Array): Promise<Uint8Array> {
  try {
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const out = await PDFDocument.create();

    for (const srcPage of src.getPages()) {
      const { width, height } = srcPage.getSize();
      const embedded = await out.embedPage(srcPage);
      const page = out.addPage([width, height]);
      page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(1, 1, 1) });
      page.drawPage(embedded, { x: 0, y: 0, width, height });
    }

    return await out.save({ useObjectStreams: false });
  } catch {
    return bytes;
  }
}

async function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => {
      if (value) resolve(value);
      else reject(new Error("Could not rasterize PDF page"));
    }, "image/png");
  });
  return new Uint8Array(await blob.arrayBuffer());
}

async function rasterizePdfForPrint(bytes: Uint8Array): Promise<Uint8Array> {
  const pdfjs = await loadPdfjs();
  const loadingTask = pdfjs.getDocument({ data: bytes.slice().buffer });
  const src = await loadingTask.promise;
  const out = await PDFDocument.create();

  try {
    for (let pageIndex = 1; pageIndex <= src.numPages; pageIndex++) {
      const srcPage = await src.getPage(pageIndex);
      const baseViewport = srcPage.getViewport({ scale: 1 });
      const maxEdge = Math.max(baseViewport.width, baseViewport.height);
      const scale = Math.min(8, Math.max(2, 1800 / maxEdge));
      const viewport = srcPage.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d", { alpha: false });
      if (!ctx) throw new Error("Could not create PDF print canvas");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await srcPage.render({
        canvas,
        canvasContext: ctx,
        viewport,
        background: "#ffffff",
      }).promise;

      const image = await out.embedPng(await canvasToPngBytes(canvas));
      const page = out.addPage([baseViewport.width, baseViewport.height]);
      page.drawRectangle({
        x: 0,
        y: 0,
        width: baseViewport.width,
        height: baseViewport.height,
        color: rgb(1, 1, 1),
      });
      page.drawImage(image, {
        x: 0,
        y: 0,
        width: baseViewport.width,
        height: baseViewport.height,
      });
    }

    return await out.save({ useObjectStreams: false });
  } finally {
    await src.destroy();
  }
}

async function makePrintablePdf(bytes: Uint8Array): Promise<Uint8Array> {
  try {
    return await rasterizePdfForPrint(bytes);
  } catch {
    return addOpaqueWhiteBackground(bytes);
  }
}

export async function printPdfBytes(
  bytes: Uint8Array,
  printerName: string,
  silent = true,
  meta?: PrintMeta,
): Promise<void> {
  if (!printerName) throw new Error("No printer configured");
  if (isElectron()) {
    const printableBytes = await makePrintablePdf(bytes);
    const res = await window.dispatchAPI!.printPdf({
      base64: bytesToBase64(printableBytes),
      printerName,
      silent,
    });
    if (!res.ok) {
      fireLog({
        printer: printerName,
        meta,
        byteSize: printableBytes.byteLength,
        status: "error",
        error: res.error || "Print failed",
      });
      throw new Error(res.error || "Print failed");
    }
    fireLog({ printer: printerName, meta, byteSize: printableBytes.byteLength, status: "success" });
    return;
  }
  // Browser fallback: open the PDF in a new tab — user prints manually.
  const blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const w = window.open(url, "_blank");
  if (!w) {
    fireLog({
      printer: printerName,
      meta,
      byteSize: bytes.byteLength,
      status: "error",
      error: "Popup blocked — allow popups for this site to print from the browser.",
    });
    throw new Error(
      "Popup blocked. Allow popups for this site, or install the desktop app for silent printing.",
    );
  }
  setTimeout(() => {
    try {
      w.focus();
      w.print();
    } catch {
      /* ignore */
    }
  }, 800);
  fireLog({ printer: printerName, meta, byteSize: bytes.byteLength, status: "success" });
}
