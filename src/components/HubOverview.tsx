import { useQueries, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Package, Truck, Clock, AlertTriangle } from "lucide-react";
import {
  fetchOrderItems,
  listASNs,
  listOpenOrders,
  type MintsoftASN,
  type MintsoftOrder,
} from "@/lib/mintsoft";
import { loadSettings } from "@/lib/storage";

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function ageHours(s?: string | null) {
  if (!s) return null;
  const t = new Date(s).getTime();
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / 36e5;
}
function bucket(h: number | null): "fresh" | "today" | "stale" | "critical" {
  if (h == null || h < 24) return "fresh";
  if (h < 48) return "today";
  if (h < 72) return "stale";
  return "critical";
}
const bucketMeta: Record<
  ReturnType<typeof bucket>,
  { label: string; className: string }
> = {
  fresh: { label: "< 1 day", className: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30" },
  today: { label: "1–2 days", className: "bg-amber-500/15 text-amber-600 border-amber-500/30" },
  stale: { label: "2–3 days", className: "bg-orange-500/15 text-orange-600 border-orange-500/30" },
  critical: { label: "3+ days", className: "bg-destructive/15 text-destructive border-destructive/30" },
};

export function HubOverview() {
  const ordersQuery = useQuery({
    queryKey: ["orders"],
    queryFn: () => listOpenOrders(loadSettings()),
    refetchOnWindowFocus: false,
  });
  const asnsQuery = useQuery({
    queryKey: ["asns"],
    queryFn: () => listASNs(loadSettings()),
    refetchOnWindowFocus: false,
  });

  const orders = (ordersQuery.data ?? []) as MintsoftOrder[];
  const today = startOfDay(new Date());
  const tomorrow = addDays(today, 1);

  const dueToday = orders.filter((o) => {
    const raw = (o.OrderDate as string | undefined) ?? o.CreatedDate;
    if (!raw) return false;
    const t = new Date(raw).getTime();
    return t < tomorrow.getTime();
  });
  const dueTodayCount = dueToday.length;

  const itemQueries = useQueries({
    queries: dueToday.map((o) => ({
      queryKey: ["order-items", o.ID],
      queryFn: () => fetchOrderItems(loadSettings(), o.ID),
      staleTime: 5 * 60_000,
      refetchOnWindowFocus: false,
    })),
  });
  const dueTodayUnits = itemQueries.reduce(
    (s, q) => s + (q.data?.reduce((n, it) => n + (it.Quantity ?? 0), 0) ?? 0),
    0,
  );
  const unitsLoading = itemQueries.some((q) => q.isLoading);

  const buckets = { fresh: 0, today: 0, stale: 0, critical: 0 };
  for (const o of orders) {
    buckets[bucket(ageHours((o.OrderDate as string | undefined) ?? o.CreatedDate))]++;
  }
  const overdue = buckets.stale + buckets.critical;

  // ASN calendar — next 7 days
  const asns = (asnsQuery.data ?? []) as MintsoftASN[];
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const asnsByDay = days.map((d) => {
    const next = addDays(d, 1);
    const items = asns.filter((a) => {
      if (!a.ExpectedDate) return false;
      const t = new Date(a.ExpectedDate).getTime();
      if (Number.isNaN(t)) return false;
      if (t < d.getTime() || t >= next.getTime()) return false;
      const s = (a.Status ?? "").toLowerCase().replace(/[\s_-]/g, "");
      // exclude completed
      if (s.includes("bookedin") || s.includes("complete") || s.includes("closed") || s.includes("delivered")) {
        return false;
      }
      return true;
    });
    return { date: d, items };
  });

  const loading = ordersQuery.isLoading || asnsQuery.isLoading;

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Overview
          </h2>
        </div>
        {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      </div>

      <div className="grid gap-3 grid-cols-3">
        {/* Orders due today */}
        <Link to="/orders" className="block">
          <Card className="h-full transition-colors hover:border-primary/60 hover:bg-accent/40">
            <CardContent className="p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Package className="h-3.5 w-3.5" /> Due today
                </div>
                {overdue > 0 && (
                  <Badge
                    variant="outline"
                    className="h-5 border-destructive/30 bg-destructive/10 px-1.5 text-[10px] text-destructive"
                  >
                    <AlertTriangle className="mr-0.5 h-2.5 w-2.5" />
                    {overdue}
                  </Badge>
                )}
              </div>
              <div className="mt-1 flex items-baseline gap-1.5">
                <div className="text-2xl font-semibold tabular-nums leading-none">{dueTodayCount}</div>
                <div className="text-[11px] text-muted-foreground">
                  / {orders.length} open
                </div>
              </div>
              <div className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                <span className="tabular-nums font-medium text-foreground">
                  {dueTodayUnits.toLocaleString()}
                </span>
                <span>units total</span>
                {unitsLoading && <Loader2 className="h-3 w-3 animate-spin" />}
              </div>
            </CardContent>
          </Card>
        </Link>

        {/* Order age */}
        <Card className="h-full">
          <CardContent className="p-3">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Clock className="h-3.5 w-3.5" /> Order age
            </div>
            <div className="mt-1.5 flex items-center gap-1">
              {(["fresh", "today", "stale", "critical"] as const).map((k) => {
                const n = buckets[k];
                const pct = orders.length ? Math.round((n / orders.length) * 100) : 0;
                const color =
                  k === "fresh"
                    ? "bg-emerald-500"
                    : k === "today"
                      ? "bg-amber-500"
                      : k === "stale"
                        ? "bg-orange-500"
                        : "bg-destructive";
                return (
                  <div
                    key={k}
                    className="flex-1 rounded-sm border border-border px-1.5 py-1 text-center"
                    title={bucketMeta[k].label}
                  >
                    <div className="text-[9px] uppercase text-muted-foreground leading-tight">
                      {bucketMeta[k].label}
                    </div>
                    <div className="text-[11px] font-semibold tabular-nums leading-tight">{n}</div>
                    <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-muted">
                      <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* ASN calendar */}
        <Link to="/asns" className="block">
          <Card className="h-full transition-colors hover:border-primary/60 hover:bg-accent/40">
            <CardContent className="p-3">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Truck className="h-3.5 w-3.5" /> ASNs · 7d
              </div>
              <div className="mt-2 grid grid-cols-7 gap-1">
                {asnsByDay.map(({ date, items }) => {
                  const isToday = date.getTime() === today.getTime();
                  return (
                    <div
                      key={date.toISOString()}
                      title={`${date.toLocaleDateString()} — ${items.length} ASN(s)`}
                      className={
                        "rounded-sm border px-0.5 py-1 text-center leading-tight " +
                        (isToday ? "border-primary/50 bg-primary/5" : "border-border")
                      }
                    >
                      <div className="text-[9px] uppercase text-muted-foreground">
                        {date.toLocaleDateString(undefined, { weekday: "narrow" })}
                      </div>
                      <div className="text-[11px] font-medium">{date.getDate()}</div>
                      <div className="text-[11px] tabular-nums">
                        {items.length > 0 ? (
                          <span className="font-semibold text-primary">{items.length}</span>
                        ) : (
                          <span className="text-muted-foreground">·</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>
    </section>
  );
}