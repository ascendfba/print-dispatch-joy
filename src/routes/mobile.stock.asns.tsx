import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, Search, Truck, Loader2, X } from "lucide-react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listASNs, type MintsoftASN } from "@/lib/mintsoft";
import { loadSettings } from "@/lib/storage";

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
    const dateA = a.ExpectedDate ? new Date(a.ExpectedDate).getTime() : 0;
    const dateB = b.ExpectedDate ? new Date(b.ExpectedDate).getTime() : 0;
    return dateB - dateA;
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
          sorted.map((asn) => <ASNCard key={asn.ID} asn={asn} />)
        )}
      </div>
    </div>
  );
}

function ASNCard({ asn }: { asn: MintsoftASN }) {
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
        <p className="text-xs text-muted-foreground truncate">
          {asn.SupplierName || "—"}
        </p>
        <div className="flex items-center gap-2 mt-1">
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
          {asn.TotalQuantity != null && (
            <span className="text-[11px] text-muted-foreground">
              {asn.TotalQuantity} item{asn.TotalQuantity === 1 ? "" : "s"}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
