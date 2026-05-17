import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/d/")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        return new Response(null, {
          status: 302,
          headers: { Location: `/api/public/d/${params.slug}` },
        });
      },
    },
  },
});
