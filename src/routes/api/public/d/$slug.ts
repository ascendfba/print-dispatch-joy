import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

export const Route = createFileRoute("/api/public/d/$slug")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const slug = String(params.slug ?? "").toLowerCase();
        if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) {
          return new Response("Not found", { status: 404 });
        }

        const url = process.env.SUPABASE_URL!;
        const key =
          process.env.SUPABASE_PUBLISHABLE_KEY ??
          process.env.SUPABASE_ANON_KEY ??
          "";
        const supabase = createClient(url, key, {
          auth: { persistSession: false, autoRefreshToken: false },
        });

        const { data, error } = await supabase
          .from("dev_apps")
          .select("html, name, is_published")
          .eq("slug", slug)
          .eq("is_published", true)
          .maybeSingle();

        if (error || !data) {
          return new Response("Not found", { status: 404 });
        }

        return new Response(data.html ?? "", {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "public, max-age=60",
            "X-Robots-Tag": "noindex",
          },
        });
      },
    },
  },
});