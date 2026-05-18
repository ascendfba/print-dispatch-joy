import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { requireAuth } from "@/lib/require-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Upload,
  Download,
  Loader2,
  Receipt,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { loadSettings } from "@/lib/storage";
import { fetchOrderComments } from "@/lib/mintsoft";

export const Route = createFileRoute("/invoice-merger")({
  beforeLoad: ({ location }) => requireAuth(location),
  component: InvoiceMergerPage,
});

type Row = Record<string, string>;

type MergeResult = {
  orderRef: string;
  charge: number | null;
  notes: string;
  error?: string;
};

const ORDER_COL_CANDIDATES = [
  "ordernumber",
  "order number",
  "order_no",
  "order no",
  "orderno",
  "orderid",
  "order id",
  "order_id",
  "order",
  "channelorderref",
  "channel order ref",
  "reference",
];

function parseCsv(text: string): { headers: string[]; rows: Row[] } {
  const lines: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQ = false;
      } else field += ch;
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === ",") {
      cur.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      cur.push(field);
      lines.push(cur);
      cur = [];
      field = "";
    } else field += ch;
  }
  if (field.length > 0 || cur.length > 0) {
    cur.push(field);
    lines.push(cur);
  }
  const nonEmpty = lines.filter((r) => r.some((c) => c.trim().length > 0));
  if (nonEmpty.length === 0) return { headers: [], rows: [] };
  const headers = nonEmpty[0].map((h) => h.trim());
  const rows = nonEmpty.slice(1).map((r) => {
    const obj: Row = {};
    headers.forEach((h, idx) => {
      obj[h] = (r[idx] ?? "").trim();
    });
    return obj;
  });
  return { headers, rows };
}

