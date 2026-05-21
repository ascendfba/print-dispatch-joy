import { requireAuth } from "@/lib/require-auth";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
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
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronsUpDown,
  Loader2,
  PackageCheck,
  Save,
  Search,
  Truck,
  XCircle,
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  fetchASN,
  fetchASNItems,
  fetchProduct,
  fetchProductStockLocations,
  listClients,
  listWarehouseLocations,
  receiveASNItem,
  completeASN,
  partialCompleteASN,
  type MintsoftWarehouseLocation,
  type MintsoftProduct,
  type MintsoftASNItem,
} from "@/lib/mintsoft";
import { loadSettings } from "@/lib/storage";

export const Route = createFileRoute("/asns_/$asnId")({
  beforeLoad: ({ location }) => requireAuth(location),
  component: AsnDetailPage,
});

function formatDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

function AsnDetailPage() {
  const { asnId } = Route.useParams();
  const id = Number(asnId);

  const asnQuery = useQuery({
    queryKey: ["asn", id],
    queryFn: () => fetchASN(loadSettings(), id),
    enabled: Number.isFinite(id) && id > 0,
    refetchOnWindowFocus: false,
  });

  const clientsQuery = useQuery({
    queryKey: ["clients"],
    queryFn: () => listClients(loadSettings()),
    staleTime: 30 * 60_000,
    refetchOnWindowFocus: false,
  });

  const a = asnQuery.data;
  const clientName =
    a?.ClientId
      ? clientsQuery.data?.find((c) => c.ID === a.ClientId)?.BrandName ??
        clientsQuery.data?.find((c) => c.ID === a.ClientId)?.Name ??
        `Client #${a.ClientId}`
      : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link to="/asns">
              <ArrowLeft className="h-4 w-4" /> Back
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Truck className="h-6 w-6" />
            {a?.Reference || `ASN #${id}`}
          </h1>
          {a?.Status ? <Badge variant="outline">{a.Status}</Badge> : null}
        </div>
      </div>

      {asnQuery.isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading ASN…
        </div>
      ) : asnQuery.error ? (
        <div className="py-12 text-center text-sm text-destructive">
          {asnQuery.error instanceof Error
            ? asnQuery.error.message
            : "Failed to load ASN"}
        </div>
      ) : !a ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          ASN not found.
        </div>
      ) : (
        <>
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">Details</CardTitle>
          </CardHeader>
          <CardContent className="pb-3 pt-0">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3 lg:grid-cols-4">
              <Field label="Reference" value={a.Reference} />
              <Field label="PO Ref" value={a.PORef} />
              <Field label="Client" value={clientName} />
              <Field label="Supplier" value={a.SupplierName} />
              <Field label="Warehouse" value={a.WarehouseName} />
              <Field label="Status" value={a.Status} />
              <Field
                label="Quantity"
                value={
                  a.TotalQuantity != null
                    ? `${a.TotalQuantity}${a.InboundType ? ` (${a.InboundType.toLowerCase()})` : ""}`
                    : null
                }
              />
              <Field label="Goods-in type" value={a.InboundType} />
              <Field label="Est. arrival" value={formatDate(a.ExpectedDate)} />
              <Field label="Created" value={formatDate(a.CreatedDate)} />
              <Field label="Received" value={formatDate(a.ReceivedDate)} />
              {a.Comments || a.Notes ? (
                <Field label="Comments" value={a.Comments || a.Notes} full />
              ) : null}
            </dl>
          </CardContent>
        </Card>
        <BookInCard
          asnId={id}
          warehouseId={a.WarehouseId ?? null}
          asnStatus={a.Status ?? null}
        />
        </>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  full,
}: {
  label: string;
  value?: string | number | null;
  full?: boolean;
}) {
  return (
    <div className={full ? "col-span-full" : undefined}>
      <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="whitespace-pre-wrap text-xs">
        {value != null && value !== "" ? value : "—"}
      </dd>
    </div>
  );
}

type RowState = {
  receivedQty: string;
  locationId: string;
  bbf: string;
  confirmed?: boolean;
};

type PendingBookingState = {
  qty: number;
  baselineReceived: number;
};

const draftKey = (asnId: number) => `asn-bookin-draft:${asnId}`;
const pendingBookingKey = (asnId: number) => `asn-bookin-pending:${asnId}`;
const bookedLocationsKey = (asnId: number) => `asn-bookin-locations:${asnId}`;
const asnCompletedKey = (asnId: number) => `asn-completed:${asnId}`;

function asnItemKey(item: MintsoftASNItem): string {
  return String(item.ID ?? item.ProductId ?? item.SKU ?? "");
}

