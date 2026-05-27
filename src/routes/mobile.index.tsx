import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ShoppingBag,
  ClipboardList,
  Truck,
  ArrowLeftRight,
  PackagePlus,
  BookOpen,
  ChevronRight,
  Loader2,
} from "lucide-react";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { listASNs, type MintsoftASN } from "@/lib/mintsoft";
import { loadSettings } from "@/lib/storage";

export const Route = createFileRoute("/mobile/")({
  component: MobileHome,
});

type Tile = {
  label: string;
  icon: ReactNode;
  to?: string;
};

function MobileHome() {
  const sections: { title: string; tiles: Tile[] }[] = [
    {
      title: "Picking",
      tiles: [
        { label: "Order Picking", icon: <ShoppingBag className="h-6 w-6" /> },
        { label: "View Orders", icon: <ClipboardList className="h-6 w-6" /> },
      ],
    },
    {
      title: "Inventory Management",
      tiles: [
        { label: "ASNs", icon: <Truck className="h-6 w-6" />, to: "/mobile/stock/asns" },
        { label: "Transfer Inventory", icon: <ArrowLeftRight className="h-6 w-6" />, to: "/mobile/stock/transfer" },
        { label: "Bulk Transfer Inventory", icon: <PackagePlus className="h-6 w-6" /> },
        { label: "Book Inventory", icon: <BookOpen className="h-6 w-6" /> },
      ],
    },
  ];

  const asnsQuery = useQuery({
    queryKey: ["mobile-asns"],
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

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayMs = 86_400_000;

  const dayLabels = ["Today", "Tomorrow"];
  const dayCards = [0, 1].map((offset) => {
    const d = new Date(today.getTime() + offset * dayMs);
    const dStr = d.toDateString();
    const label = dayLabels[offset];
    const asns = (asnsQuery.data ?? []).filter((a) => {
      if (!a.ExpectedDate) return false;
      const ed = new Date(a.ExpectedDate);
      ed.setHours(0, 0, 0, 0);
      return ed.toDateString() === dStr;
    });
    return { date: d, label, asns };
  });

  return (
    <div className="px-4 py-4 space-y-5">
      {sections.map((s) => (
        <section key={s.title}>
          <h2 className="mb-2 text-sm font-semibold">{s.title}</h2>
          <div className="grid grid-cols-3 gap-3">
            {s.tiles.map((t) => (
              <TileCard key={t.label} tile={t} />
            ))}
          </div>
        </section>
      ))}

      <section>
        <h2 className="mb-2 text-sm font-semibold">ASNs Due</h2>
        {asnsQuery.isLoading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading ASNs…
          </div>
        ) : asnsQuery.error ? (
          <div className="py-6 text-center text-sm text-destructive">
            {asnsQuery.error instanceof Error
              ? asnsQuery.error.message
              : "Failed to load ASNs"}
          </div>
        ) : (
          <div className="space-y-3">
            {dayCards.map(({ date, label, asns }) => (
              <div
                key={date.toDateString()}
                className="rounded-xl border bg-card p-3"
              >
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="text-sm font-medium">{label}</p>
                    <p className="text-xs text-muted-foreground">
                      {date.toLocaleDateString(undefined, {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                      })}
                    </p>
                  </div>
                  <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                    {asns.length} ASN{asns.length === 1 ? "" : "s"}
                  </span>
                </div>
                {asns.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-1">
                    No ASNs due
                  </p>
                ) : (
                  <div className="space-y-1">
                    {asns.slice(0, 3).map((a) => (
                      <Link
                        key={a.ID}
                        to="/asns/$asnId"
                        params={{ asnId: String(a.ID) }}
                        className="flex items-center gap-2 rounded-lg p-2 hover:bg-muted/60 transition-colors"
                      >
                        <Truck className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium truncate">
                            {a.Reference || `#${a.ID}`}
                          </p>
                          <p className="text-[11px] text-muted-foreground truncate">
                            {a.SupplierName || "—"}
                          </p>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                      </Link>
                    ))}
                    {asns.length > 3 && (
                      <p className="text-xs text-muted-foreground text-center py-1">
                        +{asns.length - 3} more
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function TileCard({ tile }: { tile: Tile }) {
  const inner = (
    <div className="flex flex-col items-center justify-center text-center gap-2 rounded-xl border bg-card aspect-square p-2 active:bg-muted/60">
      <div className="text-primary">{tile.icon}</div>
      <span className="text-[11px] leading-tight font-medium">{tile.label}</span>
    </div>
  );
  return tile.to ? <Link to={tile.to}>{inner}</Link> : inner;
}