function csvField(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function toCsv(headers: string[], rows: Row[]): string {
  const head = headers.map(csvField).join(",");
  const body = rows
    .map((r) => headers.map((h) => csvField(r[h] ?? "")).join(","))
    .join("\n");
  return head + "\n" + body + "\n";
}

function detectOrderColumn(headers: string[]): string | null {
  const lower = headers.map((h) => h.toLowerCase().replace(/[_\s-]+/g, " ").trim());
  for (const cand of ORDER_COL_CANDIDATES) {
    const idx = lower.indexOf(cand.replace(/[_\s-]+/g, " ").trim());
    if (idx >= 0) return headers[idx];
  }
  // fallback: anything containing "order"
  const idx = lower.findIndex((h) => h.includes("order"));
  return idx >= 0 ? headers[idx] : null;
}

// Pull the "Further Charges: £X.XX" total from a rework comment.
function parseFurtherCharges(comment: string): number | null {
  const m = comment.match(/Further\s+Charges?\s*:\s*£?\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function InvoiceMergerPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [orderCol, setOrderCol] = useState<string>("");
  const [results, setResults] = useState<Record<string, MergeResult>>({});
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [running, setRunning] = useState(false);

  const uniqueOrderRefs = useMemo(() => {
    if (!orderCol) return [] as string[];
    const set = new Set<string>();
    for (const r of rows) {
      const v = (r[orderCol] ?? "").trim();
      if (v) set.add(v);
    }
    return Array.from(set);
  }, [rows, orderCol]);

  const merged = useMemo(() => {
    if (!orderCol || rows.length === 0) return { headers: [] as string[], rows: [] as Row[] };
    const newHeaders = [...headers];
    if (!newHeaders.includes("Rework Charge")) newHeaders.push("Rework Charge");
    if (!newHeaders.includes("Rework Notes")) newHeaders.push("Rework Notes");
    const newRows = rows.map((r) => {
      const ref = (r[orderCol] ?? "").trim();
      const res = results[ref];
      return {
        ...r,
        "Rework Charge": res?.charge != null ? res.charge.toFixed(2) : "",
        "Rework Notes": res?.notes ?? "",
      };
    });
    return { headers: newHeaders, rows: newRows };
  }, [headers, rows, orderCol, results]);

  const totals = useMemo(() => {
    let matched = 0;
    let chargeSum = 0;
    for (const ref of uniqueOrderRefs) {
      const r = results[ref];
      if (r?.charge != null) {
        matched++;
        chargeSum += r.charge;
      }
    }
    return { matched, chargeSum, total: uniqueOrderRefs.length };
  }, [results, uniqueOrderRefs]);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) {
      toast.error("File too large (max 10MB)");
      return;
    }
    const text = await f.text();
    const { headers: h, rows: r } = parseCsv(text);
    if (h.length === 0) {
      toast.error("Couldn't parse CSV");
      return;
    }
    setFilename(f.name);
    setHeaders(h);
    setRows(r);
    setResults({});
    const detected = detectOrderColumn(h);
    setOrderCol(detected ?? h[0]);
    if (!detected) {
      toast.warning("Couldn't auto-detect the order column — pick it manually.");
    } else {
      toast.success(`Loaded ${r.length} rows · detected "${detected}"`);
    }
  }

  async function runMerge() {
    if (!orderCol) {
      toast.error("Select the order column first");
      return;
    }
    const refs = uniqueOrderRefs;
    if (refs.length === 0) {
      toast.error("No order references found in that column");
      return;
    }
    const settings = loadSettings();
    if (!settings.mintsoftBaseUrl) {
      toast.error("Mintsoft is not configured — open Settings first.");
      return;
    }
    setRunning(true);
    setProgress({ done: 0, total: refs.length });
    const out: Record<string, MergeResult> = {};
    const concurrency = 4;
    let i = 0;
    const workers = Array.from({ length: concurrency }, async () => {
      while (true) {
        const idx = i++;
        if (idx >= refs.length) return;
        const ref = refs[idx];
        const numeric = Number(ref);
        if (!Number.isFinite(numeric) || numeric <= 0) {
          out[ref] = {
            orderRef: ref,
            charge: null,
            notes: "",
            error: "Not a numeric order ID",
          };
        } else {
          try {
            const comments = await fetchOrderComments(settings, numeric);
            // Find the latest rework-style comment with "Further Charges"
            const sorted = [...comments].sort((a, b) => {
              const ta = a.CreatedDate ? new Date(a.CreatedDate).getTime() : 0;
              const tb = b.CreatedDate ? new Date(b.CreatedDate).getTime() : 0;
              return tb - ta;
            });
            let charge: number | null = null;
            let notes = "";
            for (const c of sorted) {
              const txt = (c.Comment ?? "").trim();
              if (!txt) continue;
              const v = parseFurtherCharges(txt);
              if (v != null) {
                charge = v;
                notes = txt;
                break;
              }
            }
            out[ref] = { orderRef: ref, charge, notes };
          } catch (err) {
            out[ref] = {
              orderRef: ref,
              charge: null,
              notes: "",
              error: err instanceof Error ? err.message : "fetch failed",
            };
          }
        }
        setResults((prev) => ({ ...prev, [ref]: out[ref] }));
        setProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
      }
    });
    await Promise.all(workers);
    setRunning(false);
    const matched = Object.values(out).filter((r) => r.charge != null).length;
    toast.success(`Done · ${matched}/${refs.length} orders matched`);
  }

  function download() {
    if (merged.rows.length === 0) {
      toast.error("Nothing to download");
      return;
    }
    const csv = toCsv(merged.headers, merged.rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const base = (filename ?? "invoice").replace(/\.csv$/i, "");
    a.href = url;
    a.download = `${base}-merged.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Link to="/" className="hover:text-foreground">Hub</Link>
        <span>/</span>
        <span>Invoice Merger</span>
      </div>

      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Invoice Merger</h1>
          <p className="text-sm text-muted-foreground">
            Upload a Mintsoft invoice CSV. We'll fetch each order's comments and append
            the rework charge total and breakdown so you can bill clients accurately.
          </p>
        </div>
        <Button variant="ghost" size="sm" asChild>
          <Link to="/">
            <ArrowLeft className="mr-1 h-4 w-4" /> Back
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Receipt className="h-4 w-4" /> 1. Upload invoice CSV
          </CardTitle>
          <CardDescription>
            Export the invoice from Mintsoft as CSV, then upload it here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={handleFile}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => fileRef.current?.click()} variant="outline">
              <Upload className="mr-1 h-4 w-4" /> Choose CSV
            </Button>
            {filename && (
              <span className="text-sm text-muted-foreground">
                {filename} · {rows.length} rows
              </span>
            )}
          </div>

          {headers.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-[200px_1fr] sm:items-center">
              <Label htmlFor="order-col">Order ID column</Label>
              <select
                id="order-col"
                value={orderCol}
                onChange={(e) => setOrderCol(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              >
                {headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </div>
          )}
        </CardContent>
      </Card>

      {headers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">2. Fetch rework charges</CardTitle>
            <CardDescription>
              We'll look up each unique order in Mintsoft and pull the latest comment
              containing a "Further Charges" line.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={runMerge} disabled={running || !orderCol}>
                {running ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <Receipt className="mr-1 h-4 w-4" />
                )}
                Fetch charges for {uniqueOrderRefs.length} orders
              </Button>
              {progress && (
                <span className="text-sm text-muted-foreground tabular-nums">
                  {progress.done} / {progress.total}
                </span>
              )}
              {totals.total > 0 && (
                <div className="flex items-center gap-2 text-sm">
                  <Badge variant="secondary">
                    {totals.matched} matched
                  </Badge>
                  <span className="text-muted-foreground">
                    Total charges: £{totals.chargeSum.toFixed(2)}
                  </span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {merged.rows.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
            <div>
              <CardTitle className="text-base">3. Preview &amp; download</CardTitle>
              <CardDescription>
                Two columns appended: <code>Rework Charge</code> and <code>Rework Notes</code>.
              </CardDescription>
            </div>
            <Button onClick={download}>
              <Download className="mr-1 h-4 w-4" /> Download merged CSV
            </Button>
          </CardHeader>
          <CardContent>
            <div className="max-h-[60vh] overflow-auto rounded-md border">
              <table className="w-full border-collapse text-xs">
                <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                  <tr>
                    {merged.headers.map((h) => (
                      <th
                        key={h}
                        className="border-b border-border px-2 py-1 text-left font-medium"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {merged.rows.slice(0, 200).map((r, i) => {
                    const ref = (r[orderCol] ?? "").trim();
                    const res = results[ref];
                    return (
                      <tr key={i} className="odd:bg-background even:bg-muted/30">
                        {merged.headers.map((h) => (
                          <td
                            key={h}
                            className="max-w-[24rem] truncate border-b border-border/60 px-2 py-1 align-top"
                            title={r[h]}
                          >
                            {h === "Rework Charge" && res?.error ? (
                              <span className="inline-flex items-center gap-1 text-destructive">
                                <AlertTriangle className="h-3 w-3" /> err
                              </span>
                            ) : (
                              r[h] || (
                                <span className="text-muted-foreground/60">—</span>
                              )
                            )}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {merged.rows.length > 200 && (
                <div className="px-2 py-1 text-xs text-muted-foreground">
                  Showing first 200 of {merged.rows.length} rows. Download to see all.
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}