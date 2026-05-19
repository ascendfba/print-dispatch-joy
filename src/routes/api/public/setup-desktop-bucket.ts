import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const Route = createFileRoute("/api/public/setup-desktop-bucket")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = request.headers.get("x-setup-secret");
        if (secret !== process.env.SB_SERVICE_ROLE_KEY) {
          return new Response("forbidden", { status: 403 });
        }
        const { data: existing } = await supabaseAdmin.storage.getBucket("desktop-app");
        if (!existing) {
          const { error } = await supabaseAdmin.storage.createBucket("desktop-app", {
            public: true,
            fileSizeLimit: 500 * 1024 * 1024,
          });
          if (error) return new Response(`create: ${error.message}`, { status: 500 });
        }
        // Upload via passed URL
        const url = new URL(request.url).searchParams.get("from");
        if (url) {
          const r = await fetch(url);
          if (!r.ok) return new Response(`fetch: ${r.status}`, { status: 500 });
          const buf = new Uint8Array(await r.arrayBuffer());
          const { error } = await supabaseAdmin.storage
            .from("desktop-app")
            .upload("DispatchConsole-win32-x64.zip", buf, {
              contentType: "application/zip",
              upsert: true,
            });
          if (error) return new Response(`upload: ${error.message}`, { status: 500 });
        }
        return Response.json({ ok: true });
      },
    },
  },
});
