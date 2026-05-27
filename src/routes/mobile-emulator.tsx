import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { requireAuth } from "@/lib/require-auth";
import { Button } from "@/components/ui/button";
import { ArrowLeft, RotateCcw, RotateCw, ExternalLink } from "lucide-react";

export const Route = createFileRoute("/mobile-emulator")({
  beforeLoad: ({ location }) => requireAuth(location),
  component: MobileEmulatorPage,
});

const MOBILE_APP_URL = "/mobile";

const DEVICES = [
  { key: "iphone-15", label: "iPhone 15", width: 393, height: 852 },
  { key: "iphone-se", label: "iPhone SE", width: 375, height: 667 },
  { key: "pixel-7", label: "Pixel 7", width: 412, height: 915 },
  { key: "ipad-mini", label: "iPad mini", width: 744, height: 1133 },
] as const;

function MobileEmulatorPage() {
  const [deviceKey, setDeviceKey] = useState<(typeof DEVICES)[number]["key"]>("iphone-15");
  const [landscape, setLandscape] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const device = DEVICES.find((d) => d.key === deviceKey)!;
  const width = landscape ? device.height : device.width;
  const height = landscape ? device.width : device.height;

  return (
    <div className="min-h-screen bg-muted/30 flex flex-col">
      <header className="border-b bg-background px-4 py-3 flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link to="/">
            <ArrowLeft className="h-4 w-4 mr-1" /> Hub
          </Link>
        </Button>
        <div className="flex items-center gap-1">
          {DEVICES.map((d) => (
            <Button
              key={d.key}
              size="sm"
              variant={d.key === deviceKey ? "default" : "outline"}
              onClick={() => setDeviceKey(d.key)}
            >
              {d.label}
            </Button>
          ))}
        </div>
        <Button size="sm" variant="outline" onClick={() => setLandscape((v) => !v)}>
          {landscape ? <RotateCcw className="h-4 w-4 mr-1" /> : <RotateCw className="h-4 w-4 mr-1" />}
          {landscape ? "Portrait" : "Landscape"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setReloadKey((k) => k + 1)}>
          Reload
        </Button>
        <div className="ml-auto text-xs text-muted-foreground flex items-center gap-2">
          <span>{width} × {height}</span>
          <a
            href={MOBILE_APP_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 hover:text-foreground"
          >
            Open in new tab <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </header>

      <div className="flex-1 flex items-center justify-center p-6 overflow-auto">
        <div
          className="relative bg-black rounded-[2.5rem] shadow-2xl p-3"
          style={{ width: width + 24, height: height + 24 }}
        >
          <div className="absolute top-3 left-1/2 -translate-x-1/2 w-24 h-6 bg-black rounded-b-2xl z-10" />
          <iframe
            key={reloadKey}
            src={MOBILE_APP_URL}
            title="Mobile App Emulator"
            className="w-full h-full rounded-[2rem] bg-white"
            style={{ width, height }}
            allow="camera; microphone; geolocation; clipboard-read; clipboard-write"
          />
        </div>
      </div>
    </div>
  );
}