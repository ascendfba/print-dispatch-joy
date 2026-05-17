import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/d/")({
  server: {
    handlers: {
      GET: async (ctx: any) => {
        const slug = String(ctx?.params?.slug ?? "");
        return new Response(null, {
          status: 302,
          headers: { Location: `/api/public/d/${slug}` },
        });
      },
    },
  },
});
