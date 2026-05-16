import { PDFDocument } from "pdf-lib";

// PDF user-space units = 1/72 inch. 1mm = 2.8346 pt.
const MM = 2.8346456693;

export type LabelKind = "small" | "large" | "other";

export type DetectedSize = {
  widthMm: number;
  heightMm: number;
  kind: LabelKind;
};

function near(a: number, b: number, tol = 4) {
  return Math.abs(a - b) <= tol;
}

export function classify(widthMm: number, heightMm: number): LabelKind {
  const w = Math.min(widthMm, heightMm);
  const h = Math.max(widthMm, heightMm);
  // 50 x 25 mm FNSKU labels (tolerate up to ~5mm drift)
  if (near(w, 25, 5) && near(h, 50, 6)) return "small";
  // 4x6" shipping labels — nominal 100x150mm, but couriers ship 102x152
  // and some (e.g. UPS) come out at 108x152. Widen tolerance to cover all.
  if (w >= 95 && w <= 115 && h >= 145 && h <= 160) return "large";
  return "other";
}

export async function detectFromBytes(bytes: Uint8Array): Promise<DetectedSize> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const page = doc.getPage(0);
  const { width, height } = page.getSize();
  const widthMm = Math.round(width / MM);
  const heightMm = Math.round(height / MM);
  return { widthMm, heightMm, kind: classify(widthMm, heightMm) };
}