import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runMintsoftSync } from "@/lib/mintsoft-sync.server";

export const Route = createFileRoute("/api/public/cron/sync-mintsoft")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const provided = request.headers.get("x-cron-secret") ?? "";
        const { data, error } = await supabaseAdmin.rpc("get_mintsoft_cron_secret");
        if (error || !data || typeof data !== "string") {
          return new Response("Cron secret unavailable", { status: 500 });
        }
        if (provided.length === 0 || provided !== data) {
          return new Response("Unauthorized", { status: 401 });
        }
        try {
          const result = await runMintsoftSync();
          return Response.json({ ok: true, ...result });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return new Response(JSON.stringify({ ok: false, error: msg }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});