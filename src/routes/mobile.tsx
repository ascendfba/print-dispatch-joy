import { createFileRoute, Outlet, Link, useLocation } from "@tanstack/react-router";
import { Menu, Home, MapPinned, ScanBarcode } from "lucide-react";
import ascendLogo from "@/assets/ascend-fba-logo.png";

export const Route = createFileRoute("/mobile")({
  component: MobileShell,
});

function MobileShell() {
  const { pathname } = useLocation();
  const isActive = (p: string) =>
    p === "/mobile" ? pathname === "/mobile" : pathname.startsWith(p);

  return (
    <div className="h-[100dvh] bg-background text-foreground flex flex-col overflow-hidden">
      {/* Top bar */}
      <header className="shrink-0 border-b bg-gradient-to-r from-[#0a2e3d] via-[#0d3a4d] to-[#0a2e3d] pt-[env(safe-area-inset-top)]">
        <div className="flex items-center justify-between px-4 h-14">
          <button className="p-1 -ml-1 text-white/90">
            <Menu className="h-5 w-5" />
          </button>
          <img
            src={ascendLogo}
            alt="Ascend FBA"
            className="h-7 object-contain brightness-0 invert"
          />
          <div className="w-7" />
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto min-h-0">
        <Outlet />
      </main>

      {/* Bottom nav */}
      <nav className="shrink-0 border-t bg-card pb-[env(safe-area-inset-bottom)]">
        <div className="grid grid-cols-3">
          <BottomItem to="/mobile/locations" label="Locations" icon={<MapPinned className="h-7 w-7" strokeWidth={2.25} />} active={isActive("/mobile/locations")} />
          <BottomItem to="/mobile" label="Home" icon={<Home className="h-7 w-7" strokeWidth={2.25} />} active={pathname === "/mobile"} />
          <BottomItem to="/mobile/search" label="Search" icon={<ScanBarcode className="h-7 w-7" strokeWidth={2.25} />} active={isActive("/mobile/search")} />
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
      className={`flex flex-col items-center justify-center gap-1 py-3 text-xs font-medium active:bg-muted/60 transition-colors ${
        active ? "text-[#0099d4]" : "text-muted-foreground"
      }`}
    >
      {icon}
      <span>{label}</span>
    </Link>
  );
}
