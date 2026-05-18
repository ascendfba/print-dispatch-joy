import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import JSZip from "jszip";
import { requireAuth } from "@/lib/require-auth";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ArrowLeft,
  Download,
  Loader2,
  Receipt,
  RefreshCw,
  FileArchive,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { loadSettings } from "@/lib/storage";
import {
  fetchInvoiceItems,
  fetchOrderComments,
  listInvoices,
  type MintsoftInvoice,
  type MintsoftInvoiceItem,
} from "@/lib/mintsoft";

export const Route = createFileRoute("/invoice-merger")({
  beforeLoad: ({ location }) => requireAuth(location),
  component: InvoiceMergerPage,
});

type ItemWithComment = MintsoftInvoiceItem & {
  _comment?: string;
  _charge?: number | null;
};

type ClientGroup = {
  clientId: number | string;
  clientName: string;
  invoices: MintsoftInvoice[];
  items: ItemWithComment[];
};

function csvField(v: string | number | null | undefined): string {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function parseFurtherCharges(comment: string): number | null {
  const m = comment.match(/Further\s+Charges?\s*:\s*£?\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function isConfirmed(status: string | null | undefined): boolean {
  if (!status) return false;
  const s = status.toLowerCase();
  return (
    s.includes("confirm") ||
    s.includes("approved") ||
    s.includes("finalised") ||
    s.includes("finalized") ||
    s.includes("posted")
  );
}

function buildClientCsv(group: ClientGroup): string {
  const headers = [
    "InvoiceNumber",
    "InvoiceDate",
    "InvoiceStatus",
    "OrderId",
    "OrderNumber",
    "Description",
    "Quantity",
    "UnitPrice",
    "TotalPrice",
    "ReworkCost",
    "ParsedReworkCharge",
    "OrderComment",
  ];
  const invById = new Map<number, MintsoftInvoice>();
  for (const inv of group.invoices) invById.set(inv.ID, inv);
  const lines: string[] = [headers.join(",")];
  for (const it of group.items) {
    const inv = it.InvoiceId != null ? invById.get(it.InvoiceId) : undefined;
    lines.push(
      [
        csvField(inv?.InvoiceNumber ?? ""),
        csvField(inv?.InvoiceDate ?? ""),
        csvField(inv?.Status ?? ""),
        csvField(it.OrderId ?? ""),
        csvField(it.OrderNumber ?? ""),
        csvField(it.Description ?? ""),
        csvField(it.Quantity ?? ""),
        csvField(it.UnitPrice ?? ""),
        csvField(it.TotalPrice ?? ""),
        csvField(it.ReworkCost ?? ""),
        csvField(it._charge != null ? it._charge.toFixed(2) : ""),
        csvField(it._comment ?? ""),
      ].join(","),
    );
  }
  return lines.join("\n") + "\n";
}

function safeFilename(s: string): string {
  return s.replace(/[^a-z0-9._-]+/gi, "_").slice(0, 80) || "client";
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function InvoiceMergerPage() {
  const [take, setTake] = useState(50);
  const [invoices, setInvoices] = useState<MintsoftInvoice[]>([]);
  const [items, setItems] = useState<ItemWithComment[]>([]);
  const [loadingInvoices, setLoadingInvoices] = useState(false);
  const [fetchingComments, setFetchingComments] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(null);
  const [selectedClient, setSelectedClient] = useState<string>("");

  async function pullInvoices() {
    const settings = loadSettings();
    if (!settings.mintsoftBaseUrl) {
      toast.error("Mintsoft is not configured — open Settings first.");
      return;
    }
    setLoadingInvoices(true);
    setInvoices([]);
    setItems([]);
    setSelectedClient("");
    try {
      const all = await listInvoices(settings, { take });
      const confirmed = all.filter((i) => isConfirmed(i.Status));
      // sort newest first
      confirmed.sort((a, b) => {
        const ta = a.InvoiceDate ? new Date(a.InvoiceDate).getTime() : 0;
        const tb = b.InvoiceDate ? new Date(b.InvoiceDate).getTime() : 0;
        return tb - ta;
      });
      setInvoices(confirmed);
      if (confirmed.length === 0) {
        toast.warning(
          `No confirmed invoices found in the latest ${all.length}. Confirm them in Mintsoft first.`,
        );
      } else {
        toast.success(
          `Loaded ${confirmed.length} confirmed invoice${confirmed.length === 1 ? "" : "s"}.`,
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load invoices");
    } finally {
      setLoadingInvoices(false);
    }
  }

  async function fetchItemsAndComments() {
    if (invoices.length === 0) return;
    const settings = loadSettings();
    setFetchingComments(true);
    setItems([]);
    try {
      // 1) Fetch line items for each invoice
      setProgress({ done: 0, total: invoices.length, label: "Fetching invoice items" });
      const allItems: ItemWithComment[] = [];
      const concurrency = 4;
      let i = 0;
      await Promise.all(
        Array.from({ length: concurrency }, async () => {
          while (true) {
            const idx = i++;
            if (idx >= invoices.length) return;
            const inv = invoices[idx];
            try {
              const its = await fetchInvoiceItems(settings, inv.ID);
              for (const it of its) {
                allItems.push({
                  ...it,
                  InvoiceId: it.InvoiceId ?? inv.ID,
                });
              }
            } catch {
              /* skip invoice */
            }
            setProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
          }
        }),
      );

      // 2) Fetch comments for each unique OrderId
      const orderIds = Array.from(
        new Set(
          allItems
            .map((it) => Number(it.OrderId))
            .filter((n) => Number.isFinite(n) && n > 0),
        ),
      );
      const commentByOrder = new Map<number, { comment: string; charge: number | null }>();
      setProgress({ done: 0, total: orderIds.length, label: "Fetching order comments" });
      let j = 0;
      await Promise.all(
        Array.from({ length: concurrency }, async () => {
          while (true) {
            const idx = j++;
            if (idx >= orderIds.length) return;
            const oid = orderIds[idx];
            try {
              const comments = await fetchOrderComments(settings, oid);
              const sorted = [...comments].sort((a, b) => {
                const ta = a.CreatedDate ? new Date(a.CreatedDate).getTime() : 0;
                const tb = b.CreatedDate ? new Date(b.CreatedDate).getTime() : 0;
                return tb - ta;
              });
              let pickedComment = "";
              let charge: number | null = null;
              for (const c of sorted) {
                const txt = (c.Comment ?? "").trim();
                if (!txt) continue;
                const v = parseFurtherCharges(txt);
                if (v != null) {
                  pickedComment = txt;
                  charge = v;
                  break;
                }
                if (!pickedComment) pickedComment = txt;
              }
              commentByOrder.set(oid, { comment: pickedComment, charge });
            } catch {
              /* skip */
            }
            setProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
          }
        }),
      );

      // 3) Merge comments into items
      const merged = allItems.map((it) => {
        const oid = Number(it.OrderId);
        const m = Number.isFinite(oid) ? commentByOrder.get(oid) : undefined;
        return { ...it, _comment: m?.comment ?? "", _charge: m?.charge ?? null };
      });
      setItems(merged);
      const withCharge = merged.filter((m) => m._charge != null).length;
      toast.success(
        `Fetched ${merged.length} line items · ${withCharge} have rework charges.`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Fetch failed");
    } finally {
      setFetchingComments(false);
      setProgress(null);
    }
  }

  const clientGroups = useMemo<ClientGroup[]>(() => {
    if (invoices.length === 0) return [];
    const map = new Map<string, ClientGroup>();
    for (const inv of invoices) {
      const key = String(inv.ClientId ?? inv.ClientName ?? "unknown");
      if (!map.has(key)) {
        map.set(key, {
          clientId: inv.ClientId ?? key,
          clientName: inv.ClientName ?? "Unknown",
          invoices: [],
          items: [],
        });
      }
      map.get(key)!.invoices.push(inv);
    }
    const invToKey = new Map<number, string>();
    for (const [key, g] of map) {
      for (const inv of g.invoices) invToKey.set(inv.ID, key);
    }
    for (const it of items) {
      if (it.InvoiceId == null) continue;
      const key = invToKey.get(it.InvoiceId);
      if (!key) continue;
      map.get(key)!.items.push(it);
    }
    return Array.from(map.values()).sort((a, b) =>
      a.clientName.localeCompare(b.clientName),
    );
  }, [invoices, items]);

  const totalCharges = useMemo(
    () =>
      items.reduce((s, it) => s + (it._charge != null ? it._charge : 0), 0),
    [items],
  );

  function downloadClientCsv(clientKey: string) {
    const g = clientGroups.find((c) => String(c.clientId) === clientKey);
    if (!g) return;
    const csv = buildClientCsv(g);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    downloadBlob(blob, `${safeFilename(g.clientName)}-invoice-merged.csv`);
  }

  async function downloadAllZip() {
    if (clientGroups.length === 0) return;
    const zip = new JSZip();
    for (const g of clientGroups) {
      zip.file(`${safeFilename(g.clientName)}.csv`, buildClientCsv(g));
    }
    const blob = await zip.generateAsync({ type: "blob" });
    const stamp = new Date().toISOString().slice(0, 10);
    downloadBlob(blob, `invoices-merged-${stamp}.zip`);
  }

  const hasInvoices = invoices.length > 0;
  const hasItems = items.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Hub
        </Link>
        <span>/</span>
        <span>Invoice Merger</span>
      </div>

      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Invoice Merger</h1>
          <p className="text-sm text-muted-foreground">
            Pull recent confirmed invoices from Mintsoft, merge in each order's
            comments and rework charges, then export per client.
          </p>
        </div>
        <Button variant="ghost" size="sm" asChild>
          <Link to="/">
            <ArrowLeft className="mr-1 h-4 w-4" /> Back
          </Link>
        </Button>
      </div>

      {/* Step 1 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Receipt className="h-4 w-4" /> 1. Pull confirmed invoices
          </CardTitle>
          <CardDescription>
            Loads the latest invoices from Mintsoft and keeps only the ones with a
            confirmed / approved / posted status. Confirm them in Mintsoft first.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid w-32 gap-1">
              <Label htmlFor="take">Look at latest</Label>
              <Input
                id="take"
                type="number"
                min={10}
                max={500}
                step={10}
                value={take}
                onChange={(e) => setTake(Math.max(10, Number(e.target.value) || 50))}
              />
            </div>
            <Button onClick={pullInvoices} disabled={loadingInvoices}>
              {loadingInvoices ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-1 h-4 w-4" />
              )}
              Pull invoices
            </Button>
            {hasInvoices && (
              <div className="flex items-center gap-2 text-sm">
                <Badge variant="secondary">
                  {invoices.length} confirmed
                </Badge>
                <span className="text-muted-foreground">
                  across {clientGroups.length} client
                  {clientGroups.length === 1 ? "" : "s"}
                </span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Step 2 */}
      {hasInvoices && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              2. Fetch line items &amp; order comments
            </CardTitle>
            <CardDescription>
              Pulls invoice line items, then fetches each order's comments and
              parses the "Further Charges: £X.XX" total written by Control Dock.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={fetchItemsAndComments} disabled={fetchingComments}>
                {fetchingComments ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <Receipt className="mr-1 h-4 w-4" />
                )}
                Fetch items &amp; comments
              </Button>
              {progress && (
                <span className="text-sm text-muted-foreground tabular-nums">
                  {progress.label}: {progress.done} / {progress.total}
                </span>
              )}
              {hasItems && (
                <div className="flex items-center gap-2 text-sm">
                  <Badge variant="secondary">{items.length} line items</Badge>
                  <span className="text-muted-foreground">
                    £{totalCharges.toFixed(2)} in rework charges
                  </span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3 */}
      {hasItems && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
            <div>
              <CardTitle className="text-base">3. Export per client</CardTitle>
              <CardDescription>
                Pick a client to download their merged CSV, or grab a ZIP with
                every client at once.
              </CardDescription>
            </div>
            <Button onClick={downloadAllZip} variant="default">
              <FileArchive className="mr-1 h-4 w-4" /> Download all (ZIP)
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="overflow-hidden rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/60 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Client</th>
                    <th className="px-3 py-2 text-right font-medium">Invoices</th>
                    <th className="px-3 py-2 text-right font-medium">Line items</th>
                    <th className="px-3 py-2 text-right font-medium">
                      Rework charges
                    </th>
                    <th className="px-3 py-2 text-right font-medium">Download</th>
                  </tr>
                </thead>
                <tbody>
                  {clientGroups.map((g) => {
                    const sum = g.items.reduce(
                      (s, it) => s + (it._charge ?? 0),
                      0,
                    );
                    const matched = g.items.filter(
                      (it) => it._charge != null,
                    ).length;
                    const key = String(g.clientId);
                    return (
                      <tr
                        key={key}
                        className="border-t border-border/60 odd:bg-background even:bg-muted/20"
                      >
                        <td className="px-3 py-2">
                          <div className="font-medium">{g.clientName}</div>
                          <div className="text-xs text-muted-foreground">
                            ID {String(g.clientId)}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {g.invoices.length}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {g.items.length}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {sum > 0 ? (
                            <span className="inline-flex items-center gap-1">
                              <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                              £{sum.toFixed(2)}
                              <span className="text-xs text-muted-foreground">
                                ({matched})
                              </span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-muted-foreground">
                              <AlertTriangle className="h-3 w-3" /> none
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setSelectedClient(key);
                              downloadClientCsv(key);
                            }}
                          >
                            <Download className="mr-1 h-3 w-3" /> CSV
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {selectedClient && (
              <p className="text-xs text-muted-foreground">
                Last downloaded:{" "}
                {clientGroups.find((c) => String(c.clientId) === selectedClient)
                  ?.clientName ?? ""}
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}