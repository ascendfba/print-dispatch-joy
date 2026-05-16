import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { requireAuth } from "@/lib/require-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Plus, Trash2, Code2, Eye, ArrowLeft, ExternalLink, Save } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/development")({
  beforeLoad: ({ location }) => requireAuth(location),
  component: DevelopmentPage,
});

type DevApp = {
  id: string;
  name: string;
  html: string;
  updatedAt: number;
};

const STORAGE_KEY = "dev-apps:v1";

const STARTER_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>New app</title>
    <style>
      body { font-family: system-ui, sans-serif; padding: 2rem; }
      h1 { color: #6366f1; }
    </style>
  </head>
  <body>
    <h1>Hello from your new app</h1>
    <p>Edit the HTML to build something useful.</p>
  </body>
</html>`;

function loadApps(): DevApp[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as DevApp[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveApps(apps: DevApp[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(apps));
}

function DevelopmentPage() {
  const [apps, setApps] = useState<DevApp[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    setApps(loadApps());
  }, []);

  const activeApp = useMemo(
    () => apps.find((a) => a.id === activeId) ?? null,
    [apps, activeId],
  );

  function createApp() {
    const app: DevApp = {
      id: crypto.randomUUID(),
      name: `App ${apps.length + 1}`,
      html: STARTER_HTML,
      updatedAt: Date.now(),
    };
    const next = [app, ...apps];
    setApps(next);
    saveApps(next);
    setActiveId(app.id);
  }

  function updateApp(id: string, patch: Partial<DevApp>) {
    const next = apps.map((a) =>
      a.id === id ? { ...a, ...patch, updatedAt: Date.now() } : a,
    );
    setApps(next);
    saveApps(next);
  }

  function deleteApp(id: string) {
    if (!confirm("Delete this app? This can't be undone.")) return;
    const next = apps.filter((a) => a.id !== id);
    setApps(next);
    saveApps(next);
    if (activeId === id) setActiveId(null);
    toast.success("App deleted");
  }

  if (activeApp) {
    return (
      <AppEditor
        app={activeApp}
        onBack={() => setActiveId(null)}
        onChange={(patch) => updateApp(activeApp.id, patch)}
        onDelete={() => deleteApp(activeApp.id)}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Link to="/" className="hover:text-foreground">Hub</Link>
            <span>/</span>
            <span>Development</span>
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Development</h1>
          <p className="text-sm text-muted-foreground">
            Build and preview small HTML apps. Stored locally in your browser.
          </p>
        </div>
        <Button onClick={createApp}>
          <Plus className="mr-1 h-4 w-4" /> New app
        </Button>
      </div>

      {apps.length === 0 ? (
        <Card className="flex flex-col items-center justify-center gap-3 border-dashed py-16 text-center">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Code2 className="h-6 w-6" />
          </div>
          <div>
            <p className="font-medium">No apps yet</p>
            <p className="text-sm text-muted-foreground">
              Create your first mini HTML app to get started.
            </p>
          </div>
          <Button onClick={createApp}>
            <Plus className="mr-1 h-4 w-4" /> New app
          </Button>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {apps.map((app) => (
            <Card
              key={app.id}
              className="group flex h-full cursor-pointer flex-col overflow-hidden transition-colors hover:border-primary/60"
              onClick={() => setActiveId(app.id)}
            >
              <div className="aspect-video w-full overflow-hidden border-b bg-muted">
                <iframe
                  title={app.name}
                  srcDoc={app.html}
                  sandbox=""
                  className="pointer-events-none h-full w-full origin-top-left scale-100"
                />
              </div>
              <div className="flex items-center justify-between gap-2 p-4">
                <div className="min-w-0">
                  <p className="truncate font-medium">{app.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Updated {new Date(app.updatedAt).toLocaleString("en-GB")}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteApp(app.id);
                  }}
                  aria-label="Delete app"
                >
                  <Trash2 className="h-4 w-4 text-muted-foreground" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function AppEditor({
  app,
  onBack,
  onChange,
  onDelete,
}: {
  app: DevApp;
  onBack: () => void;
  onChange: (patch: Partial<DevApp>) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(app.name);
  const [html, setHtml] = useState(app.html);
  const [tab, setTab] = useState<"code" | "preview">("code");
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    setName(app.name);
    setHtml(app.html);
  }, [app.id]);

  const dirty = name !== app.name || html !== app.html;

  function save() {
    onChange({ name: name.trim() || "Untitled", html });
    toast.success("Saved");
  }

  function openInNewTab() {
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="mr-1 h-4 w-4" /> Back
          </Button>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-9 w-64 font-medium"
            placeholder="App name"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={openInNewTab}>
            <ExternalLink className="mr-1 h-4 w-4" /> Open
          </Button>
          <Button variant="ghost" size="sm" onClick={onDelete}>
            <Trash2 className="mr-1 h-4 w-4" /> Delete
          </Button>
          <Button size="sm" onClick={save} disabled={!dirty}>
            <Save className="mr-1 h-4 w-4" /> Save
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "code" | "preview")}>
        <TabsList>
          <TabsTrigger value="code">
            <Code2 className="mr-1 h-4 w-4" /> Code
          </TabsTrigger>
          <TabsTrigger value="preview">
            <Eye className="mr-1 h-4 w-4" /> Preview
          </TabsTrigger>
        </TabsList>
        <TabsContent value="code">
          <textarea
            value={html}
            onChange={(e) => setHtml(e.target.value)}
            spellCheck={false}
            className="h-[60vh] w-full resize-none rounded-md border border-border bg-card p-4 font-mono text-xs text-foreground outline-none focus:ring-2 focus:ring-ring"
          />
        </TabsContent>
        <TabsContent value="preview">
          <div className="h-[60vh] w-full overflow-hidden rounded-md border border-border bg-white">
            <iframe
              ref={iframeRef}
              title={name}
              srcDoc={html}
              sandbox="allow-scripts allow-forms allow-modals allow-popups"
              className="h-full w-full"
            />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}