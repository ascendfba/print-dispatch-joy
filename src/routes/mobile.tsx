import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/mobile")({
  component: () => (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <Outlet />
    </div>
  ),
});