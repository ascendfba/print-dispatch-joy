import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ShoppingBag,
  Layers,
  Package,
  Truck,
  ArrowLeftRight,
  PackagePlus,
  BookOpen,
  Boxes,
} from "lucide-react";
import type { ReactNode } from "react";

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
        { label: "Batch Picking", icon: <Layers className="h-6 w-6" /> },
        { label: "Carton / Pallet Picking", icon: <Package className="h-6 w-6" /> },
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
    {
      title: "Carton/Pallet Management",
      tiles: [
        { label: "Cartons", icon: <Boxes className="h-6 w-6" /> },
      ],
    },
  ];

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