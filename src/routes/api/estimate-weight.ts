import { createFileRoute } from "@tanstack/react-router";

type Item = {
  sku?: string | null;
  name?: string | null;
  description?: string | null;
  ean?: string | null;
  upc?: string | null;
  quantity: number;
  /** Per-unit weight in grams from Mintsoft, when known. */
  mintsoftGrams?: number | null;
};

type ResolvedItem = {
  sku?: string | null;
  quantity: number;
  perUnitGrams: number;
  source: "mintsoft" | "amazon" | "ai" | "fallback";
  note?: string | null;
};

const ASIN_RE = /\b(B0[A-Z0-9]{8})\b/i;

/** Parse strings like "1.2 kg", "250 g", "8.4 ounces", "1 lb" → grams. */
function parseWeightToGrams(raw: string): number | null {
  const cleaned = raw.replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  const m = cleaned.match(
    /(\d+(?:[.,]\d+)?)\s*(kilograms?|kgs?|grams?|g|milligrams?|mg|pounds?|lbs?|ounces?|oz)\b/i,
  );
  if (!m) return null;
  const n = parseFloat(m[1].replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  const u = m[2].toLowerCase();
  if (u.startsWith("kg") || u.startsWith("kilogram")) return Math.round(n * 1000);
  if (u === "g" || u.startsWith("gram")) return Math.round(n);
  if (u === "mg" || u.startsWith("milligram")) return Math.round(n / 1000);
  if (u.startsWith("lb") || u.startsWith("pound")) return Math.round(n * 453.592);
  if (u.startsWith("oz") || u.startsWith("ounce")) return Math.round(n * 28.3495);
  return null;
}

/** Try to pull a per-unit weight from an Amazon product page HTML. */
function extractWeightFromAmazonHtml(html: string): number | null {
  // Strip tags between obvious label rows so the regex can see "Item Weight … 250 g".
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const labels = [
    /Item Weight[^A-Za-z0-9]{0,20}([\d.,]+\s*(?:kilograms?|kgs?|grams?|g|pounds?|lbs?|ounces?|oz))/i,
    /Package Weight[^A-Za-z0-9]{0,20}([\d.,]+\s*(?:kilograms?|kgs?|grams?|g|pounds?|lbs?|ounces?|oz))/i,
    /Weight[^A-Za-z0-9]{0,20}([\d.,]+\s*(?:kilograms?|kgs?|grams?|g|pounds?|lbs?|ounces?|oz))/i,
  ];
  for (const re of labels) {
    const m = text.match(re);
    if (m) {
      const g = parseWeightToGrams(m[1]);
      if (g) return g;
    }
  }
  return null;
}

async function lookupAmazonWeight(asin: string): Promise<number | null> {
  const firecrawlKey = process.env.FIRECRAWL_API_KEY;
  if (!firecrawlKey) return null;
  try {
    const fc = await fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${firecrawlKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: `https://www.amazon.co.uk/dp/${asin}`,
        formats: ["html"],
        onlyMainContent: false,
        location: { country: "GB", languages: ["en-GB"] },
      }),
    });
    if (!fc.ok) return null;
    const data = (await fc.json()) as { data?: { html?: string }; html?: string };
    const html = data.data?.html ?? data.html ?? "";
    if (!html || /awswaf|captcha|robot check/i.test(html)) return null;
    return extractWeightFromAmazonHtml(html);
  } catch {
    return null;
  }
}

function findAsin(item: Item): string | null {
  const src = [item.sku, item.name, item.description, item.ean, item.upc]
    .map((v) => (v ? String(v) : ""))
    .join(" ");
  return src.match(ASIN_RE)?.[1]?.toUpperCase() ?? null;
}

