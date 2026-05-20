import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/stock")({
  component: StockPage,
});

function StockPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Stock</h1>
      <p className="text-sm text-muted-foreground">Stock management coming soon.</p>
    </div>
  );
}