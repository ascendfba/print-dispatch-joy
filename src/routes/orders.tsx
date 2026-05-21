import { requireAuth } from "@/lib/require-auth";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { MultiSelect } from "@/components/MultiSelect";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  addTrackingNumber,
  despatchOrder,
  fetchOrderDocuments,
  fetchOrderItems,
  fetchProduct,
  listClients,
  listOpenOrders,
  listOrderStatuses,
  listOrdersByStatus,
  type MintsoftOrder,
} from "@/lib/mintsoft";
import { detectFromBytes, type LabelKind } from "@/lib/pdfSize";
import { pickPrinter, printPdfBytes } from "@/lib/printing";
import { loadSettings } from "@/lib/storage";
import { Clock, Loader2, Package, Printer, RefreshCw, Truck, X } from "lucide-react";
import { PDFDocument } from "pdf-lib";
import { PdfPreview } from "@/components/PdfPreview";
import { useQueries } from "@tanstack/react-query";
import { QuickPrintCard } from "@/components/QuickPrintCard";

const isPickingListDoc = (d: { label: string; fileName?: string }) =>
  /pick(ing)?\s*list|despatch\s*note|dispatch\s*note/i.test(d.label) ||
  /pick(ing)?[-_ ]?list|despatch[-_ ]?note|dispatch[-_ ]?note/i.test(d.fileName ?? "");

function ageInHours(dateStr?: string): number | null {
  if (!dateStr) return null;
  const t = new Date(dateStr).getTime();
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / 36e5;
}

