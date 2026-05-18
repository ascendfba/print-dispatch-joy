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

// Wide-matrix CSV: one row per client, one column per service.
// Columns: ClientID, ClientName, <Service Label 1>, <Service Label 2>, ...
// ClientID "*" = default fallback for any client without a specific rate.
// A hidden second header row carries the machine codes so re-imports stay
// stable even if a label is reworded in Excel.
export function ratesToCsv(
  rates: ReworkRates,
  clientLookup: (id: string) => string,
): string {
  const labelHeader = [
    "ClientID",
    "ClientName",
    ...REWORK_CATALOG.map((c) => c.label),
  ]
    .map(csvField)
    .join(",");
  const codeHeader = [
    "*code*",
    "*code*",
    ...REWORK_CATALOG.map((c) => c.key),
  ]
    .map(csvField)
    .join(",");

  const clientIds = Object.keys(rates);
  if (!clientIds.includes(DEFAULT_CLIENT_KEY)) clientIds.unshift(DEFAULT_CLIENT_KEY);

  const rows: string[] = [];
  for (const cid of clientIds) {
    const name = cid === DEFAULT_CLIENT_KEY ? "Default" : clientLookup(cid);
    const cells = [csvField(cid), csvField(name)];
    for (const code of REWORK_CATALOG) {
      const rate = rates[cid]?.[code.key];
      cells.push(rate == null ? "" : rate.toFixed(2));
    }
    rows.push(cells.join(","));
  }
  return [labelHeader, codeHeader, ...rows].join("\n");
}

export function csvToRates(csv: string): ReworkRates {
  const out: ReworkRates = {};
  const validKeys = new Set(REWORK_CATALOG.map((c) => c.key));
  const labelToKey = new Map<string, string>(
    REWORK_CATALOG.map((c) => [c.label.toLowerCase(), c.key]),
  );
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return out;

  const firstCells = parseCsvLine(lines[0]).map((c) => c.trim());
  const isLegacy =
    /^clientid$/i.test(firstCells[0] ?? "") &&
    /^code$/i.test(firstCells[2] ?? "") &&
    /^rateperunit$/i.test(firstCells[4] ?? "");

  // Legacy long format: ClientID, ClientName, Code, Label, RatePerUnit
  if (isLegacy) {
    for (let i = 1; i < lines.length; i++) {
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

  // Wide format. Header row 1 = labels (or codes); optional row 2 = codes.
  const headerLabels = firstCells;
  let codeRow: string[] | null = null;
  let dataStart = 1;
  if (lines.length > 1) {
    const second = parseCsvLine(lines[1]).map((c) => c.trim());
    if (second[0] === "*code*" || second[1] === "*code*") {
      codeRow = second;
      dataStart = 2;
    }
  }

  // Resolve each column (index >= 2) to a rate code.
  const colToKey = new Map<number, string>();
  for (let i = 2; i < headerLabels.length; i++) {
    const fromCode = codeRow?.[i];
    if (fromCode && validKeys.has(fromCode)) {
      colToKey.set(i, fromCode);
      continue;
    }
    const label = headerLabels[i]?.toLowerCase() ?? "";
    const k = labelToKey.get(label);
    if (k) colToKey.set(i, k);
    else if (validKeys.has(headerLabels[i] ?? "")) {
      colToKey.set(i, headerLabels[i]);
    }
  }

  for (let i = dataStart; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    if (cells.length < 2) continue;
    const clientId = cells[0].trim() || DEFAULT_CLIENT_KEY;
    const row: Record<string, number> = { ...(out[clientId] ?? {}) };
    for (const [colIdx, key] of colToKey) {
      const raw = (cells[colIdx] ?? "").trim();
      if (raw === "") continue;
      const n = Number(raw);
      if (Number.isFinite(n)) row[key] = n;
    }
    if (Object.keys(row).length > 0) out[clientId] = row;
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