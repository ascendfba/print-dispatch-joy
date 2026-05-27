import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, Search, Truck, Loader2, X, Boxes } from "lucide-react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listASNs, listClients, type MintsoftASN } from "@/lib/mintsoft";
import { loadSettings } from "@/lib/storage";

function getSkuCount(asn: MintsoftASN): number | undefined {
  const raw = asn as Record<string, unknown>;
  const candidates = [
    "TotalSKUs", "SKUCount", "LineItemCount", "ItemCount",
    "NumberOfProducts", "ProductsCount", "TotalProducts",
    "NumberOfSKUs", "SKUs", "ProductCount",
  ];
  for (const key of candidates) {
    const val = raw[key];
    if (typeof val === "number" && Number.isFinite(val)) return val;
    if (typeof val === "string") {
      const n = Number(val);
      if (Number.isFinite(n)) return n;
    }
  }
  const items = raw["ASNItems"] ?? raw["Items"] ?? raw["Details"];
  if (Array.isArray(items)) return items.length;
  return undefined;
}

function getPackageBreakdown(asn: MintsoftASN): string {
  const raw = asn as Record<string, unknown>;
  const counts: Record<string, number> = {};

  // Try individual count fields first
  const fieldMappings: Array<[string, string[]]> = [
    ["Pallet", ["Pallets", "PalletCount", "NumberOfPallets", "TotalPallets", "PalletQty"]],
    ["Carton", ["Cartons", "CartonCount", "NumberOfCartons", "TotalCartons", "CartonQty", "CartonsQty"]],
    ["Box", ["Boxes", "BoxCount", "NumberOfBoxes", "TotalBoxes", "BoxQty"]],
    ["Bag", ["Bags", "BagCount", "NumberOfBags", "TotalBags"]],
    ["Tote", ["Totes", "ToteCount", "NumberOfTotes", "TotalTotes"]],
    ["Crate", ["Crates", "CrateCount", "NumberOfCrates", "TotalCrates"]],
    ["Roll", ["Rolls", "RollCount", "NumberOfRolls", "TotalRolls"]],
    ["Drum", ["Drums", "DrumCount", "NumberOfDrums", "TotalDrums"]],
  ];

  for (const [label, keys] of fieldMappings) {
    for (const key of keys) {
      const val = raw[key];
      if (typeof val === "number" && val > 0) {
        counts[label] = (counts[label] || 0) + val;
        break;
      }
      if (typeof val === "string") {
        const n = Number(val);
        if (n > 0) {
          counts[label] = (counts[label] || 0) + n;
          break;
        }
      }
    }
  }

  // Try a Packages / PackageTypes array
  const packagesArr = raw["Packages"] ?? raw["PackageTypes"] ?? raw["PackageDetails"];
  if (Array.isArray(packagesArr)) {
    for (const pkg of packagesArr) {
      if (!pkg || typeof pkg !== "object") continue;
      const p = pkg as Record<string, unknown>;
      const type =
        (typeof p["Type"] === "string" && p["Type"]) ||
        (typeof p["PackageType"] === "string" && p["PackageType"]) ||
        (typeof p["Name"] === "string" && p["Name"]) ||
        "";
      const qty =
        typeof p["Quantity"] === "number" ? p["Quantity"] :
        typeof p["Count"] === "number" ? p["Count"] :
        typeof p["Qty"] === "number" ? p["Qty"] :
        typeof p["Quantity"] === "string" ? Number(p["Quantity"]) :
        typeof p["Count"] === "string" ? Number(p["Count"]) :
        typeof p["Qty"] === "string" ? Number(p["Qty"]) :
        0;
      if (type && qty > 0) {
        const key = type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
        counts[key] = (counts[key] || 0) + qty;
      }
    }
  }

  // Also try PackageSummary string
  if (typeof raw["PackageSummary"] === "string" && raw["PackageSummary"]) {
    return raw["PackageSummary"] as string;
  }

  const entries = Object.entries(counts).filter(([, n]) => n > 0);
  if (entries.length === 0) return "";
  return entries.map(([type, qty]) => `${type.toLowerCase()} x ${qty}`).join(", ");
}


export const Route = createFileRoute("/mobile/stock/asns")({
  component: MobileASNs,
});

