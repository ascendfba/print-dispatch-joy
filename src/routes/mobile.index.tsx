import { createFileRoute, Link } from "@tanstack/react-router";
import { Package, ArrowLeftRight, MapPin, ChevronRight } from "lucide-react";

export const Route = createFileRoute("/mobile/")({
  component: MobileHome,
});

type Item = {
  title: string;
  to: string;
  icon: typeof Package;
  description: string;
};

type Section = {
  title: string;
  items: Item[];
};

const sections: Section[] = [
  {
    title: "Stock",
    items: [
      { title: "ASNs", to: "/mobile/stock/asns", icon: Package, description: "Receive inbound shipments" },
      { title: "Transfer Inventory", to: "/mobile/stock/transfer", icon: ArrowLeftRight, description: "Move stock between locations" },
      { title: "Location Contents", to: "/mobile/stock/locations", icon: MapPin, description: "Check what's in a location" },
    ],
  },
];

function MobileHome() {
  return (
    <div className="flex-1 flex flex-col">
      <header className="px-5 pt-6 pb-4 border-b">
        <h1 className="text-2xl font-semibold tracking-tight">Warehouse</h1>
        <p className="text-sm text-muted-foreground mt-1">Choose an action</p>
      </header>

      <div className="flex-1 px-4 py-5 space-y-6 overflow-y-auto">
        {sections.map((section) => (
          <section key={section.title}>
            <h2 className="px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              {section.title}
            </h2>
            <div className="rounded-2xl border bg-card divide-y overflow-hidden">
              {section.items.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    className="flex items-center gap-3 px-4 py-4 active:bg-muted/60 transition-colors"
                  >
                    <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm">{item.title}</div>
                      <div className="text-xs text-muted-foreground truncate">{item.description}</div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}