import { useQuery } from "@tanstack/react-query";

// Unified product-image resolution.
// Priority:
//   1. Mintsoft direct ImageURL
//   2. Amazon ASIN lookup (via /api/amazon-image, backed by Firecrawl connector)
//   3. AI-picked candidate from Amazon + Google search using name + description
//      (Gemini picker at /api/pick-product-image)

export type ProductImageInput = {
  imageUrl?: string | null;
  name?: string | null;
  description?: string | null;
  sku?: string | null;
  ean?: string | null;
  upc?: string | null;
  scannedBarcode?: string | null;
};

export type ResolvedImage = {
  url: string | null;
  suggested: boolean;
  source: "direct" | "asin" | "ai" | "none";
};

type Candidate = { image: string; title?: string | null };

const ASIN_RE = /\b(B0[A-Z0-9]{8})\b/i;

async function fetchAmazon(query: string): Promise<Candidate[]> {
  try {
    const r = await fetch(`/api/amazon-image?q=${encodeURIComponent(query)}`);
    if (!r.ok) return [];
    const data = (await r.json()) as { candidates?: Candidate[]; image?: string | null };
    if (data.candidates?.length) return data.candidates;
    return data.image ? [{ image: data.image, title: null }] : [];
  } catch {
    return [];
  }
}

async function fetchGoogle(query: string): Promise<Candidate[]> {
  try {
    const r = await fetch(`/api/google-image?q=${encodeURIComponent(query)}`);
    if (!r.ok) return [];
    const data = (await r.json()) as { candidates?: Candidate[]; image?: string | null };
    if (data.candidates?.length) return data.candidates;
    return data.image ? [{ image: data.image, title: null }] : [];
  } catch {
    return [];
  }
}

export function useProductImage(input: ProductImageInput, opts?: { enabled?: boolean }) {
  const direct = input.imageUrl?.trim() || null;
  const asinSource = [input.sku, input.name, input.ean, input.upc, input.scannedBarcode]
    .map((v) => (v ? String(v) : ""))
    .join(" ");
  const asin = asinSource.match(ASIN_RE)?.[1]?.toUpperCase() ?? null;

  return useQuery<ResolvedImage>({
    queryKey: [
      "product-image-v2",
      direct,
      asin,
      input.sku ?? null,
      input.ean ?? null,
      input.upc ?? null,
      input.scannedBarcode ?? null,
      input.name ?? null,
      (input.description ?? "").slice(0, 120),
    ],
    enabled: opts?.enabled ?? true,
    staleTime: 60 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      // 1. Direct Mintsoft URL
      if (direct) return { url: direct, suggested: false, source: "direct" };

      // 2. ASIN — Amazon product page via connector
      if (asin) {
        const amazon = await fetchAmazon(asin);
        if (amazon.length > 0) {
          return { url: amazon[0].image, suggested: true, source: "asin" };
        }
      }

      // 3. AI title search using name + description (and any barcodes we have)
      const titleQuery = [input.name, input.description]
        .filter((s): s is string => !!s && String(s).trim().length > 0)
        .map((s) => String(s).trim())
        .join(" ")
        .slice(0, 240)
        .trim();

      const searchQueries = [input.ean, input.upc, input.scannedBarcode, titleQuery || input.name]
        .map((q) => (q ? String(q).trim() : ""))
        .filter((q) => q.length > 0);

      const seen = new Set<string>();
      const candidates: Candidate[] = [];
      for (const q of searchQueries) {
        const [a, g] = await Promise.all([fetchAmazon(q), fetchGoogle(q)]);
        for (const c of [...a, ...g]) {
          if (!c.image || seen.has(c.image)) continue;
          seen.add(c.image);
          candidates.push(c);
          if (candidates.length >= 6) break;
        }
        if (candidates.length >= 6) break;
      }
      if (candidates.length === 0) {
        return { url: null, suggested: false, source: "none" };
      }

      try {
        const r = await fetch("/api/pick-product-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            product: {
              name: input.name ?? null,
              sku: input.sku ?? null,
              ean: input.ean ?? null,
              upc: input.upc ?? null,
              description: input.description ?? null,
            },
            candidates,
          }),
        });
        if (r.ok) {
          const data = (await r.json()) as { image?: string | null };
          if (data.image) return { url: data.image, suggested: true, source: "ai" };
          return { url: null, suggested: false, source: "none" };
        }
      } catch {
        // fall through to first candidate
      }
      return { url: candidates[0].image, suggested: true, source: "ai" };
    },
  });
}