async function aiEstimatePerUnit(items: Item[]): Promise<number[]> {
  // Returns one per-unit gram value per input item (same order). Falls back to 150g.
  const lovableKey = process.env.LOVABLE_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;
  const lines = items
    .map(
      (i, idx) =>
        `${idx + 1}. qty=${i.quantity} sku=${i.sku ?? "?"} name="${i.name ?? ""}" desc="${i.description ?? ""}"`,
    )
    .join("\n");
  const prompt = `Estimate per-unit packaged weight in grams for each line of a UK warehouse order.

Rules:
- Read name and description carefully. If a multipack (e.g. "6 pack", "case of 24", "2x500ml"), per_unit_grams is the whole pack weight.
- Infer size/volume (1ml liquid ≈ 1g; add ~50g per can/bottle for packaging).
- If totally unknown, use 150g.
- DO NOT multiply by qty — return PER UNIT.

Return ONLY strict JSON: {"lines":[{"index":<1-based>,"per_unit_grams":<int>}]}

Items:
${lines}`;

  async function callLovable() {
    if (!lovableKey) return null;
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${lovableKey}` },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
      }),
    });
    if (!r.ok) return null;
    const data = (await r.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content ?? "";
  }
  async function callGroq() {
    if (!groqKey) return null;
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${groqKey}` },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      }),
    });
    if (!r.ok) return null;
    const data = (await r.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content ?? "";
  }

  let raw: string | null = null;
  try {
    raw = (await callLovable()) ?? (await callGroq());
  } catch {
    raw = null;
  }
  const result = items.map(() => 150);
  if (!raw) return result;
  let parsed: { lines?: Array<{ index?: number; per_unit_grams?: number }> } = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        parsed = JSON.parse(m[0]);
      } catch {
        // ignore
      }
    }
  }
  if (Array.isArray(parsed.lines)) {
    for (const l of parsed.lines) {
      const idx = (Number(l.index) || 0) - 1;
      const g = Math.round(Number(l.per_unit_grams) || 0);
      if (idx >= 0 && idx < result.length && g > 0) result[idx] = g;
    }
  }
  return result;
}

export const Route = createFileRoute("/api/estimate-weight")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { items?: Item[] };
        try {
          body = (await request.json()) as { items?: Item[] };
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }
        const items = (body.items ?? []).filter((i) => i && i.quantity > 0);
        if (items.length === 0) {
          return Response.json({ grams: 0, note: "No items" });
        }

        const resolved: Array<ResolvedItem | null> = new Array(items.length).fill(null);

        // 1. Mintsoft weight (direct).
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          const g = Math.round(Number(it.mintsoftGrams) || 0);
          if (g > 0) {
            resolved[i] = {
              sku: it.sku,
              quantity: it.quantity,
              perUnitGrams: g,
              source: "mintsoft",
            };
          }
        }

        // 2. Amazon ASIN lookup (parallel) for anything still unresolved.
        const amazonJobs: Array<Promise<void>> = [];
        for (let i = 0; i < items.length; i++) {
          if (resolved[i]) continue;
          const asin = findAsin(items[i]);
          if (!asin) continue;
          amazonJobs.push(
            lookupAmazonWeight(asin).then((g) => {
              if (g && g > 0) {
                resolved[i] = {
                  sku: items[i].sku,
                  quantity: items[i].quantity,
                  perUnitGrams: g,
                  source: "amazon",
                  note: `Amazon ${asin}`,
                };
              }
            }),
          );
        }
        await Promise.all(amazonJobs);

        // 3. AI estimate for the rest.
        const remainingIdx = items
          .map((_, i) => i)
          .filter((i) => !resolved[i]);
        if (remainingIdx.length > 0) {
          const remainingItems = remainingIdx.map((i) => items[i]);
          const aiGrams = await aiEstimatePerUnit(remainingItems);
          for (let k = 0; k < remainingIdx.length; k++) {
            const i = remainingIdx[k];
            const g = Math.max(1, Math.round(aiGrams[k] || 150));
            resolved[i] = {
              sku: items[i].sku,
              quantity: items[i].quantity,
              perUnitGrams: g,
              source: aiGrams[k] > 0 ? "ai" : "fallback",
            };
          }
        }

        let subtotal = 0;
        const sources = { mintsoft: 0, amazon: 0, ai: 0, fallback: 0 };
        const breakdown: ResolvedItem[] = [];
        for (let i = 0; i < items.length; i++) {
          const r = resolved[i]!;
          subtotal += r.perUnitGrams * r.quantity;
          sources[r.source]++;
          breakdown.push(r);
        }
        const grams = subtotal + 1000; // flat 1kg outer packaging.
        const parts: string[] = [];
        if (sources.mintsoft) parts.push(`${sources.mintsoft} from Mintsoft`);
        if (sources.amazon) parts.push(`${sources.amazon} from Amazon`);
        if (sources.ai) parts.push(`${sources.ai} AI-estimated`);
        if (sources.fallback) parts.push(`${sources.fallback} default`);
        const note = parts.join(", ") || null;
        return Response.json({ grams, note, breakdown });
      },
    },
  },
});