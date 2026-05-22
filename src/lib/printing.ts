import { PDFDocument } from "pdf-lib";
import { bytesToBase64 } from "./mintsoft";
import type { Settings } from "./storage";
import type { LabelKind } from "./pdfSize";
import { logPrintEvent } from "./print-history.functions";

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

type ElectronPrintResult = { ok: boolean; error?: string; logPath?: string };
type ElectronPrintApi = NonNullable<Window["dispatchAPI"]> & {
  debugPrintLog?: (args: Record<string, unknown>) => Promise<{ ok: boolean; logPath?: string }>;
  printPdf: (args: {
    base64: string;
    printerName: string;
    silent: boolean;
    pageSize?: { widthPt: number; heightPt: number };
  }) => Promise<ElectronPrintResult>;
  printRasterPages: (args: {
    pages: Array<{ pngBase64: string; widthPt: number; heightPt: number }>;
    printerName: string;
    silent: boolean;
  }) => Promise<ElectronPrintResult>;
};

function electronApi(): ElectronPrintApi {
  return window.dispatchAPI! as ElectronPrintApi;
}

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

/**
 * Inspect the PDF's first page so we can tell Electron the exact paper
 * size. Without this, Chromium falls back to the printer's default paper
 * (usually A4) and scales / clips the PDF — courier labels end up tiny on
 * a huge page, invoices get cropped, etc.
 */
async function readFirstPageSizePt(
  bytes: Uint8Array,
): Promise<{ widthPt: number; heightPt: number } | null> {
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const page = doc.getPages()[0];
    if (!page) return null;
    const { width, height } = page.getSize();
    const rotation = page.getRotation().angle % 360;
    const swap = rotation === 90 || rotation === 270;
    return {
      widthPt: swap ? height : width,
      heightPt: swap ? width : height,
    };
  } catch {
    return null;
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
    const printableByteSize = bytes.byteLength;
    const pageSize = await readFirstPageSizePt(bytes);
    const res = await window.dispatchAPI!.printPdf({
      base64: bytesToBase64(bytes),
      printerName,
      silent,
      pageSize: pageSize ?? undefined,
    });

    if (!res.ok) {
      fireLog({
        printer: printerName,
        meta,
        byteSize: printableByteSize,
        status: "error",
        error: res.error || "Print failed",
      });
      throw new Error(res.error || "Print failed");
    }
    fireLog({ printer: printerName, meta, byteSize: printableByteSize, status: "success" });
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
