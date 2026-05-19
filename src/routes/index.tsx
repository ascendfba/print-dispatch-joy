import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { requireAuth } from "@/lib/require-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { HubOverview } from "@/components/HubOverview";
import {
  Boxes,
  Truck,
  ExternalLink,
  Warehouse,
  ShoppingCart,
  Code2,
  BarChart3,
  Globe,
  CalendarClock,
  FileSignature,
  Contact2,
  Target,
  FolderCode,
  Wallet,
  Receipt,
  Monitor,
} from "lucide-react";

export const Route = createFileRoute("/")({
  beforeLoad: ({ location }) => requireAuth(location),
  component: HubPage,
});

type Tile = {
  key: string;
  title: string;
  description: string;
  icon: typeof Boxes;
  to?: string;
  href?: string;
  comingSoon?: boolean;
  extra?: React.ReactNode;
  /** simple-icons slug for brand logo, e.g. "hubspot" */
  logoSlug?: string;
  /** hex without # — used for logo tint and tile accent */
  brandColor?: string;
};

type Section = {
  key: string;
  title: string;
  icon: typeof Boxes;
  description: string;
  tiles: Tile[];
};

const sections: Section[] = [
  {
    key: "warehouse",
    title: "Warehouse",
    icon: Warehouse,
    description: "Operations, fulfilment and stock.",
    tiles: [
      {
        key: "control-dock",
        title: "Control Dock",
        description: "Order splitting, ASNs, printing and rework charges.",
        icon: Boxes,
        to: "/orders",
        brandColor: "6366f1",
      },
      {
        key: "mintsoft",
        title: "Mintsoft",
        description: "Open Mintsoft WMS in a new tab.",
        icon: Truck,
        href: "https://om.mintsoft.co.uk/",
        brandColor: "0ea5e9",
      },
      {
        key: "ups-collection",
        title: "Schedule UPS Collection",
        description: "Book a UPS pickup on ups.com.",
        icon: CalendarClock,
        href: "https://www.ups.com/pickup/schedule",
        extra: <UpsDeadlineTimer />,
        logoSlug: "ups",
        brandColor: "521801",
      },
    ],
  },
  {
    key: "sales",
    title: "Sales",
    icon: ShoppingCart,
    description: "Pipeline, customers and revenue.",
    tiles: [
      {
        key: "pandadoc",
        title: "PandaDoc",
        description: "Proposals, quotes and e-signatures.",
        icon: FileSignature,
        href: "https://app.pandadoc.com/",
        logoSlug: "pandadoc",
        brandColor: "3a8718",
      },
      {
        key: "hubspot",
        title: "HubSpot",
        description: "CRM, contacts and deal pipeline.",
        icon: Contact2,
        href: "https://app.hubspot.com/",
        logoSlug: "hubspot",
        brandColor: "ff7a59",
      },
      {
        key: "google-ads",
        title: "Google Ads",
        description: "Campaigns, keywords and performance.",
        icon: Target,
        href: "https://ads.google.com/",
        logoSlug: "googleads",
        brandColor: "4285f4",
      },
      {
        key: "reports",
        title: "Sales Reports",
        description: "Revenue, conversion and trends.",
        icon: BarChart3,
        comingSoon: true,
        brandColor: "f59e0b",
      },
    ],
  },
  {
    key: "web",
    title: "Website Development",
    icon: Code2,
    description: "Public site and marketing tools.",
    tiles: [
      {
        key: "site",
        title: "ascendfba.co.uk",
        description: "Open the live marketing site.",
        icon: Globe,
        href: "https://ascendfba.co.uk/",
        brandColor: "10b981",
      },
      {
        key: "development",
        title: "Development",
        description: "Build and preview mini HTML apps.",
        icon: FolderCode,
        to: "/development",
        brandColor: "8b5cf6",
      },
    ],
  },
  {
    key: "finance",
    title: "Finance",
    icon: Wallet,
    description: "Invoicing, charges and accounting.",
    tiles: [
      {
        key: "invoice-merger",
        title: "Invoice Merger",
        description: "Combine Mintsoft invoice CSV with rework charges and order comments.",
        icon: Receipt,
        to: "/invoice-merger",
        brandColor: "059669",
      },
    ],
  },
];

