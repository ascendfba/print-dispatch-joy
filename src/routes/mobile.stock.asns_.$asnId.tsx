import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, Truck, Loader2, Package, Search, X, AlertTriangle } from "lucide-react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchASN,
  fetchASNItems,
  fetchProduct,
  type MintsoftASNItem,
  type MintsoftProduct,
} from "@/lib/mintsoft";
import { loadSettings } from "@/lib/storage";

export const Route = createFileRoute("/mobile/stock/asns_/$asnId")({
  component: MobileASNDetail,
});

function MobileASNDetail() {
  const { asnId } = Route.useParams();
  const id = Number(asnId);
  const [query, setQuery] = useState("");

  const asnQuery = useQuery({
    queryKey: ["mobile-asn", id],
    queryFn: async () => {
      const settings = loadSettings();
      return fetchASN(settings, id);
    },
    staleTime: 60_000,
  });

  const itemsQuery = useQuery({
    queryKey: ["mobile-asn-items", id],
    queryFn: async () => {
      const settings = loadSettings();
      return fetchASNItems(settings, id);
    },
    staleTime: 60_000,
  });

  const asn = asnQuery.data;
  const items = itemsQuery.data ?? [];

  const filtered = query.trim()
    ? items.filter((it) => {
        const q = query.trim().toLowerCase();
        return (
          (it.SKU ?? "").toLowerCase().includes(q) ||
          (it.Title ?? "").toLowerCase().includes(q) ||
          (it.Description ?? "").toLowerCase().includes(q) ||
          (it.EAN ?? "").toLowerCase().includes(q) ||
          (it.UPC ?? "").toLowerCase().includes(q)
        );
      })
    : items;

  return (
    <div className="flex-1 flex flex-col">
      <header className="px-3 pt-4 pb-3 border-b flex items-center gap-2 bg-gradient-to-r from-[#0a2e3d] via-[#0d3a4d] to-[#0a2e3d]">
        <Link to="/mobile/stock/asns" className="p-2 -ml-2 rounded-lg active:bg-white/10">
          <ChevronLeft className="h-5 w-5 text-white" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-semibold text-white truncate">
            {asn?.Reference || `ASN #${id}`}
          </h1>
          {asn?.SupplierName && (
            <p className="text-xs text-white/70 truncate">{asn.SupplierName}</p>
          )}
        </div>
        <div className="rounded-lg p-2 bg-white/10">
          <Truck className="h-4 w-4 text-white" />
        </div>
      </header>

      <div className="px-3 pt-3 pb-2 bg-card border-b">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search SKU, title or barcode…"
            className="w-full h-10 pl-9 pr-9 rounded-lg border border-input bg-background text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#0099d4]"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded-full bg-muted text-muted-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {itemsQuery.isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading items…
          </div>
        ) : itemsQuery.error ? (
          <div className="py-8 text-center text-sm text-destructive">
            {itemsQuery.error instanceof Error
              ? itemsQuery.error.message
              : "Failed to load items"}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            {query.trim() ? "No items match your search" : "No items on this ASN"}
          </div>
        ) : (
          filtered.map((it, idx) => <ASNItemRow key={it.ID ?? idx} item={it} />)
        )}
      </div>
    </div>
  );
}

