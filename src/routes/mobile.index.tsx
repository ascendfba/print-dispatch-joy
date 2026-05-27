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
  iconColor: string;
  bgColor: string;
  to?: string;
};

function MobileHome() {
  const sections: { title: string; accentColor: string; tiles: Tile[] }[] = [
    {
      title: "Picking",
      accentColor: "bg-[#0099d4]",
      tiles: [
        { label: "Order Picking", icon: <ShoppingBag className="h-6 w-6" />, iconColor: "text-[#0099d4]", bgColor: "bg-[#0099d4]/10" },
        { label: "View Orders", icon: <ClipboardList className="h-6 w-6" />, iconColor: "text-[#0a2e3d]", bgColor: "bg-[#0a2e3d]/10" },
      ],
    },
    {
      title: "Inventory Management",
      accentColor: "bg-[#0099d4]",
      tiles: [
        { label: "ASNs", icon: <Truck className="h-6 w-6" />, iconColor: "text-[#0099d4]", bgColor: "bg-[#0099d4]/10", to: "/mobile/stock/asns" },
        { label: "Transfer Inventory", icon: <ArrowLeftRight className="h-6 w-6" />, iconColor: "text-[#0a2e3d]", bgColor: "bg-[#0a2e3d]/10", to: "/mobile/stock/transfer" },
        { label: "Bulk Transfer Inventory", icon: <PackagePlus className="h-6 w-6" />, iconColor: "text-[#0099d4]", bgColor: "bg-[#0099d4]/10" },
        { label: "Book Inventory", icon: <BookOpen className="h-6 w-6" />, iconColor: "text-[#0a2e3d]", bgColor: "bg-[#0a2e3d]/10" },
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
  const dayBorderColors = ["border-l-[#0099d4]", "border-l-[#0a2e3d]"];
  const dayBadgeColors = ["bg-[#0099d4]/10 text-[#0099d4]", "bg-[#0a2e3d]/10 text-[#0a2e3d]"];

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
    return { date: d, label, asns, borderColor: dayBorderColors[offset], badgeColor: dayBadgeColors[offset] };
  });

  return (
    <div className="px-4 py-4 space-y-5">
      {sections.map((s) => (
        <section key={s.title}>
          <div className="flex items-center gap-2 mb-2">
            <div className={`h-4 w-1 rounded-full ${s.accentColor}`} />
            <h2 className="text-sm font-semibold">{s.title}</h2>
          </div>
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
      <div className={`rounded-xl p-2.5 ${tile.bgColor}`}>
        <div className={tile.iconColor}>{tile.icon}</div>
      </div>
      <span className="text-[11px] leading-tight font-medium">{tile.label}</span>
    </div>
  );
  return tile.to ? <Link to={tile.to}>{inner}</Link> : inner;
}
