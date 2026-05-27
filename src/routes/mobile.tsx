import { createFileRoute, Outlet, Link, useLocation } from "@tanstack/react-router";
import { Menu, Home, MapPin, Search, Warehouse } from "lucide-react";
import ascendLogo from "@/assets/ascend-fba-logo.png";

export const Route = createFileRoute("/mobile")({
  component: MobileShell,
});

function MobileShell() {
  const { pathname } = useLocation();
  const isActive = (p: string) =>
    p === "/mobile" ? pathname === "/mobile" : pathname.startsWith(p);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Top bar */}
      <header className="shrink-0 border-b bg-gradient-to-r from-amber-500 to-orange-500 pt-[env(safe-area-inset-top)]">
        <div className="flex items-center justify-between px-4 h-14">
          <button className="p-1 -ml-1 text-white/90">
            <Menu className="h-5 w-5" />
          </button>
          <img
            src={ascendLogo}
            alt="Ascend FBA"
            className="h-7 object-contain"
          />
          <div className="w-7" />
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>

      {/* Bottom nav */}
      <nav className="shrink-0 border-t bg-card">
        <div className="grid grid-cols-3">
          <BottomItem to="/mobile/locations" label="Location Contents" icon={<MapPin className="h-5 w-5" />} active={isActive("/mobile/locations")} />
          <BottomItem to="/mobile" label="Home" icon={<Home className="h-5 w-5" />} active={pathname === "/mobile"} />
          <BottomItem to="/mobile/search" label="Product Search" icon={<Search className="h-5 w-5" />} active={isActive("/mobile/search")} />
        </div>
      </nav>
    </div>
  );
}

function BottomItem({
  to,
  label,
  icon,
  active,
}: {
  to: string;
  label: string;
  icon: React.ReactNode;
  active: boolean;
}) {
  return (
    <Link
      to={to}
      className={`flex flex-col items-center justify-center gap-1 py-2 text-[11px] ${
        active ? "text-amber-600 font-medium" : "text-muted-foreground"
      }`}
    >
      {icon}
      <span>{label}</span>
    </Link>
  );
}
