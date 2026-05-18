import { useEffect, useRef, useState } from "react";
import { PDFDocument } from "pdf-lib";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Printer, Upload, FileCheck2 } from "lucide-react";
import { toast } from "sonner";
import { loadSettings } from "@/lib/storage";
import { pickPrinter, printPdfBytes } from "@/lib/printing";
import { detectFromBytes } from "@/lib/pdfSize";

type Slot = {
  key: string;
  title: string;
  description: string;
};

const SLOTS: Slot[] = [
  {
    key: "carton",
    title: "Carton warning labels (+15kg)",
    description: "Heavy-carton warning sticker.",
  },
  {
    key: "poly",
    title: "Poly Bag Suffocation Labels",
    description: "Suffocation warning for poly bags.",
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

export function QuickPrintCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Printer className="h-4 w-4" /> Quick-print labels
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        {SLOTS.map((s) => (
          <QuickPrintSlot key={s.key} slot={s} />
        ))}
      </CardContent>
    </Card>
  );
}

function QuickPrintSlot({ slot }: { slot: Slot }) {
  const [stored, setStored] = useState<Stored | null>(null);
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setStored(loadStored(slot.key));
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
      const size = await detectFromBytes(out);
      const printer = pickPrinter(settings, size.kind);
      if (!printer) {
        throw new Error(
          `No printer set for ${size.kind} (${size.widthMm}×${size.heightMm} mm). Set one in Settings.`,
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
    <div className="rounded-md border p-3 space-y-3">
      <div>
        <div className="text-sm font-medium">{slot.title}</div>
        <div className="text-xs text-muted-foreground">{slot.description}</div>
      </div>
      <div className="flex items-center gap-2 text-xs">
        {stored ? (
          <span className="inline-flex items-center gap-1 text-emerald-600">
            <FileCheck2 className="h-3.5 w-3.5" />
            <span className="truncate max-w-[180px]" title={stored.name}>
              {stored.name}
            </span>
          </span>
        ) : (
          <span className="text-muted-foreground">No PDF uploaded</span>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto h-7"
          onClick={() => fileRef.current?.click()}
        >
          <Upload className="mr-1 h-3.5 w-3.5" />
          {stored ? "Replace" : "Upload"}
        </Button>
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
      <div className="flex items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor={`qty-${slot.key}`} className="text-xs">
            Quantity
          </Label>
          <Input
            id={`qty-${slot.key}`}
            type="number"
            min={1}
            max={500}
            value={qty}
            onChange={(e) => setQty(Number(e.target.value) || 1)}
            className="h-9 w-24"
          />
        </div>
        <Button onClick={onPrint} disabled={busy || !stored} className="ml-auto">
          {busy ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Printer className="mr-2 h-4 w-4" />
          )}
          Print
        </Button>
      </div>
    </div>
  );
}