function MobileASNs() {
  const [query, setQuery] = useState("");

  const asnsQuery = useQuery({
    queryKey: ["mobile-asns-list"],
    queryFn: async () => {
      const settings = loadSettings();
      if (!settings.mintsoftApiKey && !settings.mintsoftUsername) {
        throw new Error("Configure Mintsoft in Settings first");
      }
      return listASNs(settings);
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const clientsQuery = useQuery({
    queryKey: ["mobile-clients-list"],
    queryFn: async () => {
      const settings = loadSettings();
      if (!settings.mintsoftApiKey && !settings.mintsoftUsername) return [];
      return listClients(settings);
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const clientMap = new Map<number, string>();
  for (const c of clientsQuery.data ?? []) {
    const anyC = c as unknown as Record<string, unknown>;
    const id = Number(anyC["ID"] ?? anyC["Id"] ?? anyC["ClientId"] ?? anyC["ClientID"]);
    const name =
      (typeof anyC["Name"] === "string" && anyC["Name"]) ||
      (typeof anyC["ClientName"] === "string" && anyC["ClientName"]) ||
      (typeof anyC["CompanyName"] === "string" && anyC["CompanyName"]) ||
      "";
    if (Number.isFinite(id) && name) clientMap.set(id, name as string);
  }

  const allAsns = asnsQuery.data ?? [];

  const filtered = query.trim()
    ? allAsns.filter((a) => {
        const q = query.trim().toLowerCase();
        const ref = (a.Reference ?? "").toLowerCase();
        const id = String(a.ID).toLowerCase();
        const supplier = (a.SupplierName ?? "").toLowerCase();
        return ref.includes(q) || id.includes(q) || supplier.includes(q);
      })
    : allAsns;

  // Hide booked-in / received / completed ASNs
  const activeAsns = filtered.filter((a) => {
    const status = (a.Status ?? "").toLowerCase();
    return !status.includes("booked") && !status.includes("received") && !status.includes("complete") && !status.includes("closed") && !status.includes("processed");
  });

  const sorted = [...activeAsns].sort((a, b) => {
    const dateA = a.ExpectedDate ? new Date(a.ExpectedDate).getTime() : Infinity;
    const dateB = b.ExpectedDate ? new Date(b.ExpectedDate).getTime() : Infinity;
    return dateA - dateB;
  });

  return (
    <div className="flex-1 flex flex-col">
      <header className="px-3 pt-4 pb-3 border-b flex items-center gap-2 bg-gradient-to-r from-[#0a2e3d] via-[#0d3a4d] to-[#0a2e3d]">
        <Link to="/mobile" className="p-2 -ml-2 rounded-lg active:bg-white/10">
          <ChevronLeft className="h-5 w-5 text-white" />
        </Link>
        <h1 className="text-lg font-semibold text-white">ASNs</h1>
      </header>

      <div className="px-3 pt-3 pb-2 bg-card border-b">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search ASN #, reference or supplier…"
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

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {asnsQuery.isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading ASNs…
          </div>
        ) : asnsQuery.error ? (
          <div className="py-8 text-center text-sm text-destructive">
            {asnsQuery.error instanceof Error
              ? asnsQuery.error.message
              : "Failed to load ASNs"}
          </div>
        ) : sorted.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            {query.trim() ? "No ASNs match your search" : "No ASNs found"}
          </div>
        ) : (
          sorted.map((asn) => (
            <ASNCard
              key={asn.ID}
              asn={asn}
              clientName={
                (asn.ClientId && clientMap.get(asn.ClientId)) ||
                (typeof (asn as Record<string, unknown>).ClientName === "string"
                  ? ((asn as Record<string, unknown>).ClientName as string)
                  : "") ||
                ""
              }
            />
          ))
        )}
      </div>
    </div>
  );
}

function ASNCard({ asn, clientName }: { asn: MintsoftASN; clientName: string }) {
  const expected = asn.ExpectedDate
    ? new Date(asn.ExpectedDate)
    : null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const isOverdue = expected ? expected < today : false;
  const isToday = expected ? expected.toDateString() === today.toDateString() : false;

  let borderColor = "border-l-[#0099d4]";
  if (isOverdue) borderColor = "border-l-red-500";
  else if (isToday) borderColor = "border-l-[#0099d4]";
  else borderColor = "border-l-[#0a2e3d]";

  return (
    <Link
      to="/mobile/stock/asns/$asnId"
      params={{ asnId: String(asn.ID) }}
      className={`flex items-start gap-3 rounded-xl border bg-card p-3 border-l-4 ${borderColor} active:bg-muted/60 transition-colors`}
    >
      <div className="rounded-xl p-2 bg-[#0099d4]/10 shrink-0 mt-0.5">
        <Truck className="h-4 w-4 text-[#0099d4]" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium truncate">
            {asn.Reference || `ASN #${asn.ID}`}
          </p>
          {asn.Status && (
            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium bg-[#0a2e3d]/10 text-[#0a2e3d] shrink-0">
              {asn.Status}
            </span>
          )}
        </div>
        {clientName && (
          <p className="text-xs font-medium text-[#0a2e3d] truncate">
            {clientName}
          </p>
        )}
        {asn.SupplierName && (
          <p className="text-xs text-muted-foreground truncate">
            {asn.SupplierName}
          </p>
        )}
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {expected && (
            <span
              className={`text-[11px] ${
                isOverdue
                  ? "text-red-600 font-medium"
                  : isToday
                    ? "text-[#0099d4] font-medium"
                    : "text-muted-foreground"
              }`}
            >
              {isToday
                ? "Due today"
                : isOverdue
                  ? `Overdue — ${expected.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
                  : expected.toLocaleDateString(undefined, {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                    })}
            </span>
          )}
        </div>
        {(() => {
          const skuCount = getSkuCount(asn);
          const qty = asn.TotalQuantity;
          if (skuCount == null && qty == null) return null;
          return (
            <div className="flex items-center gap-3 mt-1 flex-wrap text-[11px] font-medium text-[#0a2e3d]">
              {skuCount != null && <span>SKU: {skuCount}</span>}
              {qty != null && <span>Total Units: {qty}</span>}
            </div>
          );
        })()}
        {(() => {
          const breakdown = getPackageBreakdown(asn);
          if (!breakdown) return null;
          return (
            <div className="flex items-center gap-1.5 mt-1">
              <Boxes className="h-3 w-3 text-muted-foreground" />
              <span className="text-[11px] text-muted-foreground capitalize">
                Type: {breakdown}
              </span>
            </div>
          );
        })()}
      </div>
    </Link>
  );
}

