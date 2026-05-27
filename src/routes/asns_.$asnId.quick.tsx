import { requireAuth } from "@/lib/require-auth";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueries, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Loader2,
  SkipForward,
  Truck,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  fetchASN,
  fetchASNItems,
  fetchProduct,
  listWarehouseLocations,
  receiveASNItem,
  type MintsoftASNItem,
  type MintsoftProduct,
} from "@/lib/mintsoft";
import { loadSettings } from "@/lib/storage";
import { useProductImage } from "@/lib/useProductImage";
import { AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/asns_/$asnId/quick")({
  beforeLoad: ({ location }) => requireAuth(location),
  component: QuickAsnPage,
});

// --- helpers (mirror asns_.$asnId.tsx) -------------------------------------
function productRequiresBbf(p: unknown): boolean {
  if (!p || typeof p !== "object") return false;
  for (const [k, v] of Object.entries(p as Record<string, unknown>)) {
    if (v !== true) continue;
    const key = k.toLowerCase();
    if (
      key.includes("expir") ||
      key.includes("bestbefore") ||
      key === "bbe" ||
      key.startsWith("bbe_") ||
      key.includes("bbedate") ||
      key.includes("bbd")
    ) return true;
  }
  return false;
}

function normaliseBbf(raw: string): string {
  const s = (raw ?? "").trim();
  if (!s) return "";
  if (/^(\d{4})-(\d{2})-(\d{2})$/.test(s)) return s;
  const digits = s.replace(/\D/g, "");
  let dd = "", mm = "", yyyy = "";
  if (digits.length === 6) { dd = digits.slice(0,2); mm = digits.slice(2,4); yyyy = "20" + digits.slice(4,6); }
  else if (digits.length === 8) { dd = digits.slice(0,2); mm = digits.slice(2,4); yyyy = digits.slice(4,8); }
  else return "";
  const d = Number(dd), m = Number(mm), y = Number(yyyy);
  if (!d || !m || !y || d > 31 || m > 12) return "";
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return "";
  return `${yyyy}-${mm}-${dd}`;
}

function isoToDdmmyyyy(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const [, y, mo, d] = m;
  return `${d}${mo}${y}`;
}

function remainingQty(it: MintsoftASNItem): number {
  const exp = Number(it.ExpectedQuantity) || 0;
  const rec = Number(it.ReceivedQuantity) || 0;
  return Math.max(0, exp - rec);
}

type EntryState = {
  qty: string;
  locationId: string;
  bbf: string;
  done?: boolean;
  skipped?: boolean;
};

