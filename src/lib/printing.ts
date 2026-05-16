import { bytesToBase64 } from "./mintsoft";
import type { Settings } from "./storage";
import type { LabelKind } from "./pdfSize";

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

export async function printPdfBytes(
  bytes: Uint8Array,
  printerName: string,
  silent = true,
): Promise<void> {
  if (!printerName) throw new Error("No printer configured");
  if (isElectron()) {
    const res = await window.dispatchAPI!.printPdf({
      base64: bytesToBase64(bytes),
      printerName,
      silent,
    });
    if (!res.ok) throw new Error(res.error || "Print failed");
    return;
  }
  // Browser fallback: open the PDF in a new tab — user prints manually.
  const blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const w = window.open(url, "_blank");
  if (w) {
    setTimeout(() => {
      try {
        w.focus();
        w.print();
      } catch {
        /* ignore */
      }
    }, 800);
  }
}