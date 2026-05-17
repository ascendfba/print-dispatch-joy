import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { requireAuth } from "@/lib/require-auth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Plus,
  Trash2,
  Code2,
  Eye,
  ArrowLeft,
  ExternalLink,
  Save,
  Upload,
  FileArchive,
  Globe,
  Copy,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { inlineZipSite } from "@/lib/inlineZipSite";

export const Route = createFileRoute("/development")({
  beforeLoad: ({ location }) => requireAuth(location),
  component: DevelopmentPage,
});

type DevApp = {
  id: string;
  name: string;
  slug: string;
  html: string;
  is_published: boolean;
  updated_at: string;
};

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

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "app";
}

async function uniqueSlug(base: string, excludeId?: string): Promise<string> {
  let slug = slugify(base);
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? slug : `${slug}-${i + 1}`;
    const q = supabase.from("dev_apps").select("id").eq("slug", candidate).limit(1);
    const { data } = await q;
    const taken = (data ?? []).some((r) => r.id !== excludeId);
    if (!taken) return candidate;
  }
  return `${slug}-${crypto.randomUUID().slice(0, 6)}`;
}

function DevelopmentPage() {
  const [apps, setApps] = useState<DevApp[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { data, error } = await supabase
      .from("dev_apps")
      .select("id, name, slug, html, is_published, updated_at")
      .order("updated_at", { ascending: false });
    if (error) {
      toast.error(error.message);
      return;
    }
    setApps((data ?? []) as DevApp[]);
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const activeApp = useMemo(
    () => apps.find((a) => a.id === activeId) ?? null,
    [apps, activeId],
  );

  async function createApp() {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) {
      toast.error("Not signed in");
      return;
    }
    const name = `App ${apps.length + 1}`;
    const slug = await uniqueSlug(name);
    const { data, error } = await supabase
      .from("dev_apps")
      .insert({
        user_id: u.user.id,
        name,
        slug,
        html: STARTER_HTML,
        is_published: false,
      })
      .select("id, name, slug, html, is_published, updated_at")
      .single();
    if (error || !data) {
      toast.error(error?.message ?? "Couldn't create app");
      return;
    }
    setApps([data as DevApp, ...apps]);
    setActiveId(data.id);
  }

  async function updateApp(id: string, patch: Partial<DevApp>) {
    const { data, error } = await supabase
      .from("dev_apps")
      .update(patch)
      .eq("id", id)
      .select("id, name, slug, html, is_published, updated_at")
      .single();
    if (error || !data) {
      toast.error(error?.message ?? "Save failed");
      return null;
    }
    setApps((prev) => prev.map((a) => (a.id === id ? (data as DevApp) : a)));
    return data as DevApp;
  }

  async function deleteApp(id: string) {
    if (!confirm("Delete this app? This can't be undone.")) return;
    const { error } = await supabase.from("dev_apps").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setApps((prev) => prev.filter((a) => a.id !== id));
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
            Build, preview, and publish small HTML apps. Stored in your account.
          </p>
        </div>
        <Button onClick={createApp}>
          <Plus className="mr-1 h-4 w-4" /> New app
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : apps.length === 0 ? (
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
              <div className="relative aspect-video w-full overflow-hidden border-b bg-muted">
                <iframe
                  title={app.name}
                  srcDoc={app.html}
                  sandbox=""
                  className="pointer-events-none h-full w-full"
                />
                {app.is_published && (
                  <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-emerald-500/90 px-2 py-0.5 text-[10px] font-medium text-white">
                    <Globe className="h-3 w-3" /> Live
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between gap-2 p-4">
                <div className="min-w-0">
                  <p className="truncate font-medium">{app.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    /{app.slug} · {new Date(app.updated_at).toLocaleString("en-GB")}
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
  onChange: (patch: Partial<DevApp>) => Promise<DevApp | null>;
  onDelete: () => void;
}) {
  const [name, setName] = useState(app.name);
  const [slug, setSlug] = useState(app.slug);
  const [html, setHtml] = useState(app.html);
  const [tab, setTab] = useState<"code" | "preview">("code");
  const [saving, setSaving] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setName(app.name);
    setSlug(app.slug);
    setHtml(app.html);
  }, [app.id]);

  const dirty =
    name !== app.name || slug !== app.slug || html !== app.html;

  const publicUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/d/${app.slug}`
      : `/d/${app.slug}`;

  async function save() {
    const cleanSlug = slugify(slug || name);
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(cleanSlug)) {
      toast.error("Invalid slug");
      return;
    }
    setSaving(true);
    const res = await onChange({
      name: name.trim() || "Untitled",
      slug: cleanSlug,
      html,
    });
    setSaving(false);
    if (res) {
      setSlug(res.slug);
      toast.success("Saved");
    }
  }

  async function togglePublish(next: boolean) {
    // Auto-save pending changes first so the live URL matches the editor.
    if (dirty) {
      const res = await onChange({
        name: name.trim() || "Untitled",
        slug: slugify(slug || name),
        html,
        is_published: next,
      });
      if (res) {
        setSlug(res.slug);
        toast.success(next ? "Published" : "Unpublished");
      }
      return;
    }
    const res = await onChange({ is_published: next });
    if (res) toast.success(next ? "Published" : "Unpublished");
  }

  function openInNewTab() {
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  async function copyPublicUrl() {
    try {
      await navigator.clipboard.writeText(publicUrl);
      toast.success("Public URL copied");
    } catch {
      toast.error("Couldn't copy");
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.error("File too large (max 2MB)");
      return;
    }
    try {
      const text = await file.text();
      setHtml(text);
      if (!name || name.startsWith("App ")) {
        const base = file.name.replace(/\.[^.]+$/, "");
        if (base) setName(base);
      }
      setTab("code");
      toast.success(`Loaded ${file.name}`);
    } catch {
      toast.error("Couldn't read file");
    }
  }

  async function handleZipUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error("ZIP too large (max 10MB)");
      return;
    }
    const t = toast.loading(`Unpacking ${file.name}…`);
    try {
      const { html: inlined, indexPath } = await inlineZipSite(file);
      const sizeMb = new Blob([inlined]).size / (1024 * 1024);
      if (sizeMb > 4) {
        toast.warning(
          `Bundled HTML is ${sizeMb.toFixed(1)}MB — save may be slow.`,
        );
      }
      setHtml(inlined);
      if (!name || name.startsWith("App ")) {
        const base = file.name.replace(/\.[^.]+$/, "");
        if (base) setName(base);
      }
      setTab("preview");
      toast.success(`Loaded site (entry: ${indexPath})`, { id: t });
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Couldn't read ZIP", { id: t });
    }
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
            className="h-9 w-56 font-medium"
            placeholder="App name"
          />
          <div className="flex items-center gap-1 text-sm text-muted-foreground">
            <span>/d/</span>
            <Input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              className="h-9 w-44 font-mono text-xs"
              placeholder="slug"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".html,.htm,.txt,.svg,text/html,text/plain,image/svg+xml"
            className="hidden"
            onChange={handleUpload}
          />
          <input
            ref={zipInputRef}
            type="file"
            accept=".zip,application/zip,application/x-zip-compressed"
            className="hidden"
            onChange={handleZipUpload}
          />
          <Button variant="ghost" size="sm" onClick={() => fileInputRef.current?.click()}>
            <Upload className="mr-1 h-4 w-4" /> Upload
          </Button>
          <Button variant="ghost" size="sm" onClick={() => zipInputRef.current?.click()}>
            <FileArchive className="mr-1 h-4 w-4" /> Upload ZIP
          </Button>
          <Button variant="ghost" size="sm" onClick={openInNewTab}>
            <ExternalLink className="mr-1 h-4 w-4" /> Open
          </Button>
          <Button variant="ghost" size="sm" onClick={onDelete}>
            <Trash2 className="mr-1 h-4 w-4" /> Delete
          </Button>
          <Button size="sm" onClick={save} disabled={!dirty || saving}>
            {saving ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-1 h-4 w-4" />
            )}
            Save
          </Button>
        </div>
      </div>

      <Card className="flex flex-wrap items-center justify-between gap-3 p-3">
        <div className="flex items-center gap-3">
          <Switch
            id="publish"
            checked={app.is_published}
            onCheckedChange={togglePublish}
          />
          <Label htmlFor="publish" className="cursor-pointer">
            {app.is_published ? "Published" : "Draft"}
          </Label>
          <span className="text-xs text-muted-foreground">
            {app.is_published
              ? "Anyone with the link can view this app."
              : "Only you can see this app."}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Input
            readOnly
            value={publicUrl}
            className="h-9 w-[28rem] max-w-full font-mono text-xs"
          />
          <Button variant="outline" size="sm" onClick={copyPublicUrl}>
            <Copy className="mr-1 h-4 w-4" /> Copy
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.open(publicUrl, "_blank", "noopener,noreferrer")}
            disabled={!app.is_published}
          >
            <ExternalLink className="mr-1 h-4 w-4" /> Visit
          </Button>
        </div>
      </Card>

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
