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
        const target = `https://www.amazon.co.uk/s?k=${encodeURIComponent(q)}`;
        try {
          const res = await fetch(target, {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
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
