import { createFileRoute } from "@tanstack/react-router";

// Server route: search Amazon UK and return product image URL candidates.
// Returns up to ~6 candidates so a downstream picker (Gemini) can choose
// the most accurate one.  Used as a fallback when Mintsoft has no ImageURL.
export const Route = createFileRoute("/api/amazon-image")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const q = url.searchParams.get("q")?.trim();
        if (!q) {
          return Response.json({ error: "Missing q" }, { status: 400 });
        }
        const ua =
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
        const asinMatch = q.match(/\b(B0[A-Z0-9]{8})\b/i);
        // ASIN fast-path: fetch the product detail page directly and pull the
        // main landing image. Far more accurate than search-result scraping.
        if (asinMatch) {
          const asin = asinMatch[1].toUpperCase();
          try {
            const dp = await fetch(`https://www.amazon.co.uk/dp/${asin}`, {
              headers: {
                "User-Agent": ua,
                "Accept-Language": "en-GB,en;q=0.9",
                Accept: "text/html",
              },
            });
            if (dp.ok) {
              const html = await dp.text();
              if (!/awswaf|challenge-container|captcha|robot/i.test(html)) {
                const candidates: { image: string; title: string | null }[] = [];
                const seen = new Set<string>();
                const titleMatch = html.match(/<span[^>]+id="productTitle"[^>]*>([^<]+)<\/span>/i);
                const title = titleMatch ? titleMatch[1].trim() : null;
                // landingImage carries data-a-dynamic-image='{"url":[w,h], ...}'
                const dyn = html.match(/id="landingImage"[^>]+data-a-dynamic-image="([^"]+)"/i);
                if (dyn) {
                  try {
                    const obj = JSON.parse(dyn[1].replace(/&quot;/g, '"')) as Record<string, [number, number]>;
                    const sorted = Object.entries(obj).sort((a, b) => b[1][0] * b[1][1] - a[1][0] * a[1][1]);
                    for (const [u] of sorted) {
                      if (!seen.has(u)) {
                        seen.add(u);
                        candidates.push({ image: u, title });
                      }
                    }
                  } catch {
                    // ignore parse errors
                  }
                }
                const direct = html.match(/id="landingImage"[^>]+src="([^"]+)"/i);
                if (direct && !seen.has(direct[1])) {
                  seen.add(direct[1]);
                  candidates.push({ image: direct[1], title });
                }
                if (candidates.length > 0) {
                  return Response.json({
                    image: candidates[0].image,
                    candidates,
                    source: `amazon.co.uk/dp/${asin}`,
                    asin,
                    title,
                  });
                }
              }
            }
          } catch {
            // fall through to search
          }
        }
        const target = `https://www.amazon.co.uk/s?k=${encodeURIComponent(q)}`;
        try {
          const res = await fetch(target, {
            headers: {
              "User-Agent": ua,
              "Accept-Language": "en-GB,en;q=0.9",
              Accept: "text/html",
            },
          });
          if (!res.ok) {
            return Response.json({ image: null, candidates: [], status: res.status }, { status: 200 });
          }
          const html = await res.text();
          if (/awswaf|challenge-container|captcha|robot/i.test(html)) {
            return Response.json({ image: null, candidates: [], source: null });
          }
          const candidates: { image: string; title: string | null }[] = [];
          const seen = new Set<string>();
          const tiles = html.split(/data-component-type="s-search-result"/i);
          for (let i = 1; i < tiles.length && candidates.length < 6; i++) {
            const tile = tiles[i].slice(0, 8000);
            if (/AdHolder|Sponsored|"sp_"/i.test(tile)) continue;
            const m =
              tile.match(/<img[^>]+class="s-image"[^>]+src="([^"]+)"/i) ||
              tile.match(/<img[^>]+src="(https:\/\/m\.media-amazon\.com\/images\/I\/[^"]+)"/i);
            if (!m || !m[1] || seen.has(m[1])) continue;
            const titleMatch =
              tile.match(/<h2[^>]*>[\s\S]*?<span[^>]*>([^<]+)<\/span>/i) ||
              tile.match(/aria-label="([^"]+)"/i);
            seen.add(m[1]);
            candidates.push({
              image: m[1],
              title: titleMatch ? titleMatch[1].trim() : null,
            });
          }
          return Response.json({
            image: candidates[0]?.image ?? null,
            candidates,
            source: "amazon.co.uk",
          });
        } catch (err) {
          return Response.json(
            { image: null, candidates: [], error: err instanceof Error ? err.message : String(err) },
            { status: 200 },
          );
        }
      },
    },
  },
});