function QuickAsnPage() {
  const { asnId: asnIdRaw } = Route.useParams();
  const asnId = Number(asnIdRaw);
  const queryClient = useQueryClient();

  const asnQuery = useQuery({
    queryKey: ["asn", asnId],
    queryFn: () => fetchASN(loadSettings(), asnId),
    enabled: Number.isFinite(asnId) && asnId > 0,
  });

  const itemsQuery = useQuery({
    queryKey: ["asn-items", asnId],
    queryFn: () => fetchASNItems(loadSettings(), asnId),
    enabled: Number.isFinite(asnId) && asnId > 0,
  });

  const a = asnQuery.data;
  const items = itemsQuery.data ?? [];
  const warehouseId = a?.WarehouseId ?? null;

  const locationsQuery = useQuery({
    queryKey: ["wh-locations", warehouseId],
    queryFn: () =>
      warehouseId ? listWarehouseLocations(loadSettings(), warehouseId) : Promise.resolve([]),
    enabled: !!warehouseId,
    staleTime: 5 * 60_000,
  });
  const locations = locationsQuery.data ?? [];

  const productQueries = useQueries({
    queries: items.map((it) => ({
      queryKey: ["product", it.ProductId ?? null],
      queryFn: () =>
        it.ProductId ? fetchProduct(loadSettings(), it.ProductId) : Promise.resolve(null),
      enabled: !!it.ProductId,
      staleTime: 30 * 60_000,
    })),
  });

  const [index, setIndex] = useState(0);
  const [entries, setEntries] = useState<Record<string, EntryState>>({});
  const [submitting, setSubmitting] = useState(false);

  const total = items.length;
  const current = items[index];
  const currentKey = current ? String(current.ID ?? current.ProductId ?? current.SKU ?? index) : "";
  const currentProduct = productQueries[index]?.data as MintsoftProduct | null | undefined;
  const requiresBbf = productRequiresBbf(currentProduct);
  const entry = entries[currentKey] ?? { qty: "", locationId: "", bbf: "" };
  const completedCount = Object.values(entries).filter((e) => e.done || e.skipped).length;
  const progressPct = total > 0 ? Math.round((completedCount / total) * 100) : 0;
  const allFinished = total > 0 && completedCount >= total;

  function patchEntry(patch: Partial<EntryState>) {
    setEntries((prev) => ({
      ...prev,
      [currentKey]: { ...(prev[currentKey] ?? { qty: "", locationId: "", bbf: "" }), ...patch },
    }));
  }

  function goNext() {
    // find next index that isn't finished, wrap from current+1
    if (!total) return;
    for (let step = 1; step <= total; step++) {
      const i = (index + step) % total;
      const k = String(items[i].ID ?? items[i].ProductId ?? items[i].SKU ?? i);
      if (!entries[k]?.done && !entries[k]?.skipped) {
        setIndex(i);
        return;
      }
    }
    setIndex(index); // stay
  }

  function goPrev() {
    if (!total) return;
    setIndex((i) => (i - 1 + total) % total);
  }

  function skip() {
    patchEntry({ skipped: true });
    setTimeout(goNext, 0);
  }

  async function saveAndNext() {
    if (!current) return;
    if (!warehouseId) {
      toast.error("ASN has no warehouse — cannot book in.");
      return;
    }
    const qty = Number(entry.qty);
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error("Enter a quantity");
      return;
    }
    if (!entry.locationId) {
      toast.error("Pick a location");
      return;
    }
    if (!current.ID || !current.ProductId) {
      toast.error("Missing item/product id");
      return;
    }
    let bbfIso = "";
    if (requiresBbf) {
      if (!entry.bbf) { toast.error("BBE date required"); return; }
      bbfIso = normaliseBbf(entry.bbf);
      if (!bbfIso) { toast.error("Invalid BBE — use DDMMYY (e.g. 010126)"); return; }
    } else if (entry.bbf) {
      bbfIso = normaliseBbf(entry.bbf);
      if (!bbfIso) { toast.error("Invalid BBE — use DDMMYY (e.g. 010126)"); return; }
    }

    setSubmitting(true);
    try {
      const rem = remainingQty(current);
      const complete = qty >= rem;
      await receiveASNItem(loadSettings(), {
        ASNId: asnId,
        ASNDetailId: current.ID,
        ProductId: current.ProductId,
        WarehouseId: warehouseId,
        LocationId: Number(entry.locationId),
        Quantity: qty,
        Complete: complete,
        BestBeforeDate: bbfIso ? isoToDdmmyyyy(bbfIso) : undefined,
      });
      patchEntry({ done: true });
      toast.success(`Booked in ${qty} × ${current.SKU ?? "item"}`);
      await queryClient.refetchQueries({ queryKey: ["asn-items", asnId] });
      await queryClient.refetchQueries({ queryKey: ["asn", asnId] });
      setTimeout(goNext, 0);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to book in");
    } finally {
      setSubmitting(false);
    }
  }

  // ---- render -----------------------------------------------------------
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-2 md:p-4">
      <div className="flex items-center justify-between gap-4">
        <Button asChild variant="outline" size="sm">
          <Link to="/asns"><ArrowLeft className="h-4 w-4" /> ASNs</Link>
        </Button>
        <h1 className="text-xl md:text-2xl font-semibold flex items-center gap-2">
          <Truck className="h-6 w-6" /> Quick ASN
        </h1>
        <div className="w-[88px] text-right text-sm text-muted-foreground tabular-nums">
          {total ? `${Math.min(index + 1, total)} / ${total}` : "—"}
        </div>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{a?.Reference || (a ? `#${a.ID}` : "ASN")} {a?.SupplierName ? `— ${a.SupplierName}` : ""}</span>
          <span>{completedCount} of {total} done</span>
        </div>
        <Progress value={progressPct} />
      </div>

      {itemsQuery.isLoading ? (
        <div className="flex items-center justify-center py-24 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading items…
        </div>
      ) : itemsQuery.error ? (
        <div className="py-24 text-center text-sm text-destructive">
          {itemsQuery.error instanceof Error ? itemsQuery.error.message : "Failed to load items"}
        </div>
      ) : total === 0 ? (
        <div className="py-24 text-center text-sm text-muted-foreground">No items on this ASN.</div>
      ) : allFinished ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <CheckCircle2 className="h-14 w-14 text-primary" />
            <h2 className="text-2xl font-semibold">All items processed</h2>
            <p className="text-muted-foreground">
              {Object.values(entries).filter((e) => e.done).length} booked in,{" "}
              {Object.values(entries).filter((e) => e.skipped).length} skipped.
            </p>
            <div className="flex gap-2 pt-2">
              <Button asChild variant="outline"><Link to="/asns">Back to ASNs</Link></Button>
              <Button onClick={() => { setEntries({}); setIndex(0); }}>Start over</Button>
            </div>
          </CardContent>
        </Card>
      ) : current ? (
        <Card className="overflow-hidden">
          <CardHeader className="border-b bg-muted/30">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <CardTitle className="truncate text-xl md:text-2xl">
                  {current.Title || current.Description || "—"}
                </CardTitle>
                <div className="mt-1 font-mono text-sm text-muted-foreground">
                  {current.SKU || "—"}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Remaining
                </div>
                <div className="text-3xl font-bold tabular-nums">
                  {remainingQty(current)}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  of {current.ExpectedQuantity ?? 0}
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6 p-6">
            <QuickProductImage product={current} />

            <div className="space-y-2">
              <Label htmlFor="qty" className="text-base">Quantity received</Label>
              <Input
                id="qty"
                inputMode="numeric"
                pattern="[0-9]*"
                value={entry.qty}
                onChange={(e) => patchEntry({ qty: e.target.value.replace(/[^\d]/g, ""), done: false })}
                placeholder="0"
                className="h-14 text-center text-2xl tabular-nums"
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label className="text-base">Location</Label>
              <Select
                value={entry.locationId}
                onValueChange={(v) => patchEntry({ locationId: v, done: false })}
                disabled={!warehouseId || locationsQuery.isLoading}
              >
                <SelectTrigger className="h-12 text-base">
                  <SelectValue placeholder={
                    !warehouseId ? "No warehouse on ASN"
                      : locationsQuery.isLoading ? "Loading…"
                      : "Choose a location"
                  } />
                </SelectTrigger>
                <SelectContent>
                  {locations.map((loc) => (
                    <SelectItem key={loc.id} value={String(loc.id)} className="text-base">
                      {loc.name || loc.code || `#${loc.id}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="bbf" className="text-base">
                Best-before date {requiresBbf ? <span className="text-destructive">*</span> : <span className="text-muted-foreground text-sm">(optional)</span>}
              </Label>
              <Input
                id="bbf"
                value={entry.bbf}
                onChange={(e) => patchEntry({ bbf: e.target.value, done: false })}
                placeholder="DDMMYY (e.g. 010126)"
                className="h-12 text-center text-lg tabular-nums"
              />
            </div>
          </CardContent>
          <div className="flex flex-col gap-2 border-t bg-muted/20 p-4 sm:flex-row sm:justify-between">
            <div className="flex gap-2">
              <Button variant="outline" size="lg" onClick={goPrev} disabled={submitting}>
                <ArrowLeft className="h-4 w-4" /> Previous
              </Button>
              <Button variant="outline" size="lg" onClick={skip} disabled={submitting}>
                <SkipForward className="h-4 w-4" /> Skip
              </Button>
            </div>
            <Button
              size="lg"
              className="h-12 text-base"
              onClick={saveAndNext}
              disabled={submitting}
            >
              {submitting ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Booking in…</>
              ) : (
                <><Check className="h-4 w-4" /> Save &amp; next <ArrowRight className="h-4 w-4" /></>
              )}
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function QuickProductImage({ product }: { product: MintsoftProduct | null }) {
  const q = useProductImage({
    imageUrl: product?.ImageURL,
    name: product?.Title ?? product?.Name,
    description: product?.Description,
    sku: product?.SKU,
    ean: product?.EAN,
    upc: product?.UPC,
  });
  const resolved = q.data;
  const cls = "max-h-48 rounded-md border bg-white object-contain p-2";
  if (resolved?.url && !resolved.suggested) {
    return (
      <div className="flex justify-center">
        <img src={resolved.url} alt={product?.Title ?? ""} className={cls} />
      </div>
    );
  }
  if (q.isLoading) {
    return (
      <div className="flex justify-center">
        <div className="flex h-32 w-32 items-center justify-center rounded-md border bg-muted">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }
  if (resolved?.url) {
    return (
      <div className="flex flex-col items-center gap-1">
        <img
          src={resolved.url}
          alt={`Suggested for ${product?.Title ?? ""}`}
          className={`${cls} border-2 border-orange-500`}
        />
        <div className="flex items-center gap-1 rounded-sm border border-orange-500 bg-orange-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-800 dark:bg-orange-500/15 dark:text-orange-300">
          <AlertTriangle className="h-3 w-3" /> Suggested
        </div>
      </div>
    );
  }
  return null;
}