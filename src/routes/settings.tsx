import { requireAuth } from "@/lib/require-auth";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  defaultSettings,
  loadSettings,
  saveSettings,
  tokenStore,
  type Settings,
  type ReworkRates,
} from "@/lib/storage";
import { isElectron, listInstalledPrinters } from "@/lib/printing";
import { login, listClients, type MintsoftClient } from "@/lib/mintsoft";
import { REWORK_CATALOG, DEFAULT_CLIENT_KEY, ratesToCsv, csvToRates } from "@/lib/rework";
import { listPricing, savePricing } from "@/lib/pricing.functions";
import {
  checkUserSettings,
  loadUserSettings,
  saveUserSettings,
} from "@/lib/user-settings.functions";
import { useServerFn } from "@tanstack/react-start";
import { TwoFactorCard } from "@/components/TwoFactorCard";
import { TrustedDeviceCard } from "@/components/TrustedDeviceCard";
import { QuickPrintCard } from "@/components/QuickPrintCard";
import { PrintHistoryCard } from "@/components/PrintHistoryCard";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RefreshCw, Save, Plug, Download, Upload, ShieldCheck } from "lucide-react";
import JSZip from "jszip";
import agentSource from "../../local-print-agent/agent.cjs?raw";
import agentReadme from "../../local-print-agent/README.md?raw";

function normalizeMintsoftBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  return trimmed.replace(/\/api\/auth$/i, "").replace(/\/api$/i, "");
}

type ThemeMode = "light" | "dark" | "system";
const THEME_KEY = "app:theme";