function UpsDeadlineTimer() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const next = nextUpsDeadline(now);
  const diffMs = next.getTime() - now.getTime();
  const isPast = diffMs <= 0;
  const totalSec = Math.max(0, Math.floor(diffMs / 1000));
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;

  const urgent = !isPast && diffMs < 60 * 60 * 1000; // < 1h
  const label = days > 0 ? `${days}d ${hours}h ${minutes}m` : `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className={
        "rounded-md border px-3 py-2 text-xs " +
        (urgent
          ? "border-destructive/40 bg-destructive/10 text-destructive"
          : "border-border bg-muted/40 text-muted-foreground")
      }
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">Booking deadline</span>
        <span className="font-mono tabular-nums">{label}</span>
      </div>
      <div className="mt-0.5 text-[10px] opacity-80">
        Next cutoff: {next.toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" })}
      </div>
    </div>
  );
}

function nextUpsDeadline(from: Date): Date {
  const d = new Date(from);
  // Try today at 12:00; if past or weekend, roll forward to next weekday.
  d.setHours(12, 0, 0, 0);
  if (d.getTime() <= from.getTime()) {
    d.setDate(d.getDate() + 1);
    d.setHours(12, 0, 0, 0);
  }
  while (d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() + 1);
  }
  return d;
}

function HubPage() {
  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Warehouse hub</h1>
        <p className="text-sm text-muted-foreground">
          Your operational dashboard. Choose an app to get started.
        </p>
      </div>
      <HubOverview />
      {sections.map((section) => {
        const SectionIcon = section.icon;
        return (
          <section key={section.key} className="space-y-4">
            <div className="flex items-center gap-3 border-b border-border pb-2">
              <div className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
                <SectionIcon className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-lg font-semibold tracking-tight">{section.title}</h2>
                <p className="text-xs text-muted-foreground">{section.description}</p>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {section.tiles.map((t) => {
                const Icon = t.icon;
                const brand = t.brandColor ? `#${t.brandColor}` : undefined;
                const inner = (
            <Card
              style={
                brand
                  ? ({
                      borderTop: `3px solid ${brand}`,
                    } as React.CSSProperties)
                  : undefined
              }
              className={
                "h-full overflow-hidden transition-colors " +
                (t.comingSoon
                  ? "opacity-60"
                  : "hover:border-primary/60 hover:bg-accent/40 cursor-pointer")
              }
            >
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div
                    className="inline-flex h-10 w-10 items-center justify-center rounded-md"
                    style={
                      brand
                        ? { backgroundColor: `${brand}1a`, color: brand }
                        : undefined
                    }
                  >
                    {t.logoSlug ? (
                      <img
                        src={`https://cdn.simpleicons.org/${t.logoSlug}/${t.brandColor ?? "000"}`}
                        alt={`${t.title} logo`}
                        className="h-5 w-5"
                        loading="lazy"
                      />
                    ) : (
                      <Icon className="h-5 w-5" style={brand ? { color: brand } : undefined} />
                    )}
                  </div>
                  {t.comingSoon && <Badge variant="secondary">Coming soon</Badge>}
                  {t.href && <ExternalLink className="h-4 w-4 text-muted-foreground" />}
                </div>
                <CardTitle className="mt-3">{t.title}</CardTitle>
                <CardDescription>{t.description}</CardDescription>
              </CardHeader>
              <CardContent>{t.extra}</CardContent>
            </Card>
          );

                if (t.to) {
                  return (
                    <Link key={t.key} to={t.to} className="block">
                      {inner}
                    </Link>
                  );
                }
                if (t.href) {
                  return (
                    <a
                      key={t.key}
                      href={t.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block"
                    >
                      {inner}
                    </a>
                  );
                }
                return (
                  <div key={t.key} aria-disabled className="cursor-not-allowed">
                    {inner}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
