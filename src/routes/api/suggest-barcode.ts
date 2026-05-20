import { createFileRoute } from "@tanstack/react-router";

// POST /api/suggest-barcode
// Body: { name?: string, sku?: string, description?: string }
// Returns: { barcode: string|null, type?: "EAN"|"UPC", confidence?: "low"|"medium"|"high", reason?: string, sources?: string[] }
//
// Pipeline: search Google for "<product> EAN/barcode", scrape the top results,
// extract candidate 8-14 digit codes with surrounding context, then ask Gemini
// to pick the most likely real barcode for this exact product.

type Body = {
  name?: string | null;
  sku?: string | null;
  description?: string | null;
};

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function fetchHtml(url: string, timeoutMs = 6000): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), timeoutMs);
    const r = await fetch(url, {
      headers: { "User-Agent": UA, "Accept-Language": "en-GB,en;q=0.9", Accept: "text/html" },
      signal: ctrl.signal,
    });
    clearTimeout(to);
    if (!r.ok) return null;
    return await r.text();
  } catch {
    return null;
  }
}

function extractGoogleResultLinks(html: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /\/url\?q=(https?:\/\/[^&"]+)&/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < 8) {
    try {
      const u = decodeURIComponent(m[1]);
      if (/google\.|gstatic|webcache/i.test(u)) continue;
      if (seen.has(u)) continue;
      seen.add(u);
      out.push(u);
    } catch {
      // skip
    }
  }
  return out;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function isValidEan13(d: string): boolean {
  if (d.length !== 13) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const n = Number(d[i]);
    sum += i % 2 === 0 ? n : n * 3;
  }
  const check = (10 - (sum % 10)) % 10;
  return check === Number(d[12]);
}

function isValidUpcA(d: string): boolean {
  if (d.length !== 12) return false;
  let sum = 0;
  for (let i = 0; i < 11; i++) {
    const n = Number(d[i]);
    sum += i % 2 === 0 ? n * 3 : n;
  }
  const check = (10 - (sum % 10)) % 10;
  return check === Number(d[11]);
}

type Candidate = { digits: string; context: string; source: string };

function extractBarcodes(text: string, source: string): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>();
  const re = /(?<!\d)(\d{12,14})(?!\d)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) && out.length < 8) {
    const d = m[1];
    if (seen.has(d)) continue;
    if (!(isValidEan13(d) || isValidUpcA(d) || d.length === 14)) continue;
    seen.add(d);
    const start = Math.max(0, m.index - 60);
    const end = Math.min(text.length, m.index + d.length + 60);
    out.push({ digits: d, context: text.slice(start, end).trim(), source });
  }
  return out;
}

