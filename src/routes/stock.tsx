import { requireAuth } from "@/lib/require-auth";
import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChevronDown, ChevronRight, Loader2, Package, Pencil, RefreshCw } from "lucide-react";
import {
  fetchProductStockLocations,
  fetchProductOpenOrderAllocations,
  transferStockLocation,
  type StockLocation,
  type ProductOrderAllocation,
} from "@/lib/mintsoft";
import { listWarehouses, listWarehouseLocations } from "@/lib/mintsoft";
import {
  getCachedClients,
  getCachedProducts,
  getSyncState,
  triggerSync,
} from "@/lib/mintsoft-cache.functions";
import { loadSettings } from "@/lib/storage";
import { MultiSelect } from "@/components/MultiSelect";

function formatBbe(input: string): string {
  const s = input.trim();
  // ISO yyyy-mm-dd[Thh:...]
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  // UK dd/mm/yyyy or dd-mm-yyyy
  const uk = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (uk) {
    const d = uk[1].padStart(2, "0");
    const m = uk[2].padStart(2, "0");
    const y = uk[3].length === 2 ? `20${uk[3]}` : uk[3];
    return `${d}/${m}/${y}`;
  }
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    return parsed.toLocaleDateString("en-GB");
  }
  return s;
}
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

export const Route = createFileRoute("/stock")({
  beforeLoad: ({ location }) => requireAuth(location),
  component: StockPage,
});

