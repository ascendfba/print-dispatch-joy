import { Link, Outlet, useLocation, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Package, Settings as SettingsIcon, Truck, LogOut, LayoutGrid, Boxes } from "lucide-react";
import { isElectron } from "@/lib/printing";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import ascendLogo from "@/assets/ascend-fba-logo.png";
import ascendLogoDark from "@/assets/ascend-fba-logo-dark.png";
import { deviceTrust } from "@/lib/device-trust";

export function AppLayout() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setEmail(data.session?.user.email ?? null));
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_e, session) => {
      setEmail(session?.user.email ?? null);
      router.invalidate();
      queryClient.invalidateQueries();
    });
    return () => subscription.unsubscribe();
  }, [router, queryClient]);

  async function signOut() {
    if (email && deviceTrust.findByEmail(email)) {
      deviceTrust.lock(email);
      queryClient.clear();
      navigate({ to: "/login" });
      return;
    }
    await supabase.auth.signOut({ scope: "local" });
    navigate({ to: "/login" });
  }

  const tabs = [
    { to: "/", label: "Hub", icon: LayoutGrid, exact: true },
    { to: "/orders", label: "Orders", icon: Package },
    { to: "/asns", label: "ASNs", icon: Truck },
    { to: "/stock", label: "Stock", icon: Boxes },
    { to: "/settings", label: "Settings", icon: SettingsIcon },
  ];
  const authRoutes = ["/login", "/signup", "/forgot-password", "/reset-password"];
  const isAuthRoute = authRoutes.some((r) => pathname === r || pathname.startsWith(r + "/"));
  if (isAuthRoute) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <Outlet />
        <Toaster richColors position="top-right" />
      </div>
    );
  }
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-6 py-3">
          <Link to="/" className="flex items-center gap-2">
            <img src={ascendLogo} alt="Ascend FBA" className="h-7 w-auto block dark:hidden" />
            <img src={ascendLogoDark} alt="Ascend FBA" className="h-7 w-auto hidden dark:block" />
          </Link>
          <nav className="flex items-center gap-1">
            {tabs.map((t) => {
              const active = t.exact ? pathname === t.to : pathname.startsWith(t.to);
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
          <div className="flex items-center gap-3">
            <div className="text-xs text-muted-foreground">
              {email ?? (isElectron() ? "Desktop mode" : "Browser preview")}
            </div>
            {email && (
              <Button variant="ghost" size="sm" onClick={signOut}>
                <LogOut className="mr-1 h-4 w-4" /> Sign out
              </Button>
            )}
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