export const Route = createFileRoute("/api/suggest-barcode")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.GROQ_API_KEY;
        if (!apiKey) {
          return Response.json(
            { barcode: null, error: "GROQ_API_KEY missing" },
            { status: 500 },
          );
        }
        let body: Body;
        try {
          body = (await request.json()) as Body;
        } catch {
          return Response.json({ barcode: null, error: "Invalid body" }, { status: 400 });
        }
        const name = (body.name ?? "").toString().trim();
        const sku = (body.sku ?? "").toString().trim();
        const description = (body.description ?? "").toString().trim();
        if (!name && !sku) {
          return Response.json({ barcode: null, error: "Need name or SKU" }, { status: 400 });
        }

        // 1) Web search for the product + barcode. Build the query from
        // name + the most descriptive bits of the description (size, pack,
        // variant) so vague SKUs/names still produce relevant matches.
        const descSnippet = description
          .replace(/\s+/g, " ")
          .slice(0, 120)
          .trim();
        const queryParts = [name || sku, descSnippet, "EAN barcode"].filter(Boolean);
        const query = queryParts.join(" ");
        const enc = encodeURIComponent(query);
        const searchHtml = await fetchHtml(
          `https://www.google.com/search?q=${enc}&hl=en&gl=uk`,
        );
        const links = searchHtml ? extractGoogleResultLinks(searchHtml) : [];

        // 2) Scrape candidate pages and extract barcode digits.
        const candidates: Candidate[] = [];
        const sources: string[] = [];
        if (searchHtml) {
          const fromSerp = extractBarcodes(stripHtml(searchHtml), "google-results");
          candidates.push(...fromSerp);
        }
        const topLinks = links.slice(0, 4);
        await Promise.all(
          topLinks.map(async (url) => {
            const html = await fetchHtml(url, 5000);
            if (!html) return;
            const text = stripHtml(html);
            const found = extractBarcodes(text, url);
            if (found.length) {
              sources.push(url);
              candidates.push(...found);
            }
          }),
        );

        // De-dupe by digits, keep first context.
        const byDigits = new Map<string, Candidate>();
        for (const c of candidates) {
          if (!byDigits.has(c.digits)) byDigits.set(c.digits, c);
        }
        const uniqueCandidates = Array.from(byDigits.values()).slice(0, 10);

        const prompt =
          "You are a product-identification assistant for a UK warehouse. " +
          "Choose the most likely retail barcode (EAN-13 or UPC-A) for this exact product variant. " +
          "Use ONLY the web-scraped candidates below; do not invent digits. " +
          "If none of the candidates clearly match the product (brand, variant, size, pack count), return null.\n\n" +
          `Name: ${name || "(unknown)"}\n` +
          `SKU: ${sku || "(unknown)"}\n` +
          `Description: ${description || "(none)"}\n\n` +
          (uniqueCandidates.length
            ? "Candidates extracted from web pages (digits + surrounding text + source URL):\n" +
              uniqueCandidates
                .map(
                  (c, i) =>
                    `[${i}] ${c.digits}\n    context: "${c.context.replace(/"/g, "'")}"\n    source: ${c.source}`,
                )
                .join("\n")
            : "No web candidates were found. You may still suggest a barcode from your training knowledge if highly confident, otherwise return null.") +
          "\n\nConfidence rubric:\n" +
          "- high: barcode appears on a reputable product page that clearly matches name + variant + size\n" +
          "- medium: barcode appears on a relevant page but variant/size match is partial\n" +
          "- low: weak match or from training memory only\n\n" +
          'Reply ONLY as strict JSON: {"barcode": "<digits or null>", "type": "EAN"|"UPC", "confidence": "low"|"medium"|"high", "reason": "<one sentence citing the source or why none match>"}';

        try {
          const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: "llama-3.3-70b-versatile",
              messages: [{ role: "user", content: prompt }],
              temperature: 0,
              response_format: { type: "json_object" },
            }),
          });
          if (!r.ok) {
            const text = await r.text();
            return Response.json(
              { barcode: null, error: `groq ${r.status}: ${text.slice(0, 200)}` },
              { status: 200 },
            );
          }
          const data = (await r.json()) as {
            choices?: { message?: { content?: string } }[];
          };
          const raw = data.choices?.[0]?.message?.content ?? "";
          const m = raw.match(/\{[\s\S]*\}/);
          if (!m) {
            return Response.json({ barcode: null, reason: "no JSON in response" });
          }
          let parsed: {
            barcode?: string | null;
            type?: string;
            confidence?: string;
            reason?: string;
          };
          try {
            parsed = JSON.parse(m[0]);
          } catch {
            return Response.json({ barcode: null, reason: "invalid JSON" });
          }
          const digits = (parsed.barcode ?? "").toString().replace(/\D/g, "");
          if (!digits || digits.length < 8 || digits.length > 14) {
            return Response.json({
              barcode: null,
              reason: parsed.reason ?? "no confident match",
              sources,
            });
          }
          return Response.json({
            barcode: digits,
            type: parsed.type === "UPC" ? "UPC" : "EAN",
            confidence: parsed.confidence ?? "low",
            reason: parsed.reason ?? "",
            sources,
          });
        } catch (err) {
          return Response.json(
            { barcode: null, error: err instanceof Error ? err.message : String(err) },
            { status: 200 },
          );
        }
      },
    },
  },
});