import type { ReworkRates } from "@/lib/storage";

export type ReworkCode = {
  key: string;
  label: string;
  barcode: string;
};

export const REWORK_CATALOG: ReworkCode[] = [
  { key: "fnsku", label: "FNSKU Labelling", barcode: "9384921831" },
  { key: "carton_forwarded", label: "Cartons Forwarded", barcode: "" },
  { key: "carton_supplied", label: "Carton Supplied", barcode: "" },
  { key: "poly_s", label: "Poly-S", barcode: "" },
  { key: "poly_m", label: "Poly-M", barcode: "" },
  { key: "poly_l", label: "Poly-L", barcode: "" },
  { key: "bubble", label: "Bubble", barcode: "" },
  { key: "bundle", label: "Bundles < 6 units", barcode: "9384924819" },
  { key: "bundle_over6", label: "Bundle additional items", barcode: "430395832384" },
  { key: "pallet", label: "Pallet Processing", barcode: "" },
];

export const DEFAULT_CLIENT_KEY = "*";

export function getRate(
  rates: ReworkRates,
  clientId: number | string | null | undefined,
  reworkKey: string,
): number | undefined {
  const cid = clientId == null ? "" : String(clientId);
  const direct = rates[cid]?.[reworkKey];
  if (typeof direct === "number" && Number.isFinite(direct)) return direct;
  const fallback = rates[DEFAULT_CLIENT_KEY]?.[reworkKey];
  if (typeof fallback === "number" && Number.isFinite(fallback)) return fallback;
  return undefined;
}

export function formatGBP(value: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

// CSV columns: ClientID, ClientName, Code, Label, RatePerUnit
// ClientID "*" = default fallback for any client without a specific rate.
export function ratesToCsv(
  rates: ReworkRates,
  clientLookup: (id: string) => string,
): string {
  const header = "ClientID,ClientName,Code,Label,RatePerUnit";
  const rows: string[] = [];
  const clientIds = Object.keys(rates);
  if (!clientIds.includes(DEFAULT_CLIENT_KEY)) clientIds.unshift(DEFAULT_CLIENT_KEY);
  for (const cid of clientIds) {
    const name = cid === DEFAULT_CLIENT_KEY ? "Default" : clientLookup(cid);
    for (const code of REWORK_CATALOG) {
      const rate = rates[cid]?.[code.key];
      rows.push(
        [
          csvField(cid),
          csvField(name),
          csvField(code.key),
          csvField(code.label),
          rate == null ? "" : rate.toFixed(2),
        ].join(","),
      );
    }
  }
  return [header, ...rows].join("\n");
}

export function csvToRates(csv: string): ReworkRates {
  const out: ReworkRates = {};
  const validKeys = new Set(REWORK_CATALOG.map((c) => c.key));
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return out;
  // Skip header if present.
  const startIdx = /clientid/i.test(lines[0]) ? 1 : 0;
  for (let i = startIdx; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    if (cells.length < 5) continue;
    const [cid, , code, , rateStr] = cells;
    const key = code.trim();
    if (!validKeys.has(key)) continue;
    const rate = Number(rateStr);
    if (!Number.isFinite(rate)) continue;
    const clientId = cid.trim() || DEFAULT_CLIENT_KEY;
    out[clientId] = { ...(out[clientId] ?? {}), [key]: rate };
  }
  return out;
}

function csvField(v: string): string {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else if (ch === '"') {
      inQuotes = true;
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}