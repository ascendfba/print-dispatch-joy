import { createFileRoute, Link } from "@tanstack/react-router";
import { requireAuth } from "@/lib/require-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Boxes, Truck, Users, ExternalLink } from "lucide-react";

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
};

const tiles: Tile[] = [
  {
    key: "crm",
    title: "CRM",
    description: "Customer relationships and accounts.",
    icon: Users,
    comingSoon: true,
  },
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
    description: "Open Mintsoft in a new tab.",
    icon: Truck,
    href: "https://om.mintsoft.co.uk/",
  },
];

function HubPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Warehouse hub</h1>
        <p className="text-sm text-muted-foreground">Choose an app to get started.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((t) => {
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
              <CardContent />
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
    </div>
  );
}
