export type ScannedLabel = {
  pageIndex: number;
  text: string;
  barcode: string | null;
};

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

async function makeReader() {
  const [{ BrowserMultiFormatReader }, zxingLib] = await Promise.all([
    import("@zxing/browser"),
    import("@zxing/library"),
  ]);
  const { DecodeHintType, BarcodeFormat } = zxingLib;
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E,
    BarcodeFormat.CODE_128,
    BarcodeFormat.CODE_39,
    BarcodeFormat.ITF,
  ]);
  hints.set(DecodeHintType.TRY_HARDER, true);
  return new BrowserMultiFormatReader(hints);
}

/**
 * Render each page of the label PDF to canvas, OCR-ish extract text content,
 * and attempt to decode any barcode present.
 */
export async function scanLabelPdf(bytes: Uint8Array): Promise<ScannedLabel[]> {
  const pdfjs = await loadPdfjs();
  const data = bytes.slice().buffer;
  const pdf = await pdfjs.getDocument({ data }).promise;
  const reader = await makeReader();
  const out: ScannedLabel[] = [];

  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);

      // Extract printed text from PDF directly.
      let text = "";
      try {
        const tc = await page.getTextContent();
        const rows = tc.items
          .map((it) => {
            const item = it as { str?: string; transform?: number[] };
            return {
              str: item.str ?? "",
              x: item.transform?.[4] ?? 0,
              y: item.transform?.[5] ?? 0,
            };
          })
          .filter((it) => it.str.trim());
        rows.sort((a, b) => Math.abs(b.y - a.y) > 3 ? b.y - a.y : a.x - b.x);
        const lines: Array<{ y: number; parts: string[] }> = [];
        for (const row of rows) {
          const line = lines.find((l) => Math.abs(l.y - row.y) <= 3);
          if (line) line.parts.push(row.str);
          else lines.push({ y: row.y, parts: [row.str] });
        }
        text = lines
          .map((line) => line.parts.join(" ").replace(/\s+/g, " ").trim())
          .filter(Boolean)
          .join("\n");
      } catch {
        text = "";
      }

      // Render at higher scale so the barcode bars are crisp.
      const viewport = page.getViewport({ scale: 4 });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;

      let barcode: string | null = null;
      try {
        const result = await reader.decodeFromCanvas(canvas);
        barcode = result.getText();
      } catch {
        barcode = null;
      }

      out.push({ pageIndex: i - 1, text, barcode });
    }
  } finally {
    await pdf.destroy();
  }

  return out;
}

/**
 * Build a lookup from SKU -> barcode by matching each scanned label's text
 * against a list of known SKUs. SKUs are matched case-insensitively as
 * whole tokens to avoid false positives.
 */
export function buildSkuBarcodeMap(
  scans: ScannedLabel[],
  skus: string[],
): Map<string, string> {
  const map = new Map<string, string>();
  const cleanSkus = skus
    .filter((s): s is string => typeof s === "string" && s.length > 0)
    .map((s) => ({ original: s, lower: s.toLowerCase() }));

  for (const scan of scans) {
    if (!scan.barcode) continue;
    const haystack = scan.text.toLowerCase();
    if (!haystack) continue;
    for (const { original, lower } of cleanSkus) {
      if (map.has(original)) continue;
      // word-ish boundary match
      const re = new RegExp(`(^|[^a-z0-9])${lower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`);
      if (re.test(haystack)) {
        map.set(original, scan.barcode);
        break;
      }
    }
  }
  return map;
}