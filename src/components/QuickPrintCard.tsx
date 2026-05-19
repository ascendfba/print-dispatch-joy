import { useEffect, useRef, useState } from "react";
import { PDFDocument } from "pdf-lib";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Printer, Upload, FileCheck2 } from "lucide-react";
import { toast } from "sonner";
import { loadSettings } from "@/lib/storage";
import { pickPrinter, printPdfBytes, isElectron } from "@/lib/printing";
import { supabase } from "@/integrations/supabase/client";

type Slot = {
  key: string;
  title: string;
  description: string;
  printerKind: "small" | "large" | "other";
};

const SLOTS: Slot[] = [
  {
    key: "carton",
    title: "Carton",
    description: "Heavy-carton warning sticker.",
    printerKind: "large",
  },
  {
    key: "poly",
    title: "Warning",
    description: "Suffocation warning for poly bags.",
    printerKind: "small",
  },
];

type Stored = { name: string; path: string; url: string };

const BUCKET = "warning-labels";

function storagePath(slotKey: string) {
  return `${slotKey}.pdf`;
}

async function fetchStored(slot: Slot): Promise<Stored | null> {
  const path = storagePath(slot.key);
  const { data: list } = await supabase.storage.from(BUCKET).list("", {
    search: path,
  });
  const entry = list?.find((f) => f.name === path);
  if (!entry) return null;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  const url = `${data.publicUrl}?v=${encodeURIComponent(entry.updated_at ?? entry.created_at ?? "")}`;
  return { name: `${slot.title}.pdf`, path, url };
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

export function QuickPrintCard({ mode = "print" }: { mode?: "print" | "upload" } = {}) {
  return (
    <Card className="py-0">
      <CardContent className="px-3 py-2">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground mb-2">
          <Printer className="h-3.5 w-3.5" />
          {mode === "upload" ? "Warning label PDFs" : "Quick print warning labels"}
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          {SLOTS.map((s) => (
            <QuickPrintSlot key={s.key} slot={s} mode={mode} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function QuickPrintSlot({ slot, mode }: { slot: Slot; mode: "print" | "upload" }) {
  const [stored, setStored] = useState<Stored | null>(null);
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let s = await fetchStored(slot).catch(() => null);
      // One-time migration: if nothing in Storage yet but this browser still
      // has a PDF in the old localStorage slot, push it up so every user sees
      // the same labels.
      if (!s && typeof window !== "undefined") {
        try {
          const raw = window.localStorage.getItem(`quickprint:${slot.key}`);
          if (raw) {
            const v = JSON.parse(raw) as { name?: string; base64?: string };
            if (v?.base64) {
              const bin = atob(v.base64);
              const bytes = new Uint8Array(bin.length);
              for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
              const blob = new Blob([bytes], { type: "application/pdf" });
              const { error } = await supabase.storage
                .from(BUCKET)
                .upload(storagePath(slot.key), blob, {
                  upsert: true,
                  contentType: "application/pdf",
                });
              if (!error) {
                window.localStorage.removeItem(`quickprint:${slot.key}`);
                s = await fetchStored(slot).catch(() => null);
              }
            }
          }
        } catch {
          /* ignore migration errors */
        }
      }
      if (!cancelled) setStored(s);
    })();
    return () => {
      cancelled = true;
    };
  }, [slot]);

  async function onFile(file: File) {
    if (file.type && !file.type.includes("pdf")) {
      toast.error("Please upload a PDF");
      return;
    }
    setBusy(true);
    try {
      const path = storagePath(slot.key);
      const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
        upsert: true,
        contentType: "application/pdf",
      });
      if (error) throw error;
      const next = await fetchStored(slot);
      setStored(next);
      toast.success(`${slot.title} saved for all users`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function onPrint() {
    if (!stored) {
      toast.error("Upload a PDF first");
      return;
    }
    const copies = Math.max(1, Math.min(500, Math.floor(qty || 1)));
    setBusy(true);
    try {
      const bytes = await fetchBytes(stored.url);
      const src = await PDFDocument.load(bytes as BlobPart as ArrayBuffer);
      const merged = await PDFDocument.create();
      const indices = src.getPageIndices();
      for (let i = 0; i < copies; i++) {
        const pages = await merged.copyPages(src, indices);
        for (const p of pages) merged.addPage(p);
      }
      const out = await merged.save();
      const settings = loadSettings();
      const printer = pickPrinter(settings, slot.printerKind);
      if (!printer) {
        throw new Error(
          `No ${slot.printerKind} printer configured. Set one in Settings.`,
        );
      }
      await printPdfBytes(out, printer, settings.silentPrint);
      if (isElectron()) {
        toast.success(`Sent ${copies} × ${slot.title} to ${printer}`);
      } else {
        toast.success(
          `Opened ${copies} × ${slot.title} — use the browser print dialog (install the desktop app for silent printing).`,
        );
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Print failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-md border px-2.5 py-2 flex items-center gap-2">
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium truncate">{slot.title}</div>
        {mode === "upload" ? (
          <>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1 truncate max-w-full"
              title={stored?.name ?? "Upload PDF"}
            >
              {stored ? (
                <>
                  <FileCheck2 className="h-3 w-3 text-emerald-600 shrink-0" />
                  <span className="truncate">{stored.name}</span>
                </>
              ) : (
                <>
                  <Upload className="h-3 w-3 shrink-0" />
                  <span>Upload PDF</span>
                </>
              )}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
                e.target.value = "";
              }}
            />
          </>
        ) : (
          <div className="text-[11px] text-muted-foreground inline-flex items-center gap-1 truncate max-w-full">
            {stored ? (
              <>
                <FileCheck2 className="h-3 w-3 text-emerald-600 shrink-0" />
                <span className="truncate">{stored.name}</span>
              </>
            ) : (
              <span className="italic">No PDF — upload in Settings</span>
            )}
          </div>
        )}
      </div>
      {mode === "print" && (
        <>
          <Input
            type="number"
            min={1}
            max={500}
            value={qty}
            onChange={(e) => setQty(Number(e.target.value) || 1)}
            className="h-8 w-12 px-1.5 text-sm"
            aria-label={`${slot.title} quantity`}
          />
          <Button
            size="sm"
            onClick={onPrint}
            disabled={busy || !stored}
            className="h-8"
          >
            {busy ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Printer className="mr-1 h-3.5 w-3.5" />
            )}
            Print
          </Button>
        </>
      )}
    </div>
  );
}
