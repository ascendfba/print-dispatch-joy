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
import { ChevronDown, ChevronRight, Loader2, Package, RefreshCw } from "lucide-react";
import {
  fetchProductStockLocations,
  type StockLocation,
} from "@/lib/mintsoft";
import {
  getCachedClients,
  getCachedProducts,
  getSyncState,
  triggerSync,
} from "@/lib/mintsoft-cache.functions";
import { loadSettings } from "@/lib/storage";
import { MultiSelect } from "@/components/MultiSelect";
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

export const Route = createFileRoute("/stock")({
  beforeLoad: ({ location }) => requireAuth(location),
  component: StockPage,
});

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

  const toggleRow = async (productId: number) => {
    if (expandedId === productId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(productId);
    if (locations[productId]?.data || locations[productId]?.loading) return;
    setLocations((s) => ({ ...s, [productId]: { loading: true } }));
    try {
      const settings = loadSettings();
      const data = await fetchProductStockLocations(settings, productId);
      setLocations((s) => ({ ...s, [productId]: { loading: false, data } }));
    } catch (e) {
      setLocations((s) => ({
        ...s,
        [productId]: { loading: false, error: (e as Error).message },
      }));
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
  }, [
    productsQuery.data,
    filter,
    clientFilter,
    clientNameById,
    inStockOnly,
    tab,
  ]);

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
            <Switch id="in-stock-toggle" checked={inStockOnly} onCheckedChange={(v) => { setInStockOnly(v); setPage(1); }} />
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
            onChange={(v) => { setClientFilter(v); setPage(1); }}
            placeholder="All clients"
          />
          <Input
            value={filter}
            onChange={(e) => { setFilter(e.target.value); setPage(1); }}
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
              <Tabs value={tab} onValueChange={(v) => { setTab(v as "all" | "allocated"); setPage(1); }}>
                <TabsList>
                  <TabsTrigger value="all">All</TabsTrigger>
                  <TabsTrigger value="allocated">Allocated</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>Show</span>
              <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}>
                <SelectTrigger className="h-8 w-[80px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[10, 25, 50, 100, 250].map((n) => (
                    <SelectItem key={n} value={String(n)}>{n}</SelectItem>
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
              No products found. {syncState?.last_success_at ? null : "Click Refresh to populate the cache."}
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
                    <TableHead className="w-[110px] text-right">Stock</TableHead>
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
                            {p.stock_level ?? 0}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm text-amber-600 dark:text-amber-400">
                            {p.allocated ?? 0}
                          </TableCell>
                        </TableRow>
                        {isOpen && (
                          <TableRow className="bg-muted/30 hover:bg-muted/30">
                            <TableCell colSpan={6}>
                              {locState?.loading ? (
                                <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                  Loading stock locations…
                                </div>
                              ) : locState?.error ? (
                                <div className="py-2 text-sm text-destructive">{locState.error}</div>
                              ) : !locState?.data || locState.data.length === 0 ? (
                                <div className="py-2 text-sm text-muted-foreground">
                                  No stock locations found.
                                </div>
                              ) : (
                                <div className="py-2">
                                  <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                    Stock locations
                                  </div>
                                  <ul className="space-y-1">
                                    {locState.data.map((l, i) => (
                                      <li
                                        key={`${l.location}-${i}`}
                                        className="flex items-center justify-between rounded border border-border bg-background px-3 py-1.5 text-sm"
                                      >
                                        <span className="font-mono">{l.location}</span>
                                        <span className="text-muted-foreground">
                                          Qty: {l.quantity}
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
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
                          onClick={(e) => { e.preventDefault(); setPage((p) => Math.max(1, p - 1)); }}
                          className={page <= 1 ? "pointer-events-none opacity-50" : ""}
                        />
                      </PaginationItem>
                      {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                        <PaginationItem key={p}>
                          <PaginationLink
                            href="#"
                            isActive={p === page}
                            onClick={(e) => { e.preventDefault(); setPage(p); }}
                          >
                            {p}
                          </PaginationLink>
                        </PaginationItem>
                      ))}
                      <PaginationItem>
                        <PaginationNext
                          href="#"
                          onClick={(e) => { e.preventDefault(); setPage((p) => Math.min(totalPages, p + 1)); }}
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