import { requireAuth } from "@/lib/require-auth";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { PdfPreview } from "@/components/PdfPreview";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import {
  despatchOrder,
  fetchOrderItems,
  fetchOrderDocuments,
  fetchProduct,
  fetchProductBundle,
  fetchProductStock,
  stockMovementIn,
  fetchOrder,
  listWarehouses,
  listWarehouseLocations,
  fetchWarehouseLocation,
  fetchOrderAllocations,
  fetchProductOrderAllocations,
  type OrderAllocation,
  listClients,
  listOpenOrders,
  type MintsoftOrder,
  type MintsoftOrderItem,
  type MintsoftProduct,
  addOrderComment,
} from "@/lib/mintsoft";
import { detectFromBytes, type LabelKind } from "@/lib/pdfSize";
import { PDFDocument } from "pdf-lib";
import { scanLabelPdf, buildSkuBarcodeMap } from "@/lib/labelScan";
import { pickPrinter, printPdfBytes } from "@/lib/printing";
import { loadSettings } from "@/lib/storage";
import { REWORK_CATALOG, getRate, formatGBP } from "@/lib/rework";
import { ArrowLeft, ArrowRight, Check, Eye, FileText, Flag, ImageOff, Loader2, MapPin, Minus, Printer, AlertTriangle, ListChecks, Plus, Weight } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/orders_/$orderId")({
  ssr: false,
  beforeLoad: ({ location }) => requireAuth(location),
  component: OrderDetailPage,
});

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

