import { createFileRoute, redirect } from "@tanstack/react-router";
import { requireAuth } from "@/lib/require-auth";

export const Route = createFileRoute("/")({
  beforeLoad: async ({ location }) => {
    await requireAuth(location);
    throw redirect({ to: "/orders" });
  },
  component: () => null,
});