function ASNItemRow({ item }: { item: MintsoftASNItem }) {
  const productQuery = useQuery({
    queryKey: ["product", item.ProductId ?? null],
    queryFn: () =>
      item.ProductId
        ? fetchProduct(loadSettings(), item.ProductId)
        : Promise.resolve(null),
    enabled: !!item.ProductId,
    staleTime: 30 * 60_000,
    refetchOnWindowFocus: false,
  });
  const p = productQuery.data;
  const sku = p?.SKU || item.SKU || "—";
  const name = p?.Name || item.Title || item.Description || "Untitled product";
  const description = p?.Description || item.Description || "";
  const ean = (p?.EAN || item.EAN || "").toString();
  const upc = (p?.UPC || item.UPC || "").toString();
  const rawBarcode = (ean || upc).trim();
  const hasBarcode = /^\d{12,14}$/.test(rawBarcode);

  const imageProduct: MintsoftProduct | null = p
    ? {
        ...p,
        ImageURL: p.ImageURL || item.ImageURL || null,
        EAN: p.EAN || item.EAN || null,
        UPC: p.UPC || item.UPC || null,
        Name: p.Name || item.Title || undefined,
      }
    : item.ImageURL || item.EAN || item.UPC || item.Title
      ? {
          ID: item.ProductId ?? 0,
          SKU: item.SKU ?? undefined,
          Name: item.Title ?? undefined,
          Description: item.Description,
          ImageURL: item.ImageURL,
          EAN: item.EAN,
          UPC: item.UPC,
        }
      : null;

  return (
    <div className="flex items-start gap-3 rounded-xl border bg-card p-3">
      <ProductImage product={imageProduct} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-snug line-clamp-2">{name}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5 font-mono truncate">
          {sku}
        </p>
        {description && (
          <p className="text-[11px] text-muted-foreground/80 mt-0.5 line-clamp-2">
            {description}
          </p>
        )}
        <BarcodeRow
          ean={ean}
          upc={upc}
          name={name}
          sku={sku}
          description={description}
          hasBarcode={hasBarcode}
        />
        <div className="mt-1.5 flex items-center gap-3 text-[11px]">
          <span className="inline-flex items-center rounded-full px-2 py-0.5 font-medium bg-[#0099d4]/10 text-[#0099d4]">
            Expected {item.ExpectedQuantity ?? 0}
          </span>
          {item.ReceivedQuantity != null && item.ReceivedQuantity > 0 && (
            <span className="text-muted-foreground">
              Received {item.ReceivedQuantity}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

type ImageCandidate = { image: string; title?: string | null };

async function fetchImageCandidates(query: string): Promise<ImageCandidate[]> {
  try {
    const r = await fetch(`/api/google-image?q=${encodeURIComponent(query)}`);
    if (!r.ok) return [];
    const data = (await r.json()) as {
      candidates?: ImageCandidate[];
      image?: string | null;
    };
    if (data.candidates && data.candidates.length) return data.candidates;
    return data.image ? [{ image: data.image, title: null }] : [];
  } catch {
    return [];
  }
}

function ProductImage({ product }: { product: MintsoftProduct | null }) {
  const direct = product?.ImageURL || null;
  const queries = [product?.EAN, product?.UPC, product?.Name]
    .map((q) => (q ? String(q).trim() : ""))
    .filter((q) => q.length > 0);
  const suggestQuery = useQuery({
    queryKey: ["mobile-best-image", product?.SKU ?? product?.Name, queries],
    queryFn: async () => {
      const seen = new Set<string>();
      const candidates: ImageCandidate[] = [];
      for (const q of queries) {
        const found = await fetchImageCandidates(q);
        for (const c of found) {
          if (!seen.has(c.image)) {
            seen.add(c.image);
            candidates.push(c);
          }
          if (candidates.length >= 6) break;
        }
        if (candidates.length >= 6) break;
      }
      if (candidates.length === 0) return null;
      try {
        const r = await fetch("/api/pick-product-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            product: {
              name: product?.Name ?? null,
              sku: product?.SKU ?? null,
              ean: product?.EAN ?? null,
              upc: product?.UPC ?? null,
              description: product?.Description ?? null,
            },
            candidates,
          }),
        });
        if (r.ok) {
          const data = (await r.json()) as { image?: string | null };
          if (data.image) return data.image;
          return null;
        }
      } catch {
        // ignore
      }
      return candidates[0].image;
    },
    enabled: !direct && queries.length > 0,
    staleTime: 60 * 60_000,
    refetchOnWindowFocus: false,
  });

  const box = "h-16 w-16 shrink-0 rounded-lg border bg-muted overflow-hidden flex items-center justify-center";

  if (direct) {
    return (
      <div className={box}>
        <img
          src={direct}
          alt={product?.Name ?? ""}
          className="h-full w-full object-cover"
          loading="lazy"
        />
      </div>
    );
  }
  if (suggestQuery.isLoading) {
    return (
      <div className={box}>
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (suggestQuery.data) {
    return (
      <div className="flex flex-col items-center gap-1 shrink-0">
        <div className={`${box} border-2 border-orange-500`}>
          <img
            src={suggestQuery.data}
            alt={`Suggested image for ${product?.Name ?? ""}`}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        </div>
        <div
          className="flex items-center gap-1 rounded-sm border border-orange-500 bg-orange-100 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-orange-800 dark:bg-orange-500/15 dark:text-orange-300"
          title="AI suggested image — may not match"
        >
          <AlertTriangle className="h-2.5 w-2.5" /> Suggested
        </div>
      </div>
    );
  }
  return (
    <div className={box}>
      <Package className="h-6 w-6 text-muted-foreground" />
    </div>
  );
}

function BarcodeRow({
  ean,
  upc,
  name,
  sku,
  description,
  hasBarcode,
}: {
  ean: string;
  upc: string;
  name: string;
  sku: string;
  description: string;
  hasBarcode: boolean;
}) {
  const query = useQuery({
    queryKey: ["suggest-barcode", sku || name, name, description],
    queryFn: async () => {
      const r = await fetch("/api/suggest-barcode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, sku, description }),
      });
      return (await r.json()) as {
        barcode?: string | null;
        confidence?: string;
        reason?: string;
      };
    },
    enabled: !hasBarcode && !!(name || sku),
    staleTime: 24 * 60 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  if (hasBarcode) {
    return (
      <div className="text-[11px] text-muted-foreground mt-0.5">
        <span className="font-semibold">Barcode:</span>{" "}
        <span className="font-mono">{ean || upc}</span>
      </div>
    );
  }

  if (query.isLoading) {
    return (
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground mt-0.5">
        <span className="font-semibold">Barcode:</span>
        <Loader2 className="h-3 w-3 animate-spin" />
        <span className="italic">scanning…</span>
      </div>
    );
  }

  const barcode = query.data?.barcode;
  const confidence = query.data?.confidence ?? "low";
  const reason = query.data?.reason ?? "";
  const confColor =
    confidence === "high"
      ? "text-emerald-700 border-emerald-500/40 bg-emerald-50"
      : confidence === "medium"
        ? "text-orange-700 border-orange-500/40 bg-orange-50"
        : "text-rose-700 border-rose-500/40 bg-rose-50";

  if (barcode) {
    return (
      <div
        className="text-[11px] text-muted-foreground mt-0.5"
        title={reason || undefined}
      >
        <span className="font-semibold">Barcode:</span>{" "}
        <span className="font-mono text-orange-700" title="AI-suggested">
          {barcode}
        </span>{" "}
        <span
          className={`ml-1 inline-flex items-center rounded border px-1 py-px text-[9px] font-semibold uppercase tracking-wide ${confColor}`}
        >
          {confidence}
        </span>
      </div>
    );
  }
  return (
    <div className="text-[11px] text-muted-foreground mt-0.5">
      <span className="font-semibold">Barcode:</span>{" "}
      <span className="italic">None suggested</span>
    </div>
  );
}