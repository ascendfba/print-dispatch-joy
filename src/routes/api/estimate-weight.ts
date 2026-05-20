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
              `${idx + 1}. ${i.quantity}x ${i.sku ?? "?"} — ${i.description ?? "(no description)"}`,
          )
          .join("\n");

        const prompt = `You are estimating the total shipping weight (in grams) of an order based on item descriptions and quantities. Return ONLY a JSON object of the form {"grams": <integer>, "note": "<one-sentence reasoning>"}. Be pragmatic — guess a typical retail packaged weight per unit, multiply by quantity, sum, and add ~5% packaging. If a description is too vague, assume a small consumer product around 150g.

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
          let parsed: { grams?: number; note?: string } = {};
          try {
            parsed = JSON.parse(raw);
          } catch {
            const m = raw.match(/\{[\s\S]*\}/);
            if (m) parsed = JSON.parse(m[0]);
          }
          const grams = Math.max(0, Math.round(Number(parsed.grams) || 0));
          return Response.json({ grams, note: parsed.note ?? null });
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