function ProductImage({
  product,
  scannedBarcode,
}: {
  product: MintsoftProduct | null | undefined;
  scannedBarcode?: string | null;
}) {
  const direct = product?.ImageURL || null;
  // Prefer barcodes (unique), then scanned barcode, then product name.
  // Never use SKU — internal codes match unrelated listings.
  const queries = [product?.EAN, product?.UPC, scannedBarcode, product?.Name]
    .map((q) => (q ? String(q).trim() : ""))
    .filter((q) => q.length > 0);

  const amazonQuery = useQuery({
    queryKey: ["best-image", product?.SKU ?? product?.Name, queries],
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
        // fall through
      }
      return candidates[0].image;
    },
    enabled: !direct && queries.length > 0,
    staleTime: 60 * 60_000,
    refetchOnWindowFocus: false,
  });

  if (direct) {
    return (
      <img
        src={direct}
        alt={product?.Name ?? ""}
        className="h-20 w-20 rounded-md border bg-muted object-contain"
        loading="lazy"
      />
    );
  }

  if (amazonQuery.isLoading) {
    return (
      <div className="flex h-20 w-20 items-center justify-center rounded-md border bg-muted">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (amazonQuery.data) {
    return (
      <div className="relative">
        <img
          src={amazonQuery.data}
          alt={`Suggested image for ${product?.Name ?? ""}`}
          className="h-20 w-20 rounded-md border-2 border-amber-500/50 bg-muted object-contain"
          loading="lazy"
        />
        <div className="absolute -top-1 -right-1 rounded-full bg-amber-500 p-0.5 text-white">
          <AlertTriangle className="h-3 w-3" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-20 w-20 items-center justify-center rounded-md border bg-muted text-muted-foreground">
      <ImageOff className="h-5 w-5" />
    </div>
  );
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function getOrderReference(order: MintsoftOrder | null | undefined): string | null {
  if (!order) return null;
  return firstString(
    order.ChannelOrderRef,
    order["ChannelOrderReference"],
    order["ExternalOrderReference"],
    order["ExternalOrderRef"],
    order["Reference"],
    order.OrderNumber,
    order["OrderNo"],
  );
}

function OrderDetailPage() {
  const { orderId } = Route.useParams();
  const id = Number(orderId);
  const qc = useQueryClient();
  const [printing, setPrinting] = useState(false);
  const [labelsPrinted, setLabelsPrinted] = useState(false);
  const [despatched, setDespatched] = useState(false);
  const [overweightOpen, setOverweightOpen] = useState(false);

  // Load order summary from the cached open-orders list (avoids an extra fetch).
  const ordersQuery = useQuery({
    queryKey: ["orders"],
    queryFn: () => listOpenOrders(loadSettings()),
    refetchOnWindowFocus: false,
  });
  const orderSummary = (ordersQuery.data ?? []).find((o) => o.ID === id) as MintsoftOrder | undefined;
  const orderQuery = useQuery({
    queryKey: ["order", id],
    queryFn: () => fetchOrder(loadSettings(), id),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
  const order = orderQuery.data ?? orderSummary;
  const orderReference = firstString(
    order?.ChannelOrderRef,
    orderSummary?.ChannelOrderRef,
    order?.["ChannelOrderReference"],
    orderSummary?.["ChannelOrderReference"],
    order?.["ExternalOrderReference"],
    orderSummary?.["ExternalOrderReference"],
    order?.["ExternalOrderRef"],
    orderSummary?.["ExternalOrderRef"],
    order?.["Reference"],
    orderSummary?.["Reference"],
    order?.OrderNumber,
    orderSummary?.OrderNumber,
    order?.["OrderNo"],
    orderSummary?.["OrderNo"],
  );

  const clientsQuery = useQuery({
    queryKey: ["clients"],
    queryFn: () => listClients(loadSettings()),
    staleTime: 30 * 60_000,
    refetchOnWindowFocus: false,
  });
  const clientName = useMemo(() => {
    if (!order) return null;
    const cid = (order as { ClientId?: number }).ClientId;
    const c = (clientsQuery.data ?? []).find((x) => x.ID === cid);
    return c?.BrandName || c?.ShortName || c?.Name || null;
  }, [order, clientsQuery.data]);

  const itemsQuery = useQuery({
    queryKey: ["order-items", id],
    queryFn: () => fetchOrderItems(loadSettings(), id),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  // Pull the same allocation data Mintsoft uses to build the picking list so
  // we can show pickers where each SKU is stocked (location, batch, BBE).
  const allocationsQuery = useQuery({
    queryKey: ["order-allocations", id],
    queryFn: async () => {
      const settings = loadSettings();
      let allocs: OrderAllocation[] = [];
      try {
        allocs = await fetchOrderAllocations(settings, id);
      } catch (e) {
        console.warn("[order] fetchOrderAllocations failed", e);
      }
      // Resolve any missing/numeric location names to the short bin code
      // (e.g. "B10-S1-PL1") so pickers see the same label as the picking list.
      const needsName = (n: string | undefined, locId: number | undefined) => {
        if (!locId) return false;
        const t = (n ?? "").trim().toLowerCase();
        return !t || t === `${locId}` || t === `location ${locId}`;
      };
      // Build a global locationId -> short-name map by listing every
      // warehouse's locations once (same source the picking list uses).
      // Falls back to MIL1 if no warehouseId was returned on the allocation.
      const unresolved = allocs.filter((a) =>
        a.locationId && needsName(a.locationName, a.locationId),
      );
      if (unresolved.length > 0) {
        let warehouseIds = Array.from(
          new Set(unresolved.map((a) => a.warehouseId).filter((w): w is number => !!w)),
        );
        if (warehouseIds.length === 0) {
          try {
            const whs = await listWarehouses(settings);
            const mil1 =
              whs.find((w) => (w.code ?? "").toUpperCase() === "MIL1") ||
              whs.find((w) => (w.name ?? "").toUpperCase().includes("MIL1"));
            if (mil1) warehouseIds = [mil1.id];
          } catch (e) {
            console.warn("[order] listWarehouses failed", e);
          }
        }
        const nameMap = new Map<number, string>();
        await Promise.all(
          warehouseIds.map(async (wid) => {
            try {
              const locs = await listWarehouseLocations(settings, wid);
              for (const l of locs) {
                if (l.name) nameMap.set(l.id, l.code || l.name);
              }
            } catch (e) {
              console.warn("[order] listWarehouseLocations failed", wid, e);
            }
          }),
        );
        for (const a of allocs) {
          if (a.locationId && needsName(a.locationName, a.locationId)) {
            const name = nameMap.get(a.locationId);
            if (name) a.locationName = name;
          }
        }
      }
      const byItem = new Map<number, OrderAllocation[]>();
      const byProduct = new Map<number, OrderAllocation[]>();
      for (const a of allocs) {
        if (a.orderItemId) {
          const list = byItem.get(a.orderItemId) ?? [];
          list.push(a);
          byItem.set(a.orderItemId, list);
        }
        if (a.productId) {
          const list = byProduct.get(a.productId) ?? [];
          list.push(a);
          byProduct.set(a.productId, list);
        }
      }
      return { byItem, byProduct };
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const productIds = useMemo(
    () => Array.from(new Set((itemsQuery.data ?? []).map((it) => it.ProductId))),
    [itemsQuery.data],
  );

  const productsQuery = useQuery({
    queryKey: ["order-products", id, productIds.join(",")],
    queryFn: async () => {
      const settings = loadSettings();
      const entries = await Promise.all(
        productIds.map(async (pid) => [pid, await fetchProduct(settings, pid)] as const),
      );
      const map = new Map<number, MintsoftProduct>();
      for (const [pid, p] of entries) if (p) map.set(pid, p);
      return map;
    },
    enabled: productIds.length > 0,
    staleTime: 30 * 60_000,
    refetchOnWindowFocus: false,
  });

  // For products flagged as bundles, fetch the component list so we can show
  // how many physical units make up the bundle SKU.
  const bundleProductIds = useMemo(() => {
    const products = productsQuery.data;
    if (!products) return [] as number[];
    return Array.from(products.values())
      .filter((p) => p.Bundle || p.IsBundle || (p.BundleProducts && p.BundleProducts.length))
      .map((p) => p.ID);
  }, [productsQuery.data]);

  const bundlesQuery = useQuery({
    queryKey: ["order-bundles", id, bundleProductIds.join(",")],
    queryFn: async () => {
      const settings = loadSettings();
      const map = new Map<
        number,
        { units: number; components: Array<{ SKU?: string; Quantity: number }> }
      >();
      await Promise.all(
        bundleProductIds.map(async (pid) => {
          const inline = productsQuery.data?.get(pid)?.BundleProducts ?? [];
          let comps: Array<{ SKU?: string; Quantity: number }> = inline.map((c) => ({
            SKU: c.SKU ?? undefined,
            Quantity: Number(c.Quantity ?? 1) || 1,
          }));
          if (comps.length === 0) {
            const fetched = await fetchProductBundle(settings, pid);
            comps = fetched.map((c) => ({ SKU: c.SKU, Quantity: c.Quantity }));
          }
          const total = comps.reduce((sum, c) => sum + c.Quantity, 0);
          if (total > 0) map.set(pid, { units: total, components: comps });
        }),
      );
      return map;
    },
    enabled: bundleProductIds.length > 0,
    staleTime: 30 * 60_000,
    refetchOnWindowFocus: false,
  });

  // Scan barcodes from the 51×25mm picking labels so we can use them as
  // EAN-equivalents when looking up suggested product images.
  const scanQuery = useQuery({
    queryKey: ["label-scan", id],
    queryFn: async () => {
      const docs = await fetchOrderDocuments(loadSettings(), id);
      const labelDocs: Array<{ bytes: Uint8Array }> = [];
      for (const doc of docs) {
        const isPdf =
          (doc.contentType ?? "application/pdf").toLowerCase().includes("pdf") ||
          doc.fileName?.toLowerCase().endsWith(".pdf");
        if (!isPdf) continue;
        try {
          const size = await detectFromBytes(doc.bytes);
          if (size.kind === "small") labelDocs.push({ bytes: doc.bytes });
        } catch {
          /* ignore */
        }
      }
      const allScans = [];
      for (const d of labelDocs) {
        try {
          const s = await scanLabelPdf(d.bytes);
          allScans.push(...s);
        } catch (e) {
          console.warn("[label-scan] failed", e);
        }
      }
      return allScans;
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const skuBarcodeMap = useMemo(() => {
    const skus = (itemsQuery.data ?? [])
      .map((it) => it.SKU)
      .filter((s): s is string => !!s);
    return buildSkuBarcodeMap(scanQuery.data ?? [], skus);
  }, [scanQuery.data, itemsQuery.data]);

  // Shipping label page count → used to auto-derive Cartons Forwarded
  // (2 pages per box, so cartons = pages / 2, rounded up).
  const shippingPagesQuery = useQuery({
    queryKey: ["shipping-pages", id],
    queryFn: async () => {
      const docs = await fetchOrderDocuments(loadSettings(), id);
      let pages = 0;
      for (const doc of docs) {
        const isPdf =
          (doc.contentType ?? "application/pdf").toLowerCase().includes("pdf") ||
          doc.fileName?.toLowerCase().endsWith(".pdf");
        if (!isPdf) continue;
        try {
          const size = await detectFromBytes(doc.bytes);
          if (size.kind !== "large") continue;
          const pdf = await PDFDocument.load(doc.bytes, { ignoreEncryption: true });
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

  // Scan the shipping (large) label PDF for the courier tracking barcode.
  // We pick the longest unique barcode found (couriers usually print a long
  // tracking 1D barcode plus shorter routing/zone codes).
  const trackingQuery = useQuery({
    queryKey: ["tracking-scan", id],
    queryFn: async () => {
      const docs = await fetchOrderDocuments(loadSettings(), id);
      const barcodeCandidates: string[] = [];
      const textBlobs: string[] = [];
      for (const doc of docs) {
        const isPdf =
          (doc.contentType ?? "application/pdf").toLowerCase().includes("pdf") ||
          doc.fileName?.toLowerCase().endsWith(".pdf");
        if (!isPdf) continue;
        try {
          const size = await detectFromBytes(doc.bytes);
          if (size.kind !== "large") continue;
          const scans = await scanLabelPdf(doc.bytes);
          for (const s of scans) {
            if (s.barcode && s.barcode.length >= 8) barcodeCandidates.push(s.barcode);
            if (s.text) textBlobs.push(s.text);
          }
        } catch {
          /* ignore */
        }
      }
      const text = textBlobs.join(" \n ");
      // 1) Known courier patterns — anywhere in the printed text.
      const courierPatterns: RegExp[] = [
        /\b(1Z[0-9A-Z]{16})\b/i, // UPS
        /\b([A-Z]{2}\d{9}GB)\b/, // Royal Mail / international S10
        /\b(JD\d{18,22})\b/, // DPD/Yodel JD-prefix
        /\b(H\d{15,18})\b/, // Evri/Hermes
        /\b(\d{20,22})\b/, // FedEx / generic long numeric
      ];
      for (const re of courierPatterns) {
        const m = text.match(re);
        if (m) return m[1].toUpperCase();
      }
      // 2) "Tracking[: #] <value>" label on the printed text.
      const labelled = text.match(
        /tracking[\s#:no.]*([A-Z0-9]{8,30})/i,
      );
      if (labelled) return labelled[1].toUpperCase();
      // 3) Apply the same courier patterns to the decoded barcodes.
      for (const b of barcodeCandidates) {
        for (const re of courierPatterns) {
          const m = b.match(re);
          if (m) return m[1].toUpperCase();
        }
      }
      // 4) Last resort — longest barcode found.
      if (barcodeCandidates.length === 0) return null;
      barcodeCandidates.sort((a, b) => b.length - a.length);
      return barcodeCandidates[0];
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const [chargesSubmitted, setChargesSubmitted] = useState(false);
  const [confirmDespatch, setConfirmDespatch] = useState(false);

  const printLabels = useMutation({
    mutationFn: async () => {
      if (!order) throw new Error("Order not loaded");
      setPrinting(true);
      const settings = loadSettings();
      const docs = (await fetchOrderDocuments(settings, order.ID)).filter((doc) =>
        (doc.contentType ?? "application/pdf").toLowerCase().includes("pdf") ||
        doc.fileName?.toLowerCase().endsWith(".pdf"),
      );
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
      return summary;
    },
    onSuccess: (summary) => {
      const ref = orderReference ?? `#${id}`;
      toast.success(`Order ${ref}: printed ${summary.length} label(s)`);
      setLabelsPrinted(true);
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed"),
    onSettled: () => setPrinting(false),
  });

  const despatch = useMutation({
    mutationFn: async () => {
      if (!order) throw new Error("Order not loaded");
      await despatchOrder(
        loadSettings(),
        order.ID,
        trackingQuery.data ?? undefined,
      );
    },
    onSuccess: () => {
      const tn = trackingQuery.data;
      const ref = orderReference ?? `#${id}`;
      toast.success(
        tn ? `Order ${ref} despatched (tracking ${tn})` : `Order ${ref} despatched`,
      );
      void qc.invalidateQueries({ queryKey: ["orders"] });
      setDespatched(true);
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const handleDespatchClick = () => {
    if (!chargesSubmitted) {
      setConfirmDespatch(true);
      return;
    }
    despatch.mutate();
  };

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" asChild className="mb-2 -ml-2">
          <Link to="/orders">
            <ArrowLeft className="mr-1 h-4 w-4" /> Back to dashboard
          </Link>
        </Button>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {orderReference ? `Order: ${orderReference}` : `Order #${id}`}
            </h1>
            <p className="text-sm text-muted-foreground">
              {clientName ?? "—"}
              {order?.OrderDate
                ? ` · placed ${new Date(order.OrderDate as string).toLocaleString()}`
                : ""}
            </p>
          </div>
          <PrintPickingListButton orderId={order?.ID ?? Number(id)} />
        </div>
      </div>

      <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-400">
        <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
        Images with an amber border are <strong>suggested matches from Amazon UK</strong>, not the
        official product image — verify before picking.
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Required SKUs ({(itemsQuery.data ?? []).length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Image</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Qty</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {itemsQuery.isLoading && (
                <TableRow>
                  <TableCell colSpan={4} className="py-10 text-center text-sm text-muted-foreground">
                    <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading items…
                  </TableCell>
                </TableRow>
              )}
              {!itemsQuery.isLoading &&
                (itemsQuery.data ?? []).map((it) => {
                  const p = productsQuery.data?.get(it.ProductId);
                  const isSuggested = !p?.ImageURL;
                  const skuKey = it.SKU ?? p?.SKU ?? "";
                  const scannedBarcode = skuKey ? skuBarcodeMap.get(skuKey) : undefined;
                  // Mintsoft tags bundle order lines with an internal
                  // OrderItemNameValue named "BUNDLE-ID" whose value is
                  // "<bundleProductId>;<numberOfBundles>;<guid>". The line
                  // Quantity is the total units; units-per-bundle is therefore
                  // Quantity / numberOfBundles.
                  const bundleTag = (it.OrderItemNameValues ?? []).find(
                    (v) => (v?.Name ?? "").toUpperCase() === "BUNDLE-ID",
                  );
                  const bundleParts = bundleTag?.Value?.split(";") ?? [];
                  const numberOfBundles = Number(bundleParts[1]);
                  const bundleInfo = bundlesQuery.data?.get(it.ProductId);
                  const unitsPerBundle =
                    Number.isFinite(numberOfBundles) &&
                    numberOfBundles > 0 &&
                    it.Quantity
                      ? Math.round(it.Quantity / numberOfBundles)
                      : bundleInfo?.units;
                  const isBundle = !!(
                    bundleTag || p?.Bundle || p?.IsBundle || bundleInfo
                  );
                  const allocs =
                    allocationsQuery.data?.byItem.get(it.ID) ??
                    (it.ProductId
                      ? allocationsQuery.data?.byProduct.get(it.ProductId)
                      : undefined) ??
                    [];
                  return (
                    <TableRow key={it.ID}>
                      <TableCell>
                        <ProductImage product={p} scannedBarcode={scannedBarcode} />
                      </TableCell>
                      <TableCell className="font-mono text-xs align-top pt-4">
                        {it.SKU ?? p?.SKU ?? "—"}
                        {isBundle && (
                          <div className="mt-1">
                            <HoverCard openDelay={100} closeDelay={50}>
                              <HoverCardTrigger asChild>
                                <Badge
                                  variant="outline"
                                  className="cursor-help border-indigo-500/40 bg-indigo-500/10 text-indigo-700 font-sans"
                                >
                                  {unitsPerBundle
                                    ? `${unitsPerBundle} units per bundle`
                                    : "Bundle"}
                                </Badge>
                              </HoverCardTrigger>
                              <HoverCardContent align="start" className="w-72 p-0">
                                <div className="border-b px-3 py-2 text-xs font-semibold">
                                  Bundle components
                                </div>
                                {bundleInfo?.components?.length ? (
                                  <ul className="divide-y text-xs">
                                    {bundleInfo.components.map((c, i) => (
                                      <li
                                        key={i}
                                        className="flex items-center justify-between px-3 py-1.5"
                                      >
                                        <span className="font-mono">{c.SKU ?? "—"}</span>
                                        <span className="tabular-nums text-muted-foreground">
                                          × {c.Quantity}
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                ) : (
                                  <div className="px-3 py-3 text-xs text-muted-foreground">
                                    {bundlesQuery.isFetching
                                      ? "Loading components…"
                                      : "No component details available."}
                                  </div>
                                )}
                              </HoverCardContent>
                            </HoverCard>
                          </div>
                        )}
                        {p?.EAN && (
                          <div className="text-[10px] text-muted-foreground">EAN {p.EAN}</div>
                        )}
                      </TableCell>
                      <TableCell className="align-top pt-4">
                        <div className="text-sm">{p?.Name || p?.Description || "—"}</div>
                        {isSuggested && p && (
                          <Badge
                            variant="outline"
                            className="mt-1 border-amber-500/40 bg-amber-500/10 text-amber-700"
                          >
                            <AlertTriangle className="mr-1 h-3 w-3" />
                            Suggested image
                          </Badge>
                        )}
                        <div className="mt-2 space-y-0.5 text-xs">
                          {allocationsQuery.isLoading && (
                            <div className="text-muted-foreground">
                              <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
                              Loading pick location…
                            </div>
                          )}
                          {!allocationsQuery.isLoading && allocs.length === 0 && (
                            <div className="text-muted-foreground">
                              <MapPin className="mr-1 inline h-3 w-3" />
                              No allocation
                            </div>
                          )}
                          {allocs.map((a, i) => {
                            const loc = a.locationName || "Unassigned";
                            const meta: string[] = [];
                            if (a.batchNo) meta.push(`Batch ${a.batchNo}`);
                            if (a.bestBefore)
                              meta.push(
                                `BBE ${new Date(a.bestBefore).toLocaleDateString()}`,
                              );
                            return (
                              <div
                                key={`${a.orderItemId ?? "p"}-${a.locationId ?? "x"}-${i}`}
                                className="flex flex-wrap items-center gap-x-2 gap-y-0.5"
                              >
                                <span className="inline-flex items-center font-medium text-foreground">
                                  <MapPin className="mr-1 h-3 w-3 text-muted-foreground" />
                                  {loc}
                                </span>
                                <span className="tabular-nums text-muted-foreground">
                                  × {a.quantity}
                                </span>
                                {meta.length > 0 && (
                                  <span className="text-muted-foreground">
                                    · {meta.join(" · ")}
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-2xl font-semibold tabular-nums align-top pt-3">
                        {it.Quantity}
                        {isBundle && Number.isFinite(numberOfBundles) && numberOfBundles > 0 && (
                          <div className="text-xs font-medium text-indigo-700">
                            {numberOfBundles} bundles
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              {!itemsQuery.isLoading && (itemsQuery.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-10 text-center text-sm text-muted-foreground">
                    No items on this order.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
        <WeightEstimateFooter
          items={itemsQuery.data ?? []}
          products={productsQuery.data}
          onOverweight={() => setOverweightOpen(true)}
        />
        </Card>

        <div className="space-y-3">
          <ReworkChargesCard
            items={itemsQuery.data ?? []}
            fnskuLabelCount={scanQuery.data?.length ?? 0}
            shippingLabelPages={shippingPagesQuery.data ?? 0}
            orderId={id}
            orderNumber={orderReference}
            clientId={(order as { ClientId?: number } | undefined)?.ClientId ?? null}
            onSubmitted={() => setChargesSubmitted(true)}
            submitted={chargesSubmitted}
            attention={!chargesSubmitted}
          />
          <Button
            className={`w-full ${chargesSubmitted && !labelsPrinted ? "animate-attention" : ""}`}
            variant="outline"
            onClick={() => printLabels.mutate()}
            disabled={printing || !order}
          >
            {printing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : labelsPrinted ? (
              <Check className="mr-2 h-4 w-4" />
            ) : (
              <Printer className="mr-2 h-4 w-4" />
            )}
            Print labels
          </Button>
          <Button
            className={`w-full ${chargesSubmitted && labelsPrinted ? "animate-attention" : ""}`}
            size="lg"
            onClick={handleDespatchClick}
            disabled={despatch.isPending || !order}
          >
            {despatch.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Despatch
          </Button>
          {despatched && (
            <Button
              className="w-full"
              variant="outline"
              onClick={() => setOverweightOpen(true)}
            >
              <Weight className="mr-2 h-4 w-4" />
              Order overweight
            </Button>
          )}
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
            <div className="font-medium text-muted-foreground">Tracking number</div>
            {trackingQuery.isLoading ? (
              <div className="text-muted-foreground">Scanning shipping label…</div>
            ) : trackingQuery.data ? (
              <div className="font-mono text-foreground">{trackingQuery.data}</div>
            ) : (
              <div className="text-muted-foreground">
                No tracking barcode detected on the shipping label.
              </div>
            )}
          </div>
        </div>
      </div>

      <OrderDocumentsCard orderId={id} />

      <OverweightDialog
        open={overweightOpen}
        onOpenChange={setOverweightOpen}
        items={itemsQuery.data ?? []}
        products={productsQuery.data}
        orderId={id}
        orderNumber={orderReference}
      />

      <AlertDialog open={confirmDespatch} onOpenChange={setConfirmDespatch}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Despatch without submitting charges?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Rework charges have not been submitted for this order. If you
              despatch now, the charges will not be billed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Go back</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmDespatch(false);
                despatch.mutate();
              }}
            >
              Despatch anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function PrintPickingListButton({ orderId }: { orderId: number }) {
  const [loading, setLoading] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [preview, setPreview] = useState<{ bytes: Uint8Array; url: string; fileName: string } | null>(null);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview.url);
    };
  }, [preview]);

  const handleClick = async () => {
    setLoading(true);
    try {
      const settings = loadSettings();
      const docs = await fetchOrderDocuments(settings, orderId);
      // Prefer the Mintsoft despatch note / picking list. Do NOT match FBA
      // "prep" labels — those are a different document.
      const isPickingList = (d: { label: string; fileName?: string }) =>
        /pick(ing)?\s*list|despatch\s*note|dispatch\s*note/i.test(d.label) ||
        /pick(ing)?[-_ ]?list|despatch[-_ ]?note|dispatch[-_ ]?note/i.test(d.fileName ?? "");
      const pick = docs.find(isPickingList);
      if (!pick) throw new Error("No picking list found on the despatch note for this order");
      if (preview) {
        URL.revokeObjectURL(preview.url);
      }
      const blob = new Blob([pick.bytes as BlobPart], { type: "application/pdf" });
      setPreview({
        bytes: pick.bytes,
        url: URL.createObjectURL(blob),
        fileName: pick.fileName || pick.label || "Picking list.pdf",
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to open picking list");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-2">
        <Button variant="outline" onClick={handleClick} disabled={loading}>
          {loading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <ListChecks className="mr-2 h-4 w-4" />
          )}
          View picking list
        </Button>
        <Button
          variant="outline"
          size="icon"
          title="Print picking list"
          aria-label="Print picking list"
          disabled={printing}
          onClick={async () => {
            setPrinting(true);
            try {
              const settings = loadSettings();
              const docs = await fetchOrderDocuments(settings, orderId);
              const isPickingList = (d: { label: string; fileName?: string }) =>
                /pick(ing)?\s*list|despatch\s*note|dispatch\s*note/i.test(d.label) ||
                /pick(ing)?[-_ ]?list|despatch[-_ ]?note|dispatch[-_ ]?note/i.test(d.fileName ?? "");
              const pick = docs.find(isPickingList);
              if (!pick) throw new Error("No picking list found for this order");
              const printer = pickPrinter(settings, "other");
              await printPdfBytes(pick.bytes, printer, settings.silentPrint);
              toast.success("Picking list sent to printer");
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Failed to print picking list");
            } finally {
              setPrinting(false);
            }
          }}
        >
          {printing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
        </Button>
      </div>
      <Dialog open={!!preview} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="flex h-[90vh] w-[95vw] max-w-5xl flex-col p-4">
          <DialogHeader>
            <DialogTitle className="truncate text-sm font-medium">
              {preview?.fileName ?? "Picking list"}
            </DialogTitle>
          </DialogHeader>
          {preview && <PdfPreview bytes={preview.bytes} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function ReworkChargesCard({
  items,
  fnskuLabelCount,
  shippingLabelPages,
  className,
  orderId,
  orderNumber,
  clientId,
  onSubmitted,
  submitted,
  attention,
}: {
  items: Array<{
    Quantity: number;
    OrderItemNameValues?: Array<{
      Name?: string | null;
      Value?: string | null;
    }> | null;
  }>;
  fnskuLabelCount: number;
  shippingLabelPages: number;
  className?: string;
  orderId: number;
  orderNumber?: string | null;
  clientId: number | null;
  onSubmitted: () => void;
  submitted: boolean;
  attention?: boolean;
}) {
  const findByKey = (key: string) => REWORK_CATALOG.find((c) => c.key === key)!;
  const settingsForRates = loadSettings();
  const rateFor = (key: string) =>
    getRate(settingsForRates.reworkRates ?? {}, clientId, key);

  // Auto-counted defaults.
  // - FNSKU labels: number of label pages on the 51×25mm picking-label PDF.
  // - Bundles (<6 units): total number of bundles across all bundle lines
  //   (sum of qty / unitsPerBundle for each line tagged with BUNDLE-ID).
  // - Shipping carton supplied: defaults to 1 per order, override as needed.
  const fnskuCount = fnskuLabelCount;
  // Cartons Forwarded: 2 pages per box on the shipping-label PDF.
  const cartonsForwarded = Math.max(1, Math.ceil(shippingLabelPages / 2));

  const bundleCount = items.reduce((sum, it) => {
    const tag = (it.OrderItemNameValues ?? []).find(
      (v) => (v?.Name ?? "").toUpperCase() === "BUNDLE-ID",
    );
    if (!tag?.Value) return sum;
    // Mintsoft encodes BUNDLE-ID as "<bundleProductId>;<numberOfBundles>;<guid>".
    const numberOfBundles = Number(tag.Value.split(";")[1]);
    if (!Number.isFinite(numberOfBundles) || numberOfBundles <= 0) return sum;
    return sum + numberOfBundles;
  }, 0);

  const initial = useMemo<Record<string, number>>(
    () => ({
      fnsku: fnskuCount,
      bundle: bundleCount,
      carton_supplied: 1,
      carton_forwarded: cartonsForwarded,
      bundle_over6: 0,
    }),
    [fnskuCount, bundleCount, cartonsForwarded],
  );
  const autoMap: Record<string, number> = {
    fnsku: fnskuCount,
    bundle: bundleCount,
    carton_supplied: 1,
    carton_forwarded: cartonsForwarded,
    bundle_over6: 0,
  };

  const [qty, setQty] = useState<Record<string, number>>(initial);
  const [pickerValue, setPickerValue] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  // Re-sync auto-counted defaults when the underlying order items load/change.
  useEffect(() => {
    setQty(initial);
  }, [initial]);

  const handleSubmit = async () => {
    const entries = REWORK_CATALOG.map((c) => ({ ...c, qty: qty[c.key] ?? 0 })).filter(
      (e) => e.qty > 0,
    );
    if (entries.length === 0) {
      toast.warning("No rework charges to submit");
      return;
    }
    const settings = loadSettings();
    const missingRates = entries.filter(
      (e) => getRate(settings.reworkRates ?? {}, clientId, e.key) == null,
    );
    if (missingRates.length > 0) {
      const list = missingRates.map((m) => `• ${m.label}`).join("\n");
      const ok = window.confirm(
        `Warning: no rate is set for this client on the following lines:\n\n${list}\n\nThese will be submitted with no charge applied. Proceed anyway?`,
      );
      if (!ok) return;
    }
    setSubmitting(true);
    try {
      // Uniform inline format, e.g.:
      //   FNSKU Labelling @ £0.11 per unit x 26, Bundles <6 units @ £0.30 x 24, Total price £8.06
      let total = 0;
      let anyRated = false;
      const parts = entries.map((e) => {
        const rate = getRate(settings.reworkRates ?? {}, clientId, e.key);
        if (rate != null) {
          anyRated = true;
          total += rate * e.qty;
          return `${e.label} @ £${rate.toFixed(2)} per unit x ${e.qty}`;
        }
        return `${e.label} (no rate set) x ${e.qty}`;
      });
      const furtherCharges = anyRated ? ` Further Charges: £${total.toFixed(2)}` : "";
      const comment = `Inspection Fee charged at order picking fee. Additional Prep Work: ${parts.join(", ")}.${furtherCharges}`;
      await addOrderComment(settings, orderId, comment, true);
      const ref = orderNumber ?? `#${orderId}`;
      toast.success(`Order ${ref}: charges submitted (${entries.length} line${entries.length === 1 ? "" : "s"})`);
      onSubmitted();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to submit charges");
    } finally {
      setSubmitting(false);
    }
  };

  const ALWAYS_VISIBLE = new Set(["fnsku", "carton_forwarded", "carton_supplied"]);
  const visibleKeys = REWORK_CATALOG.filter(
    (c) => (qty[c.key] ?? 0) > 0 || (autoMap[c.key] ?? 0) > 0 || ALWAYS_VISIBLE.has(c.key),
  ).map((c) => c.key);
  const hiddenCatalog = REWORK_CATALOG.filter((c) => !visibleKeys.includes(c.key));

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Rework barcodes</CardTitle>
        <p className="text-xs text-muted-foreground">
          Quantities are prefilled from the order. Adjust if needed, then click
          Submit charges — the API adds each rework barcode to the Mintsoft
          order automatically.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {visibleKeys.map((key) => {
          const c = findByKey(key);
          const auto = autoMap[key] ?? 0;
          const rate = rateFor(key);
          const lineQty = qty[key] ?? 0;
          return (
            <div key={key} className="flex items-center justify-between gap-3 px-2 py-1">
              <div className="min-w-0">
                <div className="text-sm">{c.label}</div>
                <div className="text-[10px] font-mono text-muted-foreground">
                  {c.barcode}
                  {auto > 0 && <span className="ml-2">· auto: {auto}</span>}
                  {rate != null && (
                    <span className="ml-2">
                      · {formatGBP(rate)}/unit
                      {lineQty > 0 && ` = ${formatGBP(rate * lineQty)}`}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label="Decrease"
                  disabled={submitted || (qty[key] ?? 0) <= 0}
                  onClick={() =>
                    setQty((q) => ({
                      ...q,
                      [key]: Math.max(0, (q[key] ?? 0) - 1),
                    }))
                  }
                  className="flex h-9 w-9 items-center justify-center rounded-md border bg-background text-red-600 hover:bg-red-50 disabled:opacity-40 disabled:hover:bg-background"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <input
                  type="number"
                  min={0}
                  value={qty[key] ?? 0}
                  onChange={(e) =>
                    setQty((q) => ({
                      ...q,
                      [key]: Math.max(0, Number(e.target.value) || 0),
                    }))
                  }
                  disabled={submitted}
                  className="h-9 w-16 rounded-md border bg-background px-2 text-center text-sm tabular-nums"
                />
                <button
                  type="button"
                  aria-label="Increase"
                  disabled={submitted}
                  onClick={() =>
                    setQty((q) => ({
                      ...q,
                      [key]: (q[key] ?? 0) + 1,
                    }))
                  }
                  className="flex h-9 w-9 items-center justify-center rounded-md border bg-background text-green-600 hover:bg-green-50 disabled:opacity-40 disabled:hover:bg-background"
                >
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          );
        })}

        {hiddenCatalog.length > 0 && !submitted && (
          <div className="flex items-center gap-2 pt-1">
            <Select
              value={pickerValue}
              onValueChange={(v) => {
                setQty((q) => {
                  // Poly bag options track the number of bundles in the
                  // order — prefill with bundleCount the first time the
                  // user picks one, otherwise just increment.
                  const current = q[v] ?? 0;
                  if (current === 0 && v.startsWith("poly_") && bundleCount > 0) {
                    return { ...q, [v]: bundleCount };
                  }
                  return { ...q, [v]: current + 1 };
                });
                setPickerValue("");
              }}
            >
              <SelectTrigger className="h-9 flex-1">
                <SelectValue placeholder="Add rework code…" />
              </SelectTrigger>
              <SelectContent>
                {hiddenCatalog.map((c) => (
                  <SelectItem key={c.key} value={c.key}>
                    <Plus className="mr-1 inline h-3.5 w-3.5" />
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {(() => {
          let total = 0;
          let anyRated = false;
          for (const c of REWORK_CATALOG) {
            const r = rateFor(c.key);
            const q = qty[c.key] ?? 0;
            if (r != null && q > 0) {
              anyRated = true;
              total += r * q;
            }
          }
          if (!anyRated) return null;
          return (
            <div className="flex items-center justify-between border-t pt-2 text-sm">
              <span className="font-medium">Total</span>
              <span className="font-mono tabular-nums">{formatGBP(total)}</span>
            </div>
          );
        })()}

        <div
          className={`mt-2 flex w-full ${attention && !submitted ? "animate-attention" : ""}`}
        >
          <Button
            className="flex-1 rounded-r-none bg-emerald-600 text-white hover:bg-emerald-700"
            onClick={handleSubmit}
            disabled={submitting || submitted}
          >
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {submitted && <Check className="mr-2 h-4 w-4" />}
            {submitted ? "Charges submitted" : "Submit charges"}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="secondary"
                size="icon"
                className="rounded-l-none rounded-r-md border-l border-border/60"
                disabled={submitting}
                aria-label="Charge options"
              >
                <Flag className="h-4 w-4 text-red-500" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={async () => {
                  try {
                    await addOrderComment(
                      loadSettings(),
                      orderId,
                      "Charges Flagged, please review",
                      true,
                    );
                    const ref = orderNumber ?? `#${orderId}`;
                    toast.success(`Order ${ref}: flagged for review`);
                  } catch (e) {
                    toast.error(
                      e instanceof Error ? e.message : "Failed to flag charges",
                    );
                  }
                }}
              >
                <Flag className="mr-2 h-4 w-4" />
                Flag charges for review
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardContent>
    </Card>
  );
}

function OrderDocumentsCard({ orderId }: { orderId: number }) {
  const [preview, setPreview] = useState<{ bytes: Uint8Array; url: string; fileName: string; contentType: string } | null>(null);
  const docsQuery = useQuery({
    queryKey: ["order-docs", orderId],
    queryFn: async () => {
      const docs = await fetchOrderDocuments(loadSettings(), orderId);
      return Promise.all(
        docs.map(async (d) => {
          const looksPdf = (d.bytes[0] === 0x25 && d.bytes[1] === 0x50 && d.bytes[2] === 0x44 && d.bytes[3] === 0x46);
          const rawType = (d.contentType || "").toLowerCase();
          const contentType = looksPdf
            ? "application/pdf"
            : rawType || (d.fileName?.toLowerCase().endsWith(".pdf") ? "application/pdf" : "application/octet-stream");
          const isPdf = contentType.includes("pdf");
          const size = isPdf ? await detectFromBytes(d.bytes).catch(() => null) : null;
          const blob = new Blob([d.bytes as BlobPart], { type: contentType });
          let pageCount: number | null = null;
          if (isPdf) {
            try {
              const doc = await PDFDocument.load(d.bytes, { ignoreEncryption: true });
              pageCount = doc.getPageCount();
            } catch {
              pageCount = null;
            }
          }
          return { label: d.label, fileName: d.fileName || d.label, contentType, url: URL.createObjectURL(blob), size, bytes: d.bytes, pageCount };
        }),
      );
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    return () => {
      docsQuery.data?.forEach((d) => URL.revokeObjectURL(d.url));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docsQuery.data]);

  // "Print with order?" selection — defaults: large (108×152 shipping) and small (51×25 FNSKU).
  const [printSel, setPrintSel] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (!docsQuery.data) return;
    setPrintSel((prev) => {
      const next = { ...prev };
      for (const d of docsQuery.data!) {
        if (next[d.label] === undefined) {
          next[d.label] = d.size?.kind === "large" || d.size?.kind === "small";
        }
      }
      return next;
    });
  }, [docsQuery.data]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Documents{docsQuery.data ? ` (${docsQuery.data.length})` : ""}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {docsQuery.isLoading && (
          <div className="py-6 text-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading documents…
          </div>
        )}
        {docsQuery.isError && (
          <div className="py-4 text-sm text-destructive">
            Failed to load documents: {(docsQuery.error as Error)?.message}
          </div>
        )}
        {!docsQuery.isLoading && !docsQuery.isError && (docsQuery.data ?? []).length === 0 && (
          <div className="py-6 text-center text-sm text-muted-foreground">
            No documents available for this order.
          </div>
        )}
        {!docsQuery.isLoading && (docsQuery.data ?? []).length > 0 && (
          <>
          <div className="flex items-center justify-end pb-2 pr-1 text-xs font-medium text-muted-foreground">
            Print with order?
          </div>
          <ul className="divide-y">
            {docsQuery.data!.map((d) => (
              <li key={d.label} className="flex items-center justify-between gap-3 py-3">
                <div className="flex items-center gap-3 min-w-0">
                  <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="truncate text-sm font-medium">{d.label}</div>
                      {d.pageCount != null && (
                        <Badge variant="secondary" className="shrink-0 text-[11px] font-medium">
                          {d.pageCount} page{d.pageCount === 1 ? "" : "s"}
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {d.contentType.includes("pdf") ? "PDF" : d.contentType}
                      {d.size
                        ? ` · ${d.size.kind} (${d.size.widthMm}×${d.size.heightMm} mm)`
                        : ""}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="default" size="sm" onClick={() => setPreview({ bytes: d.bytes, url: d.url, fileName: d.fileName, contentType: d.contentType })}>
                    <Eye className="mr-1 h-3.5 w-3.5" /> Quick look
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    title={`Print ${d.label}`}
                    aria-label={`Print ${d.label}`}
                    onClick={async () => {
                      try {
                        const settings = loadSettings();
                        const kind = d.size?.kind ?? "other";
                        const printer = pickPrinter(settings, kind);
                        await printPdfBytes(d.bytes, printer, settings.silentPrint);
                        toast.success(`Sent ${d.label} to printer`);
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : "Failed to print");
                      }
                    }}
                  >
                    <Printer className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="sm" asChild>
                    <a href={d.url} download={d.fileName}>Download</a>
                  </Button>
                  <label className="ml-2 flex items-center justify-center pl-2 pr-1">
                    <Checkbox
                      checked={!!printSel[d.label]}
                      onCheckedChange={(v) =>
                        setPrintSel((s) => ({ ...s, [d.label]: v === true }))
                      }
                      aria-label={`Print ${d.label} with order`}
                    />
                  </label>
                </div>
              </li>
            ))}
          </ul>
          </>
        )}
      </CardContent>
      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-5xl w-[95vw] h-[90vh] flex flex-col p-4">
          <DialogHeader>
            <DialogTitle className="text-sm font-medium truncate">{preview?.fileName}</DialogTitle>
          </DialogHeader>
          {preview && (
            preview.contentType.startsWith("image/") ? (
              <img src={preview.url} alt={preview.fileName} className="flex-1 min-h-0 w-full object-contain" />
            ) : preview.contentType.includes("pdf") ? (
              <PdfPreview bytes={preview.bytes} />
            ) : (
              <iframe src={preview.url} title={preview.fileName} className="flex-1 min-h-0 w-full rounded border bg-white" />
            )
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function OverweightDialog({
  open,
  onOpenChange,
  items,
  products,
  orderId,
  orderNumber,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: MintsoftOrderItem[];
  products: Map<number, MintsoftProduct | null> | undefined;
  orderId: number;
  orderNumber: string | null;
}) {
  const [qtys, setQtys] = useState<Record<number, number>>({});
  const [submitting, setSubmitting] = useState(false);
  type BookResult =
    | { status: "ok"; qty: number; location: string; before: number; after: number; verified: boolean }
    | { status: "error"; message: string };
  const [results, setResults] = useState<Record<number, BookResult>>({});
  const [verifiedReturned, setVerifiedReturned] = useState<Record<number, boolean>>({});

  const needsLocationName = (label: string, locationId: number) => {
    const normalized = label.trim().toLowerCase();
    return !normalized || normalized === `${locationId}` || normalized === `location ${locationId}`;
  };

  useEffect(() => {
    if (open) {
      setQtys({});
      setResults({});
      setVerifiedReturned({});
    }
  }, [open]);

  const setQty = (itemId: number, value: number, max: number) => {
    const clamped = Math.max(0, Math.min(max, Math.floor(value || 0)));
    setQtys((s) => ({ ...s, [itemId]: clamped }));
  };

  const hasAny = Object.values(qtys).some((q) => q > 0);

  const handleBookIn = async () => {
    const settings = loadSettings();
    const lines = items
      .map((it) => ({ it, qty: qtys[it.ID] ?? 0 }))
      .filter((x) => x.qty > 0);
    if (lines.length === 0) return;

    setSubmitting(true);
    const ref = orderNumber ?? "unknown order";
    const summary: string[] = [];
    const failures: string[] = [];

    // Source location, batch and best-before come from the order's stock
    // allocations (same data Mintsoft uses to build the picking list).
    // Warehouse is always MIL1.
    let mil1Id: number | undefined;
    let allocations: OrderAllocation[] = [];
    const locationNameCache = new Map<number, string>();
    try {
      const whs = await listWarehouses(settings);
      const match =
        whs.find((w) => (w.code ?? "").toUpperCase() === "MIL1") ||
        whs.find((w) => (w.name ?? "").toUpperCase() === "MIL1") ||
        whs.find((w) => (w.name ?? "").toUpperCase().includes("MIL1"));
      mil1Id = match?.id;
    } catch {
      /* handled per line below */
    }
    try {
      allocations = await fetchOrderAllocations(settings, orderId);
    } catch (e) {
      console.warn("[overweight] fetchOrderAllocations failed", e);
    }

    try {
      for (const { it, qty } of lines) {
        const sku = it.SKU ?? products?.get(it.ProductId)?.SKU ?? `#${it.ProductId}`;
        try {
          let alloc =
            allocations.find((a) => a.orderItemId === it.ID) ??
            allocations.find((a) => a.productId === it.ProductId);
          if (!alloc?.locationId) {
            // Fallback: pull from product stock-flow history (Manage Inventory),
            // which keeps the per-order Location/BBE even after despatch.
            try {
              const flow = await fetchProductOrderAllocations(
                settings,
                it.ProductId,
                orderId,
              );
              alloc = flow.find((a) => a.locationId) ?? alloc;
            } catch (e) {
              console.warn("[overweight] stock-flow fallback failed", e);
            }
          }
          if (!alloc?.locationId) {
            failures.push(`${sku}: no allocation found for this order`);
            setResults((r) => ({
              ...r,
              [it.ID]: { status: "error", message: "No allocation found on order" },
            }));
            continue;
          }
          const warehouseId = mil1Id ?? alloc.warehouseId;
          const locationId = alloc.locationId;
          if (!warehouseId) {
            failures.push(`${sku}: MIL1 warehouse not found`);
            setResults((r) => ({
              ...r,
              [it.ID]: { status: "error", message: "MIL1 warehouse not found" },
            }));
            continue;
          }
          let locationLabel = alloc.locationName ?? "";
          let beforeQty = 0;
          try {
            const stock = await fetchProductStock(settings, it.ProductId);
            const match = stock.find((s) => s.locationId === locationId);
            beforeQty = match?.quantity ?? 0;
            if (!locationLabel && match?.location) locationLabel = match.location;
          } catch {
            /* best-effort */
          }
          if (needsLocationName(locationLabel, locationId) && warehouseId) {
            try {
              let locs = locationNameCache.size
                ? null
                : await listWarehouseLocations(settings, warehouseId);
              if (locs) {
                for (const l of locs) locationNameCache.set(l.id, l.name);
              }
              const name = locationNameCache.get(locationId);
              if (name) locationLabel = name;
            } catch {
              /* best-effort */
            }
          }
          if (needsLocationName(locationLabel, locationId) && warehouseId) {
            const loc = await fetchWarehouseLocation(settings, warehouseId, locationId);
            if (loc?.name) {
              locationNameCache.set(locationId, loc.name);
              locationLabel = loc.name;
            }
          }
          if (!locationLabel) locationLabel = `Location ${locationId}`;
          await stockMovementIn(settings, {
            ProductId: it.ProductId,
            WarehouseId: warehouseId,
            LocationId: locationId,
            Quantity: qty,
            Comment: `Order: ${ref} overweight, ${sku} x ${qty} booked in`,
            ...(alloc.batchNo ? { BatchNumber: alloc.batchNo } : {}),
            ...(alloc.bestBefore ? { BestBeforeDate: alloc.bestBefore } : {}),
          });
          // Verify the stock movement landed by re-fetching the same location.
          let afterQty = beforeQty;
          let verified = false;
          try {
            const after = await fetchProductStock(settings, it.ProductId);
            const matched = after.find((s) => s.locationId === locationId);
            if (matched) {
              afterQty = matched.quantity;
              verified = afterQty >= beforeQty + qty;
            }
          } catch {
            /* verification is best-effort */
          }
          setResults((r) => ({
            ...r,
            [it.ID]: {
              status: "ok",
              qty,
              location: locationLabel,
              before: beforeQty,
              after: afterQty,
              verified,
            },
          }));
          summary.push(`${sku} x ${qty} booked in`);
        } catch (e) {
          failures.push(`${sku}: ${e instanceof Error ? e.message : "failed"}`);
          setResults((r) => ({
            ...r,
            [it.ID]: {
              status: "error",
              message: e instanceof Error ? e.message : "Failed to book in",
            },
          }));
        }
      }

      if (summary.length > 0) {
        try {
          await addOrderComment(
            settings,
            orderId,
            `Order: ${ref} overweight, ${summary.join(", ")}`,
          );
        } catch {
          /* comment failure is non-fatal */
        }
        toast.success(`Order: ${ref} overweight, ${summary.join(", ")}`);
      }
      if (failures.length > 0) {
        toast.error(`Some lines failed: ${failures.join("; ")}`);
      }
      /* Keep the dialog open so the user can see the per-SKU confirmation. */
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          const bookedIds = Object.entries(results)
            .filter(([, r]) => r.status === "ok")
            .map(([id]) => Number(id));
          const allVerified = bookedIds.every((id) => verifiedReturned[id]);
          if (bookedIds.length > 0 && !allVerified) return;
        }
        onOpenChange(next);
      }}
    >
      <DialogContent
        className="max-w-2xl"
        onEscapeKeyDown={(e) => {
          const bookedIds = Object.entries(results)
            .filter(([, r]) => r.status === "ok")
            .map(([id]) => Number(id));
          const allVerified = bookedIds.every((id) => verifiedReturned[id]);
          if (bookedIds.length > 0 && !allVerified) e.preventDefault();
        }}
        onPointerDownOutside={(e) => {
          const bookedIds = Object.entries(results)
            .filter(([, r]) => r.status === "ok")
            .map(([id]) => Number(id));
          const allVerified = bookedIds.every((id) => verifiedReturned[id]);
          if (bookedIds.length > 0 && !allVerified) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Weight className="h-5 w-5" />
            Order overweight — book stock back in
          </DialogTitle>
          <DialogDescription>
            Uses MIL1 plus the picking-list location and best-before date.
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Select how many units of each SKU were removed from this shipment.
          The quantities will be booked into inventory as a separate stock-in
          movement (using the SKU's picking location and best-before date) —
          the original order quantity is left unchanged.
        </p>
        <div className="max-h-[55vh] overflow-y-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">On order</TableHead>
                <TableHead className="text-right w-40">Remove</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((it) => {
                const p = products?.get(it.ProductId);
                const sku = it.SKU ?? p?.SKU ?? "—";
                const qty = qtys[it.ID] ?? 0;
                const result = results[it.ID];
                return (
                  <TableRow key={it.ID}>
                    <TableCell className="font-mono text-xs align-top">
                      <div>{sku}</div>
                      {result?.status === "ok" && (
                        <>
                          <div
                            className={`mt-1 text-base font-bold font-sans normal-case ${
                              result.verified
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-amber-600 dark:text-amber-400"
                            }`}
                          >
                            {result.qty} BOOKED IN to {result.location}
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            onClick={() =>
                              setVerifiedReturned((s) => ({ ...s, [it.ID]: true }))
                            }
                            disabled={!!verifiedReturned[it.ID]}
                            className="mt-2 bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-100 disabled:bg-emerald-700"
                          >
                            {verifiedReturned[it.ID] ? "✓ Stock Returned Verified" : "Verify Stock Returned"}
                          </Button>
                        </>
                      )}
                      {result?.status === "error" && (
                        <div className="mt-1 text-[11px] font-sans normal-case text-destructive">
                          {result.message}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">{p?.Name ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{it.Quantity}</TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex items-center gap-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => setQty(it.ID, qty - 1, it.Quantity)}
                          disabled={qty <= 0}
                        >
                          <Minus className="h-3 w-3" />
                        </Button>
                        <input
                          type="number"
                          min={0}
                          max={it.Quantity}
                          value={qty}
                          onChange={(e) => setQty(it.ID, Number(e.target.value), it.Quantity)}
                          className="h-7 w-14 rounded-md border bg-background px-2 text-right text-sm tabular-nums"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => setQty(it.ID, qty + 1, it.Quantity)}
                          disabled={qty >= it.Quantity}
                        >
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                    No items on this order.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          {(() => {
            const bookedIds = Object.entries(results)
              .filter(([, r]) => r.status === "ok")
              .map(([id]) => Number(id));
            const allVerified = bookedIds.every((id) => verifiedReturned[id]);
            const pendingCount = bookedIds.filter((id) => !verifiedReturned[id]).length;
            return (
              <Button
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={submitting || !allVerified}
                title={!allVerified ? `Verify stock returned for ${pendingCount} item(s) first` : undefined}
              >
                {bookedIds.length > 0
                  ? allVerified
                    ? "Close"
                    : `Verify stock returned (${pendingCount})`
                  : "Cancel"}
              </Button>
            );
          })()}
          <Button onClick={handleBookIn} disabled={!hasAny || submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Book stock in
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function WeightEstimateFooter({
  items,
  products,
  onOverweight,
}: {
  items: MintsoftOrderItem[];
  products: Map<number, MintsoftProduct | null> | undefined;
  onOverweight: () => void;
}) {
  const payload = useMemo(
    () =>
      items.map((it) => ({
        sku: it.SKU ?? products?.get(it.ProductId)?.SKU ?? undefined,
        description:
          products?.get(it.ProductId)?.Name ||
          products?.get(it.ProductId)?.Description ||
          undefined,
        quantity: it.Quantity ?? 0,
      })),
    [items, products],
  );

  const key = useMemo(
    () =>
      payload
        .map((p) => `${p.sku ?? ""}|${p.quantity}|${(p.description ?? "").slice(0, 40)}`)
        .join(";"),
    [payload],
  );

  const estimate = useQuery({
    queryKey: ["weight-estimate", key],
    enabled: payload.length > 0 && payload.every((p) => !!p.description),
    staleTime: 60 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const r = await fetch("/api/estimate-weight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: payload }),
      });
      if (!r.ok) throw new Error(`Estimate failed (${r.status})`);
      return (await r.json()) as { grams: number; note?: string | null };
    },
  });

  const grams = estimate.data?.grams ?? 0;
  const kg = (grams / 1000).toFixed(grams >= 1000 ? 2 : 3);

  return (
    <div className="flex items-center justify-between gap-3 border-t bg-muted/30 px-6 py-3">
      <div className="text-sm">
        <span className="text-muted-foreground">Estimated order weight: </span>
        {estimate.isLoading || estimate.isFetching ? (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> estimating…
          </span>
        ) : estimate.error ? (
          <span className="text-muted-foreground">—</span>
        ) : estimate.data ? (
          <>
            <span className="font-semibold tabular-nums">{kg} kg</span>
            <span className="ml-1 text-xs text-muted-foreground">({grams} g · AI estimate)</span>
          </>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
        {estimate.data?.note && (
          <div className="text-xs text-muted-foreground italic">{estimate.data.note}</div>
        )}
      </div>
      <Button
        variant="destructive"
        size="sm"
        onClick={onOverweight}
        className="bg-red-600 hover:bg-red-700 text-white"
      >
        <Weight className="mr-2 h-4 w-4" />
        Overweight
      </Button>
    </div>
  );
}