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

async function makePrintablePdf(bytes: Uint8Array): Promise<Uint8Array> {
  // Previously this rebuilt every PDF via pdf-lib `embedPage` to ensure an
  // opaque white background. That transformation lost rotation, cropbox
  // offsets and form XObjects on real-world Mintsoft documents (invoices,
  // picking lists, courier labels) — Chrome's PDF viewer then printed a
  // blank page. Trust the source PDF as-is; it's already a valid PDF from
  // Mintsoft / pdf-lib.
  return bytes;
}

export async function printPdfBytes(
  bytes: Uint8Array,
  printerName: string,
  silent = true,
  meta?: PrintMeta,
): Promise<void> {
  if (!printerName) throw new Error("No printer configured");
  if (isElectron()) {
    let printableByteSize = bytes.byteLength;
    let res: { ok: boolean; error?: string };

    try {
      const printableBytes = await makePrintablePdf(bytes);
      printableByteSize = printableBytes.byteLength;
      res = await window.dispatchAPI!.printPdf({
        base64: bytesToBase64(printableBytes),
        printerName,
        silent,
      });
    } catch {
      res = await window.dispatchAPI!.printPdf({
        base64: bytesToBase64(bytes),
        printerName,
        silent,
      });
    }

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