function applyTheme(mode: ThemeMode) {
  const root = document.documentElement;
  const isDark =
    mode === "dark" ||
    (mode === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  root.classList.toggle("dark", isDark);
}

export const Route = createFileRoute("/settings")({
  beforeLoad: ({ location }) => requireAuth(location),
  component: SettingsPage,
});

function SettingsPage() {
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [printers, setPrinters] = useState<string[]>([]);
  const [testing, setTesting] = useState(false);
  const [checkingDb, setCheckingDb] = useState(false);
  const [agentStatus, setAgentStatus] = useState<"checking" | "online" | "offline">("checking");
  const [agentPlatform, setAgentPlatform] = useState<string | null>(null);
  const [clients, setClients] = useState<MintsoftClient[]>([]);
  const [theme, setTheme] = useState<ThemeMode>(() => {
    if (typeof window === "undefined") return "system";
    return (localStorage.getItem(THEME_KEY) as ThemeMode | null) ?? "system";
  });
  const fileRef = useRef<HTMLInputElement | null>(null);
  const fetchPricing = useServerFn(listPricing);
  const persistPricing = useServerFn(savePricing);
  const fetchSettings = useServerFn(loadUserSettings);
  const persistSettings = useServerFn(saveUserSettings);
  const checkDb = useServerFn(checkUserSettings);

  useEffect(() => {
    const s = loadSettings();
    setSettings(s);
    void refreshPrinters();
    // Pull canonical settings from the database (source of truth across devices).
    fetchSettings()
      .then((remote) => {
        if (remote) {
          setSettings((prev) => {
            const merged: Settings = {
              ...prev,
              mintsoftBaseUrl: remote.mintsoftBaseUrl || prev.mintsoftBaseUrl,
              mintsoftUsername: remote.mintsoftUsername ?? prev.mintsoftUsername,
              mintsoftPassword: remote.mintsoftPassword ?? prev.mintsoftPassword,
              mintsoftApiKey: remote.mintsoftApiKey ?? prev.mintsoftApiKey,
              printers: { ...prev.printers, ...(remote.printers ?? {}) },
              silentPrint: remote.silentPrint ?? prev.silentPrint,
              reworkClientId: remote.reworkClientId ?? prev.reworkClientId,
              reworkMap: remote.reworkMap ?? prev.reworkMap,
            };
            saveSettings(merged);
            listClients(merged).then(setClients).catch(() => {});
            return merged;
          });
        } else {
          listClients(s).then(setClients).catch(() => {});
        }
      })
      .catch(() => {
        listClients(s).then(setClients).catch(() => {});
      });
    // Load pricing from database (DB is the source of truth).
    fetchPricing()
      .then((rows) => {
        const rates: ReworkRates = {};
        for (const r of rows) {
          (rates[r.client_id] ??= {})[r.rate_code] = Number(r.rate_per_unit);
        }
        setSettings((prev) => {
          const next = { ...prev, reworkRates: rates };
          saveSettings(next);
          return next;
        });
      })
      .catch(() => {
        // Not signed in or table missing — keep localStorage value.
      });
  }, []);

  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem(THEME_KEY, theme);
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  // Poll the local print agent for health every 5s so the user sees a
  // live status indicator in the Printer tab.
  useEffect(() => {
    let cancelled = false;
    async function ping() {
      const port = localStorage.getItem("printAgentPort") || "9911";
      try {
        const res = await fetch(`http://127.0.0.1:${port}/health`, {
          signal: AbortSignal.timeout(2000),
        });
        if (cancelled) return;
        if (res.ok) {
          const j = (await res.json().catch(() => ({}))) as { platform?: string };
          setAgentStatus("online");
          setAgentPlatform(j.platform ?? null);
        } else {
          setAgentStatus("offline");
        }
      } catch {
        if (!cancelled) setAgentStatus("offline");
      }
    }
    void ping();
    const id = setInterval(ping, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  async function downloadAgentZip() {
    try {
      const zip = new JSZip();
      const folder = zip.folder("local-print-agent")!;
      folder.file("agent.cjs", agentSource);
      folder.file("README.md", agentReadme);
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "local-print-agent.zip";
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Downloaded local-print-agent.zip — see README to run it.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Download failed");
    }
  }

  async function refreshPrinters() {
    const installed = await listInstalledPrinters();
    let merged = [...installed];
    // Also try the local print agent (http://127.0.0.1:9911/printers).
    try {
      const agentPort = localStorage.getItem("printAgentPort") || "9911";
      const res = await fetch(`http://127.0.0.1:${agentPort}/printers`, {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const json = (await res.json()) as { printers?: string[] };
        if (Array.isArray(json.printers)) {
          merged = Array.from(new Set([...merged, ...json.printers]));
          if (!installed.length) toast.success(`Found ${json.printers.length} printer(s) via local agent`);
        }
      }
    } catch {
      /* agent not running — silent */
    }
    setPrinters(merged);
  }

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((s) => ({ ...s, [key]: value }));
  }

  function setPrinter(slot: keyof Settings["printers"], value: string) {
    setSettings((s) => ({ ...s, printers: { ...s.printers, [slot]: value } }));
  }

  async function save() {
    const cleanSettings = {
      ...settings,
      mintsoftBaseUrl: normalizeMintsoftBaseUrl(settings.mintsoftBaseUrl),
    };
    setSettings(cleanSettings);
    saveSettings(cleanSettings);
    tokenStore.clear();
    // Persist Mintsoft credentials + printer routing to the database so
    // the API key follows the user across browsers and devices.
    let dbOk = false;
    try {
      await persistSettings({
        data: {
          mintsoftBaseUrl: cleanSettings.mintsoftBaseUrl,
          mintsoftUsername: cleanSettings.mintsoftUsername,
          mintsoftPassword: cleanSettings.mintsoftPassword,
          mintsoftApiKey: cleanSettings.mintsoftApiKey,
          printers: cleanSettings.printers,
          silentPrint: cleanSettings.silentPrint,
          reworkClientId: cleanSettings.reworkClientId,
          reworkMap: cleanSettings.reworkMap,
        },
      });
      dbOk = true;
    } catch (e) {
      toast.error(
        e instanceof Error
          ? `Saved locally; settings sync failed: ${e.message}`
          : "Saved locally; settings sync failed",
      );
    }
    // Sync pricing rows to the database.
    try {
      const rows: Array<{
        client_id: string;
        client_name: string | null;
        rate_code: string;
        rate_per_unit: number;
      }> = [];
      const rates = cleanSettings.reworkRates ?? {};
      for (const [client_id, row] of Object.entries(rates)) {
        const client_name =
          client_id === DEFAULT_CLIENT_KEY
            ? "Default"
            : clientNameById.get(client_id) ?? null;
        for (const [rate_code, rate_per_unit] of Object.entries(row)) {
          if (typeof rate_per_unit === "number" && Number.isFinite(rate_per_unit)) {
            rows.push({ client_id, client_name, rate_code, rate_per_unit });
          }
        }
      }
      await persistPricing({ data: { rows } });
      toast.success(
        `Settings saved${dbOk ? " to cloud" : ""} (${rows.length} pricing row${rows.length === 1 ? "" : "s"} synced)`,
      );
    } catch (e) {
      toast.error(
        e instanceof Error
          ? `Saved locally; database sync failed: ${e.message}`
          : "Saved locally; database sync failed",
      );
    }
  }

  async function testLogin() {
    setTesting(true);
    try {
      const cleanSettings = {
        ...settings,
        mintsoftBaseUrl: normalizeMintsoftBaseUrl(settings.mintsoftBaseUrl),
      };
      setSettings(cleanSettings);
      saveSettings(cleanSettings);
      tokenStore.clear();
      await login(cleanSettings);
      toast.success("Connected to Mintsoft");
      // Refresh client list after a successful login.
      try {
        setClients(await listClients(cleanSettings));
      } catch {
        /* ignore */
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Login failed");
    } finally {
      setTesting(false);
    }
  }

  async function runDbCheck() {
    setCheckingDb(true);
    try {
      const res = await checkDb();
      if (res.ok) toast.success(res.message);
      else toast.error(`user_settings not ready: ${res.message}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Check failed");
    } finally {
      setCheckingDb(false);
    }
  }

  const electron = isElectron();

  const clientNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of clients) {
      m.set(String(c.ID), c.BrandName || c.ShortName || c.Name || `Client ${c.ID}`);
    }
    return m;
  }, [clients]);

  function exportCsv() {
    // Seed the export with every known client so the user gets a complete
    // template — existing rates are preserved, missing clients show blank.
    const merged: ReworkRates = { [DEFAULT_CLIENT_KEY]: {}, ...(settings.reworkRates ?? {}) };
    for (const c of clients) {
      const id = String(c.ID);
      if (!(id in merged)) merged[id] = {};
    }
    const csv = ratesToCsv(merged, (id) => clientNameById.get(id) ?? `Client ${id}`);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "rework-rates.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importCsv(file: File) {
    try {
      const text = await file.text();
      const parsed = csvToRates(text);
      setSettings((s) => ({ ...s, reworkRates: parsed }));
      const clientCount = Object.keys(parsed).length;
      const rateCount = Object.values(parsed).reduce(
        (n, row) => n + Object.keys(row).length,
        0,
      );
      toast.success(
        `Imported ${rateCount} rate(s) across ${clientCount} client(s) — click Save to persist.`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "CSV import failed");
    }
  }

  const printerSlots: Array<{
    key: keyof Settings["printers"];
    title: string;
    desc: string;
  }> = [
    { key: "small", title: "50 × 25 mm labels", desc: "Small product / barcode labels" },
    { key: "large", title: "100 × 150 mm labels", desc: "Shipping / courier labels" },
    {
      key: "other",
      title: "Other (A4 etc.)",
      desc: "Invoices, picking lists, large courier labels",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Appearance, security, integrations and client pricing — all in one place.
        </p>
      </div>

      <Tabs defaultValue="general" className="space-y-6">
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="printer">Printer</TabsTrigger>
          <TabsTrigger value="history">Print History</TabsTrigger>
          <TabsTrigger value="pricing">Client Pricing</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Appearance</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Label htmlFor="theme">App color theme</Label>
              <Select
                value={theme}
                onValueChange={(v) => setTheme(v as ThemeMode)}
              >
                <SelectTrigger id="theme" className="w-60">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="light">Light</SelectItem>
                  <SelectItem value="dark">Dark</SelectItem>
                  <SelectItem value="system">Match system</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Saved on this device and applied instantly.
              </p>
            </CardContent>
          </Card>

          <Card>
        <CardHeader>
          <CardTitle>Mintsoft API</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="baseUrl">Base URL</Label>
            <Input
              id="baseUrl"
              value={settings.mintsoftBaseUrl}
              onChange={(e) => update("mintsoftBaseUrl", e.target.value)}
              placeholder="https://api.mintsoft.co.uk"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="user">Username</Label>
            <Input
              id="user"
              autoComplete="off"
              value={settings.mintsoftUsername}
              onChange={(e) => update("mintsoftUsername", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pass">Password</Label>
            <Input
              id="pass"
              type="password"
              autoComplete="new-password"
              value={settings.mintsoftPassword}
              onChange={(e) => update("mintsoftPassword", e.target.value)}
            />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="apikey">API Key (recommended)</Label>
            <Input
              id="apikey"
              autoComplete="off"
              value={settings.mintsoftApiKey}
              onChange={(e) => update("mintsoftApiKey", e.target.value)}
              placeholder="ms-apikey value from Mintsoft"
            />
            <p className="text-xs text-muted-foreground">
              If set, the API key is used (sent as <code>ms-apikey</code> header) and
              username/password are ignored.
            </p>
          </div>
          <div className="md:col-span-2 flex gap-2">
            <Button onClick={save} variant="default">
              <Save className="mr-2 h-4 w-4" /> Save
            </Button>
            <Button onClick={testLogin} variant="secondary" disabled={testing}>
              <Plug className="mr-2 h-4 w-4" />
              {testing ? "Testing…" : "Test connection"}
            </Button>
            <Button
              onClick={runDbCheck}
              variant="outline"
              disabled={checkingDb}
            >
              <ShieldCheck className="mr-2 h-4 w-4" />
              {checkingDb ? "Checking…" : "Check cloud storage"}
            </Button>
          </div>
        </CardContent>
      </Card>

        </TabsContent>

        <TabsContent value="security" className="space-y-6">
          <TwoFactorCard />
          <TrustedDeviceCard />
        </TabsContent>

        <TabsContent value="printer" className="space-y-6">
          <QuickPrintCard mode="upload" />
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Local print agent</CardTitle>
              <div className="flex items-center gap-2">
                <span
                  className={
                    "inline-block h-2.5 w-2.5 rounded-full " +
                    (agentStatus === "online"
                      ? "bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.2)]"
                      : agentStatus === "offline"
                      ? "bg-red-500"
                      : "bg-muted-foreground/50 animate-pulse")
                  }
                  aria-hidden
                />
                <span className="text-xs text-muted-foreground">
                  {agentStatus === "online"
                    ? `Online${agentPlatform ? ` (${agentPlatform})` : ""}`
                    : agentStatus === "offline"
                    ? "Offline"
                    : "Checking…"}
                </span>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                A tiny Node script runs on the PC connected to your printers and
                exposes them to this app at <code>http://127.0.0.1:9911</code>.
                Download the zip, unpack it, then run{" "}
                <code>node agent.cjs</code> from a terminal (requires Node 18+).
              </p>
              <div className="flex flex-wrap gap-2">
                <Button onClick={downloadAgentZip} variant="default">
                  <Download className="mr-2 h-4 w-4" /> Download agent
                </Button>
                <Button onClick={refreshPrinters} variant="outline">
                  <RefreshCw className="mr-2 h-4 w-4" /> Refresh printers
                </Button>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Printer routing</CardTitle>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <Switch
                    id="silent"
                    checked={settings.silentPrint}
                    onCheckedChange={(v) => update("silentPrint", !!v)}
                  />
                  <Label htmlFor="silent" className="text-sm">
                    Silent print
                  </Label>
                </div>
                <Button variant="outline" size="sm" onClick={refreshPrinters}>
                  <RefreshCw className="mr-2 h-4 w-4" /> Refresh
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {!electron && printers.length === 0 && (
                <p className="rounded-md border border-dashed border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                  No printers detected. Run the local print agent on this PC
                  (<code>node agent.cjs</code> from the{" "}
                  <code>local-print-agent</code> folder), then click{" "}
                  <strong>Refresh</strong>. Alternatively, type printer names
                  manually below.
                </p>
              )}
              {printerSlots.map((slot) => (
                <div key={slot.key} className="grid gap-2 md:grid-cols-[1fr_2fr] md:items-center">
                  <div>
                    <div className="text-sm font-medium">{slot.title}</div>
                    <div className="text-xs text-muted-foreground">{slot.desc}</div>
                  </div>
                  {printers.length > 0 ? (
                    <Select
                      value={settings.printers[slot.key] || undefined}
                      onValueChange={(v) => setPrinter(slot.key, v)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select a printer" />
                      </SelectTrigger>
                      <SelectContent>
                        {printers.map((p) => (
                          <SelectItem key={p} value={p}>
                            {p}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      value={settings.printers[slot.key]}
                      onChange={(e) => setPrinter(slot.key, e.target.value)}
                      placeholder="Printer name"
                    />
                  )}
                </div>
              ))}
              <Button onClick={save}>
                <Save className="mr-2 h-4 w-4" /> Save
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pricing" className="space-y-6">
          <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Rework charges (per client)</CardTitle>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={exportCsv}>
              <Download className="mr-2 h-4 w-4" /> Export CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
              <Upload className="mr-2 h-4 w-4" /> Import CSV
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importCsv(f);
                e.target.value = "";
              }}
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Rates are in GBP per unit. The <strong>Default</strong> row is used
            for any client without a specific rate. Export to CSV to edit in
            Excel, then import to apply. Click <strong>Save</strong> to persist.
          </p>
          {(() => {
            const rates = settings.reworkRates ?? {};
            // Build the row list: Default first, then every Mintsoft client,
            // then any orphan client IDs that exist in saved rates.
            const rowIds: string[] = [DEFAULT_CLIENT_KEY];
            const seen = new Set<string>([DEFAULT_CLIENT_KEY]);
            for (const c of clients) {
              const id = String(c.ID);
              if (!seen.has(id)) {
                rowIds.push(id);
                seen.add(id);
              }
            }
            for (const id of Object.keys(rates)) {
              if (!seen.has(id)) {
                rowIds.push(id);
                seen.add(id);
              }
            }
            const setRate = (cid: string, key: string, value: string) => {
              setSettings((s) => {
                const next: ReworkRates = { ...(s.reworkRates ?? {}) };
                const row = { ...(next[cid] ?? {}) };
                if (value.trim() === "") {
                  delete row[key];
                } else {
                  const n = Number(value);
                  if (Number.isFinite(n)) row[key] = n;
                }
                if (Object.keys(row).length === 0) delete next[cid];
                else next[cid] = row;
                return { ...s, reworkRates: next };
              });
            };
            return (
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="sticky left-0 bg-background min-w-[180px]">
                        Client
                      </TableHead>
                      {REWORK_CATALOG.map((c) => (
                        <TableHead key={c.key} className="whitespace-nowrap text-right">
                          {c.label}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rowIds.map((cid) => {
                      const name =
                        cid === DEFAULT_CLIENT_KEY
                          ? "Default"
                          : clientNameById.get(cid) ?? `Client ${cid}`;
                      return (
                        <TableRow key={cid}>
                          <TableCell className="sticky left-0 bg-background font-medium whitespace-nowrap">
                            {name}
                          </TableCell>
                          {REWORK_CATALOG.map((c) => {
                            const v = rates[cid]?.[c.key];
                            return (
                              <TableCell key={c.key} className="p-1">
                                <Input
                                  type="number"
                                  step="0.01"
                                  inputMode="decimal"
                                  className="h-8 w-24 text-right"
                                  placeholder="—"
                                  value={v == null ? "" : String(v)}
                                  onChange={(e) => setRate(cid, c.key, e.target.value)}
                                />
                              </TableCell>
                            );
                          })}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            );
          })()}
          <p className="text-xs text-muted-foreground">
            Rates in GBP per unit. Blank = no rate (falls back to Default).
            CSV layout: services across the top row, clients down the left
            column (<code>ClientID</code>, <code>ClientName</code>, then one
            column per service). Use <code>*</code> as ClientID for the
            Default row. The hidden second row carries machine codes — leave
            it in place when re-importing.
            {clients.length === 0 && (
              <> Connect to Mintsoft to load your client list.</>
            )}
          </p>

          <div className="flex justify-end">
            <Button onClick={save}>
              <Save className="mr-2 h-4 w-4" /> Save
            </Button>
          </div>
        </CardContent>
      </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
