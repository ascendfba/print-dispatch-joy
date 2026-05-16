import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Loader2, Plus, RefreshCw, Truck } from "lucide-react";
import {
  createASN,
  listASNs,
  listClients,
  listWarehouses,
  type MintsoftASN,
} from "@/lib/mintsoft";
import { loadSettings } from "@/lib/storage";

export const Route = createFileRoute("/asns")({
  component: AsnsPage,
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

function AsnsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [filter, setFilter] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [statusTab, setStatusTab] = useState<
    "new" | "partial" | "completed"
  >("new");

  const asnsQuery = useQuery({
    queryKey: ["asns"],
    queryFn: async () => {
      const settings = loadSettings();
      if (!settings.mintsoftApiKey && !settings.mintsoftUsername) {
        throw new Error("Configure Mintsoft in Settings first (API key or username)");
      }
      return listASNs(settings);
    },
    refetchOnWindowFocus: false,
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

  const warehousesQuery = useQuery({
    queryKey: ["warehouses"],
    queryFn: () => listWarehouses(loadSettings()),
    staleTime: 60 * 60_000,
    refetchOnWindowFocus: false,
  });

  const matchesStatusTab = (status: string | null | undefined) => {
    const s = (status ?? "").toLowerCase().replace(/[\s_-]/g, "");
    switch (statusTab) {
      case "new":
        return (
          s === "" ||
          s.includes("new") ||
          s.includes("draft") ||
          s.includes("await") ||
          s.includes("pending") ||
          s.includes("expected") ||
          s.includes("intransit")
        );
      case "partial":
        // "BOOKEDIN-PARTIAL" is a fully completed (book-in finished) status,
        // so exclude it. But "PARTIALLYBOOKED" must remain in the Partial tab.
        return s.includes("partial") && !s.includes("bookedin");
      case "completed":
        return (
          (s.includes("bookedin") || s.includes("complete") || s.includes("closed") || s.includes("delivered")) &&
          !(s.includes("partial") && !s.includes("bookedin"))
        );
    }
  };

  const tabCounts = useMemo(() => {
    const list = asnsQuery.data ?? [];
    const counts = { new: 0, partial: 0, completed: 0 };
    const prev = statusTab;
    for (const t of ["new", "partial", "completed"] as const) {
      (statusTab as string) === t;
    }
    // compute by re-running matcher per tab
    for (const a of list) {
      const s = (a.Status ?? "").toLowerCase().replace(/[\s_-]/g, "");
      if (s.includes("bookedin") || s.includes("complete") || s.includes("closed") || s.includes("delivered")) counts.completed++;
      else if (s.includes("partial")) counts.partial++;
      else counts.new++;
    }
    void prev;
    return counts;
  }, [asnsQuery.data, statusTab]);

  const filtered = useMemo(() => {
    const list = (asnsQuery.data ?? []).filter((a) => matchesStatusTab(a.Status));
    const q = filter.trim().toLowerCase();
    if (!q) return list;
    return list.filter((a) =>
      [
        a.Reference,
        a.SupplierName,
        a.WarehouseName,
        a.Status,
        String(a.ID),
        a.ClientId ? clientNameById.get(a.ClientId) : null,
      ]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asnsQuery.data, filter, clientNameById, statusTab]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Truck className="h-6 w-6" /> Advanced Shipping Notices
          </h1>
          <p className="text-sm text-muted-foreground">
            Inbound shipments from suppliers, synced from Mintsoft.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => asnsQuery.refetch()}
            disabled={asnsQuery.isFetching}
          >
            {asnsQuery.isFetching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Refresh
          </Button>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4" /> New ASN
              </Button>
            </DialogTrigger>
            <CreateAsnDialog
              onClose={() => setCreateOpen(false)}
              onCreated={() => {
                setCreateOpen(false);
                void qc.invalidateQueries({ queryKey: ["asns"] });
              }}
              warehouses={warehousesQuery.data ?? []}
            />
          </Dialog>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
          <CardTitle className="text-base">
            {filtered.length} ASN{filtered.length === 1 ? "" : "s"}
          </CardTitle>
          <Input
            placeholder="Search reference, supplier, warehouse…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="max-w-xs"
          />
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs value={statusTab} onValueChange={(v) => setStatusTab(v as typeof statusTab)}>
            <TabsList>
              <TabsTrigger value="new">
                New / Awaiting delivery ({tabCounts.new})
              </TabsTrigger>
              <TabsTrigger value="partial">
                Partially booked ({tabCounts.partial})
              </TabsTrigger>
              <TabsTrigger value="completed">
                Completed ({tabCounts.completed})
              </TabsTrigger>
            </TabsList>
          </Tabs>
          {asnsQuery.isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading ASNs…
            </div>
          ) : asnsQuery.error ? (
            <div className="py-12 text-center text-sm text-destructive">
              {asnsQuery.error instanceof Error
                ? asnsQuery.error.message
                : "Failed to load ASNs"}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No ASNs found.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[160px]">Reference</TableHead>
                  <TableHead className="w-[140px]">PO Ref</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead className="w-[120px]">Status</TableHead>
                  <TableHead className="w-24 text-right">Qty</TableHead>
                  <TableHead className="w-[180px]">Estimated arrival date</TableHead>
                  <TableHead>Comments</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((a: MintsoftASN) => (
                  <TableRow
                    key={a.ID}
                    className="cursor-pointer"
                    onClick={() =>
                      navigate({
                        to: "/asns/$asnId",
                        params: { asnId: String(a.ID) },
                      })
                    }
                  >
                    <TableCell className="font-medium">
                      <Link
                        to="/asns/$asnId"
                        params={{ asnId: String(a.ID) }}
                        className="text-primary hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {a.Reference || `#${a.ID}`}
                      </Link>
                    </TableCell>
                    <TableCell>{a.PORef || "—"}</TableCell>
                    <TableCell>
                      {(a.ClientId && clientNameById.get(a.ClientId)) || "—"}
                    </TableCell>
                    <TableCell>{a.SupplierName || "—"}</TableCell>
                    <TableCell>
                      {a.Status ? (
                        <Badge variant="outline">{a.Status}</Badge>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {a.TotalQuantity ?? "—"}
                      {a.InboundType ? (
                        <span className="ml-1 text-muted-foreground">
                          ({a.InboundType.toLowerCase()})
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>{formatDate(a.ExpectedDate)}</TableCell>
                    <TableCell className="max-w-[280px] truncate" title={a.Comments || a.Notes || ""}>
                      {a.Comments || a.Notes || "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CreateAsnDialog({
  onClose,
  onCreated,
  warehouses,
}: {
  onClose: () => void;
  onCreated: () => void;
  warehouses: Array<{ id: number; name: string }>;
}) {
  const [reference, setReference] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [warehouseId, setWarehouseId] = useState<string>("");
  const [expectedDate, setExpectedDate] = useState("");
  const [notes, setNotes] = useState("");

  const create = useMutation({
    mutationFn: async () => {
      const ref = reference.trim();
      if (!ref) throw new Error("Reference is required");
      const whId = Number(warehouseId);
      if (!Number.isFinite(whId) || whId <= 0) throw new Error("Pick a warehouse");
      return createASN(loadSettings(), {
        Reference: ref,
        WarehouseId: whId,
        SupplierName: supplierName.trim() || undefined,
        ExpectedDate: expectedDate || undefined,
        Notes: notes.trim() || undefined,
      });
    },
    onSuccess: (asn) => {
      toast.success(`ASN ${asn.Reference ?? asn.ID} created`);
      onCreated();
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Failed to create ASN");
    },
  });

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>New ASN</DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="asn-ref">Reference</Label>
          <Input
            id="asn-ref"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="e.g. PO-12345"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="asn-supplier">Supplier</Label>
          <Input
            id="asn-supplier"
            value={supplierName}
            onChange={(e) => setSupplierName(e.target.value)}
            placeholder="Supplier name"
          />
        </div>
        <div className="space-y-1">
          <Label>Warehouse</Label>
          <Select value={warehouseId} onValueChange={setWarehouseId}>
            <SelectTrigger>
              <SelectValue placeholder="Select warehouse" />
            </SelectTrigger>
            <SelectContent>
              {warehouses.map((w) => (
                <SelectItem key={w.id} value={String(w.id)}>
                  {w.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="asn-date">Expected date</Label>
          <Input
            id="asn-date"
            type="date"
            value={expectedDate}
            onChange={(e) => setExpectedDate(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="asn-notes">Notes</Label>
          <Textarea
            id="asn-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
          />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={create.isPending}>
          Cancel
        </Button>
        <Button onClick={() => create.mutate()} disabled={create.isPending}>
          {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Create ASN
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}