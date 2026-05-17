import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/d/$slug")({
  server: {
    handlers: {
      GET: async ({ params }: { params: { slug: string } }) => {
        return new Response(null, {
          status: 302,
          headers: { Location: `/api/public/d/${params.slug}` },
        });
      },
    },
  },
  beforeLoad: ({ params }) => {
    throw redirect({ href: `/api/public/d/${params.slug}` });
  },
});