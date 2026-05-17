import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Package, Truck, Clock, AlertTriangle } from "lucide-react";
import { listOpenOrders, listASNs, type MintsoftOrder, type MintsoftASN } from "@/lib/mintsoft";
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
  }).length;

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
    <section className="space-y-4">
      <div className="flex items-center gap-3 border-b border-border pb-2">
        <div className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Clock className="h-4 w-4" />
        </div>
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Overview</h2>
          <p className="text-xs text-muted-foreground">
            Today's workload at a glance.
          </p>
        </div>
        {loading && <Loader2 className="ml-2 h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Orders due today */}
        <Link to="/orders" className="block">
          <Card className="h-full transition-colors hover:border-primary/60 hover:bg-accent/40">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Package className="h-5 w-5" />
                </div>
                {overdue > 0 && (
                  <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive">
                    <AlertTriangle className="mr-1 h-3 w-3" />
                    {overdue} overdue
                  </Badge>
                )}
              </div>
              <CardTitle className="mt-3">Orders due today</CardTitle>
              <CardDescription>Open orders received on or before today.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-baseline gap-2">
                <div className="text-4xl font-semibold tabular-nums">{dueToday}</div>
                <div className="text-xs text-muted-foreground">
                  of {orders.length} open
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>

        {/* Order age */}
        <Card className="h-full">
          <CardHeader>
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Clock className="h-5 w-5" />
            </div>
            <CardTitle className="mt-3">Order age</CardTitle>
            <CardDescription>How long open orders have been waiting.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5">
              {(["fresh", "today", "stale", "critical"] as const).map((k) => {
                const meta = bucketMeta[k];
                const n = buckets[k];
                const pct = orders.length ? Math.round((n / orders.length) * 100) : 0;
                return (
                  <li key={k} className="flex items-center gap-3">
                    <Badge variant="outline" className={"w-20 justify-center " + meta.className}>
                      {meta.label}
                    </Badge>
                    <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className={
                          "h-full " +
                          (k === "fresh"
                            ? "bg-emerald-500"
                            : k === "today"
                              ? "bg-amber-500"
                              : k === "stale"
                                ? "bg-orange-500"
                                : "bg-destructive")
                        }
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="w-10 text-right text-sm tabular-nums">{n}</div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>

        {/* ASN calendar */}
        <Link to="/asns" className="block">
          <Card className="h-full transition-colors hover:border-primary/60 hover:bg-accent/40">
            <CardHeader>
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Truck className="h-5 w-5" />
              </div>
              <CardTitle className="mt-3">Inbound ASNs · next 7 days</CardTitle>
              <CardDescription>Expected supplier deliveries.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-7 gap-1">
                {asnsByDay.map(({ date, items }) => {
                  const isToday = date.getTime() === today.getTime();
                  const qty = items.reduce((s, a) => s + (a.TotalQuantity ?? 0), 0);
                  return (
                    <div
                      key={date.toISOString()}
                      className={
                        "rounded-md border p-1.5 text-center " +
                        (isToday ? "border-primary/50 bg-primary/5" : "border-border")
                      }
                    >
                      <div className="text-[10px] uppercase text-muted-foreground">
                        {date.toLocaleDateString(undefined, { weekday: "short" })}
                      </div>
                      <div className="text-sm font-medium">{date.getDate()}</div>
                      <div className="mt-0.5 text-xs tabular-nums">
                        {items.length > 0 ? (
                          <span className="font-semibold text-primary">{items.length}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </div>
                      {qty > 0 && (
                        <div className="text-[10px] text-muted-foreground tabular-nums">
                          {qty} u
                        </div>
                      )}
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