import { createFileRoute } from "@tanstack/react-router";

// Server route: search Google Images and return product image URL candidates.
// Falls back to Bing Images if Google blocks the request.

type Candidate = { image: string; title: string | null; source: string };

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept-Language": "en-GB,en;q=0.9",
        Accept: "text/html",
      },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function extractGoogle(html: string): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>();
  // Google Images embeds candidate URLs in inline JSON. Pull any
  // https://...{jpg,jpeg,png,webp} link that isn't a Google-hosted thumb.
  const re = /"(https?:\/\/[^"\\\s]+?\.(?:jpg|jpeg|png|webp))"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < 8) {
    const url = m[1];
    if (seen.has(url)) continue;
    if (/gstatic\.com|google\.com\/images|googleusercontent\.com\/proxy/i.test(url)) continue;
    seen.add(url);
    out.push({ image: url, title: null, source: "google" });
  }
  return out;
}

function extractBing(html: string): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>();
  // Bing wraps each result in <a class="iusc" m="{...murl:...}">
  const re = /m="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < 8) {
    try {
      const decoded = m[1].replace(/&quot;/g, '"');
      const obj = JSON.parse(decoded) as { murl?: string; t?: string };
      if (obj.murl && !seen.has(obj.murl)) {
        seen.add(obj.murl);
        out.push({ image: obj.murl, title: obj.t ?? null, source: "bing" });
      }
    } catch {
      // skip malformed
    }
  }
  return out;
}

export const Route = createFileRoute("/api/google-image")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const q = url.searchParams.get("q")?.trim();
        if (!q) return Response.json({ error: "Missing q" }, { status: 400 });

        const enc = encodeURIComponent(q);
        // Firecrawl-powered image search (most reliable from a Worker IP).
        // We scrape Bing Images via Firecrawl which renders JS and bypasses
        // most blocks. Google/Bing direct fetch is kept as a final fallback.
        const firecrawlKey = process.env.FIRECRAWL_API_KEY;
        if (firecrawlKey) {
          try {
            const fc = await fetch("https://api.firecrawl.dev/v2/scrape", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${firecrawlKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                url: `https://www.bing.com/images/search?q=${enc}&form=HDRSC2`,
                formats: ["html"],
                onlyMainContent: false,
                location: { country: "GB", languages: ["en-GB"] },
              }),
            });
            if (fc.ok) {
              const data = (await fc.json()) as {
                data?: { html?: string };
                html?: string;
              };
              const html = data.data?.html ?? data.html ?? "";
              if (html) {
                const cs = extractBing(html);
                if (cs.length > 0) {
                  return Response.json({ image: cs[0].image, candidates: cs });
                }
              }
            }
          } catch {
            // fall through to direct fetch
          }
        }
        // Try Google Images first.
        const gHtml = await fetchHtml(`https://www.google.com/search?tbm=isch&q=${enc}&hl=en`);
        let candidates: Candidate[] = [];
        if (gHtml && !/sorry\/index|unusual traffic/i.test(gHtml)) {
          candidates = extractGoogle(gHtml);
        }
        // Fallback to Bing Images if Google produced nothing.
        if (candidates.length === 0) {
          const bHtml = await fetchHtml(`https://www.bing.com/images/search?q=${enc}&form=HDRSC2`);
          if (bHtml) candidates = extractBing(bHtml);
        }
        return Response.json({
          image: candidates[0]?.image ?? null,
          candidates,
        });
      },
    },
  },
});