import { useEffect, useRef, useState } from "react";
import { PDFDocument } from "pdf-lib";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Printer, Upload, FileCheck2 } from "lucide-react";
import { toast } from "sonner";
import { loadSettings } from "@/lib/storage";
import { pickPrinter, printPdfBytes } from "@/lib/printing";

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

type Stored = { name: string; base64: string };

function lsKey(k: string) {
  return `quickprint:${k}`;
}

function loadStored(k: string): Stored | null {
  try {
    const raw = localStorage.getItem(lsKey(k));
    if (!raw) return null;
    const v = JSON.parse(raw) as Stored;
    if (v && typeof v.base64 === "string" && typeof v.name === "string") return v;
  } catch {
    /* ignore */
  }
  return null;
}

function saveStored(k: string, v: Stored) {
  localStorage.setItem(lsKey(k), JSON.stringify(v));
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
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
    setStored(loadStored(slot.key));
    const onStorage = (e: StorageEvent) => {
      if (e.key === lsKey(slot.key)) setStored(loadStored(slot.key));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [slot.key]);

  async function onFile(file: File) {
    if (file.type && !file.type.includes("pdf")) {
      toast.error("Please upload a PDF");
      return;
    }
    try {
      const base64 = await fileToBase64(file);
      const next: Stored = { name: file.name, base64 };
      saveStored(slot.key, next);
      setStored(next);
      toast.success(`${slot.title} saved`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
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
      const bytes = base64ToBytes(stored.base64);
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
      toast.success(`Sent ${copies} × ${slot.title} to ${printer}`);
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