function formatAge(hours: number | null): string {
  if (hours == null) return "—";
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  if (hours < 24) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

function ageBucket(hours: number | null): "fresh" | "today" | "stale" | "critical" {
  if (hours == null) return "fresh";
  if (hours < 24) return "fresh";
  if (hours < 48) return "today";
  if (hours < 72) return "stale";
  return "critical";
}

const bucketLabel: Record<ReturnType<typeof ageBucket>, string> = {
  fresh: "< 1 day",
  today: "1–2 days",
  stale: "2–3 days",
  critical: "3+ days",
};

const bucketBadge: Record<ReturnType<typeof ageBucket>, string> = {
  fresh: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
  today: "bg-amber-500/15 text-amber-600 border-amber-500/30",
  stale: "bg-orange-500/15 text-orange-600 border-orange-500/30",
  critical: "bg-destructive/15 text-destructive border-destructive/30",
};

export const Route = createFileRoute("/orders")({
  ssr: false,
  beforeLoad: ({ location }) => requireAuth(location),
  component: OrdersPage,
});

function OrdersPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [filter, setFilter] = useState("");
  const [clientFilter, setClientFilter] = useState<string[]>([]);
  const [trackingFor, setTrackingFor] = useState<MintsoftOrder | null>(null);
  const [trackingValue, setTrackingValue] = useState("");
  const trackingRef = useRef<HTMLInputElement>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkPreview, setBulkPreview] = useState<
    { bytes: Uint8Array; url: string; fileName: string } | null
  >(null);
  const [bulkLoading, setBulkLoading] = useState(false);

  useEffect(() => {
    return () => {
      if (bulkPreview) URL.revokeObjectURL(bulkPreview.url);
    };
  }, [bulkPreview]);

  const toggleId = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const printSelectedPickingLists = async (ids: number[]) => {
    if (ids.length === 0) return;
    setBulkLoading(true);
    try {
      const settings = loadSettings();
      const merged = await PDFDocument.create();
      const failures: number[] = [];
      const results = await Promise.all(
        ids.map(async (id) => {
          try {
            const docs = await fetchOrderDocuments(settings, id);
            const pick = docs.find(isPickingListDoc);
            return pick ? { id, bytes: pick.bytes } : { id, bytes: null };
          } catch {
            return { id, bytes: null };
          }
        }),
      );
      for (const r of results) {
        if (!r.bytes) {
          failures.push(r.id);
          continue;
        }
        try {
          const src = await PDFDocument.load(r.bytes as BlobPart as ArrayBuffer);
          const pages = await merged.copyPages(src, src.getPageIndices());
          for (const p of pages) merged.addPage(p);
        } catch {
          failures.push(r.id);
        }
      }
      if (merged.getPageCount() === 0) {
        throw new Error("No picking lists could be loaded for the selected orders");
      }
      const bytes = await merged.save();
      if (bulkPreview) URL.revokeObjectURL(bulkPreview.url);
      const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
      setBulkPreview({
        bytes,
        url: URL.createObjectURL(blob),
        fileName: `Picking lists (${ids.length - failures.length} of ${ids.length}).pdf`,
      });
      if (failures.length > 0) {
        toast.warning(`No picking list for ${failures.length} order(s)`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to build picking lists");
    } finally {
      setBulkLoading(false);
    }
  };

  const ordersQuery = useQuery({
    queryKey: ["orders"],
    queryFn: async () => {
      const settings = loadSettings();
      if (!settings.mintsoftApiKey && !settings.mintsoftUsername) {
        throw new Error("Configure Mintsoft in Settings first (API key or username)");
      }
      return listOpenOrders(settings);
    },
    refetchOnWindowFocus: false,
    refetchInterval: 10 * 60_000,
  });

  const statusesQuery = useQuery({
    queryKey: ["order-statuses"],
    queryFn: () => listOrderStatuses(loadSettings()),
    staleTime: 60 * 60_000,
    refetchOnWindowFocus: false,
  });

  const statusIdByName = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of statusesQuery.data ?? []) {
      if (s.Name) m.set(s.Name.toUpperCase(), s.ID);
    }
    return m;
  }, [statusesQuery.data]);

  const despatchedStatusId = statusIdByName.get("DESPATCHED");
  const invoicedStatusId = statusIdByName.get("INVOICED");

  const despatchedQuery = useQuery({
    queryKey: ["orders", "despatched", despatchedStatusId],
    queryFn: () => listOrdersByStatus(loadSettings(), despatchedStatusId!),
    enabled: despatchedStatusId != null,
    refetchOnWindowFocus: false,
    refetchInterval: 10 * 60_000,
  });

  const invoicedQuery = useQuery({
    queryKey: ["orders", "invoiced", invoicedStatusId],
    queryFn: () => listOrdersByStatus(loadSettings(), invoicedStatusId!),
    enabled: invoicedStatusId != null,
    refetchOnWindowFocus: false,
    refetchInterval: 10 * 60_000,
  });

  const clientsQuery = useQuery({
    queryKey: ["clients"],
    queryFn: () => listClients(loadSettings()),
    staleTime: 30 * 60_000,
    refetchOnWindowFocus: false,
  });

  const clientNameById = useMemo(() => {
    const m = new Map<number, string>();
    for (const c of clientsQuery.data ?? []) {
      m.set(c.ID, c.BrandName || c.ShortName || c.Name || `Client #${c.ID}`);
    }
    return m;
  }, [clientsQuery.data]);

  const printAndDespatch = useMutation({
    mutationFn: async (order: MintsoftOrder) => {
      const settings = loadSettings();
      const docs = await fetchOrderDocuments(settings, order.ID);
      if (docs.length === 0) throw new Error("No documents available for this order");

      const summary: Array<{ label: string; kind: LabelKind; printer: string }> = [];
      for (const doc of docs) {
        const size = await detectFromBytes(doc.bytes);
        const printer = pickPrinter(settings, size.kind);
        if (!printer) {
          throw new Error(
            `No printer set for ${size.kind} (${size.widthMm}×${size.heightMm} mm). Set one in Settings.`,
          );
        }
        await printPdfBytes(doc.bytes, printer, settings.silentPrint);
        summary.push({ label: doc.label, kind: size.kind, printer });
      }

      await despatchOrder(settings, order.ID);
      return summary;
    },
    onSuccess: (summary, order) => {
      toast.success(
        `Order ${order.OrderNumber ?? order.ID} despatched — printed ${summary.length} doc(s)`,
      );
      setTrackingFor(order);
      setTrackingValue("");
      setTimeout(() => trackingRef.current?.focus(), 50);
      void qc.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Failed");
    },
  });

  const submitTracking = useMutation({
    mutationFn: async () => {
      if (!trackingFor) return;
      const tn = trackingValue.trim();
      if (!tn) throw new Error("Scan or enter a tracking number");
      await addTrackingNumber(loadSettings(), trackingFor.ID, tn, trackingFor.CourierName);
    },
    onSuccess: () => {
      toast.success("Tracking number sent to Mintsoft");
      setTrackingFor(null);
      setTrackingValue("");
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Failed");
    },
  });

  const filtered = useMemo(() => {
    const list = ordersQuery.data ?? [];
    const q = filter.trim().toLowerCase();
    let matches = q
      ? list.filter((o) =>
          [o.OrderNumber, o.ChannelOrderRef, o.CustomerName, o.CourierName, o.WarehouseName]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(q)),
        )
      : list;
    if (clientFilter.length > 0) {
      matches = matches.filter((o) => clientFilter.includes(String((o as { ClientId?: number }).ClientId ?? 0)));
    }
    // Oldest first — most urgent at the top
    return [...matches].sort(
      (a, b) => (ageInHours(b.OrderDate as string) ?? 0) - (ageInHours(a.OrderDate as string) ?? 0),
    );
  }, [ordersQuery.data, filter, clientFilter]);

  const applyFilter = (list: MintsoftOrder[]) => {
    const q = filter.trim().toLowerCase();
    let matches = q
      ? list.filter((o) =>
          [o.OrderNumber, o.ChannelOrderRef, o.CustomerName, o.CourierName, o.WarehouseName]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(q)),
        )
      : list;
    if (clientFilter.length > 0) {
      matches = matches.filter((o) => clientFilter.includes(String((o as { ClientId?: number }).ClientId ?? 0)));
    }
    return [...matches].sort(
      (a, b) => (ageInHours(b.OrderDate as string) ?? 0) - (ageInHours(a.OrderDate as string) ?? 0),
    );
  };
  const filteredDespatched = useMemo(
    () => applyFilter(despatchedQuery.data ?? []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [despatchedQuery.data, filter, clientFilter],
  );
  const filteredInvoiced = useMemo(
    () => applyFilter(invoicedQuery.data ?? []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [invoicedQuery.data, filter, clientFilter],
  );

  const stats = useMemo(() => {
    const list = ordersQuery.data ?? [];
    const buckets = { fresh: 0, today: 0, stale: 0, critical: 0 };
    for (const o of list) buckets[ageBucket(ageInHours(o.OrderDate as string))]++;
    return { total: list.length, ...buckets };
  }, [ordersQuery.data]);

  // Orders despatched today — relies on Mintsoft's despatch timestamp.
  // Different tenants expose the field under different names, so check a
  // handful of common ones and fall back to LastModifiedDate.
  const despatchedToday = useMemo(() => {
    const list = despatchedQuery.data ?? [];
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const startMs = start.getTime();
    const endMs = startMs + 24 * 60 * 60 * 1000;
    const keys = [
      "DespatchedDate",
      "DispatchedDate",
      "DespatchDate",
      "DispatchDate",
      "CompletedOn",
      "CompletedDate",
      "LastModifiedDate",
    ];
    return list.filter((o) => {
      const r = o as Record<string, unknown>;
      for (const k of keys) {
        const v = r[k];
        if (typeof v === "string" && v) {
          const t = new Date(v).getTime();
          if (Number.isFinite(t) && t >= startMs && t < endMs) return true;
          if (Number.isFinite(t)) return false; // first present date wins
        }
      }
      return false;
    });
  }, [despatchedQuery.data]);

  // Fetch items in parallel for orders despatched today so we can sum units
  // and count bundles. Results are cached and shared with row-level cells.
  const todayItemsQueries = useQueries({
    queries: despatchedToday.map((o) => ({
      queryKey: ["order-items", o.ID],
      queryFn: () => fetchOrderItems(loadSettings(), o.ID),
      staleTime: 5 * 60_000,
      refetchOnWindowFocus: false,
    })),
  });

  const todayTotals = useMemo(() => {
    let units = 0;
    let bundles = 0;
    let loading = false;
    for (const q of todayItemsQueries) {
      if (q.isLoading) loading = true;
      const items = q.data ?? [];
      for (const it of items) {
        units += it.Quantity ?? 0;
        const tag = (it.OrderItemNameValues ?? []).find(
          (v) => (v?.Name ?? "").toUpperCase() === "BUNDLE-ID",
        );
        if (tag) {
          const n = Number(tag.Value?.split(";")[1]);
          bundles += Number.isFinite(n) && n > 0 ? n : 1;
        }
      }
    }
    return { units, bundles, loading };
  }, [todayItemsQueries]);

  // Sum outstanding units across all ready-for-dispatch orders so we can
  // compute the required throughput rate.
  const outstandingItemsQueries = useQueries({
    queries: (ordersQuery.data ?? []).map((o) => ({
      queryKey: ["order-items", o.ID],
      queryFn: () => fetchOrderItems(loadSettings(), o.ID),
      staleTime: 5 * 60_000,
      refetchOnWindowFocus: false,
    })),
  });

  const outstandingUnits = useMemo(() => {
    let units = 0;
    let loading = false;
    for (const q of outstandingItemsQueries) {
      if (q.isLoading) loading = true;
      for (const it of q.data ?? []) units += it.Quantity ?? 0;
    }
    return { units, loading };
  }, [outstandingItemsQueries]);

  // Order volume rate — staff shift is 09:00–17:00 (8 hours).
  const volumeRate = useMemo(() => {
    const now = new Date();
    const shiftStart = new Date(now);
    shiftStart.setHours(9, 0, 0, 0);
    const shiftEnd = new Date(now);
    shiftEnd.setHours(17, 0, 0, 0);
    const msPerHour = 3_600_000;
    const hoursWorked = Math.min(
      8,
      Math.max(0, (now.getTime() - shiftStart.getTime()) / msPerHour),
    );
    const hoursLeft = Math.max(
      0,
      Math.min(8, (shiftEnd.getTime() - now.getTime()) / msPerHour),
    );
    const actual = hoursWorked > 0 ? todayTotals.units / hoursWorked : 0;
    const required = hoursLeft > 0 ? outstandingUnits.units / hoursLeft : outstandingUnits.units;
    return {
      actual: Math.round(actual),
      required: Math.round(required),
      hoursLeft: Math.round(hoursLeft * 10) / 10,
    };
  }, [todayTotals.units, outstandingUnits.units]);

  // Lazily fetch order items for each visible order so we can show units & FNSKU counts.
  function OrderItemsCell({ orderId, fallbackUnits }: { orderId: number; fallbackUnits?: number }) {
    const q = useQuery({
      queryKey: ["order-items", orderId],
      queryFn: () => fetchOrderItems(loadSettings(), orderId),
      staleTime: 5 * 60_000,
      refetchOnWindowFocus: false,
    });
    if (q.isLoading) {
      return (
        <span className="text-xs text-muted-foreground">
          <Loader2 className="inline h-3 w-3 animate-spin" />
        </span>
      );
    }
    if (q.error || !q.data) {
      return <span className="text-xs text-muted-foreground">{fallbackUnits ?? "—"}</span>;
    }
    const units = q.data.reduce((s, it) => s + (it.Quantity ?? 0), 0);
    return <span className="tabular-nums">{units}</span>;
  }

  function OrderFnskuCell({ orderId }: { orderId: number }) {
    const q = useQuery({
      queryKey: ["order-fnsku-pages", orderId],
      queryFn: async () => {
        const settings = loadSettings();
        const docs = await fetchOrderDocuments(settings, orderId);
        let pages = 0;
        for (const d of docs) {
          const isPdf =
            (d.contentType ?? "application/pdf").toLowerCase().includes("pdf") ||
            d.fileName?.toLowerCase().endsWith(".pdf");
          if (!isPdf) continue;
          try {
            const size = await detectFromBytes(d.bytes);
            if (size.kind !== "small") continue;
            const pdf = await PDFDocument.load(d.bytes as BlobPart as ArrayBuffer);
            pages += pdf.getPageCount();
          } catch {
            /* ignore */
          }
        }
        return pages;
      },
      staleTime: 5 * 60_000,
      refetchOnWindowFocus: false,
    });
    if (q.isLoading) {
      return (
        <span className="text-xs text-muted-foreground">
          <Loader2 className="inline h-3 w-3 animate-spin" />
        </span>
      );
    }
    if (q.error) return <span className="text-xs text-muted-foreground">—</span>;
    return <span className="tabular-nums">{q.data ?? 0}</span>;
  }

  function OrderBundlesCell({ orderId }: { orderId: number }) {
    const q = useQuery({
      queryKey: ["order-items", orderId],
      queryFn: () => fetchOrderItems(loadSettings(), orderId),
      staleTime: 5 * 60_000,
      refetchOnWindowFocus: false,
    });
    if (q.isLoading) {
      return (
        <span className="text-xs text-muted-foreground">
          <Loader2 className="inline h-3 w-3 animate-spin" />
        </span>
      );
    }
    if (q.error || !q.data) return <span className="text-xs text-muted-foreground">—</span>;
    let bundles = 0;
    for (const it of q.data) {
      const tag = (it.OrderItemNameValues ?? []).find(
        (v) => (v?.Name ?? "").toUpperCase() === "BUNDLE-ID",
      );
      if (!tag) continue;
      const n = Number(tag.Value?.split(";")[1]);
      bundles += Number.isFinite(n) && n > 0 ? n : 1;
    }
    return <span className="tabular-nums">{bundles}</span>;
  }

  useEffect(() => {
    if (trackingFor) setTimeout(() => trackingRef.current?.focus(), 100);
  }, [trackingFor]);

  // Barcode scanner listener: scanners type fast and end with Enter. When
  // focus is not in an input/textarea, capture the buffered digits and open
  // the matching order.
  useEffect(() => {
    let buffer = "";
    let lastTs = 0;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const isEditable =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target?.isContentEditable;
      if (isEditable) return;
      // Don't intercept while a dialog is open
      if (trackingFor || bulkPreview) return;
      const now = Date.now();
      if (now - lastTs > 100) buffer = "";
      lastTs = now;
      if (e.key === "Enter") {
        const code = buffer.trim();
        buffer = "";
        if (!code) return;
        const orderId = Number(code.replace(/\D/g, ""));
        if (!Number.isFinite(orderId) || orderId <= 0) {
          toast.error(`Unrecognised barcode: ${code}`);
          return;
        }
        const orders = ordersQuery.data ?? [];
        const match = orders.find(
          (o) => o.ID === orderId || String(o.OrderNumber ?? "") === code,
        );
        if (!match && orders.length > 0) {
          toast.warning(`Order ${orderId} not in current list — opening anyway`);
        }
        navigate({ to: "/orders/$orderId", params: { orderId: String(orderId) } });
        return;
      }
      if (e.key.length === 1) {
        buffer += e.key;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate, ordersQuery.data, trackingFor, bulkPreview]);

  const renderRows = (list: typeof filtered) => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10">
            <Checkbox
              checked={
                list.length > 0 && list.every((o) => selectedIds.has(o.ID))
                  ? true
                  : list.some((o) => selectedIds.has(o.ID))
                    ? "indeterminate"
                    : false
              }
              onCheckedChange={(v) => {
                setSelectedIds((prev) => {
                  const next = new Set(prev);
                  if (v === true) for (const o of list) next.add(o.ID);
                  else for (const o of list) next.delete(o.ID);
                  return next;
                });
              }}
              aria-label="Select all"
            />
          </TableHead>
          <TableHead className="w-[180px]">Order #</TableHead>
          <TableHead>Client</TableHead>
          <TableHead className="w-24 text-right">Units</TableHead>
          <TableHead className="w-32 text-right">FNSKU labels</TableHead>
          <TableHead className="w-24 text-right">Bundles</TableHead>
          <TableHead className="w-[180px]">Order placed</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {list.map((o) => {
          const hrs = ageInHours(o.OrderDate as string);
          const bucket = ageBucket(hrs);
          const placed = o.OrderDate ? new Date(o.OrderDate as string) : null;
          const clientId = (o as { ClientId?: number }).ClientId;
          const client =
            (clientId != null && clientNameById.get(clientId)) ||
            (clientId != null ? `Client #${clientId}` : "—");
          const totalItems = (o as { TotalItems?: number }).TotalItems;
          return (
            <TableRow
              key={o.ID}
              onClick={() => navigate({ to: "/orders/$orderId", params: { orderId: String(o.ID) } })}
              className="cursor-pointer hover:bg-muted/40"
            >
              <TableCell
                onClick={(e) => e.stopPropagation()}
                className="w-10"
              >
                <Checkbox
                  checked={selectedIds.has(o.ID)}
                  onCheckedChange={() => toggleId(o.ID)}
                  aria-label={`Select order ${o.OrderNumber ?? o.ID}`}
                />
              </TableCell>
              <TableCell className="font-medium">
                {o.OrderNumber ?? `#${o.ID}`}
                {o.ChannelOrderRef && (
                  <div className="text-xs text-muted-foreground">{o.ChannelOrderRef}</div>
                )}
              </TableCell>
              <TableCell>{client}</TableCell>
              <TableCell>
                {o.CourierName ? (
                  <span className="text-xs">{o.CourierName}</span>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="text-right">
                <OrderItemsCell orderId={o.ID} fallbackUnits={totalItems} />
              </TableCell>
              <TableCell className="text-right">
                <OrderFnskuCell orderId={o.ID} />
              </TableCell>
              <TableCell className="text-right">
                <OrderBundlesCell orderId={o.ID} />
              </TableCell>
              <TableCell>
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">
                    {placed
                      ? placed.toLocaleString(undefined, {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "—"}
                  </span>
                  <Badge variant="outline" className={`w-fit ${bucketBadge[bucket]}`}>
                    <Clock className="mr-1 h-3 w-3" />
                    {formatAge(hrs)}
                  </Badge>
                </div>
              </TableCell>
            </TableRow>
          );
        })}
        {list.length === 0 && !ordersQuery.isLoading && (
          <TableRow>
            <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
              No orders in this view.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );

  const statCards: Array<{
    key: ReturnType<typeof ageBucket> | "total";
    label: string;
    value: number;
    tone: string;
  }> = [
    { key: "total", label: "Ready for dispatch", value: stats.total, tone: "text-foreground" },
    { key: "fresh", label: bucketLabel.fresh, value: stats.fresh, tone: "text-emerald-600" },
    { key: "today", label: bucketLabel.today, value: stats.today, tone: "text-amber-600" },
    { key: "stale", label: bucketLabel.stale, value: stats.stale, tone: "text-orange-600" },
    { key: "critical", label: bucketLabel.critical, value: stats.critical, tone: "text-destructive" },
  ];

  const todayCards: Array<{ key: string; label: string; value: number | string }> = [
    { key: "orders-today", label: "Orders", value: despatchedToday.length },
    {
      key: "units-today",
      label: "Units",
      value: todayTotals.loading ? "…" : todayTotals.units,
    },
    {
      key: "bundles-today",
      label: "Bundles",
      value: todayTotals.loading ? "…" : todayTotals.bundles,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dispatch dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Orders in Mintsoft status <span className="font-medium">NEW</span> — ready to pick, pack
            and despatch.
          </p>
        </div>
        <div className="flex gap-2">
          <MultiSelect
            options={(clientsQuery.data ?? []).map((c) => ({
              value: String(c.ID),
              label: c.BrandName || c.ShortName || c.Name || `Client #${c.ID}`,
            }))}
            value={clientFilter}
            onChange={setClientFilter}
            placeholder="All clients"
          />
          <Input
            placeholder="Filter…"
            className="w-64"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <Button
            variant="outline"
            onClick={() => qc.invalidateQueries({ queryKey: ["orders"] })}
            disabled={ordersQuery.isFetching}
          >
            <RefreshCw className={"mr-2 h-4 w-4 " + (ordersQuery.isFetching ? "animate-spin" : "")} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="space-y-3">
          <Card className="py-0">
            <CardContent className="p-3">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">
                Ready for dispatch
              </div>
              <div className="grid grid-cols-5 gap-2">
                {statCards.map((s) => (
                  <div key={s.key} className="rounded-md border px-2 py-1.5">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground truncate">
                        {s.label}
                      </span>
                      {s.key === "total" ? (
                        <Package className="h-3 w-3 text-muted-foreground shrink-0" />
                      ) : (
                        <Clock className="h-3 w-3 text-muted-foreground shrink-0" />
                      )}
                    </div>
                    <div className={`text-lg font-semibold tabular-nums leading-tight ${s.tone}`}>
                      {s.value}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="py-0">
            <CardContent className="p-3">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">
                Order volume rate <span className="normal-case tracking-normal">(09:00–17:00)</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-md border px-2 py-1.5">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground truncate">
                      Actual /hr
                    </span>
                    <Clock className="h-3 w-3 text-muted-foreground shrink-0" />
                  </div>
                  <div className="text-lg font-semibold tabular-nums leading-tight">
                    {todayTotals.loading ? "…" : volumeRate.actual}
                  </div>
                </div>
                <div className="rounded-md border px-2 py-1.5">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground truncate">
                      Required /hr
                    </span>
                    <Package className="h-3 w-3 text-muted-foreground shrink-0" />
                  </div>
                  <div
                    className={`text-lg font-semibold tabular-nums leading-tight ${
                      volumeRate.required > volumeRate.actual ? "text-destructive" : "text-emerald-600"
                    }`}
                  >
                    {outstandingUnits.loading ? "…" : volumeRate.required}
                  </div>
                </div>
                <div className="rounded-md border px-2 py-1.5">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground truncate">
                      Hours left
                    </span>
                    <Clock className="h-3 w-3 text-muted-foreground shrink-0" />
                  </div>
                  <div className="text-lg font-semibold tabular-nums leading-tight">
                    {volumeRate.hoursLeft}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-3">
          <Card className="py-0">
            <CardContent className="p-3">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">
                Despatched today
              </div>
              <div className="grid grid-cols-3 gap-2">
                {todayCards.map((s) => (
                  <div key={s.key} className="rounded-md border px-2 py-1.5">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground truncate">
                        {s.label}
                      </span>
                      <Truck className="h-3 w-3 text-muted-foreground shrink-0" />
                    </div>
                    <div className="text-lg font-semibold tabular-nums leading-tight">
                      {s.value}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
          <QuickPrintCard mode="print" />
        </div>
      </div>

      {ordersQuery.error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {(ordersQuery.error as Error).message}
        </div>
      )}

      {selectedIds.size > 0 && (
        <div className="sticky top-2 z-10 flex items-center justify-between gap-3 rounded-md border bg-card p-3 shadow-sm">
          <div className="text-sm">
            <span className="font-medium">{selectedIds.size}</span> order
            {selectedIds.size === 1 ? "" : "s"} selected
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => printSelectedPickingLists(Array.from(selectedIds))}
              disabled={bulkLoading}
            >
              {bulkLoading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Printer className="mr-2 h-4 w-4" />
              )}
              Print picking lists
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
              <X className="mr-2 h-4 w-4" />
              Clear
            </Button>
          </div>
        </div>
      )}

      <Tabs defaultValue="ready">
        <TabsList>
          <TabsTrigger value="ready">
            Ready for dispatch ({ordersQuery.data?.length ?? 0})
          </TabsTrigger>
          <TabsTrigger value="despatched">
            Despatched ({despatchedQuery.data?.length ?? 0})
          </TabsTrigger>
          <TabsTrigger value="invoiced">
            Invoiced ({invoicedQuery.data?.length ?? 0})
          </TabsTrigger>
        </TabsList>
        <TabsContent value="ready" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {ordersQuery.isLoading
                  ? "Loading…"
                  : `${filtered.length} order${filtered.length === 1 ? "" : "s"} — oldest first`}
              </CardTitle>
            </CardHeader>
            <CardContent>{!ordersQuery.error && renderRows(filtered)}</CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="despatched" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {despatchedQuery.isLoading
                  ? "Loading…"
                  : `${filteredDespatched.length} despatched order${filteredDespatched.length === 1 ? "" : "s"}`}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {despatchedQuery.error ? (
                <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                  {(despatchedQuery.error as Error).message}
                </div>
              ) : (
                renderRows(filteredDespatched)
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="invoiced" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {invoicedQuery.isLoading
                  ? "Loading…"
                  : `${filteredInvoiced.length} invoiced order${filteredInvoiced.length === 1 ? "" : "s"}`}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {invoicedQuery.error ? (
                <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                  {(invoicedQuery.error as Error).message}
                </div>
              ) : (
                renderRows(filteredInvoiced)
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog
        open={!!trackingFor}
        onOpenChange={(open) => {
          if (!open) setTrackingFor(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Truck className="h-5 w-5" /> Scan tracking number
            </DialogTitle>
          </DialogHeader>
          {trackingFor && (
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground">
                Order {trackingFor.OrderNumber ?? `#${trackingFor.ID}`} ·{" "}
                {trackingFor.CourierName ?? "Unknown courier"}
              </div>
              <Input
                ref={trackingRef}
                value={trackingValue}
                onChange={(e) => setTrackingValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitTracking.mutate();
                }}
                placeholder="Scan barcode…"
                autoFocus
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTrackingFor(null)}>
              Skip
            </Button>
            <Button onClick={() => submitTracking.mutate()} disabled={submitTracking.isPending}>
              {submitTracking.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save tracking
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!bulkPreview} onOpenChange={(open) => !open && setBulkPreview(null)}>
        <DialogContent className="flex h-[90vh] w-[95vw] max-w-5xl flex-col p-4">
          <DialogHeader>
            <DialogTitle className="truncate text-sm font-medium">
              {bulkPreview?.fileName ?? "Picking lists"}
            </DialogTitle>
          </DialogHeader>
          {bulkPreview && <PdfPreview bytes={bulkPreview.bytes} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

