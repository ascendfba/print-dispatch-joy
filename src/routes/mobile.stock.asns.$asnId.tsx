import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, Truck, Loader2, Package } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { fetchASN, fetchASNItems, type MintsoftASNItem } from "@/lib/mintsoft";
import { loadSettings } from "@/lib/storage";

export const Route = createFileRoute("/mobile/stock/asns/$asnId")({
  component: MobileASNDetail,
});

function MobileASNDetail() {
  const { asnId } = Route.useParams();
  const id = Number(asnId);

  const asnQuery = useQuery({
    queryKey: ["mobile-asn", id],
    queryFn: async () => {
      const settings = loadSettings();
      return fetchASN(settings, id);
    },
    staleTime: 60_000,
  });

  const itemsQuery = useQuery({
    queryKey: ["mobile-asn-items", id],
    queryFn: async () => {
      const settings = loadSettings();
      return fetchASNItems(settings, id);
    },
    staleTime: 60_000,
  });

  const asn = asnQuery.data;
  const items = itemsQuery.data ?? [];

  return (
    <div className="flex-1 flex flex-col">
      <header className="px-3 pt-4 pb-3 border-b flex items-center gap-2 bg-gradient-to-r from-[#0a2e3d] via-[#0d3a4d] to-[#0a2e3d]">
        <Link to="/mobile/stock/asns" className="p-2 -ml-2 rounded-lg active:bg-white/10">
          <ChevronLeft className="h-5 w-5 text-white" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-semibold text-white truncate">
            {asn?.Reference || `ASN #${id}`}
          </h1>
          {asn?.SupplierName && (
            <p className="text-xs text-white/70 truncate">{asn.SupplierName}</p>
          )}
        </div>
        <div className="rounded-lg p-2 bg-white/10">
          <Truck className="h-4 w-4 text-white" />
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {itemsQuery.isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading items…
          </div>
        ) : itemsQuery.error ? (
          <div className="py-8 text-center text-sm text-destructive">
            {itemsQuery.error instanceof Error
              ? itemsQuery.error.message
              : "Failed to load items"}
          </div>
        ) : items.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No items on this ASN
          </div>
        ) : (
          items.map((it, idx) => <ASNItemRow key={it.ID ?? idx} item={it} />)
        )}
      </div>
    </div>
  );
}

function ASNItemRow({ item }: { item: MintsoftASNItem }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border bg-card p-3">
      <div className="h-16 w-16 rounded-lg bg-muted overflow-hidden shrink-0 flex items-center justify-center">
        {item.ImageURL ? (
          <img
            src={item.ImageURL}
            alt={item.Title ?? item.SKU ?? "Product"}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <Package className="h-6 w-6 text-muted-foreground" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-snug line-clamp-2">
          {item.Title || item.Description || item.SKU || "Untitled product"}
        </p>
        {item.SKU && (
          <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
            SKU: {item.SKU}
          </p>
        )}
        <div className="mt-1.5 flex items-center gap-3 text-[11px]">
          <span className="inline-flex items-center rounded-full px-2 py-0.5 font-medium bg-[#0099d4]/10 text-[#0099d4]">
            Expected {item.ExpectedQuantity ?? 0}
          </span>
          {item.ReceivedQuantity != null && item.ReceivedQuantity > 0 && (
            <span className="text-muted-foreground">
              Received {item.ReceivedQuantity}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}