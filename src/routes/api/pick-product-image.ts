import { createFileRoute } from "@tanstack/react-router";

// POST /api/pick-product-image
// Body: { product: { name, ean?, upc?, sku?, description? }, candidates: [{image, title?}] }
// Uses Gemini multimodal to pick the candidate that most likely matches the
// real product. Returns { image: string|null, index: number|null, reason?: string }.

type Candidate = { image: string; title?: string | null };
type Body = {
  product: {
    name?: string | null;
    ean?: string | null;
    upc?: string | null;
    sku?: string | null;
    description?: string | null;
  };
  candidates: Candidate[];
};

export const Route = createFileRoute("/api/pick-product-image")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) {
          return Response.json({ image: null, error: "LOVABLE_API_KEY missing" }, { status: 500 });
        }
        let body: Body;
        try {
          body = (await request.json()) as Body;
        } catch {
          return Response.json({ image: null, error: "Invalid body" }, { status: 400 });
        }
        const candidates = (body.candidates ?? []).filter((c) => c && c.image).slice(0, 6);
        if (candidates.length === 0) {
          return Response.json({ image: null, index: null });
        }
        if (candidates.length === 1) {
          return Response.json({ image: candidates[0].image, index: 0, reason: "only candidate" });
        }

        const p = body.product ?? {};
        const contextLines = [
          p.name ? `Name: ${p.name}` : null,
          p.sku ? `SKU: ${p.sku}` : null,
          p.ean ? `EAN: ${p.ean}` : null,
          p.upc ? `UPC: ${p.upc}` : null,
          p.description ? `Description: ${p.description}` : null,
        ]
          .filter(Boolean)
          .join("\n");

        const userParts: Array<Record<string, unknown>> = [
          {
            type: "text",
            text:
              "You are choosing the most accurate product photo for a warehouse receiving system.\n\n" +
              "Product details:\n" +
              contextLines +
              "\n\n" +
              "Candidate images (in order). For each, an optional Amazon listing title is given.\n" +
              candidates
                .map(
                  (c, i) =>
                    `[${i}] title: ${c.title ?? "(no title)"}`,
                )
                .join("\n") +
              "\n\nPick the single image that best matches the actual product (consider brand, variant, size, colour, packaging). " +
              'Reply ONLY with strict JSON: {"index": <0-based number or null>, "reason": "<short>"}. ' +
              "Use null if none clearly match.",
          },
        ];
        for (const c of candidates) {
          userParts.push({ type: "image_url", image_url: { url: c.image } });
        }

        try {
          const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: "google/gemini-3-flash-preview",
              messages: [{ role: "user", content: userParts }],
              temperature: 0,
            }),
          });
          if (!r.ok) {
            const text = await r.text();
            return Response.json(
              { image: candidates[0].image, index: 0, error: `gemini ${r.status}: ${text.slice(0, 200)}` },
              { status: 200 },
            );
          }
          const data = (await r.json()) as {
            choices?: { message?: { content?: string } }[];
          };
          const raw = data.choices?.[0]?.message?.content ?? "";
          const m = raw.match(/\{[\s\S]*\}/);
          let pick: { index: number | null; reason?: string } | null = null;
          if (m) {
            try {
              pick = JSON.parse(m[0]);
            } catch {
              pick = null;
            }
          }
          if (!pick || pick.index === null || pick.index === undefined) {
            return Response.json({ image: null, index: null, reason: pick?.reason ?? "no match" });
          }
          const idx = Math.max(0, Math.min(candidates.length - 1, Number(pick.index)));
          return Response.json({
            image: candidates[idx].image,
            index: idx,
            reason: pick.reason ?? null,
          });
        } catch (err) {
          return Response.json(
            {
              image: candidates[0].image,
              index: 0,
              error: err instanceof Error ? err.message : String(err),
            },
            { status: 200 },
          );
        }
      },
    },
  },
});