function ExpandedDetails({
  productId,
  locState,
  allocState,
  onTransferred,
}: {
  productId: number;
  locState?: { loading: boolean; data?: StockLocation[]; error?: string };
  allocState?: { loading: boolean; data?: ProductOrderAllocation[]; error?: string };
  onTransferred?: () => void;
}) {
  const normalize = (s?: string) => (s || "").trim().toLowerCase();

  const rows = useMemo(() => {
    const map = new Map<
      string,
      {
        label: string;
        warehouseName?: string;
        stockLevel: number;
        allocated: number;
        onHand: number;
        batches: Array<{ batchNumber?: string; bestBeforeDate?: string; quantity: number }>;
        orders: ProductOrderAllocation[];
      }
    >();
    for (const l of locState?.data ?? []) {
      const key = l.locationId ? `id:${l.locationId}` : normalize(l.location) || "unassigned";
      const existing = map.get(key);
      if (existing) {
        existing.stockLevel += l.stockLevel ?? l.quantity ?? 0;
        existing.allocated += l.allocated ?? 0;
        existing.onHand += l.onHand ?? l.quantity ?? l.stockLevel ?? 0;
        if (!existing.warehouseName && l.warehouseName) existing.warehouseName = l.warehouseName;
      } else {
        map.set(key, {
          label:
            l.location || (l.locationId ? `Location #${l.locationId}` : "Location unavailable"),
          warehouseName: l.warehouseName,
          stockLevel: l.stockLevel ?? l.quantity ?? 0,
          allocated: l.allocated ?? 0,
          onHand: l.onHand ?? l.quantity ?? l.stockLevel ?? 0,
          batches: [],
          orders: [],
        });
      }
      const row = map.get(key);
      if (row && (l.batchNumber || l.bestBeforeDate)) {
        row.batches.push({
          batchNumber: l.batchNumber,
          bestBeforeDate: l.bestBeforeDate,
          quantity: l.quantity ?? l.stockLevel ?? l.onHand ?? 0,
        });
      }
    }
    for (const a of allocState?.data ?? []) {
      const key = a.locationId ? `id:${a.locationId}` : normalize(a.location) || "unassigned";
      let row = map.get(key);
      if (!row) {
        row = {
          label:
            a.location || (a.locationId ? `Location #${a.locationId}` : "Location unavailable"),
          stockLevel: 0,
          allocated: 0,
          onHand: 0,
          batches: [],
          orders: [],
        };
        map.set(key, row);
      }
      row.orders.push(a);
    }
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [locState?.data, allocState?.data]);

  const loading = locState?.loading || allocState?.loading;

  const [transfer, setTransfer] = useState<{
    fromLocation: string;
    warehouseName?: string;
    maxQty: number;
    toLocation: string;
    quantity: string;
    submitting: boolean;
  } | null>(null);

  const locationsQuery = useQuery({
    queryKey: ["all-warehouse-locations"],
    enabled: transfer !== null,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const settings = loadSettings();
      const warehouses = await listWarehouses(settings);
      const lists = await Promise.all(
        warehouses.map((w) =>
          listWarehouseLocations(settings, w.id)
            .then((locs) => locs.map((l) => ({ ...l, warehouseName: w.name })))
            .catch(() => []),
        ),
      );
      const seen = new Set<string>();
      const out: { name: string; warehouseName: string }[] = [];
      for (const l of lists.flat()) {
        const key = `${l.warehouseName}::${l.name}`;
        if (l.name && !seen.has(key)) {
          seen.add(key);
          out.push({ name: l.name, warehouseName: l.warehouseName });
        }
      }
      return out.sort((a, b) => a.name.localeCompare(b.name));
    },
  });

  const locationSuggestions = useMemo(() => {
    const all = locationsQuery.data ?? [];
    const q = (transfer?.toLocation ?? "").trim().toLowerCase();
    const wh = transfer?.warehouseName;
    const scoped = wh ? all.filter((l) => l.warehouseName === wh) : all;
    const pool = scoped.length > 0 ? scoped : all;
    if (!q) return pool.slice(0, 20);
    return pool.filter((l) => l.name.toLowerCase().includes(q)).slice(0, 20);
  }, [locationsQuery.data, transfer?.toLocation, transfer?.warehouseName]);

  const submitTransfer = async () => {
    if (!transfer) return;
    const qty = Number(transfer.quantity);
    const dest = transfer.toLocation.trim();
    if (!dest) {
      toast.error("Enter a destination location");
      return;
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error("Enter a valid quantity");
      return;
    }
    if (qty > transfer.maxQty) {
      toast.error(`Only ${transfer.maxQty} units available at ${transfer.fromLocation}`);
      return;
    }
    setTransfer({ ...transfer, submitting: true });
    try {
      await transferStockLocation(loadSettings(), {
        productId,
        warehouseName: transfer.warehouseName,
        fromLocationName: transfer.fromLocation,
        toLocationName: dest,
        quantity: qty,
      });
      toast.success(`Moved ${qty} × from ${transfer.fromLocation} to ${dest}`);
      setTransfer(null);
      onTransferred?.();
    } catch (e) {
      toast.error((e as Error).message);
      setTransfer((t) => (t ? { ...t, submitting: false } : t));
    }
  };

  return (
    <div className="py-2">
      {locState?.error ? (
        <div className="mb-2 text-sm text-destructive">{locState.error}</div>
      ) : null}
      {allocState?.error ? (
        <div className="mb-2 text-sm text-destructive">{allocState.error}</div>
      ) : null}
      {rows.length === 0 ? (
        loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading locations and allocations…
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">No stock locations found.</div>
        )
      ) : (
        <div className="overflow-hidden rounded border border-border bg-background text-sm">
          <div className="grid grid-cols-[minmax(160px,1fr)_110px_110px_110px] gap-3 border-b border-border bg-muted/60 px-3 py-2 text-xs font-medium text-muted-foreground">
            <span>Location</span>
            <span className="text-right">Stock level</span>
            <span className="text-right">Allocated</span>
            <span className="text-right">On hand</span>
          </div>
          {rows.map((row, i) => {
            const allocatedQty =
              row.allocated || row.orders.reduce((sum, o) => sum + (o.quantity || 0), 0);
            return (
              <div
                key={`${row.label}-${i}`}
                className="border-b border-border px-3 py-2 last:border-b-0"
              >
                <div className="grid grid-cols-[minmax(160px,1fr)_110px_110px_110px] gap-3 items-center">
                  <button
                    type="button"
                    className="group inline-flex items-center gap-1.5 text-left font-mono font-medium hover:text-primary"
                    onClick={() =>
                      setTransfer({
                        fromLocation: row.label,
                        warehouseName: row.warehouseName,
                        maxQty: row.onHand || row.stockLevel || 0,
                        toLocation: "",
                        quantity: String(row.onHand || row.stockLevel || 0),
                        submitting: false,
                      })
                    }
                    title="Move stock to another location"
                  >
                    {row.label}
                    <Pencil className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-60" />
                  </button>
                  <span className="text-right font-mono">{row.stockLevel}</span>
                  <span className="text-right font-mono text-amber-600 dark:text-amber-400">
                    {allocatedQty}
                  </span>
                  <span className="text-right font-mono text-emerald-600 dark:text-emerald-400">
                    {row.onHand}
                  </span>
                </div>
                {row.orders.length > 0 && (
                  <ul className="mt-2 ml-[min(12rem,30%)] space-y-1 border-t border-border pt-2 text-xs">
                    {row.orders.map((o, j) => (
                      <li key={`${o.orderId}-${j}`} className="flex items-center justify-between">
                        <span className="font-mono text-muted-foreground">
                          {o.orderNumber || `#${o.orderId}`}
                          {o.customerName ? ` · ${o.customerName}` : ""}
                        </span>
                        <span className="text-amber-600 dark:text-amber-400">×{o.quantity}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {row.batches.length > 0 && (
                  <ul className="mt-2 ml-[min(12rem,30%)] space-y-1 border-t border-border pt-2 text-xs text-muted-foreground">
                    {row.batches.map((batch, j) => (
                      <li
                        key={`${batch.batchNumber ?? "bbe"}-${batch.bestBeforeDate ?? "none"}-${j}`}
                        className="flex items-center justify-between"
                      >
                        <span>
                          {batch.batchNumber ? `Batch ${batch.batchNumber}` : "Batch"}
                          {batch.bestBeforeDate
                            ? ` · BBE ${formatBbe(batch.bestBeforeDate)}`
                            : ""}
                        </span>
                        <span className="font-mono">×{batch.quantity}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
      {loading && rows.length > 0 && (
        <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Still loading…
        </div>
      )}
      <Dialog open={transfer !== null} onOpenChange={(o) => !o && setTransfer(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move stock</DialogTitle>
            <DialogDescription>
              Transfer inventory from{" "}
              <span className="font-mono font-medium">{transfer?.fromLocation}</span> to another
              location in Mintsoft.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label htmlFor="dest-location">New location</Label>
              <Input
                id="dest-location"
                value={transfer?.toLocation ?? ""}
                onChange={(e) => setTransfer((t) => (t ? { ...t, toLocation: e.target.value } : t))}
                placeholder="e.g. B11-S2-PB6"
                autoFocus
                disabled={transfer?.submitting}
                autoComplete="off"
                list="dest-location-suggestions"
              />
              <datalist id="dest-location-suggestions">
                {locationSuggestions.map((l) => (
                  <option key={`${l.warehouseName}-${l.name}`} value={l.name}>
                    {l.warehouseName}
                  </option>
                ))}
              </datalist>
              {locationsQuery.isLoading ? (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Loading locations…
                </div>
              ) : locationsQuery.data && transfer?.toLocation ? (
                <div className="text-xs text-muted-foreground">
                  {locationSuggestions.length} match
                  {locationSuggestions.length === 1 ? "" : "es"}
                </div>
              ) : null}
            </div>
            <div className="space-y-1">
              <Label htmlFor="dest-qty">Quantity (max {transfer?.maxQty ?? 0})</Label>
              <Input
                id="dest-qty"
                type="number"
                min={1}
                max={transfer?.maxQty ?? 1}
                value={transfer?.quantity ?? ""}
                onChange={(e) => setTransfer((t) => (t ? { ...t, quantity: e.target.value } : t))}
                disabled={transfer?.submitting}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setTransfer(null)}
              disabled={transfer?.submitting}
            >
              Cancel
            </Button>
            <Button onClick={submitTransfer} disabled={transfer?.submitting}>
              {transfer?.submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Move stock
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StockPage() {
  const queryClient = useQueryClient();
  const fetchProducts = useServerFn(getCachedProducts);
  const fetchClients = useServerFn(getCachedClients);
  const fetchSyncState = useServerFn(getSyncState);
  const runSync = useServerFn(triggerSync);
  const [filter, setFilter] = useState("");
  const [clientFilter, setClientFilter] = useState<string[]>([]);
  const [inStockOnly, setInStockOnly] = useState(true);
  const [tab, setTab] = useState<"all" | "allocated">("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [locations, setLocations] = useState<
    Record<number, { loading: boolean; data?: StockLocation[]; error?: string }>
  >({});
  const [orderAllocs, setOrderAllocs] = useState<
    Record<number, { loading: boolean; data?: ProductOrderAllocation[]; error?: string }>
  >({});

  const toggleRow = async (productId: number) => {
    if (expandedId === productId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(productId);
    const settings = loadSettings();
    if (!locations[productId]?.data && !locations[productId]?.loading) {
      setLocations((s) => ({ ...s, [productId]: { loading: true } }));
      fetchProductStockLocations(settings, productId)
        .then((data) => setLocations((s) => ({ ...s, [productId]: { loading: false, data } })))
        .catch((e) =>
          setLocations((s) => ({
            ...s,
            [productId]: { loading: false, error: (e as Error).message },
          })),
        );
    }
    if (!orderAllocs[productId]?.data && !orderAllocs[productId]?.loading) {
      setOrderAllocs((s) => ({ ...s, [productId]: { loading: true } }));
      fetchProductOpenOrderAllocations(settings, productId)
        .then((data) => setOrderAllocs((s) => ({ ...s, [productId]: { loading: false, data } })))
        .catch((e) =>
          setOrderAllocs((s) => ({
            ...s,
            [productId]: { loading: false, error: (e as Error).message },
          })),
        );
    }
  };

  const productsQuery = useQuery({
    queryKey: ["stock-products-cached"],
    queryFn: () => fetchProducts(),
    refetchOnWindowFocus: false,
  });

  const clientsQuery = useQuery({
    queryKey: ["stock-clients-cached"],
    queryFn: () => fetchClients(),
    refetchOnWindowFocus: false,
  });

  const syncStateQuery = useQuery({
    queryKey: ["stock-sync-state"],
    queryFn: () => fetchSyncState(),
    refetchOnWindowFocus: false,
  });

  const syncMutation = useMutation({
    mutationFn: () => runSync(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stock-products-cached"] });
      queryClient.invalidateQueries({ queryKey: ["stock-clients-cached"] });
      queryClient.invalidateQueries({ queryKey: ["stock-sync-state"] });
    },
  });

  const clientNameById = useMemo(() => {
    const map = new Map<number, string>();
    for (const c of clientsQuery.data ?? []) {
      map.set(c.id, c.name || c.brand_name || c.short_name || `#${c.id}`);
    }
    return map;
  }, [clientsQuery.data]);

  const rows = useMemo(() => {
    let items = productsQuery.data ?? [];
    if (tab === "allocated") {
      items = items.filter((p) => (p.allocated ?? 0) > 0);
    }
    if (inStockOnly) {
      items = items.filter((p) => p.stock_level > 0 || p.allocated > 0 || p.on_hand > 0);
    }
    const q = filter.trim().toLowerCase();
    if (q) {
      items = items.filter((p) => {
        const clientId = p.client_id ?? 0;
        const clientName = clientId ? (clientNameById.get(clientId) ?? "") : "";
        return (
          (p.sku ?? "").toLowerCase().includes(q) ||
          (p.name ?? "").toLowerCase().includes(q) ||
          (p.ean ?? "").toLowerCase().includes(q) ||
          (p.upc ?? "").toLowerCase().includes(q) ||
          clientName.toLowerCase().includes(q)
        );
      });
    }
    if (clientFilter.length > 0) {
      items = items.filter((p) => clientFilter.includes(String(p.client_id ?? 0)));
    }
    return items;
  }, [productsQuery.data, filter, clientFilter, clientNameById, inStockOnly, tab]);

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const paginatedRows = rows.slice((page - 1) * pageSize, page * pageSize);

  const syncState = syncStateQuery.data;
  const lastSyncLabel = syncState?.last_success_at
    ? new Date(syncState.last_success_at).toLocaleString()
    : "never";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Stock</h1>
          <p className="text-sm text-muted-foreground">
            Cached from Mintsoft · last sync {lastSyncLabel}
            {syncState?.last_status === "error" && syncState.last_error ? (
              <span className="text-destructive"> · {syncState.last_error}</span>
            ) : null}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
          >
            {syncMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Refresh
          </Button>
          <div className="flex items-center gap-2">
            <Switch
              id="in-stock-toggle"
              checked={inStockOnly}
              onCheckedChange={(v) => {
                setInStockOnly(v);
                setPage(1);
              }}
            />
            <Label htmlFor="in-stock-toggle" className="cursor-pointer text-sm">
              In stock
            </Label>
          </div>
          <MultiSelect
            options={(clientsQuery.data ?? []).map((c) => ({
              value: String(c.id),
              label: c.brand_name || c.short_name || c.name || `Client #${c.id}`,
            }))}
            value={clientFilter}
            onChange={(v) => {
              setClientFilter(v);
              setPage(1);
            }}
            placeholder="All clients"
          />
          <Input
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setPage(1);
            }}
            placeholder="Search SKU, name, barcode or client…"
            className="max-w-sm"
          />
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <CardTitle className="flex items-center gap-2 text-base">
                <Package className="h-4 w-4" />
                {productsQuery.isLoading
                  ? "Loading products…"
                  : `${rows.length} product${rows.length === 1 ? "" : "s"}`}
              </CardTitle>
              <Tabs
                value={tab}
                onValueChange={(v) => {
                  setTab(v as "all" | "allocated");
                  setPage(1);
                }}
              >
                <TabsList>
                  <TabsTrigger value="all">All</TabsTrigger>
                  <TabsTrigger value="allocated">Allocated</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>Show</span>
              <Select
                value={String(pageSize)}
                onValueChange={(v) => {
                  setPageSize(Number(v));
                  setPage(1);
                }}
              >
                <SelectTrigger className="h-8 w-[80px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[10, 25, 50, 100, 250].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span>per page</span>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {productsQuery.isLoading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading cached SKUs…
            </div>
          ) : productsQuery.isError ? (
            <div className="py-8 text-sm text-destructive">
              {(productsQuery.error as Error).message}
            </div>
          ) : rows.length === 0 ? (
            <div className="py-8 text-sm text-muted-foreground">
              No products found.{" "}
              {syncState?.last_success_at ? null : "Click Refresh to populate the cache."}
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[200px]">Client</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead className="w-[80px]">Image</TableHead>
                    <TableHead>Barcode</TableHead>
                    <TableHead className="w-[110px] text-right">Available</TableHead>
                    <TableHead className="w-[110px] text-right">Allocated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedRows.map((p) => {
                    const clientId = p.client_id ?? 0;
                    const clientName = clientId
                      ? (clientNameById.get(clientId) ?? `#${clientId}`)
                      : "—";
                    const barcode = p.ean || p.upc || "";
                    const isOpen = expandedId === p.id;
                    const locState = locations[p.id];
                    return (
                      <Fragment key={p.id}>
                        <TableRow className="cursor-pointer" onClick={() => toggleRow(p.id)}>
                          <TableCell className="text-sm">{clientName}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2 font-medium">
                              {isOpen ? (
                                <ChevronDown className="h-4 w-4 text-muted-foreground" />
                              ) : (
                                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                              )}
                              {p.sku || "—"}
                            </div>
                            {p.name && (
                              <div className="ml-6 text-xs text-muted-foreground line-clamp-1">
                                {p.name}
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            {p.image_url ? (
                              <img
                                src={p.image_url}
                                alt={p.sku || ""}
                                className="h-12 w-12 rounded border border-border object-cover"
                                loading="lazy"
                              />
                            ) : (
                              <div className="flex h-12 w-12 items-center justify-center rounded border border-dashed border-border text-muted-foreground">
                                <Package className="h-4 w-4" />
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {barcode || <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                            {p.on_hand ?? 0}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm text-amber-600 dark:text-amber-400">
                            {p.allocated ?? 0}
                          </TableCell>
                        </TableRow>
                        {isOpen && (
                          <TableRow className="bg-muted/30 hover:bg-muted/30">
                            <TableCell colSpan={6}>
                              <ExpandedDetails
                                productId={p.id}
                                locState={locState}
                                allocState={orderAllocs[p.id]}
                                onTransferred={() => {
                                  // Refetch this product's locations after a transfer.
                                  setLocations((s) => ({ ...s, [p.id]: { loading: true } }));
                                  fetchProductStockLocations(loadSettings(), p.id)
                                    .then((data) =>
                                      setLocations((s) => ({
                                        ...s,
                                        [p.id]: { loading: false, data },
                                      })),
                                    )
                                    .catch((e) =>
                                      setLocations((s) => ({
                                        ...s,
                                        [p.id]: { loading: false, error: (e as Error).message },
                                      })),
                                    );
                                }}
                              />
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
              {totalPages > 1 && (
                <div className="mt-4 flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    Page {page} of {totalPages}
                  </span>
                  <Pagination>
                    <PaginationContent>
                      <PaginationItem>
                        <PaginationPrevious
                          href="#"
                          onClick={(e) => {
                            e.preventDefault();
                            setPage((p) => Math.max(1, p - 1));
                          }}
                          className={page <= 1 ? "pointer-events-none opacity-50" : ""}
                        />
                      </PaginationItem>
                      {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                        <PaginationItem key={p}>
                          <PaginationLink
                            href="#"
                            isActive={p === page}
                            onClick={(e) => {
                              e.preventDefault();
                              setPage(p);
                            }}
                          >
                            {p}
                          </PaginationLink>
                        </PaginationItem>
                      ))}
                      <PaginationItem>
                        <PaginationNext
                          href="#"
                          onClick={(e) => {
                            e.preventDefault();
                            setPage((p) => Math.min(totalPages, p + 1));
                          }}
                          className={page >= totalPages ? "pointer-events-none opacity-50" : ""}
                        />
                      </PaginationItem>
                    </PaginationContent>
                  </Pagination>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
