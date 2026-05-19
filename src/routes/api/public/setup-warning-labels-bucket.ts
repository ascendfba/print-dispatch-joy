import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const Route = createFileRoute("/api/public/setup-warning-labels-bucket")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const { data: existing } = await supabaseAdmin.storage.getBucket("warning-labels");
          if (!existing) {
            const { error } = await supabaseAdmin.storage.createBucket("warning-labels", {
              public: true,
            });
            if (error) {
              return new Response(
                JSON.stringify({ ok: false, error: error.message }),
                { status: 500, headers: { "Content-Type": "application/json" } },
              );
            }
          } else {
            await supabaseAdmin.storage.updateBucket("warning-labels", { public: true });
          }
          return new Response(
            JSON.stringify({ ok: true, bucket: "warning-labels", created: !existing }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        } catch (e) {
          return new Response(
            JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});