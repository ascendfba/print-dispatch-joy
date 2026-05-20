import { createFileRoute } from "@tanstack/react-router";

type Item = { sku?: string; description?: string; quantity: number };

export const Route = createFileRoute("/api/estimate-weight")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env.GROQ_API_KEY;
        if (!key) {
          return Response.json({ error: "Missing GROQ_API_KEY" }, { status: 500 });
        }
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

        const lines = items
          .map(
            (i, idx) =>
              `${idx + 1}. qty=${i.quantity} sku=${i.sku ?? "?"} desc="${i.description ?? "(no description)"}"`,
          )
          .join("\n");

        const prompt = `You estimate total shipping weight (grams) for a UK warehouse order.

RULES (follow exactly):
1. For EACH line, estimate a realistic per-unit packaged weight in grams (typical retail product weight). Default to 150g if truly unknown.
2. line_total = per_unit_grams * qty.
3. subtotal = sum of all line_totals.
4. total = round(subtotal * 1.05)  (5% packaging overhead).
5. DO NOT ignore quantity. A line with qty=10 must be 10x the per-unit weight, not 1x.

Return ONLY strict JSON:
{
  "lines": [{"sku": "...", "qty": <int>, "per_unit_grams": <int>, "line_total_grams": <int>}],
  "subtotal_grams": <int>,
  "grams": <int>,
  "note": "<one sentence>"
}

Order items:
${lines}`;

        try {
          const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${key}`,
            },
            body: JSON.stringify({
              model: "llama-3.3-70b-versatile",
              messages: [{ role: "user", content: prompt }],
              response_format: { type: "json_object" },
            }),
          });
          if (!res.ok) {
            const txt = await res.text();
            return Response.json(
              { error: `Gateway ${res.status}: ${txt.slice(0, 200)}` },
              { status: res.status === 429 || res.status === 402 ? res.status : 502 },
            );
          }
          const data = (await res.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
          };
          const raw = data.choices?.[0]?.message?.content ?? "{}";
          let parsed: {
            grams?: number;
            subtotal_grams?: number;
            note?: string;
            lines?: Array<{ sku?: string; qty?: number; per_unit_grams?: number; line_total_grams?: number }>;
          } = {};
          try {
            parsed = JSON.parse(raw);
          } catch {
            const m = raw.match(/\{[\s\S]*\}/);
            if (m) parsed = JSON.parse(m[0]);
          }

          // Recompute from per-unit weights to guarantee qty is respected.
          let grams = 0;
          let note = parsed.note ?? null;
          if (Array.isArray(parsed.lines) && parsed.lines.length > 0) {
            // Map AI per-unit weights back to our items by SKU (fallback to index).
            let subtotal = 0;
            for (let i = 0; i < items.length; i++) {
              const item = items[i];
              const match =
                parsed.lines.find((l) => l.sku && item.sku && l.sku === item.sku) ??
                parsed.lines[i];
              const perUnit = Math.max(1, Math.round(Number(match?.per_unit_grams) || 150));
              subtotal += perUnit * item.quantity;
            }
            grams = Math.round(subtotal * 1.05);
          } else {
            grams = Math.max(0, Math.round(Number(parsed.grams) || 0));
          }
          return Response.json({ grams, note });
        } catch (e) {
          return Response.json(
            { error: e instanceof Error ? e.message : "Estimate failed" },
            { status: 500 },
          );
        }
      },
    },
  },
});