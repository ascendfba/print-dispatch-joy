import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";

export const Route = createFileRoute("/mobile/")({
  component: MobileHome,
});

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function MobileHome() {
  const days = useMemo(() => {
    const today = startOfDay(new Date());
    return [0, 1, 2].map((offset) => {
      const d = new Date(today);
      d.setDate(today.getDate() + offset);
      return d;
    });
  }, []);

  return (
    <div className="flex-1 flex flex-col">
      <div className="flex-1 px-4 py-4 space-y-3 overflow-y-auto">
        <h2 className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          ASN Calendar · Next 3 days
        </h2>
        {days.map((d) => {
          const label = d.toLocaleDateString(undefined, {
            weekday: "short",
            day: "2-digit",
            month: "short",
          });
          return (
            <div key={d.toISOString()} className="rounded-2xl border bg-card overflow-hidden">
              <div className="px-4 py-2 bg-muted/40 flex items-center justify-between">
                <span className="text-sm font-medium">{label}</span>
                <span className="text-xs text-muted-foreground">0 ASNs</span>
              </div>
              <div className="px-4 py-4 text-xs text-muted-foreground">No ASNs</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}