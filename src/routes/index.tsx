import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { requireAuth } from "@/lib/require-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Boxes,
  Truck,
  Users,
  ExternalLink,
  Warehouse,
  ShoppingCart,
  Code2,
  BarChart3,
  Globe,
  Megaphone,
  CalendarClock,
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
      },
      {
        key: "mintsoft",
        title: "Mintsoft",
        description: "Open Mintsoft WMS in a new tab.",
        icon: Truck,
        href: "https://om.mintsoft.co.uk/",
      },
      {
        key: "ups-collection",
        title: "Schedule UPS Collection",
        description: "Book a UPS pickup on ups.com.",
        icon: CalendarClock,
        href: "https://www.ups.com/pickup/schedule",
        extra: <UpsDeadlineTimer />,
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
        key: "crm",
        title: "CRM",
        description: "Customer relationships and accounts.",
        icon: Users,
        comingSoon: true,
      },
      {
        key: "reports",
        title: "Sales Reports",
        description: "Revenue, conversion and trends.",
        icon: BarChart3,
        comingSoon: true,
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
      },
      {
        key: "marketing",
        title: "Marketing",
        description: "Campaigns, SEO and content.",
        icon: Megaphone,
        comingSoon: true,
      },
    ],
  },
];

function HubPage() {
  return <HubPageInner />;
}

function HubPageInner() {
  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Warehouse hub</h1>
        <p className="text-sm text-muted-foreground">
          Your operational dashboard. Choose an app to get started.
        </p>
      </div>
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
                const inner = (
            <Card
              className={
                "h-full transition-colors " +
                (t.comingSoon
                  ? "opacity-60"
                  : "hover:border-primary/60 hover:bg-accent/40 cursor-pointer")
              }
            >
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
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
