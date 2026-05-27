import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";

export const Route = createFileRoute("/mobile/stock/transfer")({
  component: () => (
    <div className="flex-1 flex flex-col">
      <header className="px-3 pt-4 pb-3 border-b flex items-center gap-2">
        <Link to="/mobile" className="p-2 -ml-2 rounded-lg active:bg-muted">
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-lg font-semibold">Transfer Inventory</h1>
      </header>
      <div className="flex-1 p-5 text-sm text-muted-foreground">
        Transfer Inventory screen — coming next.
      </div>
    </div>
  ),
});