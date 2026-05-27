import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, Truck, Loader2, Package, Search, X, AlertTriangle, Save, PackageCheck, CheckCircle2, Minus, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  fetchASN,
  fetchASNItems,
  fetchProduct,
  listWarehouseLocations,
  receiveASNItem,
  completeASN,
  partialCompleteASN,
  type MintsoftASNItem,
  type MintsoftProduct,
  type MintsoftWarehouseLocation,
} from "@/lib/mintsoft";
import { loadSettings } from "@/lib/storage";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerFooter,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";

type VerifiedRow = { receivedQty: number; bbf: string; location: string };

function isoToDdmmyyyy(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const [, y, mo, d] = m;
  return `${d}${mo}${y}`;
}

function normLoc(s: string): string {
  return (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function resolveLocationId(
  input: string,
  locations: MintsoftWarehouseLocation[],
): MintsoftWarehouseLocation | null {
  const target = normLoc(input);
  if (!target) return null;
  for (const l of locations) {
    if (normLoc(l.code ?? "") === target) return l;
  }
  for (const l of locations) {
    if (normLoc(l.name ?? "") === target) return l;
  }
  return null;
}

export const Route = createFileRoute("/mobile/stock/asns_/$asnId")({
  component: MobileASNDetail,
});

function MobileASNDetail() {
  const { asnId } = Route.useParams();
  const id = Number(asnId);
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [verified, setVerified] = useState<Record<string, VerifiedRow>>({});
  const [openItem, setOpenItem] = useState<MintsoftASNItem | null>(null);
  const [submitting, setSubmitting] = useState<null | "partial" | "full">(null);
  const queryClient = useQueryClient();

  const asnQuery = useQuery({
    queryKey: ["mobile-asn", id],
    queryFn: async () => {
      const settings = loadSettings();
      return fetchASN(settings, id);
    },
    staleTime: 60_000,
  });

  const itemsQuery = useQuery({
    queryKey: ["mobile-asn-items", id],
    queryFn: async () => {
      const settings = loadSettings();
      return fetchASNItems(settings, id);
    },
    staleTime: 60_000,
  });

  const asn = asnQuery.data;
  const items = itemsQuery.data ?? [];
  const warehouseId = asn?.WarehouseId ?? null;

  const locationsQuery = useQuery({
    queryKey: ["mobile-wh-locations", warehouseId],
    queryFn: () =>
      warehouseId
        ? listWarehouseLocations(loadSettings(), warehouseId)
        : Promise.resolve([] as MintsoftWarehouseLocation[]),
    enabled: !!warehouseId,
    staleTime: 30 * 60_000,
    refetchOnWindowFocus: false,
  });

  async function bookIn(mode: "partial" | "full") {
    if (!warehouseId) {
      toast.error("ASN has no warehouse assigned");
      return;
    }
    const entries = Object.entries(verified);
    if (entries.length === 0) {
      toast.error("Verify at least one item first");
      return;
    }
    const locations = locationsQuery.data ?? [];
    if (locations.length === 0) {
      toast.error("Warehouse locations not loaded yet");
      return;
    }
    // Resolve all locations up-front
    const resolved: Array<{
      item: MintsoftASNItem;
      row: VerifiedRow;
      locationId: number;
    }> = [];
    for (const [key, row] of entries) {
      const item = items.find((it) => String(it.ID ?? "") === key);
      if (!item) continue;
      const loc = resolveLocationId(row.location, locations);
      if (!loc) {
        toast.error(`Unknown location "${row.location}" for ${item.SKU ?? item.Title ?? "item"}`);
        return;
      }
      resolved.push({ item, row, locationId: loc.id });
    }
    setSubmitting(mode);
    const settings = loadSettings();
    let okCount = 0;
    const errors: string[] = [];
    for (const r of resolved) {
      try {
        await receiveASNItem(settings, {
          ASNId: id,
          ASNDetailId: r.item.ID ?? null,
          ProductId: r.item.ProductId!,
          WarehouseId: warehouseId,
          LocationId: r.locationId,
          Quantity: r.row.receivedQty,
          Complete: mode === "full",
          BestBeforeDate: r.row.bbf ? isoToDdmmyyyy(r.row.bbf) : undefined,
        });
        okCount += 1;
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }
    }
    try {
      if (mode === "full") {
        await completeASN(settings, id);
      } else {
        await partialCompleteASN(settings, id);
      }
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
    await queryClient.invalidateQueries({ queryKey: ["mobile-asn", id] });
    await queryClient.invalidateQueries({ queryKey: ["mobile-asn-items", id] });
    await queryClient.invalidateQueries({ queryKey: ["mobile-asns-list"] });
    setSubmitting(null);
    if (okCount > 0 && errors.length === 0) {
      toast.success(
        mode === "full"
          ? `Booked in ${okCount} line${okCount === 1 ? "" : "s"} and completed ASN`
          : `Partially booked ${okCount} line${okCount === 1 ? "" : "s"}`,
      );
      setVerified({});
      try {
        const raw = localStorage.getItem("mobile.asns.hidden");
        const arr = raw ? (JSON.parse(raw) as number[]) : [];
        const next = Array.from(new Set([...arr, id]));
        localStorage.setItem("mobile.asns.hidden", JSON.stringify(next));
      } catch { /* ignore */ }
      navigate({ to: "/mobile/stock/asns" });
    } else if (okCount > 0) {
      toast.warning(`Booked ${okCount}/${resolved.length}. ${errors[0]}`);
    } else {
      toast.error(errors[0] || "Book in failed");
    }
  }

  const filtered = query.trim()
    ? items.filter((it) => {
        const q = query.trim().toLowerCase();
        return (
          (it.SKU ?? "").toLowerCase().includes(q) ||
          (it.Title ?? "").toLowerCase().includes(q) ||
          (it.Description ?? "").toLowerCase().includes(q) ||
          (it.EAN ?? "").toLowerCase().includes(q) ||
          (it.UPC ?? "").toLowerCase().includes(q)
        );
      })
    : items;

  return (
    <div className="flex-1 flex flex-col">
      <header className="px-3 pt-4 pb-3 border-b flex items-center gap-2 bg-gradient-to-r from-[#0a2e3d] via-[#0d3a4d] to-[#0a2e3d]">
        <Link to="/mobile/stock/asns" className="p-2 -ml-2 rounded-lg active:bg-white/10">
          <ChevronLeft className="h-5 w-5 text-white" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-semibold text-white truncate">
            {asn?.Reference || `ASN #${id}`}
          </h1>
          {asn?.SupplierName && (
            <p className="text-xs text-white/70 truncate">{asn.SupplierName}</p>
          )}
        </div>
        <div className="rounded-lg p-2 bg-white/10">
          <Truck className="h-4 w-4 text-white" />
        </div>
      </header>

      <div className="px-3 pt-3 pb-2 bg-card border-b">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search SKU, title or barcode…"
            className="w-full h-10 pl-9 pr-9 rounded-lg border border-input bg-background text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#0099d4]"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded-full bg-muted text-muted-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {itemsQuery.isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading items…
          </div>
        ) : itemsQuery.error ? (
          <div className="py-8 text-center text-sm text-destructive">
            {itemsQuery.error instanceof Error
              ? itemsQuery.error.message
              : "Failed to load items"}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            {query.trim() ? "No items match your search" : "No items on this ASN"}
          </div>
        ) : (
          filtered.map((it, idx) => (
            <ASNItemRow
              key={it.ID ?? idx}
              item={it}
              verified={verified[String(it.ID ?? idx)]}
              onClick={() => setOpenItem(it)}
            />
          ))
        )}
      </div>

      {/* Fixed action bar */}
      <div className="shrink-0 border-t bg-card px-3 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={() => toast.success(`${Object.keys(verified).length} item(s) saved locally`)}
            className="flex flex-col items-center justify-center gap-1 h-16 rounded-xl border bg-background text-[#0a2e3d] font-semibold text-xs active:bg-muted"
          >
            <Save className="h-6 w-6" strokeWidth={2.25} />
            Save
          </button>
          <button
            onClick={() => void bookIn("partial")}
            disabled={!!submitting || Object.keys(verified).length === 0}
            className="flex flex-col items-center justify-center gap-1 h-16 rounded-xl border-2 border-amber-500 bg-amber-50 text-amber-800 font-semibold text-xs active:bg-amber-100 disabled:opacity-50"
          >
            {submitting === "partial" ? (
              <Loader2 className="h-6 w-6 animate-spin" strokeWidth={2.25} />
            ) : (
              <PackageCheck className="h-6 w-6" strokeWidth={2.25} />
            )}
            Partial Book
          </button>
          <button
            onClick={() => void bookIn("full")}
            disabled={!!submitting || Object.keys(verified).length === 0}
            className="flex flex-col items-center justify-center gap-1 h-16 rounded-xl bg-[#0099d4] text-white font-semibold text-xs shadow-sm active:bg-[#0088bc] disabled:opacity-50"
          >
            {submitting === "full" ? (
              <Loader2 className="h-6 w-6 animate-spin" strokeWidth={2.25} />
            ) : (
              <CheckCircle2 className="h-6 w-6" strokeWidth={2.25} />
            )}
            Book In
          </button>
        </div>
      </div>

      <VerifyDrawer
        item={openItem}
        existing={openItem ? verified[String(openItem.ID ?? "")] : undefined}
        onClose={() => setOpenItem(null)}
        onSave={(row) => {
          if (!openItem) return;
          setVerified((prev) => ({
            ...prev,
            [String(openItem.ID ?? "")]: row,
          }));
          setOpenItem(null);
          toast.success("Item verified");
        }}
      />
    </div>
  );
}

function ASNItemRow({
  item,
  verified,
  onClick,
}: {
  item: MintsoftASNItem;
  verified?: VerifiedRow;
  onClick: () => void;
}) {
  const productQuery = useQuery({
    queryKey: ["product", item.ProductId ?? null],
    queryFn: () =>
      item.ProductId
        ? fetchProduct(loadSettings(), item.ProductId)
        : Promise.resolve(null),
    enabled: !!item.ProductId,
    staleTime: 30 * 60_000,
    refetchOnWindowFocus: false,
  });
  const p = productQuery.data;
  const sku = p?.SKU || item.SKU || "—";
  const name = p?.Name || item.Title || item.Description || "Untitled product";
  const description = p?.Description || item.Description || "";
  const ean = (p?.EAN || item.EAN || "").toString();
  const upc = (p?.UPC || item.UPC || "").toString();
  const rawBarcode = (ean || upc).trim();
  const hasBarcode = /^\d{12,14}$/.test(rawBarcode);

  const imageProduct: MintsoftProduct | null = p
    ? {
        ...p,
        ImageURL: p.ImageURL || item.ImageURL || null,
        EAN: p.EAN || item.EAN || null,
        UPC: p.UPC || item.UPC || null,
        Name: p.Name || item.Title || undefined,
      }
    : item.ImageURL || item.EAN || item.UPC || item.Title
      ? {
          ID: item.ProductId ?? 0,
          SKU: item.SKU ?? undefined,
          Name: item.Title ?? undefined,
          Description: item.Description,
          ImageURL: item.ImageURL,
          EAN: item.EAN,
          UPC: item.UPC,
        }
      : null;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left flex items-start gap-3 rounded-xl border bg-card p-3 active:bg-muted/60 transition-colors ${
        verified ? "border-emerald-500 border-2" : ""
      }`}
    >
      <ProductImage product={imageProduct} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium leading-snug line-clamp-2">{name}</p>
          {verified && (
            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-emerald-100 text-emerald-700 shrink-0">
              <CheckCircle2 className="h-3 w-3" /> Verified
            </span>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground mt-0.5 font-mono truncate">
          {sku}
        </p>
        {description && (
          <p className="text-[11px] text-muted-foreground/80 mt-0.5 line-clamp-2">
            {description}
          </p>
        )}
        <BarcodeRow
          ean={ean}
          upc={upc}
          name={name}
          sku={sku}
          description={description}
          hasBarcode={hasBarcode}
        />
        <div className="mt-1.5 flex items-center gap-3 text-[11px]">
          <span className="inline-flex items-center rounded-full px-2 py-0.5 font-medium bg-[#0099d4]/10 text-[#0099d4]">
            Expected {item.ExpectedQuantity ?? 0}
          </span>
          {verified ? (
            <span className="inline-flex items-center rounded-full px-2 py-0.5 font-medium bg-emerald-100 text-emerald-700">
              Received {verified.receivedQty}
              {verified.bbf ? ` · BBF ${verified.bbf}` : ""}
              {verified.location ? ` · ${verified.location}` : ""}
            </span>
          ) : item.ReceivedQuantity != null && item.ReceivedQuantity > 0 ? (
            <span className="text-muted-foreground">
              Received {item.ReceivedQuantity}
            </span>
          ) : null}
        </div>
      </div>
    </button>
  );
}

// ---------- BBF helpers ----------
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
    ) {
      return true;
    }
  }
  return false;
}

function normaliseBbf(raw: string): string {
  const s = (raw ?? "").trim();
  if (!s) return "";
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) return s;
  const digits = s.replace(/\D/g, "");
  let dd = "", mm = "", yyyy = "";
  if (digits.length === 6) {
    dd = digits.slice(0, 2); mm = digits.slice(2, 4); yyyy = "20" + digits.slice(4, 6);
  } else if (digits.length === 8) {
    dd = digits.slice(0, 2); mm = digits.slice(2, 4); yyyy = digits.slice(4, 8);
  } else {
    return "";
  }
  const d = Number(dd), m = Number(mm), y = Number(yyyy);
  if (!d || !m || !y || d > 31 || m > 12) return "";
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return "";
  return `${yyyy}-${mm}-${dd}`;
}

function VerifyDrawer({
  item,
  existing,
  onClose,
  onSave,
}: {
  item: MintsoftASNItem | null;
  existing?: VerifiedRow;
  onClose: () => void;
  onSave: (row: VerifiedRow) => void;
}) {
  const productQuery = useQuery({
    queryKey: ["product", item?.ProductId ?? null],
    queryFn: () =>
      item?.ProductId
        ? fetchProduct(loadSettings(), item.ProductId)
        : Promise.resolve(null),
    enabled: !!item?.ProductId,
    staleTime: 30 * 60_000,
    refetchOnWindowFocus: false,
  });
  const requiresBbf = useMemo(
    () => productRequiresBbf(productQuery.data),
    [productQuery.data],
  );

  const expected = item?.ExpectedQuantity ?? 0;
  const [qty, setQty] = useState<number>(0);
  const [bbf, setBbf] = useState<string>("");
  const [location, setLocation] = useState<string>("");

  // Reset whenever a new item is opened.
  const itemKey = item ? String(item.ID ?? "") : "";
  useEffect(() => {
    if (item) {
      setQty(existing?.receivedQty ?? expected);
      setBbf(existing?.bbf ?? "");
      setLocation(existing?.location ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemKey]);

  const normalisedBbf = bbf ? normaliseBbf(bbf) : "";
  const bbfInvalid = requiresBbf && (!bbf || !normalisedBbf);
  const trimmedLocation = location.trim();
  const locationInvalid = !trimmedLocation;

  function handleSave() {
    if (qty < 0) {
      toast.error("Quantity cannot be negative");
      return;
    }
    if (requiresBbf && !normalisedBbf) {
      toast.error("Enter a valid BBF date (DDMMYY)");
      return;
    }
    if (!trimmedLocation) {
      toast.error("Scan or enter a location");
      return;
    }
    onSave({ receivedQty: qty, bbf: normalisedBbf, location: trimmedLocation });
  }

  return (
    <Drawer open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent>
        <DrawerHeader className="text-left">
          <DrawerTitle className="text-base line-clamp-2">
            {item?.Title || item?.Description || item?.SKU || "Verify item"}
          </DrawerTitle>
          {item?.SKU && (
            <p className="text-xs text-muted-foreground font-mono">{item.SKU}</p>
          )}
        </DrawerHeader>

        <div className="px-4 pb-2 space-y-5">
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-2">
              Received quantity{" "}
              <span className="text-[#0099d4]">(expected {expected})</span>
            </p>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setQty((q) => Math.max(0, q - 1))}
                className="h-12 w-12 rounded-xl border bg-background flex items-center justify-center active:bg-muted"
              >
                <Minus className="h-5 w-5" />
              </button>
              <input
                type="number"
                inputMode="numeric"
                value={qty}
                onChange={(e) => setQty(Math.max(0, Number(e.target.value) || 0))}
                className="flex-1 h-12 text-center text-lg font-semibold tabular-nums rounded-xl border border-input bg-background focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#0099d4]"
              />
              <button
                type="button"
                onClick={() => setQty((q) => q + 1)}
                className="h-12 w-12 rounded-xl border bg-background flex items-center justify-center active:bg-muted"
              >
                <Plus className="h-5 w-5" />
              </button>
            </div>
            {qty !== expected && (
              <p
                className={`mt-1.5 text-[11px] ${
                  qty < expected ? "text-amber-600" : "text-rose-600"
                }`}
              >
                {qty < expected
                  ? `${expected - qty} short of expected`
                  : `${qty - expected} over expected`}
              </p>
            )}
          </div>

          {requiresBbf && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-2">
                BBF date <span className="text-rose-600">*</span>{" "}
                <span className="text-muted-foreground/70 font-normal">
                  (DDMMYY)
                </span>
              </p>
              <input
                type="text"
                inputMode="numeric"
                placeholder="010126"
                value={bbf}
                onChange={(e) => setBbf(e.target.value)}
                maxLength={10}
                className="w-full h-12 px-3 text-base tabular-nums rounded-xl border border-input bg-background focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#0099d4]"
              />
              <p className="mt-1.5 text-[11px]">
                {bbf ? (
                  normalisedBbf ? (
                    <span className="text-emerald-700">
                      {normalisedBbf} → sends {isoToDdmmyyyy(normalisedBbf)}
                    </span>
                  ) : (
                    <span className="text-rose-600">Invalid date</span>
                  )
                ) : (
                  <span className="text-muted-foreground">
                    This SKU requires a best-before date
                  </span>
                )}
              </p>
            </div>
          )}

          {productQuery.isLoading && (
            <p className="text-[11px] text-muted-foreground flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" /> Checking SKU requirements…
            </p>
          )}

          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-2">
              Location <span className="text-rose-600">*</span>{" "}
              <span className="text-muted-foreground/70 font-normal">
                (scan or type)
              </span>
            </p>
            <input
              type="text"
              inputMode="text"
              autoCapitalize="characters"
              placeholder="e.g. A-12-3"
              value={location}
              onChange={(e) => setLocation(e.target.value.toUpperCase())}
              maxLength={32}
              className="w-full h-12 px-3 text-base font-mono uppercase tracking-wide rounded-xl border border-input bg-background focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#0099d4]"
            />
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Items will be booked into this location.
            </p>
          </div>
        </div>

        <DrawerFooter className="pt-2">
          <Button
            onClick={handleSave}
            disabled={bbfInvalid || locationInvalid}
            className="h-14 text-base bg-[#0099d4] hover:bg-[#0088bc] text-white"
          >
            <Save className="h-5 w-5 mr-2" /> Save
          </Button>
          <Button variant="outline" onClick={onClose} className="h-12">
            Cancel
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

type ImageCandidate = { image: string; title?: string | null };

async function fetchImageCandidates(query: string): Promise<ImageCandidate[]> {
  try {
    const r = await fetch(`/api/google-image?q=${encodeURIComponent(query)}`);
    if (!r.ok) return [];
    const data = (await r.json()) as {
      candidates?: ImageCandidate[];
      image?: string | null;
    };
    if (data.candidates && data.candidates.length) return data.candidates;
    return data.image ? [{ image: data.image, title: null }] : [];
  } catch {
    return [];
  }
}

function ProductImage({ product }: { product: MintsoftProduct | null }) {
  const direct = product?.ImageURL || null;
  const queries = [product?.EAN, product?.UPC, product?.Name]
    .map((q) => (q ? String(q).trim() : ""))
    .filter((q) => q.length > 0);
  const suggestQuery = useQuery({
    queryKey: ["mobile-best-image", product?.SKU ?? product?.Name, queries],
    queryFn: async () => {
      const seen = new Set<string>();
      const candidates: ImageCandidate[] = [];
      for (const q of queries) {
        const found = await fetchImageCandidates(q);
        for (const c of found) {
          if (!seen.has(c.image)) {
            seen.add(c.image);
            candidates.push(c);
          }
          if (candidates.length >= 6) break;
        }
        if (candidates.length >= 6) break;
      }
      if (candidates.length === 0) return null;
      try {
        const r = await fetch("/api/pick-product-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            product: {
              name: product?.Name ?? null,
              sku: product?.SKU ?? null,
              ean: product?.EAN ?? null,
              upc: product?.UPC ?? null,
              description: product?.Description ?? null,
            },
            candidates,
          }),
        });
        if (r.ok) {
          const data = (await r.json()) as { image?: string | null };
          if (data.image) return data.image;
          return null;
        }
      } catch {
        // ignore
      }
      return candidates[0].image;
    },
    enabled: !direct && queries.length > 0,
    staleTime: 60 * 60_000,
    refetchOnWindowFocus: false,
  });

  const box = "h-16 w-16 shrink-0 rounded-lg border bg-muted overflow-hidden flex items-center justify-center";

  if (direct) {
    return (
      <div className={box}>
        <img
          src={direct}
          alt={product?.Name ?? ""}
          className="h-full w-full object-cover"
          loading="lazy"
        />
      </div>
    );
  }
  if (suggestQuery.isLoading) {
    return (
      <div className={box}>
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (suggestQuery.data) {
    return (
      <div className="flex flex-col items-center gap-1 shrink-0">
        <div className={`${box} border-2 border-orange-500`}>
          <img
            src={suggestQuery.data}
            alt={`Suggested image for ${product?.Name ?? ""}`}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        </div>
        <div
          className="flex items-center gap-1 rounded-sm border border-orange-500 bg-orange-100 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-orange-800 dark:bg-orange-500/15 dark:text-orange-300"
          title="AI suggested image — may not match"
        >
          <AlertTriangle className="h-2.5 w-2.5" /> Suggested
        </div>
      </div>
    );
  }
  return (
    <div className={box}>
      <Package className="h-6 w-6 text-muted-foreground" />
    </div>
  );
}

function BarcodeRow({
  ean,
  upc,
  name,
  sku,
  description,
  hasBarcode,
}: {
  ean: string;
  upc: string;
  name: string;
  sku: string;
  description: string;
  hasBarcode: boolean;
}) {
  const query = useQuery({
    queryKey: ["suggest-barcode", sku || name, name, description],
    queryFn: async () => {
      const r = await fetch("/api/suggest-barcode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, sku, description }),
      });
      return (await r.json()) as {
        barcode?: string | null;
        confidence?: string;
        reason?: string;
      };
    },
    enabled: !hasBarcode && !!(name || sku),
    staleTime: 24 * 60 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  if (hasBarcode) {
    return (
      <div className="text-[11px] text-muted-foreground mt-0.5">
        <span className="font-semibold">Barcode:</span>{" "}
        <span className="font-mono">{ean || upc}</span>
      </div>
    );
  }

  if (query.isLoading) {
    return (
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground mt-0.5">
        <span className="font-semibold">Barcode:</span>
        <Loader2 className="h-3 w-3 animate-spin" />
        <span className="italic">scanning…</span>
      </div>
    );
  }

  const barcode = query.data?.barcode;
  const confidence = query.data?.confidence ?? "low";
  const reason = query.data?.reason ?? "";
  const confColor =
    confidence === "high"
      ? "text-emerald-700 border-emerald-500/40 bg-emerald-50"
      : confidence === "medium"
        ? "text-orange-700 border-orange-500/40 bg-orange-50"
        : "text-rose-700 border-rose-500/40 bg-rose-50";

  if (barcode) {
    return (
      <div
        className="text-[11px] text-muted-foreground mt-0.5"
        title={reason || undefined}
      >
        <span className="font-semibold">Barcode:</span>{" "}
        <span className="font-mono text-orange-700" title="AI-suggested">
          {barcode}
        </span>{" "}
        <span
          className={`ml-1 inline-flex items-center rounded border px-1 py-px text-[9px] font-semibold uppercase tracking-wide ${confColor}`}
        >
          {confidence}
        </span>
      </div>
    );
  }
  return (
    <div className="text-[11px] text-muted-foreground mt-0.5">
      <span className="font-semibold">Barcode:</span>{" "}
      <span className="italic">None suggested</span>
    </div>
  );
}