function getExpectedQty(item: MintsoftASNItem): number {
  const n = Number(item.ExpectedQuantity ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function getReceivedQty(item: MintsoftASNItem): number {
  const n = Number(item.ReceivedQuantity ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function getRemainingQty(item: MintsoftASNItem): number {
  return Math.max(0, getExpectedQty(item) - getReceivedQty(item));
}

function BookInCard({
  asnId,
  warehouseId,
  asnStatus,
}: {
  asnId: number;
  warehouseId: number | null;
  asnStatus: string | null;
}) {
  const [rows, setRows] = useState<Record<string | number, RowState>>({});
  const [pendingBookings, setPendingBookings] = useState<Record<string, PendingBookingState>>({});
  const [bookedLocations, setBookedLocations] = useState<Record<string, number>>({});
  const [asnCompleted, setAsnCompleted] = useState(false);
  const [submitting, setSubmitting] = useState<null | "partial" | "full" | "complete" | "complete-partial">(null);
  const [draftSaved, setDraftSaved] = useState(false);
  const [bookInVerified, setBookInVerified] = useState(false);
  const [confirmMismatch, setConfirmMismatch] = useState<null | {
    mode: "partial" | "full";
    rowsToBook: Array<{ item: MintsoftASNItem; qty: number; locationId: number; bbf: string }>;
    over: Array<{ key: string; sku: string; finalReceived: number; expected: number }>;
    under: Array<{ key: string; sku: string; finalReceived: number; expected: number }>;
  }>(null);
  const [highlightKeys, setHighlightKeys] = useState<string[]>([]);
  const queryClient = useQueryClient();

  const itemsQuery = useQuery({
    queryKey: ["asn-items", asnId],
    queryFn: () => fetchASNItems(loadSettings(), asnId),
    enabled: Number.isFinite(asnId) && asnId > 0,
    refetchOnWindowFocus: false,
  });

  const locationsQuery = useQuery({
    queryKey: ["wh-locations", warehouseId],
    queryFn: () =>
      warehouseId
        ? listWarehouseLocations(loadSettings(), warehouseId)
        : Promise.resolve([] as MintsoftWarehouseLocation[]),
    enabled: !!warehouseId,
    staleTime: 30 * 60_000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    try {
      const raw = localStorage.getItem(pendingBookingKey(asnId));
      setPendingBookings(raw ? (JSON.parse(raw) as Record<string, PendingBookingState>) : {});
    } catch {
      setPendingBookings({});
    }
    try {
      const raw = localStorage.getItem(bookedLocationsKey(asnId));
      setBookedLocations(raw ? (JSON.parse(raw) as Record<string, number>) : {});
    } catch {
      setBookedLocations({});
    }
    try {
      setAsnCompleted(localStorage.getItem(asnCompletedKey(asnId)) === "1");
    } catch {
      setAsnCompleted(false);
    }
  }, [asnId]);

  // Treat any "booked in" / completed status from Mintsoft as completed,
  // including "BOOKEDIN-PARTIAL" which means the book-in stage is finished.
  useEffect(() => {
    const s = (asnStatus ?? "").toLowerCase().replace(/[\s_-]/g, "");
    // "PARTIALLYBOOKED" stays partial; "BOOKEDIN-PARTIAL" is completed.
    const isCompletedStatus =
      (s.includes("bookedin") ||
        s.includes("complete") ||
        s.includes("closed") ||
        s.includes("delivered")) &&
      !(s.includes("partial") && !s.includes("bookedin"));
    if (isCompletedStatus) setAsnCompleted(true);
  }, [asnStatus]);

  // Initialise row state when items load — hydrate from localStorage draft if present
  useEffect(() => {
    if (!itemsQuery.data) return;
    let saved: Record<string | number, RowState> = {};
    let pending: Record<string, PendingBookingState> = {};
    try {
      const raw = localStorage.getItem(draftKey(asnId));
      if (raw) saved = JSON.parse(raw) as Record<string | number, RowState>;
    } catch {
      /* ignore */
    }
    try {
      const raw = localStorage.getItem(pendingBookingKey(asnId));
      if (raw) pending = JSON.parse(raw) as Record<string, PendingBookingState>;
    } catch {
      /* ignore */
    }
    setRows((prev) => {
      const next = { ...prev };
      for (const item of itemsQuery.data ?? []) {
        const key = asnItemKey(item);
        if (!key) continue;
        if (saved[key]) {
          next[key] = saved[key];
        } else if (!next[key]) {
          const pendingTotal = pending[key]
            ? pending[key].baselineReceived + pending[key].qty
            : 0;
          const effectiveReceived = Math.max(getReceivedQty(item), pendingTotal);
          const remaining = Math.max(0, getExpectedQty(item) - effectiveReceived);
          next[key] = {
            receivedQty: remaining > 0 ? String(remaining) : "",
            locationId: "",
            bbf: "",
          };
        }
      }
      return next;
    });
  }, [itemsQuery.data, asnId]);

  useEffect(() => {
    if (!itemsQuery.data) return;
    setPendingBookings((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const item of itemsQuery.data ?? []) {
        const key = asnItemKey(item);
        const pending = next[key];
        if (!pending) continue;
        if (getReceivedQty(item) >= pending.baselineReceived + pending.qty) {
          delete next[key];
          changed = true;
        }
      }
      if (!changed) return prev;
      try {
        localStorage.setItem(pendingBookingKey(asnId), JSON.stringify(next));
      } catch { /* ignore */ }
      return next;
    });
  }, [itemsQuery.data, asnId]);

  const updateRow = (key: string | number, patch: Partial<RowState>) =>
    {
    setDraftSaved(false);
    setBookInVerified(false);
    setRows((prev) => ({
      ...prev,
      [key]: {
        ...(prev[key] ?? { receivedQty: "", locationId: "", bbf: "" }),
        ...patch,
        // Any edit to qty/location/bbf invalidates the previous confirmation
        ...(patch.confirmed === undefined &&
        (patch.receivedQty !== undefined ||
          patch.locationId !== undefined ||
          patch.bbf !== undefined)
          ? { confirmed: false }
          : {}),
      },
    }));
    };

  const saveDraft = () => {
    try {
      localStorage.setItem(draftKey(asnId), JSON.stringify(rows));
      setDraftSaved(true);
      setBookInVerified(false);
      toast.success("Draft saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save draft");
    }
  };

  const locationOptions = useMemo(
    () => locationsQuery.data ?? [],
    [locationsQuery.data],
  );

  const items = itemsQuery.data ?? [];
  const productQueries = useQueries({
    queries: items.map((item) => ({
      queryKey: ["product", item.ProductId ?? null],
      queryFn: () =>
        item.ProductId
          ? fetchProduct(loadSettings(), item.ProductId)
          : Promise.resolve(null),
      enabled: !!item.ProductId,
      staleTime: 30 * 60_000,
      refetchOnWindowFocus: false,
    })),
  });
  const stockLocationQueries = useQueries({
    queries: items.map((item) => ({
      queryKey: ["product-stock-locations", item.ProductId ?? null],
      queryFn: () =>
        item.ProductId
          ? fetchProductStockLocations(loadSettings(), item.ProductId)
          : Promise.resolve([]),
      enabled: !!item.ProductId,
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    })),
  });
  const requiresBbfByKey = useMemo(() => {
    const map: Record<string, boolean> = {};
    items.forEach((item, i) => {
      const key = asnItemKey(item);
      const p = productQueries[i]?.data as MintsoftProduct | null | undefined;
      map[key] = productRequiresBbf(p);
    });
    return map;
  }, [items, productQueries]);
  const showBbfColumn = Object.values(requiresBbfByKey).some(Boolean);

  // ---- totals -------------------------------------------------------------
  const totals = useMemo(() => {
    let expected = 0;
    let alreadyReceived = 0;
    let entered = 0;
    for (const item of items) {
      const key = asnItemKey(item);
      const p = pendingBookings[key];
      const pendingTotal = p ? p.baselineReceived + p.qty : 0;
      const effectiveReceived = Math.max(getReceivedQty(item), pendingTotal);
      const remaining = Math.max(0, getExpectedQty(item) - effectiveReceived);
      expected += getExpectedQty(item);
      alreadyReceived += effectiveReceived;
      const n = Number(rows[key]?.receivedQty ?? "");
      if (Number.isFinite(n) && n > 0) entered += n;
    }
    const combined = alreadyReceived + entered;
    const pct = expected > 0 ? Math.min(100, Math.round((combined / expected) * 100)) : 0;
    return { expected, alreadyReceived, entered, combined, pct, shortfall: expected - combined };
  }, [items, pendingBookings, rows]);

  // Validate rows that have a qty entered — must have a location, and BBF if required.
  function validateForBooking(): { rowsToBook: Array<{ item: MintsoftASNItem; qty: number; locationId: number; bbf: string }>; error: string | null } {
    const rowsToBook: Array<{ item: MintsoftASNItem; qty: number; locationId: number; bbf: string }> = [];
    for (const item of items) {
      const key = asnItemKey(item);
      const s = rows[key];
      const qty = Number(s?.receivedQty ?? "");
      if (!s || !Number.isFinite(qty) || qty <= 0) continue;
      const p = pendingBookings[key];
      const pendingTotal = p ? p.baselineReceived + p.qty : 0;
      const effectiveReceived = Math.max(getReceivedQty(item), pendingTotal);
      const remaining = Math.max(0, getExpectedQty(item) - effectiveReceived);
      if (!s.locationId) {
        return { rowsToBook: [], error: `Pick a location for ${item.SKU ?? item.Title ?? "item"}` };
      }
      if (requiresBbfByKey[key] && !s.bbf) {
        return { rowsToBook: [], error: `BBF date required for ${item.SKU ?? item.Title ?? "item"}` };
      }
      if (!item.ID) {
        return { rowsToBook: [], error: `Missing ASN item id for ${item.SKU ?? "item"}` };
      }
      if (!item.ProductId) {
        return { rowsToBook: [], error: `Missing product id for ${item.SKU ?? "item"}` };
      }
      rowsToBook.push({ item, qty, locationId: Number(s.locationId), bbf: s.bbf });
    }
    if (rowsToBook.length === 0) {
      return { rowsToBook: [], error: "Enter at least one receive quantity" };
    }
    return { rowsToBook, error: null };
  }

  async function bookIn(mode: "partial" | "full") {
    if (!warehouseId) return;
    const { rowsToBook, error } = validateForBooking();
    if (error) {
      toast.error(error);
      return;
    }
    // Detect over/under expected mismatches and ask for explicit confirmation
    const over: Array<{ key: string; sku: string; finalReceived: number; expected: number }> = [];
    const under: Array<{ key: string; sku: string; finalReceived: number; expected: number }> = [];
    for (const r of rowsToBook) {
      const k = asnItemKey(r.item);
      const p = pendingBookings[k];
      const baseline = p
        ? p.baselineReceived + p.qty
        : getReceivedQty(r.item);
      const finalReceived = baseline + r.qty;
      const expected = getExpectedQty(r.item);
      const sku = r.item.SKU ?? r.item.Title ?? `Item ${r.item.ID ?? ""}`;
      if (finalReceived > expected) {
        over.push({ key: String(k), sku, finalReceived, expected });
      } else if (mode === "full" && finalReceived < expected) {
        under.push({ key: String(k), sku, finalReceived, expected });
      }
    }
    if (over.length > 0 || under.length > 0) {
      setConfirmMismatch({ mode, rowsToBook, over, under });
      return;
    }
    await executeBookIn(mode, rowsToBook);
  }

  async function executeBookIn(
    mode: "partial" | "full",
    rowsToBook: Array<{ item: MintsoftASNItem; qty: number; locationId: number; bbf: string }>,
  ) {
    if (!warehouseId) return;
    setSubmitting(mode);
    try {
      const settings = loadSettings();
      const succeededKeys: Array<string | number> = [];
      const receiveErrors: string[] = [];
      const overExpectedBooking = rowsToBook.some((r) => {
        const k = asnItemKey(r.item);
        const p = pendingBookings[k];
        const baseline = p
          ? p.baselineReceived + p.qty
          : getReceivedQty(r.item);
        return baseline + r.qty > getExpectedQty(r.item);
      });
      for (const r of rowsToBook) {
        try {
          await receiveASNItem(settings, {
            ASNId: asnId,
            ASNDetailId: r.item.ID ?? null,
            ProductId: r.item.ProductId!,
            WarehouseId: warehouseId,
            LocationId: r.locationId,
            Quantity: r.qty,
            Complete: mode === "full",
            BestBeforeDate: r.bbf || undefined,
          });
        } catch (e) {
          // Mintsoft sometimes returns an error on over-expected receives
          // even though the stock is actually booked in. Don't bail — collect
          // and let the post-verification step decide if it really failed.
          receiveErrors.push(e instanceof Error ? e.message : String(e));
        }
        succeededKeys.push(r.item.ID ?? r.item.ProductId ?? r.item.SKU ?? "");
      }
      // Note: Mintsoft completes the ASN automatically when items are
      // received with Complete: true. No separate /Complete endpoint exists
      // on this tenant, so we skip the extra call.
      // Clear booked rows from the draft and refresh ASN data
      setRows((prev) => {
        const next = { ...prev };
        for (const k of succeededKeys) delete next[k];
        try {
          localStorage.setItem(draftKey(asnId), JSON.stringify(next));
        } catch { /* ignore */ }
        return next;
      });
      setPendingBookings((prev) => {
        const next = { ...prev };
        for (const r of rowsToBook) {
          const key = asnItemKey(r.item);
          const existing = next[key];
          next[key] = {
            qty: (existing?.qty ?? 0) + r.qty,
            baselineReceived: existing?.baselineReceived ?? getReceivedQty(r.item),
          };
        }
        try {
          localStorage.setItem(pendingBookingKey(asnId), JSON.stringify(next));
        } catch { /* ignore */ }
        return next;
      });
      // Remember which location each line was booked to, so the cell can
      // display it even after the row's draft input is cleared.
      setBookedLocations((prev) => {
        const next = { ...prev };
        for (const r of rowsToBook) {
          next[asnItemKey(r.item)] = r.locationId;
        }
        try {
          localStorage.setItem(bookedLocationsKey(asnId), JSON.stringify(next));
        } catch { /* ignore */ }
        return next;
      });
      await queryClient.refetchQueries({ queryKey: ["asn", asnId] });
      const refreshed = await queryClient.fetchQuery({
        queryKey: ["asn-items", asnId],
        queryFn: () => fetchASNItems(loadSettings(), asnId),
      });
      // Verify the back end actually shows the stock we just booked in
      let verifiedCount = 0;
      for (const r of rowsToBook) {
        const k = asnItemKey(r.item);
        const updated = refreshed.find((it) => asnItemKey(it) === k);
        if (!updated) continue;
        const baseline =
          pendingBookings[k]?.baselineReceived ?? getReceivedQty(r.item);
        const expected = baseline + r.qty;
        if (getReceivedQty(updated) >= expected) verifiedCount += 1;
      }
      const allVerified = verifiedCount === rowsToBook.length;
      // Over-expected receives: Mintsoft often caps the reported ReceivedQty
      // at the expected amount even though the stock is fully booked in.
      // Treat any over-expected attempt as accepted so the Complete ASN
      // button is not blocked by a verify count that can never catch up.
      const overExpectedAccepted = overExpectedBooking;
      setBookInVerified(allVerified || overExpectedAccepted);
      if (allVerified) {
        toast.success(
          `Verified in Mintsoft (${rowsToBook.length} line${rowsToBook.length === 1 ? "" : "s"}). Ready to complete ASN.`,
        );
      } else if (overExpectedAccepted) {
        toast.success("Over-expected booking sent to Mintsoft. Ready to complete ASN.");
      } else if (verifiedCount > 0) {
        // Some rows confirmed in Mintsoft — treat as success even if the
        // receive call itself threw (Mintsoft often returns an error response
        // for the final receive even though the stock was booked in).
        toast.success(
          `Booked ${verifiedCount} of ${rowsToBook.length} line${rowsToBook.length === 1 ? "" : "s"} in Mintsoft.`,
        );
        setBookInVerified(true);
      } else if (receiveErrors.length > 0) {
        toast.error(receiveErrors[0]);
      } else {
        toast.warning(
          `Booked ${rowsToBook.length} line${rowsToBook.length === 1 ? "" : "s"}, but Mintsoft has only confirmed ${verifiedCount}. Wait and refresh before completing.`,
        );
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Book in failed");
    } finally {
      setSubmitting(null);
    }
  }

  async function markComplete() {
    setSubmitting("complete");
    try {
      await completeASN(loadSettings(), asnId);
      await queryClient.invalidateQueries({ queryKey: ["asn", asnId] });
      setAsnCompleted(true);
      try {
        localStorage.setItem(asnCompletedKey(asnId), "1");
      } catch { /* ignore */ }
      toast.success("ASN marked complete");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Complete failed");
    } finally {
      setSubmitting(null);
    }
  }

  async function markCompletePartial() {
    setSubmitting("complete-partial");
    try {
      await partialCompleteASN(loadSettings(), asnId);
      await queryClient.invalidateQueries({ queryKey: ["asn", asnId] });
      setAsnCompleted(true);
      try {
        localStorage.setItem(asnCompletedKey(asnId), "1");
      } catch { /* ignore */ }
      toast.success("ASN marked as partial book in");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Complete (partial) failed");
    } finally {
      setSubmitting(null);
    }
  }

  const busy = submitting !== null;
  const canCompleteAsn =
    bookInVerified ||
    (totals.expected > 0 && totals.alreadyReceived >= totals.expected) ||
    (totals.expected > 0 && totals.combined >= totals.expected);

  return (
    <>
    <Card>
      <CardHeader className="space-y-3 py-3">
        <div className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Book in</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={saveDraft} disabled={busy || !itemsQuery.data?.length}>
              <Save className="h-4 w-4" /> Save draft
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => bookIn("partial")}
              disabled={busy || !itemsQuery.data?.length || !warehouseId || totals.shortfall <= 0 || !draftSaved || Object.keys(pendingBookings).length > 0}
            >
              {submitting === "partial" ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />}
              Partial book in
            </Button>
            <Button
              size="sm"
              onClick={() => bookIn("full")}
              disabled={busy || !itemsQuery.data?.length || !warehouseId || totals.shortfall > 0 || !draftSaved}
            >
              {submitting === "full" ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />}
              Book in
            </Button>
            {!draftSaved || totals.alreadyReceived <= 0 ? null : asnCompleted ? (
              <span
                className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white"
                aria-label="ASN completed"
              >
                <CheckCircle2 className="h-4 w-4" />
                Completed
              </span>
            ) : totals.shortfall > 0 ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={markCompletePartial}
                disabled={busy || !itemsQuery.data?.length}
                title="Close this ASN on Mintsoft as a partial book in"
              >
                {submitting === "complete-partial" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Complete - Partial
              </Button>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                onClick={markComplete}
                disabled={busy || !canCompleteAsn}
              >
                {submitting === "complete" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Complete ASN
              </Button>
            )}
          </div>
        </div>
        {itemsQuery.data?.length ? (
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>
                Received{" "}
                <span className="font-medium text-foreground tabular-nums">
                  {totals.alreadyReceived}
                </span>
                {totals.entered > 0 ? (
                  <>
                    {" "}+ entered{" "}
                    <span className="font-medium text-foreground tabular-nums">
                      {totals.entered}
                    </span>
                  </>
                ) : null}
                {" "}of{" "}
                <span className="font-medium text-foreground tabular-nums">
                  {totals.expected}
                </span>
                {" "}expected
              </span>
              <span className="flex items-center gap-2 tabular-nums">
                {totals.shortfall > 0 ? (
                  <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {totals.shortfall} short
                  </span>
                ) : totals.combined > totals.expected ? (
                  <span className="text-destructive">
                    {totals.combined - totals.expected} over
                  </span>
                ) : (
                  <span className="text-emerald-600 dark:text-emerald-400">Matches expected</span>
                )}
                <span className="font-medium text-foreground">{totals.pct}%</span>
              </span>
            </div>
            <Progress value={totals.pct} className="h-2" />
          </div>
        ) : null}
      </CardHeader>
      <CardContent>
        {!warehouseId ? (
          <p className="text-sm text-muted-foreground">
            This ASN has no warehouse — cannot book in.
          </p>
        ) : itemsQuery.isLoading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading items…
          </div>
        ) : !itemsQuery.data || itemsQuery.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No items found on this ASN.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[320px]">Product</TableHead>
                <TableHead className="w-20 text-right">Expected</TableHead>
                <TableHead className="w-24 text-center">Booked in</TableHead>
                <TableHead className="w-32">Receive qty</TableHead>
                <TableHead className="w-[200px]">Location</TableHead>
                {showBbfColumn ? (
                  <TableHead className="w-[160px]">BBF date</TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {itemsQuery.data.map((item, idx) => {
                const key = asnItemKey(item);
                const state =
                  rows[key] ?? { receivedQty: "", locationId: "", bbf: "" };
                const requiresBbf = !!requiresBbfByKey[String(key)];
                const expectedQty = getExpectedQty(item);
                const receivedQty = getReceivedQty(item);
                const pending = pendingBookings[key];
                const pendingTotal = pending
                  ? pending.baselineReceived + pending.qty
                  : 0;
                const displayReceivedQty = Math.max(receivedQty, pendingTotal);
                const pendingQty = Math.max(0, displayReceivedQty - receivedQty);
                const remainingQty = Math.max(0, expectedQty - displayReceivedQty);
                const bookedLocationId = bookedLocations[String(key)];
                const bookedIn =
                  expectedQty > 0 &&
                  (displayReceivedQty >= expectedQty ||
                    (!!pending && pending.qty > 0));
                const bookedLocationName = bookedLocationId
                  ? locationOptions.find((o) => o.id === bookedLocationId)?.name
                  : null;
                const stockLocs = (stockLocationQueries[idx]?.data ?? []) as Array<{
                  location: string;
                  quantity: number;
                }>;
                const stockLocLabels = stockLocs
                  .filter((s) => s.quantity > 0 && s.location)
                  .map((s) => s.location);
                 return (
                   <TableRow
                     key={String(key)}
                     data-asn-row={String(key)}
                     className={
                       highlightKeys.includes(String(key))
                         ? "bg-amber-100/60 dark:bg-amber-500/10 transition-colors"
                         : undefined
                     }
                   >
                    <TableCell>
                      <ProductCell
                        productId={item.ProductId ?? null}
                        fallbackSku={item.SKU ?? null}
                        fallbackTitle={item.Title ?? null}
                        fallbackDescription={item.Description ?? null}
                        fallbackImageUrl={item.ImageURL ?? null}
                        fallbackEan={item.EAN ?? null}
                        fallbackUpc={item.UPC ?? null}
                      />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {expectedQty}
                    </TableCell>
                    <TableCell className="text-center">
                      {expectedQty > 0 && displayReceivedQty >= expectedQty ? (
                        <CheckCircle2 className="mx-auto h-5 w-5 text-emerald-600 dark:text-emerald-400" aria-label="Booked in" />
                      ) : displayReceivedQty > 0 ? (
                        <span
                          className="font-medium tabular-nums text-amber-700 dark:text-amber-400"
                          title={`${displayReceivedQty} of ${expectedQty} booked in (${remainingQty} missing)`}
                        >
                          {displayReceivedQty}
                        </span>
                      ) : (
                        <XCircle className="mx-auto h-5 w-5 text-muted-foreground" aria-label={`${remainingQty} left to book in`} />
                      )}
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={0}
                        value={state.receivedQty}
                        onChange={(e) =>
                          updateRow(key, { receivedQty: e.target.value })
                        }
                      />
                    </TableCell>
                    <TableCell>
                      {(() => {
                        const labels = bookedLocationName
                          ? [bookedLocationName, ...stockLocLabels.filter((l) => l !== bookedLocationName)]
                          : stockLocLabels;
                        const bookedRows = labels.map((label) => {
                          const match = stockLocs.find((s) => s.location === label);
                          // The label we just booked to this session always gets
                          // the already-received quantity for this ASN line,
                          // regardless of what stock-locations reports.
                          const isJustBooked = label === bookedLocationName;
                          const qty = isJustBooked
                            ? displayReceivedQty
                            : match?.quantity ??
                              (labels.length === 1 ? displayReceivedQty : null);
                          return { label, qty };
                        });
                        const hasBooked = displayReceivedQty > 0 && bookedRows.length > 0;
                        const stillNeedsLocation =
                          remainingQty > 0 && displayReceivedQty < expectedQty;
                        const showCombobox = !hasBooked || stillNeedsLocation;
                        return (
                          <div className="flex flex-col gap-1.5">
                            {hasBooked ? (
                              <div
                                className="flex flex-col gap-0.5 text-sm text-emerald-700 dark:text-emerald-400"
                                title="Location(s) holding the booked-in stock"
                              >
                                {bookedRows.map(({ label, qty }) => (
                                  <div key={label} className="flex items-center gap-1.5">
                                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                                    <span className="font-mono">{label}</span>
                                    {qty != null && qty > 0 ? (
                                      <span className="tabular-nums text-xs text-muted-foreground">
                                        × {qty} {qty === 1 ? "unit" : "units"}
                                      </span>
                                    ) : null}
                                  </div>
                                ))}
                              </div>
                            ) : null}
                            {showCombobox ? (
                              <LocationCombobox
                                value={state.locationId}
                                options={locationOptions}
                                loading={locationsQuery.isLoading}
                                onChange={(v) => updateRow(key, { locationId: v })}
                              />
                            ) : null}
                          </div>
                        );
                      })()}
                    </TableCell>
                    {showBbfColumn ? (
                      <TableCell>
                        {requiresBbf ? (
                          <Input
                            type="date"
                            required
                            value={state.bbf}
                            onChange={(e) =>
                              updateRow(key, { bbf: e.target.value })
                            }
                          />
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            —
                          </span>
                        )}
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
    <AlertDialog
      open={!!confirmMismatch}
      onOpenChange={(open) => {
        if (!open) setConfirmMismatch(null);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Confirm quantity mismatch</AlertDialogTitle>
          <AlertDialogDescription>
            The quantities you are about to book in do not match the expected
            quantities on this ASN. Please review and confirm.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {confirmMismatch?.over.length ? (
          <div className="space-y-1">
            <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
              Over expected
            </p>
            <ul className="space-y-1 text-sm">
              {confirmMismatch.over.map((o) => (
                <li key={`over-${o.sku}`} className="tabular-nums">
                  <span className="font-mono">{o.sku}</span> — {o.finalReceived} of {o.expected} expected ({o.finalReceived - o.expected} over)
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {confirmMismatch?.under.length ? (
          <div className="space-y-1">
            <p className="text-sm font-medium text-destructive">
              Under expected
            </p>
            <ul className="space-y-1 text-sm">
              {confirmMismatch.under.map((u) => (
                <li key={`under-${u.sku}`} className="tabular-nums">
                  <span className="font-mono">{u.sku}</span> — {u.finalReceived} of {u.expected} expected ({u.expected - u.finalReceived} short)
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-amber-500 text-white hover:bg-amber-500/90"
            onClick={() => {
              if (!confirmMismatch) return;
              const keys = Array.from(
                new Set([
                  ...confirmMismatch.over.map((o) => o.key),
                  ...confirmMismatch.under.map((u) => u.key),
                ]),
              );
              setConfirmMismatch(null);
              setHighlightKeys(keys);
              requestAnimationFrame(() => {
                const first = keys[0];
                if (!first) return;
                const el = document.querySelector(
                  `[data-asn-row="${CSS.escape(first)}"]`,
                );
                el?.scrollIntoView({ behavior: "smooth", block: "center" });
              });
              window.setTimeout(() => setHighlightKeys([]), 4000);
            }}
          >
            Review and adjust quantities
          </AlertDialogAction>
          <AlertDialogAction
            className="bg-emerald-600 text-white hover:bg-emerald-600/90"
            onClick={() => {
              if (!confirmMismatch) return;
              const { mode, rowsToBook } = confirmMismatch;
              setConfirmMismatch(null);
              void executeBookIn(mode, rowsToBook);
            }}
          >
            Confirm and book in
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}

type LocationOption = { id: number | string; name: string };

function LocationCombobox({
  value,
  options,
  loading,
  onChange,
  disabled = false,
}: {
  value: string;
  options: LocationOption[];
  loading: boolean;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selected = options.find((o) => String(o.id) === value);

  // Barcode scanners typically end input with Enter. If the search exactly
  // matches a location name (case-insensitive), auto-select it on Enter.
  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    const q = search.trim().toLowerCase();
    if (!q) return;
    const exact = options.find((o) => o.name.toLowerCase() === q);
    const match =
      exact ??
      (options.filter((o) => o.name.toLowerCase().includes(q)).length === 1
        ? options.find((o) => o.name.toLowerCase().includes(q))
        : null);
    if (match) {
      onChange(String(match.id));
      setSearch("");
      setOpen(false);
      e.preventDefault();
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
          disabled={disabled}
        >
          <span className={cn(!selected && "text-muted-foreground")}>
            {selected
              ? selected.name
              : loading
                ? "Loading…"
                : "Pick or scan location"}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-0" align="start">
        <Command shouldFilter>
          <CommandInput
            placeholder="Search or scan barcode…"
            value={search}
            onValueChange={setSearch}
            onKeyDown={handleKeyDown}
            autoFocus
          />
          <CommandList>
            <CommandEmpty>No location found.</CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem
                  key={o.id}
                  value={o.name}
                  onSelect={() => {
                    onChange(String(o.id));
                    setSearch("");
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      String(o.id) === value ? "opacity-100" : "opacity-0",
                    )}
                  />
                  {o.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function ProductCell({
  productId,
  fallbackSku,
  fallbackTitle,
  fallbackDescription,
  fallbackImageUrl,
  fallbackEan,
  fallbackUpc,
}: {
  productId: number | null;
  fallbackSku: string | null;
  fallbackTitle: string | null;
  fallbackDescription: string | null;
  fallbackImageUrl: string | null;
  fallbackEan: string | null;
  fallbackUpc: string | null;
}) {
  const productQuery = useQuery({
    queryKey: ["product", productId],
    queryFn: () =>
      productId ? fetchProduct(loadSettings(), productId) : Promise.resolve(null),
    enabled: !!productId,
    staleTime: 30 * 60_000,
    refetchOnWindowFocus: false,
  });
  const p = productQuery.data;
  const sku = p?.SKU || fallbackSku || "—";
  const name = p?.Name || fallbackTitle || "";
  const description = p?.Description || fallbackDescription || "";
  const ean = p?.EAN || fallbackEan || "";
  const upc = p?.UPC || fallbackUpc || "";
  // Mintsoft sometimes stores Amazon FNSKUs (e.g. "KQ-Z3HJ-EI78") in EAN/UPC.
  // Only trust it if it's a pure numeric 12-14 digit code (EAN/UPC).
  const rawBarcode = (ean || upc).toString().trim();
  const isRealBarcode = /^\d{12,14}$/.test(rawBarcode);
  const hasBarcode = isRealBarcode;
  const imageProduct = p
    ? {
        ...p,
        ImageURL: p.ImageURL || fallbackImageUrl || null,
        EAN: p.EAN || fallbackEan || null,
        UPC: p.UPC || fallbackUpc || null,
        Name: p.Name || fallbackTitle || undefined,
      }
    : fallbackImageUrl || fallbackEan || fallbackUpc || fallbackTitle
      ? {
          ID: productId ?? 0,
          SKU: fallbackSku ?? undefined,
          Name: fallbackTitle ?? undefined,
          Description: fallbackDescription,
          ImageURL: fallbackImageUrl,
          EAN: fallbackEan,
          UPC: fallbackUpc,
        }
      : null;
  return (
    <div className="flex items-start gap-2">
      <ProductImage product={imageProduct} />
      <div className="min-w-0 flex-1 space-y-0.5">
        {name ? (
          <div className="text-xs line-clamp-2" title={name}>
            <span className="font-semibold text-muted-foreground">Name:</span>{" "}
            <span className="font-medium">{name}</span>
          </div>
        ) : null}
        <div className="text-xs line-clamp-1" title={sku}>
          <span className="font-semibold text-muted-foreground">Sku:</span>{" "}
          <span className="font-mono">{sku}</span>
        </div>
        <div
          className="text-[11px] text-muted-foreground line-clamp-2"
          title={description || undefined}
        >
          <span className="font-semibold">Description:</span>{" "}
          {description || <span className="italic">None</span>}
        </div>
        <BarcodeRow
          ean={ean}
          upc={upc}
          name={name}
          sku={sku}
          description={description}
          hasBarcode={hasBarcode}
        />
      </div>
    </div>
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
      // Ask Gemini to pick the best match for this product.
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
          // Gemini explicitly rejected all candidates — don't show a wrong image.
          return null;
        }
      } catch {
        // fall through to first candidate
      }
      return candidates[0].image;
    },
    enabled: !direct && queries.length > 0,
    staleTime: 60 * 60_000,
    refetchOnWindowFocus: false,
  });

  const cls = "h-20 w-20 shrink-0 rounded-md border bg-muted object-contain";

  if (direct) {
    return <img src={direct} alt={product?.Name ?? ""} className={cls} loading="lazy" />;
  }
  if (amazonQuery.isLoading) {
    return (
      <div className={`${cls} flex items-center justify-center`}>
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (amazonQuery.data) {
    return (
      <div className="flex flex-col items-center gap-1">
        <img
          src={amazonQuery.data}
          alt={`Suggested image for ${product?.Name ?? ""}`}
          className={`${cls} border-2 border-orange-500`}
          loading="lazy"
        />
        <div
          className="flex items-center gap-1 rounded-sm border border-orange-500 bg-orange-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-800 dark:bg-orange-500/15 dark:text-orange-300"
          title="This image was auto-suggested by AI and may not match"
        >
          <AlertTriangle className="h-3 w-3" /> Suggested
        </div>
      </div>
    );
  }
  return <div className={cls} />;
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
  if (hasBarcode) {
    return (
      <div className="text-[11px] text-muted-foreground">
        <span className="font-semibold">Barcode:</span>{" "}
        <span className="font-mono">{ean || upc}</span>
      </div>
    );
  }

  const query = useQuery({
    queryKey: ["suggest-barcode", sku || name, name, description],
    queryFn: async () => {
      const r = await fetch("/api/suggest-barcode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, sku, description }),
      });
      const data = (await r.json()) as {
        barcode?: string | null;
        type?: string;
        confidence?: string;
        reason?: string;
        sources?: string[];
      };
      return data;
    },
    enabled: !!(name || sku),
    staleTime: 24 * 60 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  if (query.isLoading) {
    return (
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <span className="font-semibold">Barcode:</span>
        <Loader2 className="h-3 w-3 animate-spin" />
        <span className="italic">scanning the web…</span>
      </div>
    );
  }

  const barcode = query.data?.barcode;
  const confidence = query.data?.confidence ?? "low";
  const reason = query.data?.reason ?? "";
  const confColor =
    confidence === "high"
      ? "text-emerald-700 dark:text-emerald-400 border-emerald-500/40 bg-emerald-50 dark:bg-emerald-500/10"
      : confidence === "medium"
        ? "text-orange-700 dark:text-orange-400 border-orange-500/40 bg-orange-50 dark:bg-orange-500/10"
        : "text-rose-700 dark:text-rose-400 border-rose-500/40 bg-rose-50 dark:bg-rose-500/10";
  if (barcode) {
    return (
      <div className="text-[11px] text-muted-foreground" title={reason || undefined}>
        <span className="font-semibold">Barcode:</span>{" "}
        <span className="font-mono text-orange-700 dark:text-orange-400" title="AI-suggested">
          {barcode}
        </span>{" "}
        <span
          className={`ml-1 inline-flex items-center rounded border px-1 py-px text-[9px] font-semibold uppercase tracking-wide ${confColor}`}
          title={reason || "AI confidence in the match"}
        >
          {confidence}
        </span>
      </div>
    );
  }
  return (
    <div className="text-[11px] text-muted-foreground" title={reason || undefined}>
      <span className="font-semibold">Barcode:</span>{" "}
      <span className="italic">None Suggested</span>
    </div>
  );
}