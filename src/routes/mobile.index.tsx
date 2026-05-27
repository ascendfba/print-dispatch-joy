import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Truck, ChevronRight } from "lucide-react";
import { listASNs, type MintsoftASN } from "@/lib/mintsoft";
import { loadSettings } from "@/lib/storage";

export const Route = createFileRoute("/mobile/")({
  component: MobileHome,
});

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function MobileHome() {
  const settings = loadSettings();
  const asnQuery = useQuery({
    queryKey: ["mobile", "asns"],
    queryFn: () => listASNs(settings),
    staleTime: 60_000,
  });

  const days = useMemo(() => {
    const today = startOfDay(new Date());
    return [0, 1, 2].map((offset) => {
      const d = new Date(today);
      d.setDate(today.getDate() + offset);
      return d;
    });
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, MintsoftASN[]>();
    for (const d of days) map.set(d.toDateString(), []);
    for (const a of asnQuery.data ?? []) {
      if (!a.ExpectedDate) continue;
      const d = new Date(a.ExpectedDate);
      if (Number.isNaN(d.getTime())) continue;
      const key = startOfDay(d).toDateString();
      if (map.has(key)) map.get(key)!.push(a);
    }
    return map;
  }, [asnQuery.data, days]);

  return (
    <div className="flex-1 flex flex-col">
      <div className="flex-1 px-4 py-4 space-y-4 overflow-y-auto">
        <section>
          <h2 className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            ASN Calendar · Next 3 days
          </h2>

          {asnQuery.isLoading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading
            </div>
          ) : (
            <div className="space-y-3">
              {days.map((d) => {
                const list = grouped.get(d.toDateString()) ?? [];
                const label = d.toLocaleDateString(undefined, {
                  weekday: "short",
                  day: "2-digit",
                  month: "short",
                });
                return (
                  <div key={d.toISOString()} className="rounded-2xl border bg-card overflow-hidden">
                    <div className="px-4 py-2 bg-muted/40 flex items-center justify-between">
                      <span className="text-sm font-medium">{label}</span>
                      <span className="text-xs text-muted-foreground">
                        {list.length} ASN{list.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    {list.length === 0 ? (
                      <div className="px-4 py-4 text-xs text-muted-foreground">No ASNs</div>
                    ) : (
                      <div className="divide-y">
                        {list.map((a) => (
                          <Link
                            key={a.ID}
                            to="/mobile/stock/asns"
                            className="flex items-center gap-3 px-4 py-3 active:bg-muted/60"
                          >
                            <div className="h-9 w-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                              <Truck className="h-4 w-4" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium truncate">
                                {a.Reference || `ASN #${a.ID}`}
                              </div>
                              <div className="text-xs text-muted-foreground truncate">
                                {a.SupplierName || "—"}
                              </div>
                            </div>
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}