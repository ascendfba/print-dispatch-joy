import { requireAuth } from "@/lib/require-auth";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, Package } from "lucide-react";
import { listAllProducts, listClients } from "@/lib/mintsoft";
import { loadSettings } from "@/lib/storage";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/stock")({
  beforeLoad: ({ location }) => requireAuth(location),
  component: StockPage,
});

function StockPage() {
  const [filter, setFilter] = useState("");
  const [clientFilter, setClientFilter] = useState("");

  const productsQuery = useQuery({
    queryKey: ["stock-products"],
    queryFn: async () => {
      const settings = loadSettings();
      if (!settings.mintsoftApiKey && !settings.mintsoftUsername) {
        throw new Error("Configure Mintsoft in Settings first (API key or username)");
      }
      return listAllProducts(settings);
    },
    refetchOnWindowFocus: false,
  });

  const clientsQuery = useQuery({
    queryKey: ["clients"],
    queryFn: async () => {
      const settings = loadSettings();
      return listClients(settings);
    },
    refetchOnWindowFocus: false,
  });

  const clientNameById = useMemo(() => {
    const map = new Map<number, string>();
    for (const c of clientsQuery.data ?? []) {
      map.set(c.ID, c.Name || c.BrandName || c.ShortName || `#${c.ID}`);
    }
    return map;
  }, [clientsQuery.data]);

  const rows = useMemo(() => {
    let items = productsQuery.data ?? [];
    const q = filter.trim().toLowerCase();
    if (q) {
      items = items.filter((p) => {
        const clientId = p.ClientId ?? p.ClientID ?? 0;
        const clientName = clientId ? (clientNameById.get(clientId) ?? "") : "";
        return (
          (p.SKU ?? "").toLowerCase().includes(q) ||
          (p.Name ?? "").toLowerCase().includes(q) ||
          (p.EAN ?? "").toLowerCase().includes(q) ||
          (p.UPC ?? "").toLowerCase().includes(q) ||
          clientName.toLowerCase().includes(q)
        );
      });
    }
    if (clientFilter && clientFilter !== "all") {
      const cid = Number(clientFilter);
      items = items.filter((p) => (p.ClientId ?? p.ClientID ?? 0) === cid);
    }
    return items;
  }, [productsQuery.data, filter, clientFilter, clientNameById]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Stock</h1>
          <p className="text-sm text-muted-foreground">
            All SKUs from Mintsoft.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={clientFilter} onValueChange={setClientFilter}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="All clients" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All clients</SelectItem>
              {(clientsQuery.data ?? []).map((c) => (
                <SelectItem key={c.ID} value={String(c.ID)}>
                  {c.BrandName || c.ShortName || c.Name || `Client #${c.ID}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search SKU, name, barcode or client…"
            className="max-w-sm"
          />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Package className="h-4 w-4" />
            {productsQuery.isLoading
              ? "Loading products…"
              : `${rows.length} product${rows.length === 1 ? "" : "s"}`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {productsQuery.isLoading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Fetching SKUs from Mintsoft…
            </div>
          ) : productsQuery.isError ? (
            <div className="py-8 text-sm text-destructive">
              {(productsQuery.error as Error).message}
            </div>
          ) : rows.length === 0 ? (
            <div className="py-8 text-sm text-muted-foreground">
              No products found.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[200px]">Client</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead className="w-[80px]">Image</TableHead>
                  <TableHead>Barcode</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((p) => {
                  const clientId = p.ClientId ?? p.ClientID ?? 0;
                  const clientName = clientId
                    ? (clientNameById.get(clientId) ?? `#${clientId}`)
                    : "—";
                  const barcode = p.EAN || p.UPC || "";
                  return (
                    <TableRow key={p.ID}>
                      <TableCell className="text-sm">{clientName}</TableCell>
                      <TableCell>
                        <div className="font-medium">{p.SKU || "—"}</div>
                        {p.Name && (
                          <div className="text-xs text-muted-foreground line-clamp-1">
                            {p.Name}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        {p.ImageURL ? (
                          <img
                            src={p.ImageURL}
                            alt={p.SKU || ""}
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
                        {barcode || (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}