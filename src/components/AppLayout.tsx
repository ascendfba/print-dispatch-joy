import { Link, Outlet, useLocation } from "@tanstack/react-router";
import { Package, Settings as SettingsIcon, Truck } from "lucide-react";
import { isElectron } from "@/lib/printing";
import { Toaster } from "@/components/ui/sonner";
import ascendLogo from "@/assets/ascend-fba-logo.png";

export function AppLayout() {
  const { pathname } = useLocation();
  const tabs = [
    { to: "/orders", label: "Orders", icon: Package },
    { to: "/asns", label: "ASNs", icon: Truck },
    { to: "/settings", label: "Settings", icon: SettingsIcon },
  ];
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-6 py-3">
          <Link to="/orders" className="flex items-center gap-2">
            <img
              src={ascendLogo}
              alt="Ascend FBA"
              className="h-7 w-auto"
            />
          </Link>
          <nav className="flex items-center gap-1">
            {tabs.map((t) => {
              const active = pathname.startsWith(t.to);
              const Icon = t.icon;
              return (
                <Link
                  key={t.to}
                  to={t.to}
                  className={
                    "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors " +
                    (active
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground")
                  }
                >
                  <Icon className="h-4 w-4" />
                  {t.label}
                </Link>
              );
            })}
          </nav>
          <div className="text-xs text-muted-foreground">
            {isElectron() ? "Desktop mode" : "Browser preview"}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-6">
        <Outlet />
      </main>
      <Toaster richColors position="top-right" />
    </div>
  );
}