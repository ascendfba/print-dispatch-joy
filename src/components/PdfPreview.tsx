import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

// Render a PDF (from raw bytes) into stacked canvases using pdf.js.
// Avoids Chrome's blob/iframe PDF embed restrictions.
export function PdfPreview({ bytes }: { bytes: Uint8Array }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        // Configure worker via Vite ?url import.
        const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

        const data = bytes.slice().buffer;
        const loadingTask = pdfjs.getDocument({ data });
        const pdf = await loadingTask.promise;
        if (cancelled) return;

        const container = containerRef.current;
        if (!container) return;
        container.innerHTML = "";

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          if (cancelled) return;
          const containerWidth = container.clientWidth || 800;
          const baseViewport = page.getViewport({ scale: 1 });
          const scale = containerWidth / baseViewport.width;
          const viewport = page.getViewport({ scale: scale * dpr });

          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.width = `${viewport.width / dpr}px`;
          canvas.style.height = `${viewport.height / dpr}px`;
          canvas.className = "mx-auto mb-3 rounded border bg-white shadow-sm";
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          container.appendChild(canvas);
          await page.render({ canvasContext: ctx, viewport, canvas }).promise;
        }

        cleanup = () => pdf.destroy();
        setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to render PDF");
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [bytes]);

  return (
    <div className="relative flex-1 min-h-0 overflow-auto rounded border bg-muted/30 p-3">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Rendering PDF…
        </div>
      )}
      {error && (
        <div className="p-4 text-sm text-destructive">Failed to render: {error}</div>
      )}
      <div ref={containerRef} />
    </div>
  );
}